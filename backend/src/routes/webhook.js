import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens, webhookLog, filiais } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { processarMensagem } from '../services/ai.js';
import { buscarDadosCliente } from '../services/sgp.js';
import { enviarMensagem, transcreverAudioMeta } from '../services/whatsapp.js';
import { realizarHandoff } from '../services/handoff.js';
import { enviarPushParaTenant } from '../services/pushNotification.js';
import { dentroDoHorario } from '../services/horarios.js';
import { getLimite, getUso, incrementarUso } from '../services/limites.js';
import { registrarAtividade } from '../jobs/encerramentoInativo.js';

const router = Router();

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

        const [tenant] = await db.select().from(tenants)
          .where(and(eq(tenants.whatsappNumberId, phoneNumberId), eq(tenants.ativo, true)))
          .limit(1);
        if (!tenant) continue;

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
            try { await enviarMensagem(tenant, remetente, 'Este número não atende ligações. Por favor, envie uma mensagem de texto ou áudio. 😊'); } catch {}
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
              texto = await transcreverAudioMeta(tenant, mediaId);
              if (!texto) continue;
              isAudio = true;
            } catch (err) {
              console.error('[Webhook] Erro ao transcrever áudio:', err.message);
              try { await enviarMensagem(tenant, remetente, 'Recebi seu áudio, mas não consegui processá-lo. Por favor, tente enviar uma mensagem de texto.'); } catch {}
              continue;
            }
          } else if (msg.type === 'image') {
            const mediaId = msg.image?.id;
            if (!mediaId) continue;
            const caption = msg.image?.caption ? ` — "${msg.image.caption}"` : '';
            texto = `[Imagem]${caption}`;
            isAudio = false;
            await db.insert(webhookLog).values({ wamid, tenantId: tenant.id }).catch(() => {});
            await processarWebhookMsg(tenant, remetente, texto, wamid, false, mediaId, nomeWa);
            continue;
          } else if (msg.type === 'document') {
            const mediaId = msg.document?.id;
            if (!mediaId) continue;
            const nomeArquivo = msg.document?.filename || 'documento';
            texto = `[Documento] ${nomeArquivo}`;
            await db.insert(webhookLog).values({ wamid, tenantId: tenant.id }).catch(() => {});
            await processarWebhookMsg(tenant, remetente, texto, wamid, false, mediaId, nomeWa);
            continue;
          } else {
            // Ignora outros tipos silenciosamente (vídeo, sticker, etc.)
            continue;
          }

          try {
            await db.insert(webhookLog).values({ wamid, tenantId: tenant.id });
          } catch {
            continue;
          }

          await processarWebhookMsg(tenant, remetente, texto, wamid, isAudio, null, nomeWa);
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

async function processarWebhookMsg(tenant, remetente, texto, wamid, isAudio = false, midiaUrl = null, nomeWa = null) {
  registrarAtividade();

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

  // Verifica horário de atendimento
  if (!dentroDoHorario(tenant.horarios)) {
    const msg = tenant.horarios?.msgForaHorario ||
      'Nosso atendimento está encerrado no momento. Em breve retornaremos!';
    await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msg });
    try { await enviarMensagem(tenant, remetente, msg); } catch {}
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
      // Sem match automático: prossegue sem filial — SGP fará o roteamento quando integrado
    }
  }

  // Bloqueia bot se conta suspensa por inadimplência
  if (tenant.statusPagamento === 'suspenso') {
    const msg = 'Nosso atendimento automático está temporariamente suspenso. Por favor, entre em contato diretamente com o provedor.';
    try { await enviarMensagem(tenant, remetente, msg); } catch {}
    return;
  }

  // Verifica limite mensal de IA
  const contagemAtual = await getUso(tenant.id);
  const limiteAtual = getLimite(tenant.plano);
  if (contagemAtual >= limiteAtual) {
    const msgBloqueio = '⛔ Nosso assistente virtual está temporariamente indisponível. Por favor, aguarde ou entre em contato pelo telefone do provedor.';
    await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msgBloqueio });
    try { await enviarMensagem(tenant, remetente, msgBloqueio); } catch {}
    return;
  }

  // Chama IA
  const historico = await db.select().from(mensagens)
    .where(eq(mensagens.conversaId, conversa.id))
    .orderBy(mensagens.enviadaEm);

  const resultado = await processarMensagem(tenant, conversa, historico, texto, remetente);

  if (resultado.tag) {
    const tagsAtuais = Array.isArray(conversa.tags) ? conversa.tags : [];
    if (tagsAtuais.length === 0) {
      await db.update(conversas)
        .set({ tags: JSON.stringify([resultado.tag]) })
        .where(eq(conversas.id, conversa.id));
    }
  }

  // Incrementa contador de uso IA (fire-and-forget em caso de erro)
  incrementarUso(tenant).catch(err => console.error('[limites] Erro ao incrementar uso:', err.message));

  if (resultado.resposta) {
    let botWamid = null;
    try {
      const apiRes = await enviarMensagem(tenant, remetente, resultado.resposta);
      botWamid = apiRes?.messages?.[0]?.id || null;
    } catch (err) {
      console.error('Erro ao enviar resposta IA:', err.message);
    }
    await db.insert(mensagens).values({
      conversaId: conversa.id,
      origem: 'bot',
      conteudo: resultado.resposta,
      wamid: botWamid,
      status: 'enviada',
    });
    await atualizarUltMsg(conversa.id, resultado.resposta, 'bot');
  }

  if (resultado.devePelearHumano) {
    await realizarHandoff(tenant, conversa, cliente, resultado.motivo);
  }
}


export default router;
