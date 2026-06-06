import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens, webhookLog, filiais } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { processarMensagem } from '../services/ai.js';
import { enviarMensagem, transcreverAudioMeta } from '../services/whatsapp.js';
import { realizarHandoff } from '../services/handoff.js';

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
        const msgs = value.messages;
        if (!msgs?.length) continue;

        const [tenant] = await db.select().from(tenants)
          .where(and(eq(tenants.whatsappNumberId, phoneNumberId), eq(tenants.ativo, true)))
          .limit(1);
        if (!tenant) continue;

        for (const msg of msgs) {
          const wamid = msg.id;
          const remetente = msg.from;

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
          } else {
            // Ignora outros tipos silenciosamente (imagem, vídeo, sticker, etc.)
            continue;
          }

          try {
            await db.insert(webhookLog).values({ wamid, tenantId: tenant.id });
          } catch {
            continue;
          }

          await processarWebhookMsg(tenant, remetente, texto, wamid, isAudio);
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

async function processarWebhookMsg(tenant, remetente, texto, wamid, isAudio = false) {
  let [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.tenantId, tenant.id), eq(clientes.whatsapp, remetente)))
    .limit(1);

  if (!cliente) {
    [cliente] = await db.insert(clientes).values({
      tenantId: tenant.id,
      whatsapp: remetente,
      nome: remetente,
    }).returning();
  } else {
    await db.update(clientes).set({ ultimoContato: new Date() }).where(eq(clientes.id, cliente.id));
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

  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'cliente',
    conteudo: isAudio ? `[Áudio] ${texto}` : texto,
    wamid,
  });

  // Se aguardando seleção de filial, processa a escolha
  if (conversa.status === 'aguardando_filial') {
    await processarSelecaoFilial(tenant, conversa, cliente, texto, remetente);
    return;
  }

  // Se humano está atendendo, não aciona IA
  if (conversa.status === 'humano') return;

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
      } else {
        // Pede ao cliente que selecione a filial
        const opcoes = filiaisAtivas.map((f, i) => `${i + 1} - ${f.nome}`).join('\n');
        const msgMenu = `Para direcionar seu atendimento, informe o número da sua cidade:\n\n${opcoes}`;
        await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msgMenu });
        try { await enviarMensagem(tenant, remetente, msgMenu); } catch (e) { console.error(e.message); }
        await db.update(conversas).set({ status: 'aguardando_filial' }).where(eq(conversas.id, conversa.id));
        return;
      }
    }
  }

  // Chama IA
  const historico = await db.select().from(mensagens)
    .where(eq(mensagens.conversaId, conversa.id))
    .orderBy(mensagens.enviadaEm);

  const resultado = await processarMensagem(tenant, conversa, historico, texto, remetente);

  if (resultado.resposta) {
    await db.insert(mensagens).values({
      conversaId: conversa.id,
      origem: 'bot',
      conteudo: resultado.resposta,
    });
    try {
      await enviarMensagem(tenant, remetente, resultado.resposta);
    } catch (err) {
      console.error('Erro ao enviar resposta IA:', err.message);
    }
  }

  if (resultado.devePelearHumano) {
    await realizarHandoff(tenant, conversa, cliente, resultado.motivo);
  }
}

async function processarSelecaoFilial(tenant, conversa, cliente, texto, remetente) {
  const filiaisAtivas = await db.select().from(filiais)
    .where(and(eq(filiais.tenantId, tenant.id), eq(filiais.ativo, true)))
    .orderBy(filiais.nome);

  const num = parseInt(texto.trim());
  if (!isNaN(num) && num >= 1 && num <= filiaisAtivas.length) {
    const escolhida = filiaisAtivas[num - 1];
    await db.update(conversas)
      .set({ filialId: escolhida.id, status: 'bot' })
      .where(eq(conversas.id, conversa.id));

    const historico = await db.select().from(mensagens)
      .where(eq(mensagens.conversaId, conversa.id))
      .orderBy(mensagens.enviadaEm);

    const conversaAtualizada = { ...conversa, filialId: escolhida.id, status: 'bot' };
    const resultado = await processarMensagem(tenant, conversaAtualizada, historico, texto, remetente);

    if (resultado.resposta) {
      await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: resultado.resposta });
      try { await enviarMensagem(tenant, remetente, resultado.resposta); } catch (e) { console.error(e.message); }
    }

    if (resultado.devePelearHumano) {
      await realizarHandoff(tenant, conversaAtualizada, cliente, resultado.motivo);
    }
  } else {
    const opcoes = filiaisAtivas.map((f, i) => `${i + 1} - ${f.nome}`).join('\n');
    const msg = `Por favor, responda apenas com o número da sua cidade:\n\n${opcoes}`;
    await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: msg });
    try { await enviarMensagem(tenant, remetente, msg); } catch (e) { console.error(e.message); }
  }
}

export default router;
