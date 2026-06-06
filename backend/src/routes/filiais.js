import { Router } from 'express';
import { db } from '../db/index.js';
import { filiais } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(autenticar);

router.get('/', async (req, res) => {
  const tenantId = req.params.tenantId;
  console.log('[filiais GET] tenantId:', tenantId, 'user.tenantId:', req.user?.tenantId);
  try {
    const rows = await db.select().from(filiais)
      .where(eq(filiais.tenantId, tenantId))
      .orderBy(filiais.nome);
    console.log('[filiais GET] rows encontradas:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('[filiais GET] erro DB:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/', apenasAdmin, async (req, res) => {
  const tenantId = req.params.tenantId;
  console.log('[filiais POST] tenantId:', tenantId, 'user.tenantId:', req.user?.tenantId, 'body:', req.body);
  if (req.user.role !== 'superadmin' && req.user.tenantId !== tenantId) {
    return res.status(403).json({ erro: 'Acesso negado a este provedor' });
  }
  const { nome, cidade, uf } = req.body;
  if (!nome || !cidade) return res.status(400).json({ erro: 'nome e cidade obrigatórios' });
  try {
    const [filial] = await db.insert(filiais).values({
      tenantId, nome, cidade, uf,
    }).returning();
    console.log('[filiais POST] criada:', filial);
    res.status(201).json(filial);
  } catch (err) {
    console.error('[filiais POST] erro DB:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/:id', apenasAdmin, async (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.tenantId !== req.params.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  const { nome, cidade, uf, ativo } = req.body;
  const updates = {};
  if (nome !== undefined) updates.nome = nome;
  if (cidade !== undefined) updates.cidade = cidade;
  if (uf !== undefined) updates.uf = uf;
  if (ativo !== undefined) updates.ativo = ativo;
  const [filial] = await db.update(filiais)
    .set(updates)
    .where(and(eq(filiais.id, req.params.id), eq(filiais.tenantId, req.params.tenantId)))
    .returning();
  if (!filial) return res.status(404).json({ erro: 'Filial não encontrada' });
  res.json(filial);
});

router.delete('/:id', apenasAdmin, async (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.tenantId !== req.params.tenantId) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  await db.update(filiais)
    .set({ ativo: false })
    .where(and(eq(filiais.id, req.params.id), eq(filiais.tenantId, req.params.tenantId)));
  res.json({ mensagem: 'Filial desativada' });
});

export default router;
