import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes, tenantUsers, filiais, tenants } from '../db/schema.js';
import { eq, and, desc, ne, count, inArray } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import multer from 'multer';
import { enviarMensagem, uploadMidia, enviarMidia } from '../services/whatsapp.js';
import { registrarAtividade } from '../jobs/encerramentoInativo.js';
import { enviarNps } from '../services/nps.js';
import { criarRateLimit } from '../middleware/security.js';
import { audioPrecisaConverter, converterParaOggOpus } from '../services/audio.js';

// O player de áudio faz várias requisições Range pra descobrir a duração
// antes de tocar — sem isso, cada uma rebaixaria o arquivo inteiro da Meta
// de novo, o que é lento o bastante pra parecer que o áudio "não toca".
const CACHE_MEDIA_MS = 5 * 60 * 1000;
const cacheMedia = new Map(); // mediaId -> { buffer, mimeType, expiraEm }

function pegarMediaCache(mediaId) {
  const item = cacheMedia.get(mediaId);
  if (!item) return null;
  if (item.expiraEm < Date.now()) { cacheMedia.delete(mediaId); return null; }
  return item;
}

function guardarMediaCache(mediaId, buffer, mimeType) {
  if (cacheMedia.size > 200) {
    for (const [k, v] of cacheMedia) if (v.expiraEm < Date.now()) cacheMedia.delete(k);
  }
  cacheMedia.set(mediaId, { buffer, mimeType, expiraEm: Date.now() + CACHE_MEDIA_MS });
}

async function resolverWConfig(tenant, conversa) {
  if (!conversa?.filialId) return tenant;
  const [filial] = await db.select({
    whatsappNumberId: filiais.whatsappNumberId,
    whatsappToken: filiais.whatsappToken,
  }).from(filiais).where(eq(filiais.id, conversa.filialId)).limit(1);
  if (filial?.whatsappToken && filial?.whatsappNumberId) {
    return { ...tenant, whatsappNumberId: filial.whatsappNumberId, whatsappToken: filial.whatsappToken };
  }
  return tenant;
}

const MIME_TYPES_PERMITIDOS = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/webm',
  'application/pdf', 'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, arquivo, callback) => {
    if (!MIME_TYPES_PERMITIDOS.has(arquivo.mimetype)) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'arquivo'));
    }
    callback(null, true);
  },
});

const limitarUpload = criarRateLimit({
  janelaMs: 60_000,
  limite: 60,
  prefixo: 'upload-midia',
  mensagem: 'Muitos uploads em pouco tempo. Aguarde antes de tentar novamente.',
});

// A filial do atendente organiza a visão (filtro na lateral), não restringe
// acesso: qualquer um da equipe abre, assume e responde qualquer conversa do
// próprio provedor.
function podeAcessarConversa(req, conversa) {
  if (req.user.role === 'superadmin') return true;
  return conversa.tenantId === req.user.tenantId;
}

// Passa a conversa para o atendente e avisa cliente e histórico. Usado tanto
// pelo botão Assumir quanto pelo envio direto, que assume sozinho.
async function assumirConversa(req, conversa) {
  await db.update(conversas)
    .set({ status: 'humano', agenteId: req.user.id })
    .where(eq(conversas.id, conversa.id));

  const textoSistema = `[Sistema] Atendente ${req.user.nome} assumiu a conversa.`;
  await db.insert(mensagens).values({ conversaId: conversa.id, origem: 'bot', conteudo: textoSistema });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
  if (tenant?.whatsappToken && cliente?.whatsapp) {
    try {
      const wConfig = await resolverWConfig(tenant, conversa);
      await enviarMensagem(wConfig, cliente.whatsapp, `Olá! Agora você está sendo atendido por ${req.user.nome}.`);
    } catch (err) {
      console.error('Erro ao notificar assume:', err.message);
    }
  }
}

const router = Router();
router.use(autenticar);

// Escritas de agentes (enviar, assumir, devolver, transferir) contam como
// atividade para a varredura de encerramento por inatividade
router.use((req, res, next) => {
  if (req.method !== 'GET') registrarAtividade();
  next();
});

// Colegas para o seletor de transferência. A rota de equipe é apenasAdmin, então
// sem isto o atendente abria o modal e via a lista vazia.
router.get('/agentes', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.json([]);

  const rows = await db.select({
    id: tenantUsers.id,
    nome: tenantUsers.nome,
    role: tenantUsers.role,
    filialNome: filiais.nome,
  })
    .from(tenantUsers)
    .leftJoin(filiais, eq(tenantUsers.filialId, filiais.id))
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.ativo, true)))
    .orderBy(tenantUsers.nome);

  res.json(rows);
});

