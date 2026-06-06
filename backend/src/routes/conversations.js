import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes, tenantUsers, filiais } from '../db/schema.js';
import { eq, and, desc, ne, count, inArray } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import multer from 'multer';
import { enviarMensagem, uploadMidia, enviarMidia } from '../services/whatsapp.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
import { tenants } from '../db/schema.js';

const router = Router();
router.use(autenticar);

router.get('/counts', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.json({ todos: 0, mine: 0, fila: 0 });

  const [r1] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), ne(conversas.status, 'encerrada')));

  const [r2] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), eq(conversas.agenteId, req.user.id), eq(conversas.status, 'humano')));

  const [r3] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), inArray(conversas.status, ['aguardando', 'aguardando_filial'])));

  res.json({ todos: Number(r1.total), mine: Number(r2.total), fila: Number(r3.total) });
});

router.get('/', async (req, res) => {
  const { status } = req.query;
  const conditions = [];

  if (req.user.role !== 'superadmin') {
    conditions.push(eq(conversas.tenantId, req.user.tenantId));
    if (req.user.filialId) {
      conditions.push(eq(conversas.filialId, req.user.filialId));
    }
  }
  if (status) {
    conditions.push(eq(conversas.status, status));
  }
  if (req.query.mine === 'true' && req.user.id) {
    conditions.push(eq(conversas.agenteId, req.user.id));
  }

  const rows = await db.select({
    id: conversas.id,
    tenantId: conversas.tenantId,
    status: conversas.status,
    filialId: conversas.filialId,
    filialNome: filiais.nome,
    agenteId: conversas.agenteId,
    agenteNome: tenantUsers.nome,
    motivoHandoff: conversas.motivoHandoff,
    resumoIa: conversas.resumoIa,
    iniciadaEm: conversas.iniciadaEm,
    encerradaEm: conversas.encerradaEm,
    clienteId: clientes.id,
    clienteNome: clientes.nome,
    clienteWhatsapp: clientes.whatsapp,
    clienteFilial: clientes.filialNome,
    clienteStatus: clientes.statusContrato,
    clienteContratoId: clientes.contratoId,
  })
  .from(conversas)
  .innerJoin(clientes, eq(conversas.clienteId, clientes.id))
  .leftJoin(filiais, eq(conversas.filialId, filiais.id))
  .leftJoin(tenantUsers, eq(conversas.agenteId, tenantUsers.id))
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

  try {
    await enviarMensagem(tenant, cliente.whatsapp, texto);
  } catch (err) {
    console.error('Erro enviarMensagem:', err.message);
    return res.status(502).json({ erro: err.message });
  }

  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo: texto,
  }).returning();

  res.json(msg);
});

router.post('/:id/send-media', upload.single('arquivo'), async (req, res) => {
  const { id } = req.params;
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ erro: 'Arquivo obrigatório' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });
  if (conversa.status !== 'humano')
    return res.status(400).json({ erro: 'Só agentes podem enviar em conversas humanas' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

  const tipo = arquivo.mimetype.startsWith('image/') ? 'image' : 'document';
  const { id: mediaId } = await uploadMidia(tenant, arquivo.buffer, arquivo.mimetype, arquivo.originalname);
  await enviarMidia(tenant, cliente.whatsapp, mediaId, tipo, arquivo.originalname);

  const prefixo = tipo === 'image' ? '[Imagem]' : '[Arquivo]';
  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo: `${prefixo} ${arquivo.originalname}`,
  }).returning();

  res.json(msg);
});

export default router;
