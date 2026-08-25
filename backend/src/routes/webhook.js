import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens, webhookLog, filiais, filialWhatsappExtra, incidentes } from '../db/schema.js';
import { eq, and, ne, lt, sql as sqlRaw } from 'drizzle-orm';
import { processarMensagem } from '../services/ai.js';
import { buscarDadosCliente } from '../services/sgp.js';
import { dividirEmBlocos } from '../services/blocosResposta.js';
import { enviarMensagem, transcreverAudioMeta, downloadMidiaBase64, baixarArquivoUrl, uploadMidia, enviarMidia } from '../services/whatsapp.js';
import { realizarHandoff } from '../services/handoff.js';
import { enviarPushParaTenant } from '../services/pushNotification.js';
import { dentroDoHorario, proximoAtendimento } from '../services/horarios.js';
import { getLimite, getUso, incrementarUso } from '../services/limites.js';
import { registrarAtividade } from '../jobs/encerramentoInativo.js';
import { processarRespostaNps } from '../services/nps.js';
import crypto from 'crypto';

const router = Router();
let avisoAppSecretAusenteExibido = false;

// Janela após a qual uma entrega não concluída é considerada abandonada. Serve
// para separar a retentativa da Meta (que vem depois) de uma entrega duplicada
// quase simultânea. O corte é calculado no banco: recebido_em é timestamp sem
// fuso e uma Date do JS chega com offset local, que o Postgres descarta —
// a comparação erraria por horas fora de UTC.
const REPROCESSAR_APOS = sqlRaw`now() - interval '60 seconds'`;

// Marca a mensagem como "em processamento" e devolve se cabe a nós tratá-la.
// Antes o wamid era gravado antes de processar e nunca confirmado: se o
// processo caísse no meio — um deploy, por exemplo — a retentativa da Meta era
// descartada como duplicada e o cliente ficava sem resposta.
async function reservarWamid(wamid, tenantId) {
  const [novo] = await db.insert(webhookLog)
    .values({ wamid, tenantId })
    .onConflictDoNothing()
    .returning({ wamid: webhookLog.wamid });
  if (novo) return true;

  // Já existe: só reprocessa o que ficou pendente tempo suficiente. O
  // UPDATE ... RETURNING é atômico, então só uma entrega concorrente assume.
  const [retomado] = await db.update(webhookLog)
    .set({ recebidoEm: sqlRaw`now()` })
    .where(and(
      eq(webhookLog.wamid, wamid),
      eq(webhookLog.processado, false),
      lt(webhookLog.recebidoEm, REPROCESSAR_APOS),
    ))
    .returning({ wamid: webhookLog.wamid });
  return !!retomado;
}

async function confirmarWamid(wamid) {
  await db.update(webhookLog)
    .set({ processado: true })
    .where(eq(webhookLog.wamid, wamid))
    .catch(err => console.error('[Webhook] Falha ao confirmar wamid:', err.message));
}

function assinaturaMetaValida(req) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (!avisoAppSecretAusenteExibido) {
      console.warn('[Webhook] META_APP_SECRET ausente; validação de assinatura da Meta não está ativa.');
      avisoAppSecretAusenteExibido = true;
    }
    return true;
  }

  const recebida = req.get('x-hub-signature-256');
  if (!recebida?.startsWith('sha256=') || !req.rawBody) return false;

  const esperada = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex')}`;
  const recebidaBuffer = Buffer.from(recebida);
  const esperadaBuffer = Buffer.from(esperada);
  return recebidaBuffer.length === esperadaBuffer.length
    && crypto.timingSafeEqual(recebidaBuffer, esperadaBuffer);
}

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

