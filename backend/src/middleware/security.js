const buckets = new Map();

function getClientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function criarRateLimit({
  janelaMs = 60_000,
  limite = 60,
  prefixo = 'global',
  mensagem = 'Muitas requisições. Tente novamente em instantes.',
} = {}) {
  return (req, res, next) => {
    const agora = Date.now();
    const chave = `${prefixo}:${getClientKey(req)}`;
    const atual = buckets.get(chave);

    if (!atual || atual.expiraEm <= agora) {
      buckets.set(chave, { total: 1, expiraEm: agora + janelaMs });
      return next();
    }

    atual.total += 1;
    if (atual.total > limite) {
      const retryAfter = Math.max(1, Math.ceil((atual.expiraEm - agora) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ erro: mensagem });
    }

    next();
  };
}

export function headersSeguranca(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

export function limparRateLimitsExpirados() {
  const agora = Date.now();
  for (const [chave, bucket] of buckets.entries()) {
    if (bucket.expiraEm <= agora) buckets.delete(chave);
  }
}

const cleanupTimer = setInterval(limparRateLimitsExpirados, 5 * 60_000);
cleanupTimer.unref?.();
