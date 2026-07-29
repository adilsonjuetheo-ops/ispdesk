import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes, tenantUsers, filiais, tenants } from '../db/schema.js';
import { eq, and, desc, ne, count, inArray } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import multer from 'multer';
import { enviarMensagem, uploadMidia, enviarMidia } from '../services/whatsapp.js';
import { registrarAtividade } from '../jobs/encerramentoInativo.js';
import { enviarNps } from '../services/nps.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(autenticar);

// Escritas de agentes (enviar, assumir, devolver, transferir) contam como
// atividade para a varredura de encerramento por inatividade
router.use((req, res, next) => {
  if (req.method !== 'GET') registrarAtividade();
  next();
});

router.get('/counts', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.json({ todos: 0, mine: 0, fila: 0, porFilial: {} });

  const [r1] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), ne(conversas.status, 'encerrada')));

  const [r2] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), eq(conversas.agenteId, req.user.id), eq(conversas.status, 'humano')));

  const [r3] = await db.select({ total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), inArray(conversas.status, ['aguardando', 'aguardando_filial'])));

  const filialRows = await db.select({ filialId: conversas.filialId, total: count() }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), ne(conversas.status, 'encerrada')))
    .groupBy(conversas.filialId);

  const porFilial = {};
  for (const r of filialRows) {
    if (r.filialId) porFilial[r.filialId] = Number(r.total);
  }

  res.json({ todos: Number(r1.total), mine: Number(r2.total), fila: Number(r3.total), porFilial });
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
    tags: conversas.tags,
    ultimaMensagem: conversas.ultimaMensagem,
    ultimaMsgEm: conversas.ultimaMsgEm,
    ultimaMsgOrigem: conversas.ultimaMsgOrigem,
    ultimaMsgNome: conversas.ultimaMsgNome,
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

  // Dispara NPS apenas quando um agente humano participou da conversa
  if (conversa.agenteId) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
    const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
    if (tenant && cliente) {
      enviarNps(tenant, conversa, cliente.id, cliente.whatsapp).catch(err =>
        console.error('[NPS] Erro:', err.message)
      );
    }
  }

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

  let sentWamid = null;
  try {
    const apiRes = await enviarMensagem(tenant, cliente.whatsapp, texto);
    sentWamid = apiRes?.messages?.[0]?.id || null;
  } catch (err) {
    console.error('Erro enviarMensagem:', err.message);
    return res.status(502).json({ erro: err.message });
  }

  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo: texto,
    wamid: sentWamid,
    status: 'enviada',
    agenteNome: req.user.nome,
  }).returning();

  await db.update(conversas).set({
    ultimaMensagem: texto.slice(0, 200),
    ultimaMsgEm: new Date(),
    ultimaMsgOrigem: 'agente',
    ultimaMsgNome: req.user.nome,
  }).where(eq(conversas.id, id));

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

  const tipo = arquivo.mimetype.startsWith('image/')
    ? 'image'
    : arquivo.mimetype.startsWith('audio/')
      ? 'audio'
      : 'document';

  const mimeType = tipo === 'audio' ? 'audio/ogg; codecs=opus' : arquivo.mimetype;
  const { id: mediaId } = await uploadMidia(tenant, arquivo.buffer, mimeType, arquivo.originalname);
  const mediaApiRes = await enviarMidia(tenant, cliente.whatsapp, mediaId, tipo, arquivo.originalname);
  const mediaWamid = mediaApiRes?.messages?.[0]?.id || null;

  const prefixo = tipo === 'image' ? '[Imagem]' : tipo === 'audio' ? '[Áudio]' : '[Arquivo]';
  const conteudo = `${prefixo} ${arquivo.originalname}`;
  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo,
    midiaUrl: tipo === 'image' ? mediaId : null,
    wamid: mediaWamid,
    status: 'enviada',
    agenteNome: req.user.nome,
  }).returning();

  await db.update(conversas).set({
    ultimaMensagem: '🎤 Áudio',
    ultimaMsgEm: new Date(),
    ultimaMsgOrigem: 'agente',
    ultimaMsgNome: req.user.nome,
  }).where(eq(conversas.id, id));

  res.json(msg);
});

// Proxy de mídia — baixa imagem/arquivo do Meta e serve ao frontend
router.get('/:id/media/:mediaId', async (req, res) => {
  const { id, mediaId } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).end();
  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId)
    return res.status(403).end();

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  if (!tenant?.whatsappToken) return res.status(400).end();

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${tenant.whatsappToken}` },
    });
    if (!metaRes.ok) return res.status(502).end();
    const { url, mime_type } = await metaRes.json();

    const mediaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${tenant.whatsappToken}` },
    });
    if (!mediaRes.ok) return res.status(502).end();

    res.setHeader('Content-Type', mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).end();
  }
});

// Nota interna (só visível para a equipe, não vai para o WhatsApp)
router.post('/:id/note', async (req, res) => {
  const { id } = req.params;
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ erro: 'Texto obrigatório' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });

  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'nota',
    conteudo: texto,
  }).returning();

  res.json(msg);
});

// Transferir conversa para outro agente
router.post('/:id/transfer', async (req, res) => {
  const { id } = req.params;
  const { agenteId } = req.body;
  if (!agenteId) return res.status(400).json({ erro: 'agenteId obrigatório' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });

  const [agente] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, agenteId)).limit(1);
  if (!agente) return res.status(404).json({ erro: 'Agente não encontrado' });

  await db.update(conversas)
    .set({ status: 'humano', agenteId })
    .where(eq(conversas.id, id));

  await db.insert(mensagens).values({
    conversaId: id,
    origem: 'bot',
    conteudo: `[Sistema] Conversa transferida para ${agente.nome} por ${req.user.nome}.`,
  });

  res.json({ mensagem: 'Conversa transferida' });
});

// Atualizar tags da conversa
router.patch('/:id/tags', async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ erro: 'tags deve ser um array' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (req.user.role !== 'superadmin' && conversa.tenantId !== req.user.tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });

  await db.update(conversas).set({ tags: JSON.stringify(tags) }).where(eq(conversas.id, id));

  res.json({ tags });
});

export default router;
