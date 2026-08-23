import { Router } from 'express';
import { db } from '../db/index.js';
import { lembretes, tenantUsers, clientes, conversas } from '../db/schema.js';
import { eq, and, isNull, isNotNull, or, desc, asc, sql } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router();
router.use(autenticar);

const semTenant = req => !req.user?.tenantId;

// Campos que a tela precisa, já com nome do cliente e do responsável resolvidos.
const selecao = {
  id: lembretes.id,
  texto: lembretes.texto,
  venceEm: lembretes.venceEm,
  concluidoEm: lembretes.concluidoEm,
  criadoEm: lembretes.criadoEm,
  conversaId: lembretes.conversaId,
  clienteId: lembretes.clienteId,
  responsavelId: lembretes.responsavelId,
  responsavelNome: tenantUsers.nome,
  clienteNome: clientes.nome,
  clienteWhatsapp: clientes.whatsapp,
};

const comJoins = q => q
  .from(lembretes)
  .leftJoin(tenantUsers, eq(tenantUsers.id, lembretes.responsavelId))
  .leftJoin(clientes, eq(clientes.id, lembretes.clienteId));

// GET /api/lembretes?status=abertos|concluidos&meus=true
router.get('/', async (req, res) => {
  if (semTenant(req)) return res.status(403).json({ erro: 'Sem tenant' });
  const { status = 'abertos', meus } = req.query;

  const condicoes = [eq(lembretes.tenantId, req.user.tenantId)];
  condicoes.push(status === 'concluidos'
    ? isNotNull(lembretes.concluidoEm)
    : isNull(lembretes.concluidoEm));

  // "Meus" inclui os sem responsável: lembrete da equipe é de todo mundo, e
  // esconder isso faria a lista pessoal mentir sobre o que há para fazer.
  if (meus === 'true') {
    condicoes.push(or(eq(lembretes.responsavelId, req.user.id), isNull(lembretes.responsavelId)));
  }

  const linhas = await comJoins(db.select(selecao))
    .where(and(...condicoes))
    // Sem prazo vai para o fim: quem tem data cobra atenção primeiro.
    .orderBy(
      status === 'concluidos' ? desc(lembretes.concluidoEm) : sql`${lembretes.venceEm} asc nulls last`,
      asc(lembretes.criadoEm),
    )
    .limit(200);

  res.json(linhas);
});

// Contadores da barra lateral: em aberto e quantos já venceram.
router.get('/contagem', async (req, res) => {
  if (semTenant(req)) return res.json({ abertos: 0, vencidos: 0 });
  const [linha] = await db.select({
    abertos: sql`count(*)`.mapWith(Number),
    vencidos: sql`count(*) filter (where ${lembretes.venceEm} is not null and ${lembretes.venceEm} < now())`.mapWith(Number),
  })
    .from(lembretes)
    .where(and(eq(lembretes.tenantId, req.user.tenantId), isNull(lembretes.concluidoEm)));

  res.json(linha || { abertos: 0, vencidos: 0 });
});

// Lembretes em aberto de um cliente — mostrados no painel lateral da conversa.
router.get('/cliente/:clienteId', async (req, res) => {
  if (semTenant(req)) return res.json([]);
  const linhas = await comJoins(db.select(selecao))
    .where(and(
      eq(lembretes.tenantId, req.user.tenantId),
      eq(lembretes.clienteId, req.params.clienteId),
      isNull(lembretes.concluidoEm),
    ))
    .orderBy(sql`${lembretes.venceEm} asc nulls last`)
    .limit(20);
  res.json(linhas);
});

router.post('/', async (req, res) => {
  if (semTenant(req)) return res.status(403).json({ erro: 'Sem tenant' });
  const { texto, conversaId, clienteId, responsavelId, venceEm } = req.body;
  if (!texto?.trim()) return res.status(400).json({ erro: 'Escreva o que precisa ser feito.' });

  // Se veio de uma conversa, o cliente sai dela — evita depender do frontend
  // mandar os dois e ficarem divergentes.
  let clienteFinal = clienteId || null;
  if (conversaId && !clienteFinal) {
    const [conversa] = await db.select({ clienteId: conversas.clienteId, tenantId: conversas.tenantId })
      .from(conversas).where(eq(conversas.id, conversaId)).limit(1);
    if (!conversa || conversa.tenantId !== req.user.tenantId) {
      return res.status(404).json({ erro: 'Conversa não encontrada' });
    }
    clienteFinal = conversa.clienteId;
  }

  const [criado] = await db.insert(lembretes).values({
    tenantId: req.user.tenantId,
    conversaId: conversaId || null,
    clienteId: clienteFinal,
    texto: texto.trim(),
    responsavelId: responsavelId || null,
    venceEm: venceEm ? new Date(venceEm) : null,
    criadoPor: req.user.id,
  }).returning();

  res.status(201).json(criado);
});

router.patch('/:id/concluir', async (req, res) => {
  if (semTenant(req)) return res.status(403).json({ erro: 'Sem tenant' });
  const reabrir = req.body?.reabrir === true;
  const [atualizado] = await db.update(lembretes)
    .set(reabrir
      ? { concluidoEm: null, concluidoPor: null }
      : { concluidoEm: new Date(), concluidoPor: req.user.id })
    .where(and(eq(lembretes.id, req.params.id), eq(lembretes.tenantId, req.user.tenantId)))
    .returning();

  if (!atualizado) return res.status(404).json({ erro: 'Lembrete não encontrado' });
  res.json(atualizado);
});

router.delete('/:id', async (req, res) => {
  if (semTenant(req)) return res.status(403).json({ erro: 'Sem tenant' });
  const [apagado] = await db.delete(lembretes)
    .where(and(eq(lembretes.id, req.params.id), eq(lembretes.tenantId, req.user.tenantId)))
    .returning({ id: lembretes.id });
  if (!apagado) return res.status(404).json({ erro: 'Lembrete não encontrado' });
  res.json({ ok: true });
});

export default router;
