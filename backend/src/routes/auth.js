import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { superAdmins, tenantUsers, tenants } from '../db/schema.js';
import { eq, count } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router();

function gerarToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });

  // tenta super admin primeiro
  const [sa] = await db.select().from(superAdmins).where(eq(superAdmins.email, email)).limit(1);
  if (sa) {
    const ok = await bcrypt.compare(senha, sa.senhaHash);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });
    const token = gerarToken({ id: sa.id, email: sa.email, nome: sa.nome, role: 'superadmin' });
    return res.json({ token, user: { id: sa.id, email: sa.email, nome: sa.nome, role: 'superadmin' } });
  }

  // tenta usuário de tenant
  const [tu] = await db.select().from(tenantUsers).where(eq(tenantUsers.email, email)).limit(1);
  if (!tu) return res.status(401).json({ erro: 'Credenciais inválidas' });
  if (!tu.ativo) return res.status(401).json({ erro: 'Usuário desativado' });

  const ok = await bcrypt.compare(senha, tu.senhaHash);
  if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });

  const [tenant] = await db.select({ sgpTipo: tenants.sgpTipo, nomeAssistente: tenants.nomeAssistente, plano: tenants.plano })
    .from(tenants).where(eq(tenants.id, tu.tenantId)).limit(1);
  const sgpTipo = tenant?.sgpTipo || null;
  const nomeAssistente = tenant?.nomeAssistente || 'Assistente';
  const plano = tenant?.plano || 'basic';

  const payload = { id: tu.id, email: tu.email, nome: tu.nome, role: tu.role, tenantId: tu.tenantId, filialId: tu.filialId || null, sgpTipo, nomeAssistente, plano };
  const token = gerarToken(payload);
  return res.json({ token, user: payload });
});

router.put('/change-password', autenticar, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  if (!senhaAtual || !novaSenha) return res.status(400).json({ erro: 'Campos obrigatórios' });
  if (novaSenha.length < 6) return res.status(400).json({ erro: 'Nova senha: mínimo 6 caracteres' });

  if (req.user.role === 'superadmin') {
    const [sa] = await db.select().from(superAdmins).where(eq(superAdmins.id, req.user.id)).limit(1);
    if (!sa || !await bcrypt.compare(senhaAtual, sa.senhaHash))
      return res.status(401).json({ erro: 'Senha atual incorreta' });
    await db.update(superAdmins).set({ senhaHash: await bcrypt.hash(novaSenha, 10) }).where(eq(superAdmins.id, req.user.id));
  } else {
    const [tu] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, req.user.id)).limit(1);
    if (!tu || !await bcrypt.compare(senhaAtual, tu.senhaHash))
      return res.status(401).json({ erro: 'Senha atual incorreta' });
    await db.update(tenantUsers).set({ senhaHash: await bcrypt.hash(novaSenha, 10) }).where(eq(tenantUsers.id, req.user.id));
  }

  res.json({ mensagem: 'Senha alterada com sucesso' });
});

// rota de setup — cria primeiro super admin se não existir nenhum
router.post('/setup', async (req, res) => {
  const [{ total }] = await db.select({ total: count() }).from(superAdmins);
  if (Number(total) > 0) return res.status(403).json({ erro: 'Setup já realizado' });

  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha obrigatórios' });
  if (senha.length < 8) return res.status(400).json({ erro: 'Senha mínimo 8 caracteres' });

  const senhaHash = await bcrypt.hash(senha, 10);
  const [sa] = await db.insert(superAdmins).values({ nome, email, senhaHash }).returning({
    id: superAdmins.id,
    email: superAdmins.email,
    nome: superAdmins.nome,
  });
  res.status(201).json({ mensagem: 'Super admin criado com sucesso', admin: sa });
});

export default router;