router.post('/', async (req, res) => {
  if (!assinaturaMetaValida(req)) {
    return res.status(401).json({ erro: 'Assinatura de webhook inválida' });
  }
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;

        // Processa atualizações de status (entregue / lida)
        for (const s of value.statuses || []) {
          if (s.status === 'delivered') {
            await db.update(mensagens).set({ status: 'entregue' }).where(eq(mensagens.wamid, s.id)).catch(() => {});
          } else if (s.status === 'read') {
            await db.update(mensagens).set({ status: 'lida' }).where(eq(mensagens.wamid, s.id)).catch(() => {});
          }
        }

        const msgs = value.messages;
        if (!msgs?.length) continue;

        // Resolve tenant — primeiro pelo número principal, depois por número de
        // filial (principal ou adicional — uma filial pode ter mais de um número)
        let tenant = null;
        let filialEntrada = null;

        const [tenantDireto] = await db.select().from(tenants)
          .where(and(eq(tenants.whatsappNumberId, phoneNumberId), eq(tenants.ativo, true)))
          .limit(1);

        if (tenantDireto) {
          tenant = tenantDireto;
        } else {
          const [filialWpp] = await db.select().from(filiais)
            .where(eq(filiais.whatsappNumberId, phoneNumberId))
            .limit(1);
          if (filialWpp) {
            filialEntrada = filialWpp;
          } else {
            const [extra] = await db.select().from(filialWhatsappExtra)
              .where(eq(filialWhatsappExtra.whatsappNumberId, phoneNumberId))
              .limit(1);
            if (extra) {
              const [filialDoExtra] = await db.select().from(filiais)
                .where(eq(filiais.id, extra.filialId))
                .limit(1);
              if (filialDoExtra) {
                filialEntrada = { ...filialDoExtra, whatsappNumberId: extra.whatsappNumberId, whatsappToken: extra.whatsappToken };
              }
            }
          }
          if (filialEntrada) {
            const [tenantDaFilial] = await db.select().from(tenants)
              .where(and(eq(tenants.id, filialEntrada.tenantId), eq(tenants.ativo, true)))
              .limit(1);
            if (tenantDaFilial) tenant = tenantDaFilial;
            else filialEntrada = null;
          }
        }
        if (!tenant) continue;

        // Config efetiva de envio — usa token/número da filial se ela tiver o próprio
        const wConfig = (filialEntrada?.whatsappToken && filialEntrada?.whatsappNumberId)
          ? { ...tenant, whatsappNumberId: filialEntrada.whatsappNumberId, whatsappToken: filialEntrada.whatsappToken }
          : tenant;

        // Mapa wa_id -> nome do perfil WhatsApp do remetente
        const contatosWa = {};
        for (const c of value.contacts || []) {
          if (c.wa_id && c.profile?.name) contatosWa[c.wa_id] = c.profile.name;
        }

        for (const msg of msgs) {
          const wamid = msg.id;
          const remetente = msg.from;
          const nomeWa = contatosWa[remetente] || null;

          // Ligações: avisa e ignora
          if (msg.type === 'call') {
            try { await enviarMensagem(wConfig, remetente, 'Este *whatsapp* é automatizado, não permite ligações por aqui.\n\nMande um *áudio* ou *mensagem* dizendo o que deseja.'); } catch {}
            continue;
          }

          let texto = null;
          let isAudio = false;

          if (msg.type === 'text') {
            texto = msg.text?.body;
            if (!texto) continue;
          } else if (msg.type === 'audio') {
            const mediaId = msg.audio?.id;
            if (!mediaId) continue;
            try {
              texto = await transcreverAudioMeta(wConfig, mediaId);
              if (!texto) continue;
              isAudio = true;
              if (!await reservarWamid(wamid, tenant.id)) continue;
              await processarWebhookMsg(tenant, remetente, texto, wamid, true, mediaId, nomeWa, filialEntrada);
              await confirmarWamid(wamid);
              continue;
            } catch (err) {
              console.error('[Webhook] Erro ao transcrever áudio:', err.message);
              try { await enviarMensagem(wConfig, remetente, 'Recebi seu áudio, mas não consegui processá-lo. Por favor, tente enviar uma mensagem de texto.'); } catch {}
              continue;
            }
          } else if (msg.type === 'image') {
            const mediaId = msg.image?.id;
            if (!mediaId) continue;
            const caption = msg.image?.caption ? ` — "${msg.image.caption}"` : '';
            texto = `[Imagem]${caption}`;
            let midiaData = null;
            try { midiaData = await downloadMidiaBase64(wConfig, mediaId); } catch (err) {
              console.error('[Webhook] Erro ao baixar imagem:', err.message);
            }
            if (!await reservarWamid(wamid, tenant.id)) continue;
            await processarWebhookMsg(tenant, remetente, texto, wamid, false, mediaId, nomeWa, filialEntrada, midiaData);
            await confirmarWamid(wamid);
            continue;
          } else if (msg.type === 'document') {
            const mediaId = msg.document?.id;
            if (!mediaId) continue;
            const nomeArquivo = msg.document?.filename || 'documento';
            texto = `[Documento] ${nomeArquivo}`;
            let midiaData = null;
            const mimeDoc = msg.document?.mime_type || '';
            if (mimeDoc === 'application/pdf') {
              try { midiaData = await downloadMidiaBase64(wConfig, mediaId); } catch (err) {
                console.error('[Webhook] Erro ao baixar PDF:', err.message);
              }
            }
            if (!await reservarWamid(wamid, tenant.id)) continue;
            await processarWebhookMsg(tenant, remetente, texto, wamid, false, mediaId, nomeWa, filialEntrada, midiaData);
            await confirmarWamid(wamid);
            continue;
          } else if (msg.type === 'video') {
            const mediaId = msg.video?.id;
            if (!mediaId) continue;
            const caption = msg.video?.caption ? ` — "${msg.video.caption}"` : '';
            texto = `[Vídeo]${caption}`;
            if (!await reservarWamid(wamid, tenant.id)) continue;
            await processarWebhookMsg(tenant, remetente, texto, wamid, false, mediaId, nomeWa, filialEntrada, null);
            await confirmarWamid(wamid);
            continue;
          } else {
            // Ignora outros tipos silenciosamente (sticker, reação, etc.)
            continue;
          }

          if (!await reservarWamid(wamid, tenant.id)) continue;
          await processarWebhookMsg(tenant, remetente, texto, wamid, isAudio, null, nomeWa, filialEntrada);
          await confirmarWamid(wamid);
        }
      }
    }
  } catch (err) {
    console.error('Erro no webhook:', err);
  }
});

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function atualizarUltMsg(conversaId, conteudo, origem, nome = null) {
  const preview = conteudo.replace(/^\[(Áudio|Imagem|Arquivo)\] /, '').slice(0, 200);
  await db.update(conversas).set({
    ultimaMensagem: preview,
    ultimaMsgEm: new Date(),
    ultimaMsgOrigem: origem,
    ultimaMsgNome: nome,
  }).where(eq(conversas.id, conversaId));
}