router.get('/counts', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.json({ todos: 0, mine: 0, fila: 0, porFilial: {} });
  const escopo = [eq(conversas.tenantId, tenantId), ne(conversas.status, 'encerrada')];

  const [r1] = await db.select({ total: count() }).from(conversas)
    .where(and(...escopo));

  const [r2] = await db.select({ total: count() }).from(conversas)
    .where(and(...escopo, eq(conversas.agenteId, req.user.id), eq(conversas.status, 'humano')));

  const [r3] = await db.select({ total: count() }).from(conversas)
    .where(and(...escopo, inArray(conversas.status, ['aguardando', 'aguardando_filial'])));

  const filialRows = await db.select({ filialId: conversas.filialId, total: count() }).from(conversas)
    .where(and(...escopo))
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
    contratoStatus: conversas.contratoStatus,
    contratoEnviadoEm: conversas.contratoEnviadoEm,
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

  if (!podeAcessarConversa(req, conversa)) {
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

  if (!podeAcessarConversa(req, conversa)) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  await assumirConversa(req, conversa);

  res.json({ mensagem: 'Conversa assumida' });
});

router.post('/:id/release', async (req, res) => {
  const { id } = req.params;
  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (!podeAcessarConversa(req, conversa)) {
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

  if (!podeAcessarConversa(req, conversa)) {
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

  let [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });

  if (!podeAcessarConversa(req, conversa)) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  // Responder já é assumir: o atendente não precisa clicar em Assumir antes —
  // vale também pra conversa encerrada, que reabre ao ser respondida.
  if (conversa.status !== 'humano') {
    await assumirConversa(req, conversa);
    conversa = { ...conversa, status: 'humano', agenteId: req.user.id };
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
  const wConfig = await resolverWConfig(tenant, conversa);

  let sentWamid = null;
  try {
    const apiRes = await enviarMensagem(wConfig, cliente.whatsapp, texto);
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

router.post('/:id/send-media', limitarUpload, upload.single('arquivo'), async (req, res) => {
  const { id } = req.params;
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ erro: 'Arquivo obrigatório' });

  let [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (!podeAcessarConversa(req, conversa))
    return res.status(403).json({ erro: 'Acesso negado' });
  // Enviar arquivo também assume a conversa — vale também pra encerrada, que reabre.
  if (conversa.status !== 'humano') {
    await assumirConversa(req, conversa);
    conversa = { ...conversa, status: 'humano', agenteId: req.user.id };
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
  const wConfig = await resolverWConfig(tenant, conversa);

  const tipo = arquivo.mimetype.startsWith('image/')
    ? 'image'
    : arquivo.mimetype.startsWith('audio/')
      ? 'audio'
      : 'document';

  // O navegador grava no container que suportar — o Chrome só faz WebM, que o
  // WhatsApp não reproduz. Antes o mime era forçado para Ogg sem converter o
  // conteúdo: a Meta aceita sem conferir o container e o áudio chegava mudo no
  // celular do cliente, com o atendente vendo "enviado".
  let corpo = arquivo.buffer;
  let mimeType = arquivo.mimetype;
  if (tipo === 'audio') {
    if (audioPrecisaConverter(arquivo.mimetype)) {
      try {
        corpo = await converterParaOggOpus(arquivo.buffer);
        mimeType = 'audio/ogg; codecs=opus';
      } catch (err) {
        console.error('[Áudio] Falha ao converter para Ogg/Opus:', err.message);
        return res.status(502).json({ erro: 'Não foi possível converter o áudio gravado. Tente novamente.' });
      }
    } else if (mimeType.split(';')[0].trim() === 'audio/ogg') {
      mimeType = 'audio/ogg; codecs=opus';
    }
  }

  const { id: mediaId } = await uploadMidia(wConfig, corpo, mimeType, arquivo.originalname);
  const mediaApiRes = await enviarMidia(wConfig, cliente.whatsapp, mediaId, tipo, arquivo.originalname);
  const mediaWamid = mediaApiRes?.messages?.[0]?.id || null;

  const prefixo = tipo === 'image' ? '[Imagem]' : tipo === 'audio' ? '[Áudio]' : '[Arquivo]';
  const conteudo = `${prefixo} ${arquivo.originalname}`;
  const [msg] = await db.insert(mensagens).values({
    conversaId: id,
    origem: 'agente',
    conteudo,
    midiaUrl: (tipo === 'image' || tipo === 'audio') ? mediaId : null,
    wamid: mediaWamid,
    status: 'enviada',
    agenteNome: req.user.nome,
  }).returning();

  await db.update(conversas).set({
    ultimaMensagem: tipo === 'image' ? '📷 Imagem' : tipo === 'audio' ? '🎤 Áudio' : '📎 Arquivo',
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
  if (!podeAcessarConversa(req, conversa))
    return res.status(403).end();

  const [midiaVinculada] = await db.select({ id: mensagens.id }).from(mensagens)
    .where(and(eq(mensagens.conversaId, id), eq(mensagens.midiaUrl, mediaId)))
    .limit(1);
  if (!midiaVinculada) return res.status(404).end();

  try {
    let cache = pegarMediaCache(mediaId);
    if (!cache) {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
      if (!tenant?.whatsappToken) return res.status(400).end();
      const wConfig = await resolverWConfig(tenant, conversa);
      if (!wConfig?.whatsappToken) return res.status(400).end();

      const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${wConfig.whatsappToken}` },
      });
      if (!metaRes.ok) return res.status(502).end();
      const { url, mime_type } = await metaRes.json();

      const mediaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${wConfig.whatsappToken}` },
      });
      if (!mediaRes.ok) return res.status(502).end();

      const buffer = Buffer.from(await mediaRes.arrayBuffer());
      cache = { buffer, mimeType: mime_type || 'image/jpeg' };
      guardarMediaCache(mediaId, buffer, cache.mimeType);
    }

    const { buffer, mimeType } = cache;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Áudio do WhatsApp vem em Ogg/Opus sem duração no cabeçalho: o navegador
    // precisa de Range para descobrir o tamanho e liberar o play.
    res.setHeader('Accept-Ranges', 'bytes');

    const range = /^bytes=(\d*)-(\d*)$/.exec((req.headers.range || '').trim());
    if (range) {
      // bytes=-N pede os últimos N bytes (sem início) — usado por navegadores
      // pra ler o índice de duração no fim do arquivo Ogg antes de tocar.
      let inicio, fim;
      if (range[1] === '') {
        const sufixo = parseInt(range[2], 10);
        inicio = Math.max(buffer.length - sufixo, 0);
        fim = buffer.length - 1;
      } else {
        inicio = parseInt(range[1], 10);
        fim = range[2] ? parseInt(range[2], 10) : buffer.length - 1;
      }
      if (inicio >= buffer.length || fim >= buffer.length || inicio > fim) {
        res.setHeader('Content-Range', `bytes */${buffer.length}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${buffer.length}`);
      res.setHeader('Content-Length', fim - inicio + 1);
      return res.end(buffer.subarray(inicio, fim + 1));
    }

    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
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
  if (!podeAcessarConversa(req, conversa))
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
  if (!podeAcessarConversa(req, conversa))
    return res.status(403).json({ erro: 'Acesso negado' });

  const [agente] = await db.select().from(tenantUsers).where(and(
    eq(tenantUsers.id, agenteId),
    eq(tenantUsers.tenantId, conversa.tenantId),
    eq(tenantUsers.ativo, true),
  )).limit(1);
  if (!agente) return res.status(404).json({ erro: 'Agente não encontrado' });
  if (conversa.status === 'encerrada') {
    return res.status(400).json({ erro: 'Conversa encerrada. Reabra antes de transferir.' });
  }

  // Transferir a partir da fila é atribuir direto: a conversa sai do bot e já
  // fica com o colega, sem ele precisar assumir antes.
  const eraDoBot = conversa.status !== 'humano';

  await db.update(conversas)
    .set({ status: 'humano', agenteId })
    .where(eq(conversas.id, id));

  await db.insert(mensagens).values({
    conversaId: id,
    origem: 'bot',
    conteudo: `[Sistema] Conversa transferida para ${agente.nome} por ${req.user.nome}.`,
  });

  // Só avisa o cliente quando é a primeira vez que sai do atendimento
  // automático — troca entre atendentes não interessa a ele.
  if (eraDoBot) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
    const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
    if (tenant?.whatsappToken && cliente?.whatsapp) {
      try {
        const wConfig = await resolverWConfig(tenant, conversa);
        await enviarMensagem(wConfig, cliente.whatsapp, `Olá! Agora você está sendo atendido por ${agente.nome}.`);
      } catch (err) {
        console.error('Erro ao notificar transferência:', err.message);
      }
    }
  }

  res.json({ mensagem: 'Conversa transferida' });
});

// Atualizar tags da conversa
router.patch('/:id/tags', async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ erro: 'tags deve ser um array' });

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, id)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (!podeAcessarConversa(req, conversa))
    return res.status(403).json({ erro: 'Acesso negado' });

  await db.update(conversas).set({ tags: JSON.stringify(tags) }).where(eq(conversas.id, id));

  res.json({ tags });
});

export default router;
