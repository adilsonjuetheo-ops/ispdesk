import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes, tenantUsers } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import { enviarMensagem } from '../services/whatsapp.js';
import { tenants } from '../db/schema.js';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  const { status } = req.query;
  const conditions = [];

  if (req.user.role !== 'superadmin') {
    conditions.push(eq(conversas.tenantId, req.user.tenantId));
  }
  if (status) {
    conditions.push(eq(conversas.status, status));
  }

  const rows = await db.select({
    id: conversas.id,
    tenantId: conversas.tenantId,
    status: conversas.status,
    agenteId: conversas.agenteId,
    motivoHandoff: conversas.motivoHandoff,
    resumoIa: conversas.resumoIa,
    iniciadaEm: conversas.iniciadaEm,
    encerradaEm: conversas.encerradaEm,
    clienteId: clientes.id,
    clienteNome: clientes.nome,
    clienteWhatsapp: clientes.whatsapp,
    clienteFilial: clientes.filialNome,
    clienteStatus: clientes.statusContrato,
  })
  .from(conversas)
  .innerJoin(clientes, eq(conversas.clienteId, clientes.id))
  .where(conditions.length ? and(...conditions) : undefined)
  .orderBy(desc(conversas.iniciadaEm));

  res.json(rows);
});

router.get('/:id/messages', async (req, res) => {
  const { id } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const msgs = await db.select().from(mensagens)
    .where(eq(mensagens.conversaId, id))
    .orderBy(mensagens.enviadaEm);

  res.json(msgs);
});

router.post('/:id/assume', async (req, res) => {
  const { id } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  await db.update(conversas)
    .set({ status: 'humano', agenteId: req.user.id })
    .where(eq(conversas.id, id));

  const textoSistema = `[Sistema] Atendente ${req.user.nome} assumiu a conversa.`;
  await db.insert(mensagens).values({ conversaId: id, origem: 'bot', conteudo: textoSistema });

  // notifica cliente via WhatsApp
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
  if (tenant?.whatsappToken && cliente?.whatsapp) {
    try {
      await enviarMensagem(tenant, cliente.whatsapp, `Olá! Agora você está sendo atendido por ${req.user.nome}.`);
    } catch (err) {
      console.error('Erro ao notificar assume:', err.message);
    }
  }

  res.json({ mensagem: 'Conversa assumida' });
});

router.post('/:id/release', async (req, res) => {
  const { id } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  await db.update(conversas)
    .set({ status: 'bot', agenteId: null })
    .where(eq(conversas.id, id));

  await db.insert(mensagens).values({
    conversaId: id,
    origem: 'bot',
    conteudo: '[Sistema] Conversa devolvida para o assistente.',
  });

  res.json({ mensagem: 'Devolvida ao bot' });
});

router.post('/:id/close', async (req, res) => {
  const { id } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  await db.update(conversas)
    .set({ status: 'encerrada', encerradaEm: new Date() })
    .where(eq(conversas.id, id));

  res.json({ mensagem: 'Conversa encerrada' });
});

router.post('/:id/send', async (req, res) => {
  const { id } = req.params;
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ erro: 'Texto obrigatório' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  if (conversa.status !== 'humano') return res.status(400).json({ erro: 'Só agentes podem enviar mensagens em conversas humanas' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

  await enviarMensagem(tenant, cliente.whatsapp, texto);

  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo: texto,
  }).returning();

  res.json(msg);
});

export default router;
