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

// Cache curto da revalidação de sessão.
//
// Com o painel aberto são ~40 requisições por minuto por aba (lista de
// conversas e mensagens a cada 5s, contadores, presença, filiais...), e cada
// uma rodava este JOIN para buscar sempre a mesma linha. Era a consulta mais
// repetida do sistema e a principal razão de o Neon nunca suspender.
//
// O preço é que desativar um usuário ou suspender um provedor leva até
// SESSAO_TTL_MS para valer. Por isso os dois caminhos que importam —
// desativação e logout — limpam a entrada na hora; o TTL só cobre o que mudar
// direto no banco, por fora do painel.
const SESSAO_TTL_MS = 30_000;
const TETO_SESSOES = 500;
const sessoes = new Map();

export function invalidarSessao(id) {
  if (id) sessoes.delete(`tenant:${id}`);
  if (id) sessoes.delete(`super:${id}`);
}

// O logout não passa pelo autenticar — token expirado também precisa conseguir
// sair —, então a invalidação lê o token por conta própria.
export function invalidarSessaoDaRequisicao(req) {
  const token = tokenDaRequisicao(req);
  if (!token) return;
  try {
    invalidarSessao(jwt.verify(token, process.env.JWT_SECRET)?.id);
  } catch {
    // Token inválido ou expirado: não há sessão em cache que ele alcance.
  }
}

// Suspender um provedor precisa derrubar todo mundo dele, não só quem pediu.
export function invalidarSessoesDoTenant(tenantId) {
  if (!tenantId) return;
  for (const [chave, valor] of sessoes) {
    if (valor?.user?.tenantId === tenantId) sessoes.delete(chave);
  }
}

function doCache(chave) {
  const achado = sessoes.get(chave);
  if (!achado) return null;
  if (Date.now() > achado.expira) {
    sessoes.delete(chave);
    return null;
  }
  return achado.user;
}

function guardar(chave, user) {
  // Map cresce na ordem de inserção, então o primeiro é o mais antigo.
  if (sessoes.size >= TETO_SESSOES) sessoes.delete(sessoes.keys().next().value);
  sessoes.set(chave, { user, expira: Date.now() + SESSAO_TTL_MS });
}

export async function autenticar(req, res, next) {
  const token = tokenDaRequisicao(req);
  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const chave = `${payload.role === 'superadmin' ? 'super' : 'tenant'}:${payload.id}`;
    const emCache = doCache(chave);
    if (emCache) {
      req.user = emCache;
      return next();
    }

    if (payload.role === 'superadmin') {
      const [admin] = await db.select({
        id: superAdmins.id,
        email: superAdmins.email,
        nome: superAdmins.nome,
      }).from(superAdmins).where(eq(superAdmins.id, payload.id)).limit(1);

      if (!admin) return res.status(401).json({ erro: 'Usuário não está mais ativo' });
      const userSuper = { ...payload, ...admin, role: 'superadmin' };
      guardar(chave, userSuper);
      req.user = userSuper;
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
    guardar(chave, userAtual);
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
