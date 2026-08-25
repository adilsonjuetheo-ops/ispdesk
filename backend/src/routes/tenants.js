import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, tenantUsers, conversas } from '../db/schema.js';
import { eq, count, and } from 'drizzle-orm';
import { autenticar, apenasSuper } from '../middleware/auth.js';
import crypto from 'crypto';
import { getLimite, getUso, getMes } from '../services/limites.js';
import { buscarContextoSgp, buscarContextoPorDocumentoSgp } from '../services/sgp.js';
import { processarProvedor as processarLembretesProvedor, testarClienteEspecifico } from '../jobs/lembreteFaturas.js';
import { diagnosticar } from '../services/diagnostico.js';

const router = Router();

const CAMPOS_TENANT_SEGUROS = {
  id: tenants.id,
  slug: tenants.slug,
  nome: tenants.nome,
  nomeFantasia: tenants.nomeFantasia,
  logoUrl: tenants.logoUrl,
  corPrimaria: tenants.corPrimaria,
  nomeAssistente: tenants.nomeAssistente,
  plano: tenants.plano,
  ativo: tenants.ativo,
};

// rota de auto-consulta: admin/agente pode ver seu próprio tenant
router.get('/me', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  const consulta = req.user.role === 'admin'
    ? db.select().from(tenants)
    : db.select(CAMPOS_TENANT_SEGUROS).from(tenants);
  const [tenant] = await consulta.where(eq(tenants.id, req.user.tenantId)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  res.json(tenant);
});

// horário de atendimento — leitura pública (webhook precisa)
router.get('/me/horarios', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  const [tenant] = await db.select({ horarios: tenants.horarios }).from(tenants)
    .where(eq(tenants.id, req.user.tenantId)).limit(1);
  res.json(tenant?.horarios || null);
});

router.put('/me/horarios', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas admins' });
  const { horarios } = req.body;
  await db.update(tenants).set({ horarios: JSON.stringify(horarios), atualizadoEm: new Date() })
    .where(eq(tenants.id, req.user.tenantId));
  res.json({ horarios });
});

router.get('/me/uso-ia', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  const [tenant] = await db.select({ plano: tenants.plano }).from(tenants)
    .where(eq(tenants.id, req.user.tenantId)).limit(1);
  const contagem = await getUso(req.user.tenantId);
  const limite = getLimite(tenant?.plano);
  const percentual = Math.floor((contagem / limite) * 100);
  res.json({ contagem, limite, percentual, mes: getMes() });
});

// Verificação de saúde sob demanda. Fica antes do `router.use(apenasSuper)` lá
// embaixo, senão o admin do provedor levaria 403 — o mesmo tropeço que já houve
// com os atalhos.
router.get('/me/diagnostico', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores' });
  try {
    res.json(await diagnosticar(req.user.tenantId));
  } catch (err) {
    console.error('[diagnostico] Falha:', err.message);
    res.status(500).json({ erro: 'Não foi possível concluir a verificação.' });
  }
});

