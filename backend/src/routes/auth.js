import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { superAdmins, tenantUsers } from '../db/schema.js';
import { eq, count } from 'drizzle-orm';

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

  const token = gerarToken({ id: tu.id, email: tu.email, nome: tu.nome, role: tu.role, tenantId: tu.tenantId, filialId: tu.filialId || null });
  return res.json({ token, user: { id: tu.id, email: tu.email, nome: tu.nome, role: tu.role, tenantId: tu.tenantId, filialId: tu.filialId || null } });
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
