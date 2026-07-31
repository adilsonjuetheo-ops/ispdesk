import { Router } from 'express';
import { db } from '../db/index.js';
import { incidentes } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', autenticar, async (req, res) => {
  try {
    const lista = await db.select().from(incidentes)
      .where(eq(incidentes.tenantId, req.user.tenantId))
      .orderBy(desc(incidentes.criadoEm));
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar incidentes' });
  }
});

router.get('/ativo', autenticar, async (req, res) => {
  try {
    const [inc] = await db.select().from(incidentes)
      .where(and(
        eq(incidentes.tenantId, req.user.tenantId),
        eq(incidentes.status, 'ativo')
      ))
      .orderBy(desc(incidentes.criadoEm))
      .limit(1);
    res.json(inc || null);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao verificar incidente ativo' });
  }
});

router.post('/', autenticar, apenasAdmin, async (req, res) => {
  const { titulo, descricao, mensagemBot } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ erro: 'Título obrigatório' });
  try {
    const [inc] = await db.insert(incidentes).values({
      tenantId: req.user.tenantId,
      titulo: titulo.trim(),
      descricao: descricao?.trim() || null,
      mensagemBot: mensagemBot?.trim() || null,
      status: 'ativo',
    }).returning();
    res.status(201).json(inc);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar incidente' });
  }
});

router.patch('/:id', autenticar, apenasAdmin, async (req, res) => {
  const { titulo, descricao, mensagemBot, status } = req.body;
  const update = {};
  if (titulo !== undefined) update.titulo = titulo.trim();
  if (descricao !== undefined) update.descricao = descricao?.trim() || null;
  if (mensagemBot !== undefined) update.mensagemBot = mensagemBot?.trim() || null;
  if (status) {
    update.status = status;
    if (status === 'resolvido') update.resolvidoEm = new Date();
    if (status === 'ativo') update.resolvidoEm = null;
  }
  try {
    const [inc] = await db.update(incidentes)
      .set(update)
      .where(and(
        eq(incidentes.id, req.params.id),
        eq(incidentes.tenantId, req.user.tenantId)
      ))
      .returning();
    if (!inc) return res.status(404).json({ erro: 'Incidente não encontrado' });
    res.json(inc);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar incidente' });
  }
});

router.delete('/:id', autenticar, apenasAdmin, async (req, res) => {
  try {
    await db.delete(incidentes)
      .where(and(
        eq(incidentes.id, req.params.id),
        eq(incidentes.tenantId, req.user.tenantId)
      ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir incidente' });
  }
});

export default router;
