import { Router } from 'express';
import { db } from '../db/index.js';
import { atalhos } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(autenticar);

router.get('/', async (req, res) => {
  const { tenantId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.tenantId !== tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });
  const rows = await db.select().from(atalhos)
    .where(eq(atalhos.tenantId, tenantId))
    .orderBy(atalhos.criadoEm);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { tenantId } = req.params;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ erro: 'Acesso negado' });
  if (req.user.role !== 'superadmin' && req.user.tenantId !== tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });
  const { titulo, atalho, conteudo } = req.body;
  if (!titulo?.trim() || !conteudo?.trim())
    return res.status(400).json({ erro: 'Título e conteúdo obrigatórios' });
  const [row] = await db.insert(atalhos)
    .values({ tenantId, titulo: titulo.trim(), atalho: atalho?.trim() || null, conteudo: conteudo.trim() })
    .returning();
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const { tenantId, id } = req.params;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ erro: 'Acesso negado' });
  if (req.user.role !== 'superadmin' && req.user.tenantId !== tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });
  const { titulo, atalho, conteudo } = req.body;
  if (!titulo?.trim() || !conteudo?.trim())
    return res.status(400).json({ erro: 'Título e conteúdo obrigatórios' });
  const [row] = await db.update(atalhos)
    .set({ titulo: titulo.trim(), atalho: atalho?.trim() || null, conteudo: conteudo.trim() })
    .where(and(eq(atalhos.id, id), eq(atalhos.tenantId, tenantId)))
    .returning();
  if (!row) return res.status(404).json({ erro: 'Não encontrado' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const { tenantId, id } = req.params;
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ erro: 'Acesso negado' });
  if (req.user.role !== 'superadmin' && req.user.tenantId !== tenantId)
    return res.status(403).json({ erro: 'Acesso negado' });
  await db.delete(atalhos).where(and(eq(atalhos.id, id), eq(atalhos.tenantId, tenantId)));
  res.json({ mensagem: 'Atalho removido' });
});

export default router;