// rota de edição própria: admin pode editar seu tenant
router.put('/me', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas admins podem editar' });
  const {
    nome, nomeFantasia, logoUrl, corPrimaria,
    cnpj, telefone, whatsappContato, email, website,
    endereco, cidade, uf, cep,
    whatsappNumberId, whatsappToken, systemPrompt, nomeAssistente,
    sgpTipo, sgpApiUrl, sgpApiKey, exigirDocumento,
    assinaturaTipo, assinaturaToken, assinaturaExtra,
    lembreteFaturaAtivo, lembreteFaturaTemplatePre, lembreteFaturaTemplatePos, lembreteFaturaIdioma,
    lembreteFaturaLinkAssinante,
  } = req.body;
  const [tenant] = await db.update(tenants)
    .set({
      nome, nomeFantasia, logoUrl, corPrimaria,
      cnpj, telefone, whatsappContato, email, website,
      endereco, cidade, uf, cep,
      whatsappNumberId, whatsappToken, systemPrompt, nomeAssistente,
      sgpTipo, sgpApiUrl, sgpApiKey,
      exigirDocumento: !!exigirDocumento,
      assinaturaTipo: assinaturaTipo || null,
      assinaturaToken: assinaturaToken || null,
      assinaturaExtra: assinaturaExtra || null,
      lembreteFaturaAtivo: !!lembreteFaturaAtivo,
      lembreteFaturaTemplatePre: lembreteFaturaTemplatePre || null,
      lembreteFaturaTemplatePos: lembreteFaturaTemplatePos || null,
      lembreteFaturaIdioma: lembreteFaturaIdioma || 'pt_BR',
      lembreteFaturaLinkAssinante: lembreteFaturaLinkAssinante?.trim() || null,
      atualizadoEm: new Date(),
    })
    .where(eq(tenants.id, req.user.tenantId))
    .returning();
  res.json(tenant);
});

// Testa conexão com SGP configurado no tenant
router.post('/me/testar-sgp', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas admins' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.user.tenantId)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  if (!tenant.sgpTipo || !tenant.sgpApiKey) {
    return res.status(400).json({ erro: 'SGP não configurado' });
  }

  const { telefone, documento } = req.body;
  if (!telefone && !documento) {
    return res.status(400).json({ erro: 'Informe um telefone ou CPF/CNPJ para teste' });
  }

  try {
    const resultado = documento
      ? await buscarContextoPorDocumentoSgp(tenant, documento)
      : await buscarContextoSgp(tenant, telefone);
    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(502).json({ ok: false, erro: err.message });
  }
});

// Dispara manualmente o job de lembretes de fatura para o próprio provedor
// (envia templates de verdade — mesmo processo que roda automaticamente às 9h)
router.post('/me/testar-lembretes', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas admins' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.user.tenantId)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  if (!tenant.lembreteFaturaAtivo) {
    return res.status(400).json({ erro: 'Lembretes automáticos não estão ativados para este provedor' });
  }

  try {
    const resultado = await processarLembretesProvedor(tenant);
    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(502).json({ ok: false, erro: err.message });
  }
});

