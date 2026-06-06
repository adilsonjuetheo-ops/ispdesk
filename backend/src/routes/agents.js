import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { tenantUsers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin, mesmotenant } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(autenticar, apenasAdmin, mesmotenant);

router.get('/', async (req, res) => {
  const agentes = await db.select({
    id: tenantUsers.id,
    nome: tenantUsers.nome,
    email: tenantUsers.email,
    role: tenantUsers.role,
    filialId: tenantUsers.filialId,
    ativo: tenantUsers.ativo,
    criadoEm: tenantUsers.criadoEm,
  }).from(tenantUsers).where(eq(tenantUsers.tenantId, req.params.tenantId));

  res.json(agentes);
});

router.post('/', async (req, res) => {
  const { nome, email, senha, role, filialId } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha obrigatórios' });
  if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínimo 6 caracteres' });

  const roleValido = ['agente', 'admin'].includes(role) ? role : 'agente';
  const senhaHash = await bcrypt.hash(senha, 10);

  try {
    const [agente] = await db.insert(tenantUsers).values({
      tenantId: req.params.tenantId,
      nome,
      email,
      senhaHash,
      role: roleValido,
      filialId: filialId || null,
    }).returning({
      id: tenantUsers.id,
      nome: tenantUsers.nome,
      email: tenantUsers.email,
      role: tenantUsers.role,
      filialId: tenantUsers.filialId,
      ativo: tenantUsers.ativo,
      criadoEm: tenantUsers.criadoEm,
    });
    res.status(201).json(agente);
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(409).json({ erro: 'E-mail já está em uso' });
    }
    res.status(500).json({ erro: 'Erro ao criar agente' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome, email, senha, role, ativo, filialId } = req.body;
  const updates = { nome, email, role, ativo, filialId: filialId || null };

  if (senha) {
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínimo 6 caracteres' });
    updates.senhaHash = await bcrypt.hash(senha, 10);
  }

  Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

  const [agente] = await db.update(tenantUsers)
    .set(updates)
    .where(and(eq(tenantUsers.id, req.params.id), eq(tenantUsers.tenantId, req.params.tenantId)))
    .returning({
      id: tenantUsers.id,
      nome: tenantUsers.nome,
      email: tenantUsers.email,
      role: tenantUsers.role,
      filialId: tenantUsers.filialId,
      ativo: tenantUsers.ativo,
    });

  if (!agente) return res.status(404).json({ erro: 'Agente não encontrado' });
  res.json(agente);
});

router.delete('/:id', async (req, res) => {
  await db.update(tenantUsers)
    .set({ ativo: false })
    .where(and(eq(tenantUsers.id, req.params.id), eq(tenantUsers.tenantId, req.params.tenantId)));
  res.json({ mensagem: 'Agente desativado' });
});

export default router;