async function processarWebhookMsg(tenant, remetente, texto, wamid, isAudio = false, midiaUrl = null, nomeWa = null, filialEntrada = null, midiaData = null) {
  registrarAtividade();
  // Config efetiva de envio — usa número/token da filial se ela tiver o próprio
  const wConfig = (filialEntrada?.whatsappToken && filialEntrada?.whatsappNumberId)
    ? { ...tenant, whatsappNumberId: filialEntrada.whatsappNumberId, whatsappToken: filialEntrada.whatsappToken }
    : tenant;

  let [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.tenantId, tenant.id), eq(clientes.whatsapp, remetente)))
    .limit(1);

  if (!cliente) {
    [cliente] = await db.insert(clientes).values({
      tenantId: tenant.id,
      whatsapp: remetente,
      nome: nomeWa || remetente,
    }).returning();
  } else {
    const update = { ultimoContato: new Date() };
    // Atualiza nome com o do WhatsApp se ainda estiver sem nome real
    if (nomeWa && /^\d+$/.test(cliente.nome || '')) {
      update.nome = nomeWa;
    }
    await db.update(clientes).set(update).where(eq(clientes.id, cliente.id));
    if (update.nome) cliente = { ...cliente, nome: update.nome };
  }

  // Enriquece dados do cliente com informações do SGP do provedor
  try {
    const dadosSgp = await buscarDadosCliente(tenant, remetente);
    if (dadosSgp) {
      const update = {};
      if (dadosSgp.nome && !/^\d+$/.test(dadosSgp.nome)) update.nome = dadosSgp.nome;
      if (dadosSgp.contratoId) update.contratoId = dadosSgp.contratoId;
      if (dadosSgp.statusContrato) update.statusContrato = dadosSgp.statusContrato;
      if (dadosSgp.filialNome) update.filialNome = dadosSgp.filialNome;
      if (Object.keys(update).length > 0) {
        await db.update(clientes).set(update).where(eq(clientes.id, cliente.id));
        cliente = { ...cliente, ...update };
      }
    }
  } catch (err) {
    console.error('[SGP] Erro ao enriquecer cliente:', err.message);
  }

  // Verifica se é resposta de NPS pendente ANTES de criar/abrir conversa
  // Isso evita abrir uma nova conversa só para a resposta do NPS
  if (!isAudio) {
    const foiNps = await processarRespostaNps(tenant, remetente, texto, wamid);
    if (foiNps) return;
  }

  let [conversa] = await db.select().from(conversas)
    .where(and(
      eq(conversas.tenantId, tenant.id),
      eq(conversas.clienteId, cliente.id),
      ne(conversas.status, 'encerrada')
    ))
    .limit(1);

  if (!conversa) {
    [conversa] = await db.insert(conversas).values({
      tenantId: tenant.id,
      clienteId: cliente.id,
      status: 'bot',
      filialId: filialEntrada?.id || null,
      numeroRecebidoId: wConfig.whatsappNumberId || null,
    }).returning();
  }

  const conteudoCliente = isAudio ? `[Áudio] ${texto}` : texto;
  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'cliente',
    conteudo: conteudoCliente,
    wamid,
    midiaUrl: midiaUrl || null,
  });
  await atualizarUltMsg(conversa.id, conteudoCliente, 'cliente');

  // Notificação push para agentes do tenant
  enviarPushParaTenant(tenant.id, {
    title: cliente.nome !== remetente ? cliente.nome : 'Nova mensagem',
    body: isAudio ? '🎤 Áudio recebido' : texto.slice(0, 100),
    tag: conversa.id,
  }).catch(() => {});

  // Se aguardando seleção de filial (legado), reseta para bot e continua normalmente
  if (conversa.status === 'aguardando_filial') {
    await db.update(conversas).set({ status: 'bot' }).where(eq(conversas.id, conversa.id));
    conversa = { ...conversa, status: 'bot' };
  }

  // Se humano está atendendo, não aciona IA
  if (conversa.status === 'humano') return;

  // Verifica incidente ativo — responde automaticamente ao cliente
  const [incidenteAtivo] = await db.select().from(incidentes)
    .where(and(eq(incidentes.tenantId, tenant.id), eq(incidentes.status, 'ativo')))
    .orderBy(incidentes.criadoEm)
    .limit(1);
  if (incidenteAtivo) {
    const msg = incidenteAtivo.mensagemBot ||
      `⚠️ *${incidenteAtivo.titulo}*\n\nEstamos cientes do problema e nossa equipe já está trabalhando na solução. Pedimos desculpas pelo transtorno.`;
    await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msg });
    await atualizarUltMsg(conversa.id, msg, 'bot');
    try { await enviarMensagem(wConfig, remetente, msg); } catch {}
    return;
  }

  // Verifica se tenant tem filiais e se conversa já tem filial atribuída
  if (!conversa.filialId) {
    const filiaisAtivas = await db.select().from(filiais)
      .where(and(eq(filiais.tenantId, tenant.id), eq(filiais.ativo, true)))
      .orderBy(filiais.nome);

    if (filiaisAtivas.length > 0) {
      // Tenta roteamento automático via SGP
      let filialId = null;
      if (cliente.filialNome) {
        const match = filiaisAtivas.find(f =>
          normalizar(f.nome).includes(normalizar(cliente.filialNome)) ||
          normalizar(f.cidade).includes(normalizar(cliente.filialNome)) ||
          normalizar(cliente.filialNome).includes(normalizar(f.cidade))
        );
        if (match) filialId = match.id;
      }

      if (filialId) {
        await db.update(conversas).set({ filialId }).where(eq(conversas.id, conversa.id));
        conversa = { ...conversa, filialId };
      }
      // Sem match automático: tenta roteamento por palavra-chave se disponível
      if (!filialId) {
        const regrasFilial = (tenant.horarios?.regrasRoteamento || [])
          .filter(r => r.ativo !== false && r.acao === 'filial' && r.tipo === 'keyword');
        if (regrasFilial.length > 0) {
          const textoLower = texto.toLowerCase();
          for (const regra of regrasFilial) {
            const keywords = (regra.valor || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            if (keywords.some(k => textoLower.includes(k)) && regra.destinoId) {
              await db.update(conversas).set({ filialId: regra.destinoId }).where(eq(conversas.id, conversa.id));
              conversa = { ...conversa, filialId: regra.destinoId };
              break;
            }
          }
        }
      }
    }
  }

  // Bloqueia bot se conta suspensa por inadimplência
  if (tenant.statusPagamento === 'suspenso') {
    const msg = 'Nosso atendimento automático está temporariamente suspenso. Por favor, entre em contato diretamente com o provedor.';
    try { await enviarMensagem(wConfig, remetente, msg); } catch {}
    return;
  }

  // Verifica limite mensal de IA
  const contagemAtual = await getUso(tenant.id);
  const limiteAtual = getLimite(tenant.plano);
  if (contagemAtual >= limiteAtual) {
    const msgBloqueio = '⛔ Nosso assistente virtual está temporariamente indisponível. Por favor, aguarde ou entre em contato pelo telefone do provedor.';
    await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msgBloqueio });
    try { await enviarMensagem(wConfig, remetente, msgBloqueio); } catch {}
    return;
  }

  // Chama IA
  const historico = await db.select().from(mensagens)
    .where(eq(mensagens.conversaId, conversa.id))
    .orderBy(mensagens.enviadaEm);

  // Fora do horário o assistente continua atendendo — só precisa saber que não
  // há atendente humano para assumir e quando a equipe retorna.
  const humanoDisponivel = dentroDoHorario(tenant.horarios);
  const resultado = await processarMensagem(tenant, conversa, historico, texto, remetente, midiaData, {
    humanoDisponivel,
    proximoRetorno: humanoDisponivel ? null : proximoAtendimento(tenant.horarios),
  });

  if (resultado.tag) {
    const tagAtual = Array.isArray(conversa.tags) ? conversa.tags[0] : null;
    if (!tagAtual || tagAtual === 'Outros') {
      await db.update(conversas)
        .set({ tags: JSON.stringify([resultado.tag]) })
        .where(eq(conversas.id, conversa.id));
    }
  }

  // Incrementa contador de uso IA (fire-and-forget em caso de erro)
  incrementarUso(tenant).catch(err => console.error('[limites] Erro ao incrementar uso:', err.message));

  if (resultado.resposta) {
    // Código de pagamento vai sozinho num balão: no celular, copiar é segurar a
    // mensagem, e isso copia ela inteira. Resposta sem código sai igual a antes.
    const blocos = dividirEmBlocos(resultado.resposta);
    for (const bloco of blocos) {
      let botWamid = null;
      try {
        // Um de cada vez, esperando o anterior: dois envios em paralelo podem
        // chegar fora de ordem no WhatsApp, e aí o código cai antes do label.
        const apiRes = await enviarMensagem(wConfig, remetente, bloco);
        botWamid = apiRes?.messages?.[0]?.id || null;
      } catch (err) {
        console.error('Erro ao enviar resposta IA:', err.message);
      }
      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: bloco,
        wamid: botWamid,
        status: 'enviada',
      });
    }
    // A prévia da lista leva a resposta inteira, não o último balão: dividida, a
    // conversa poderia terminar num código de pagamento e a lista de conversas
    // mostraria uma parede de números no lugar do assunto.
    await atualizarUltMsg(conversa.id, resultado.resposta, 'bot');
  }

  for (const midia of resultado.midias || []) {
    try {
      // O arquivo pode vir pronto do SGP (quando exige POST autenticado) ou
      // como URL pública para baixar.
      const { buffer, mimeType } = midia.buffer
        ? { buffer: midia.buffer, mimeType: midia.mimeType }
        : await baixarArquivoUrl(midia.url);
      const { id: mediaId } = await uploadMidia(wConfig, buffer, mimeType || 'application/pdf', midia.nome);
      await enviarMidia(wConfig, remetente, mediaId, 'document', midia.nome);
      const conteudoMidia = `[Arquivo] ${midia.nome}`;
      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: conteudoMidia,
        midiaUrl: mediaId,
        status: 'enviada',
      });
      await atualizarUltMsg(conversa.id, conteudoMidia, 'bot');
    } catch (err) {
      console.error('[Webhook] Erro ao enviar mídia do bot:', err.message);
    }
  }

  if (resultado.devePelearHumano) {
    await realizarHandoff(tenant, conversa, cliente, resultado.motivo, wConfig);
  }
}


export default router;
