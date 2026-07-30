import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { superAdmins, tenantUsers, tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';

function tokenDaRequisicao(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  const cookies = req.headers.cookie || '';
  for (const parte of cookies.split(';')) {
    const [nome, ...valor] = parte.trim().split('=');
    if (nome === 'ispdesk_session') return decodeURIComponent(valor.join('='));
  }
  return null;
}

export async function autenticar(req, res, next) {
  const token = tokenDaRequisicao(req);
  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role === 'superadmin') {
      const [admin] = await db.select({
        id: superAdmins.id,
        email: superAdmins.email,
        nome: superAdmins.nome,
      }).from(superAdmins).where(eq(superAdmins.id, payload.id)).limit(1);

      if (!admin) return res.status(401).json({ erro: 'Usuário não está mais ativo' });
      req.user = { ...payload, ...admin, role: 'superadmin' };
      return next();
    }

    const [usuario] = await db.select({
      id: tenantUsers.id,
      tenantId: tenantUsers.tenantId,
      filialId: tenantUsers.filialId,
      email: tenantUsers.email,
      nome: tenantUsers.nome,
      role: tenantUsers.role,
      ativo: tenantUsers.ativo,
      tenantAtivo: tenants.ativo,
      plano: tenants.plano,
      sgpTipo: tenants.sgpTipo,
      nomeAssistente: tenants.nomeAssistente,
    })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.id, payload.id))
      .limit(1);

    if (!usuario?.ativo || !usuario.tenantAtivo) {
      return res.status(401).json({ erro: 'Usuário ou provedor não está mais ativo' });
    }

    const { ativo, tenantAtivo, ...userAtual } = usuario;
    req.user = userAtual;
    next();
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
    console.error('[auth] Falha ao revalidar sessão:', err.message);
    return res.status(503).json({ erro: 'Não foi possível validar a sessão agora' });
  }
}

export function apenasSuper(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ erro: 'Acesso restrito a super administradores' });
  }
  next();
}

export function apenasAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores' });
  }
  next();
}

export function mesmotenant(req, res, next) {
  const { tenantId } = req.params;
  if (req.user.role === 'superadmin') return next();
  if (req.user.tenantId !== tenantId) {
    return res.status(403).json({ erro: 'Acesso negado a este provedor' });
  }
  next();
}
