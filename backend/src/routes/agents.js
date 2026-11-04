import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { tenantUsers, filiais } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin, mesmotenant, invalidarSessao } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(autenticar, apenasAdmin, mesmotenant);

async function filialValida(tenantId, filialId) {
  if (!filialId) return true;
  const [filial] = await db.select({ id: filiais.id }).from(filiais).where(and(
    eq(filiais.id, filialId),
    eq(filiais.tenantId, tenantId),
    eq(filiais.ativo, true),
  )).limit(1);
  return !!filial;
}

router.get('/', async (req, res) => {
  const agentes = await db.select({
    id: tenantUsers.id,
    nome: tenantUsers.nome,
    email: tenantUsers.email,
    role: tenantUsers.role,
    filialId: tenantUsers.filialId,
    ixcTecnicoId: tenantUsers.ixcTecnicoId,
    ativo: tenantUsers.ativo,
    criadoEm: tenantUsers.criadoEm,
  }).from(tenantUsers).where(eq(tenantUsers.tenantId, req.params.tenantId));

  res.json(agentes);
});

// O vínculo com o colaborador do SGP só faz sentido para quem vai a campo.
// Guardar num agente de inbox seria dado morto que um dia confunde alguém.
const vinculoDoRole = (role, ixcTecnicoId) =>
  role === 'tecnico' ? (String(ixcTecnicoId || '').trim() || null) : null;

router.post('/', async (req, res) => {
  const { nome, email, senha, role, filialId, ixcTecnicoId } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha obrigatórios' });
  if (senha.length < 10) return res.status(400).json({ erro: 'Senha mínimo 10 caracteres' });
  if (!await filialValida(req.params.tenantId, filialId)) {
    return res.status(400).json({ erro: 'Filial inválida para este provedor' });
  }

  const roleValido = ['agente', 'admin', 'tecnico'].includes(role) ? role : 'agente';
  const senhaHash = await bcrypt.hash(senha, 12);

  try {
    const [agente] = await db.insert(tenantUsers).values({
      tenantId: req.params.tenantId,
      nome,
      email,
      senhaHash,
      role: roleValido,
      filialId: filialId || null,
      ixcTecnicoId: vinculoDoRole(roleValido, ixcTecnicoId),
    }).returning({
      id: tenantUsers.id,
      nome: tenantUsers.nome,
      email: tenantUsers.email,
      role: tenantUsers.role,
      filialId: tenantUsers.filialId,
      ixcTecnicoId: tenantUsers.ixcTecnicoId,
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
  const { nome, email, senha, role, ativo, filialId, ixcTecnicoId } = req.body;
  if (filialId !== undefined && !await filialValida(req.params.tenantId, filialId)) {
    return res.status(400).json({ erro: 'Filial inválida para este provedor' });
  }
  if (role !== undefined && !['agente', 'admin', 'tecnico'].includes(role)) {
    return res.status(400).json({ erro: 'Papel inválido' });
  }
  const updates = { nome, email, role, ativo, filialId: filialId || null };
  // Deixar de ser técnico tem que limpar o vínculo junto, senão o registro
  // guarda um colaborador que ninguém mais vê na tela para corrigir.
  if (role !== undefined) updates.ixcTecnicoId = vinculoDoRole(role, ixcTecnicoId);

  if (senha) {
    if (senha.length < 10) return res.status(400).json({ erro: 'Senha mínimo 10 caracteres' });
    updates.senhaHash = await bcrypt.hash(senha, 12);
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
      ixcTecnicoId: tenantUsers.ixcTecnicoId,
      ativo: tenantUsers.ativo,
    });

  if (!agente) return res.status(404).json({ erro: 'Agente não encontrado' });
  // A sessão fica 30s em cache. Trocar o papel de alguém só valia no minuto
  // seguinte — e agora papel decide qual app a pessoa vê, não só quais botões.
  invalidarSessao(req.params.id);
  res.json(agente);
});

router.delete('/:id', async (req, res) => {
  await db.update(tenantUsers)
    .set({ ativo: false })
    .where(and(eq(tenantUsers.id, req.params.id), eq(tenantUsers.tenantId, req.params.tenantId)));
  // O middleware guarda a sessao por 30s; desativar tem que valer agora.
  invalidarSessao(req.params.id);
  res.json({ mensagem: 'Agente desativado' });
});

export default router;
