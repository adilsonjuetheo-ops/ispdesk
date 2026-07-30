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

function opcoesCookie(req) {
  return {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function definirSessao(req, res, token) {
  res.cookie('ispdesk_session', token, opcoesCookie(req));
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
    definirSessao(req, res, token);
    return res.json({ token, user: { id: sa.id, email: sa.email, nome: sa.nome, role: 'superadmin' } });
  }

  // tenta usuário de tenant
  const [tu] = await db.select().from(tenantUsers).where(eq(tenantUsers.email, email)).limit(1);
  if (!tu) return res.status(401).json({ erro: 'Credenciais inválidas' });
  if (!tu.ativo) return res.status(401).json({ erro: 'Usuário desativado' });

  const ok = await bcrypt.compare(senha, tu.senhaHash);
  if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });

  const [tenant] = await db.select({
    sgpTipo: tenants.sgpTipo,
    nomeAssistente: tenants.nomeAssistente,
    plano: tenants.plano,
    ativo: tenants.ativo,
  })
    .from(tenants).where(eq(tenants.id, tu.tenantId)).limit(1);
  if (!tenant?.ativo) return res.status(401).json({ erro: 'Provedor desativado' });
  const sgpTipo = tenant?.sgpTipo || null;
  const nomeAssistente = tenant?.nomeAssistente || 'Assistente';
  const plano = tenant?.plano || 'basic';

  const payload = { id: tu.id, email: tu.email, nome: tu.nome, role: tu.role, tenantId: tu.tenantId, filialId: tu.filialId || null, sgpTipo, nomeAssistente, plano };
  const token = gerarToken(payload);
  definirSessao(req, res, token);
  return res.json({ token, user: payload });
});

router.post('/logout', (req, res) => {
  const { maxAge, ...opcoes } = opcoesCookie(req);
  res.clearCookie('ispdesk_session', opcoes);
  res.json({ ok: true });
});

router.put('/change-password', autenticar, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  if (!senhaAtual || !novaSenha) return res.status(400).json({ erro: 'Campos obrigatórios' });
  if (novaSenha.length < 10) return res.status(400).json({ erro: 'Nova senha: mínimo 10 caracteres' });

  if (req.user.role === 'superadmin') {
    const [sa] = await db.select().from(superAdmins).where(eq(superAdmins.id, req.user.id)).limit(1);
    if (!sa || !await bcrypt.compare(senhaAtual, sa.senhaHash))
      return res.status(401).json({ erro: 'Senha atual incorreta' });
    await db.update(superAdmins).set({ senhaHash: await bcrypt.hash(novaSenha, 12) }).where(eq(superAdmins.id, req.user.id));
  } else {
    const [tu] = await db.select().from(tenantUsers).where(eq(tenantUsers.id, req.user.id)).limit(1);
    if (!tu || !await bcrypt.compare(senhaAtual, tu.senhaHash))
      return res.status(401).json({ erro: 'Senha atual incorreta' });
    await db.update(tenantUsers).set({ senhaHash: await bcrypt.hash(novaSenha, 12) }).where(eq(tenantUsers.id, req.user.id));
  }

  res.json({ mensagem: 'Senha alterada com sucesso' });
});

// rota de setup — cria primeiro super admin se não existir nenhum
router.post('/setup', async (req, res) => {
  try {
    const [{ total }] = await db.select({ total: count() }).from(superAdmins);
    if (Number(total) > 0) return res.status(403).json({ erro: 'Setup já realizado' });

    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha obrigatórios' });
    if (senha.length < 12) return res.status(400).json({ erro: 'Senha mínimo 12 caracteres' });

    const senhaHash = await bcrypt.hash(senha, 12);
    const [sa] = await db.insert(superAdmins).values({ nome, email, senhaHash }).returning({
      id: superAdmins.id,
      email: superAdmins.email,
      nome: superAdmins.nome,
    });
    res.status(201).json({ mensagem: 'Super admin criado com sucesso', admin: sa });
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      return res.status(403).json({ erro: 'Setup já realizado' });
    }
    throw err;
  }
});

export default router;