// Dispara o envio de um lembrete de fatura pra um cliente específico (por
// CPF/CNPJ), independente da data de vencimento — útil pra validar o envio.
router.post('/me/testar-lembretes-cliente', autenticar, async (req, res) => {
  if (!req.user.tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (req.user.role !== 'admin') return res.status(403).json({ erro: 'Apenas admins' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.user.tenantId)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  if (!tenant.lembreteFaturaAtivo) {
    return res.status(400).json({ erro: 'Lembretes automáticos não estão ativados para este provedor' });
  }

  const { documento, tipo } = req.body;
  if (!documento) return res.status(400).json({ erro: 'Informe o CPF/CNPJ do cliente' });
  if (!['pre', 'pos'].includes(tipo)) return res.status(400).json({ erro: 'Tipo deve ser "pre" ou "pos"' });

  try {
    const resultado = await testarClienteEspecifico(tenant, documento, tipo);
    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(502).json({ ok: false, erro: err.message });
  }
});

router.use(autenticar, apenasSuper);

router.get('/', async (req, res) => {
  const rows = await db.select(CAMPOS_TENANT_SEGUROS).from(tenants).orderBy(tenants.criadoEm);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { slug, nome, logoUrl, corPrimaria, whatsappNumberId, whatsappToken,
          systemPrompt, nomeAssistente, sgpApiUrl, sgpApiKey, plano } = req.body;

  if (!slug || !nome || !systemPrompt) {
    return res.status(400).json({ erro: 'slug, nome e systemPrompt são obrigatórios' });
  }

  const webhookVerifyToken = crypto.randomBytes(20).toString('hex');

  try {
    const [tenant] = await db.insert(tenants).values({
      slug, nome, logoUrl, corPrimaria,
      whatsappNumberId: whatsappNumberId || null,
      whatsappToken: whatsappToken || null,
      webhookVerifyToken, systemPrompt, nomeAssistente, sgpApiUrl, sgpApiKey, plano,
    }).returning();

    res.status(201).json(tenant);
  } catch (err) {
    if (err.code === '23505') {
      const campo = err.constraint?.includes('whatsapp') ? 'Número de WhatsApp' : 'Slug';
      return res.status(409).json({ erro: `${campo} já está em uso por outro provedor` });
    }
    console.error('[tenants] Erro ao criar provedor:', err);
    res.status(500).json({ erro: 'Erro ao criar provedor' });
  }
});

router.get('/:id', async (req, res) => {
  const [tenant] = await db.select().from(tenants)
    .where(eq(tenants.id, req.params.id)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });

  const agentes = await db.select({
    id: tenantUsers.id,
    nome: tenantUsers.nome,
    email: tenantUsers.email,
    role: tenantUsers.role,
    ativo: tenantUsers.ativo,
    criadoEm: tenantUsers.criadoEm,
  }).from(tenantUsers).where(eq(tenantUsers.tenantId, req.params.id));

  res.json({ ...tenant, agentes });
});

router.put('/:id', async (req, res) => {
  const {
    slug, nome, nomeFantasia, logoUrl, corPrimaria,
    cnpj, telefone, whatsappContato, email, website,
    endereco, cidade, uf, cep,
    whatsappNumberId, whatsappToken,
    systemPrompt, nomeAssistente, sgpTipo, sgpApiUrl, sgpApiKey, plano, ativo,
  } = req.body;

  try {
    const [tenant] = await db.update(tenants)
      .set({
        slug, nome, nomeFantasia, logoUrl, corPrimaria,
        cnpj, telefone, whatsappContato, email, website,
        endereco, cidade, uf, cep,
        whatsappNumberId: whatsappNumberId || null,
        whatsappToken: whatsappToken || null,
        systemPrompt, nomeAssistente, sgpTipo, sgpApiUrl, sgpApiKey, plano, ativo,
        atualizadoEm: new Date(),
      })
      .where(eq(tenants.id, req.params.id))
      .returning();

    if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
    res.json(tenant);
  } catch (err) {
    if (err.code === '23505') {
      const campo = err.constraint?.includes('whatsapp') ? 'Número de WhatsApp' : 'Slug';
      return res.status(409).json({ erro: `${campo} já está em uso por outro provedor` });
    }
    console.error('[tenants] Erro ao atualizar provedor:', err);
    res.status(500).json({ erro: 'Erro ao atualizar provedor' });
  }
});

router.delete('/:id', async (req, res) => {
  await db.update(tenants)
    .set({ ativo: false, atualizadoEm: new Date() })
    .where(eq(tenants.id, req.params.id));
  res.json({ mensagem: 'Provedor desativado' });
});

router.delete('/:id/excluir', async (req, res) => {
  await db.delete(tenants).where(eq(tenants.id, req.params.id));
  res.json({ mensagem: 'Provedor excluído permanentemente' });
});

router.post('/:id/ativar-trial', async (req, res) => {
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [tenant] = await db.update(tenants)
    .set({ statusPagamento: 'trial', proximoVencimento: expira, atualizadoEm: new Date() })
    .where(eq(tenants.id, req.params.id))
    .returning({ statusPagamento: tenants.statusPagamento, proximoVencimento: tenants.proximoVencimento });
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  res.json(tenant);
});

router.post('/:id/renovar', async (req, res) => {
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [tenant] = await db.update(tenants)
    .set({ statusPagamento: 'ativo', proximoVencimento: expira, atualizadoEm: new Date() })
    .where(eq(tenants.id, req.params.id))
    .returning({ statusPagamento: tenants.statusPagamento, proximoVencimento: tenants.proximoVencimento });
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  res.json(tenant);
});

export default router;
