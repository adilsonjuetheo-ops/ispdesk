import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens, webhookLog } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { processarMensagem } from '../services/ai.js';
import { enviarMensagem } from '../services/whatsapp.js';
import { realizarHandoff } from '../services/handoff.js';

const router = Router();

// verificação Meta
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
  // responde 200 imediatamente para Meta não reenviar
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

        // busca tenant pelo number_id
        const [tenant] = await db.select().from(tenants)
          .where(and(eq(tenants.whatsappNumberId, phoneNumberId), eq(tenants.ativo, true)))
          .limit(1);
        if (!tenant) continue;

        for (const msg of msgs) {
          if (msg.type !== 'text') continue;
          const wamid = msg.id;
          const remetente = msg.from;
          const texto = msg.text?.body;
          if (!texto) continue;

          // idempotência
          try {
            await db.insert(webhookLog).values({ wamid, tenantId: tenant.id });
          } catch {
            continue; // já processado
          }

          await processarWebhookMsg(tenant, remetente, texto, wamid);
        }
      }
    }
  } catch (err) {
    console.error('Erro no webhook:', err);
  }
});

async function processarWebhookMsg(tenant, remetente, texto, wamid) {
  // busca ou cria cliente
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

  // busca conversa aberta ou cria nova
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

  // salva mensagem do cliente
  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'cliente',
    conteudo: texto,
    wamid,
  });

  // se humano está atendendo, não aciona IA
  if (conversa.status === 'humano') return;

  // chama IA
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

export default router;
