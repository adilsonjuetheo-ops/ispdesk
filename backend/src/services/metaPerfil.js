const GRAPH = 'https://graph.facebook.com/v19.0';

// Perfil comercial do número no WhatsApp: a foto que o cliente vê, o recado,
// o site, o endereço.
//
// Existe porque o WhatsApp Manager só deixa editar isso quem administra o
// portfólio de negócios dono da WABA. Quando o provedor entra como cliente de
// parceiro, a tela vira só leitura — mas o token guardado aqui é do app, e a
// Cloud API aceita a escrita do mesmo jeito.

// Limites da Meta. Passar deles devolve erro genérico, sem dizer qual campo:
// melhor barrar aqui, onde dá pra nomear.
export const LIMITES = {
  about: 139,
  address: 256,
  description: 512,
  email: 128,
  website: 256,
  websites: 2,
};

export const VERTICAIS = [
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN',
  'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT',
  'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ',
];

const CAMPOS = 'about,address,description,email,profile_picture_url,websites,vertical';

async function graph(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.error) {
    const msg = dados?.error?.error_user_msg || dados?.error?.message || `HTTP ${res.status}`;
    const erro = new Error(msg);
    erro.codigoMeta = dados?.error?.code ?? null;
    throw erro;
  }
  return dados;
}

export async function lerPerfil({ phoneNumberId, token }) {
  const dados = await graph(
    `${GRAPH}/${phoneNumberId}/whatsapp_business_profile?fields=${CAMPOS}`, token
  );
  return dados?.data?.[0] || {};
}

// A foto não vai no corpo da atualização: primeiro ela sobe pela Resumable
// Upload API, que devolve um handle, e é o handle que entra no perfil.
//
// São duas chamadas com autenticação DIFERENTE — a sessão abre com Bearer e o
// envio dos bytes exige `Authorization: OAuth <token>`. Mandar Bearer no
// segundo passo responde 400 sem explicar nada.
export async function subirImagem({ token, bytes, mimeType, nome = 'perfil' }) {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error('META_APP_ID não está configurado no servidor.');

  const sessao = await graph(
    `${GRAPH}/${appId}/uploads?file_name=${encodeURIComponent(nome)}` +
    `&file_length=${bytes.length}&file_type=${encodeURIComponent(mimeType)}`,
    token,
    { method: 'POST' }
  );
  if (!sessao?.id) throw new Error('A Meta não abriu a sessão de upload da imagem.');

  const envio = await graph(`${GRAPH}/${sessao.id}`, token, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      'file_offset': '0',
      'Content-Type': mimeType,
    },
    body: bytes,
  });
  if (!envio?.h) throw new Error('A Meta aceitou a imagem mas não devolveu o identificador dela.');
  return envio.h;
}

export async function atualizarPerfil({ phoneNumberId, token }, campos) {
  return graph(`${GRAPH}/${phoneNumberId}/whatsapp_business_profile`, token, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', ...campos }),
  });
}

// Aceita data URL (é como o painel manda, igual ao upload da logo) e devolve
// os bytes crus. A checagem é pelos primeiros bytes, não pela extensão nem
// pelo que o navegador disse: o arquivo é de fora.
export function lerDataUrlDeImagem(dataUrl) {
  const m = /^data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('A foto precisa ser JPEG ou PNG.');

  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) throw new Error('A foto chegou vazia.');

  const png  = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (!png && !jpeg) throw new Error('O arquivo não é um JPEG nem um PNG válido.');

  const mimeType = png ? 'image/png' : 'image/jpeg';

  // A Meta recusa abaixo de 192x192. O erro dela não diz o tamanho, então o
  // cabeçalho é lido aqui pra poder avisar com número.
  const lado = png ? dimensoesPng(bytes) : dimensoesJpeg(bytes);
  if (lado && (lado.largura < 192 || lado.altura < 192)) {
    throw new Error(`A foto tem ${lado.largura}x${lado.altura}. O WhatsApp exige pelo menos 192x192.`);
  }

  return { bytes, mimeType, dimensoes: lado };
}

function dimensoesPng(bytes) {
  if (bytes.length < 24) return null;
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) };
}

// Percorre os marcadores até achar um SOF (0xC0–0xCF, fora dos que não
// carregam dimensão), que é onde o JPEG guarda altura e largura.
function dimensoesJpeg(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marcador = bytes[i + 1];
    if (marcador >= 0xd0 && marcador <= 0xd9) { i += 2; continue; }
    const tamanho = bytes.readUInt16BE(i + 2);
    const ehSof = marcador >= 0xc0 && marcador <= 0xcf &&
                  marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (ehSof) return { altura: bytes.readUInt16BE(i + 5), largura: bytes.readUInt16BE(i + 7) };
    i += 2 + tamanho;
  }
  return null;
}
