// O frontend reduz a imagem para um quadrado de 96px antes de enviar, então o
// que chega são poucos KB. O teto abaixo é rede contra quem chamar a API
// direto: data URI grande ficaria no banco e sairia em toda listagem.
const TETO_BYTES = 80 * 1024;

// Só raster. SVG fica de fora de propósito: é XML, aceita <script> dentro, e
// uma imagem de perfil servida como image/svg+xml vira XSS no domínio da API.
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

export function lerFotoDataUri(valor) {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(valor || '').trim());
  if (!m) return null;

  const [, mime, b64] = m;
  if (!TIPOS.includes(mime.toLowerCase())) return null;

  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length || buffer.length > TETO_BYTES) return null;

  return { mime: mime.toLowerCase(), buffer };
}
