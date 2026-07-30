import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4Bloqueado(address) {
  const partes = address.split('.').map(Number);
  if (partes.length !== 4 || partes.some(n => !Number.isInteger(n))) return true;
  const [a, b] = partes;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

function ipv6Bloqueado(address) {
  const normalizado = address.toLowerCase();
  return normalizado === '::'
    || normalizado === '::1'
    || normalizado.startsWith('fc')
    || normalizado.startsWith('fd')
    || normalizado.startsWith('fe8')
    || normalizado.startsWith('fe9')
    || normalizado.startsWith('fea')
    || normalizado.startsWith('feb');
}

function ipBloqueado(address) {
  const versao = net.isIP(address);
  if (versao === 4) return ipv4Bloqueado(address);
  if (versao === 6) return ipv6Bloqueado(address);
  return true;
}

function hostsPrivadosPermitidos() {
  return new Set(
    (process.env.SGP_ALLOWED_PRIVATE_HOSTS || '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function validarUrlSgp(valor) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('URL do SGP inválida');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Protocolo da URL do SGP não permitido');
  }
  if (url.username || url.password) {
    throw new Error('Credenciais não podem ser incluídas na URL do SGP');
  }
  if (url.protocol === 'http:' && process.env.SGP_ALLOW_HTTP !== 'true') {
    throw new Error('URL do SGP deve usar HTTPS');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowlist = hostsPrivadosPermitidos();
  if (allowlist.has(hostname)) return url;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Host local não permitido para o SGP');
  }

  const enderecos = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!enderecos.length || enderecos.some(item => ipBloqueado(item.address))) {
    throw new Error('A URL do SGP aponta para uma rede privada ou reservada');
  }

  return url;
}
