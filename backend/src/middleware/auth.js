import jwt from 'jsonwebtoken';

export function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
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
