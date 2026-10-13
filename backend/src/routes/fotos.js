import { Router } from 'express';
import { db } from '../db/index.js';
import { tenantUsers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import { lerFotoDataUri } from '../services/fotoAtendente.js';

const router = Router();
router.use(autenticar);

// Rota própria, fora de /api/auth, por dois motivos.
//
// O primeiro é o rate limit: /api/auth tem teto de 100 requisições por 15
// minutos para proteger o login, e vários atendentes do mesmo escritório
// compartilham IP. Buscar avatar ali consumiria a franquia que existe para
// barrar tentativa de senha.
//
// O segundo é a banda: a presença é consultada a cada 15s por aba aberta, e
// mandar a foto em base64 no corpo dela desfaria a economia que o cache de
// sessão trouxe. Aqui o navegador guarda por um dia e só volta quando a versão
// muda — e a versão só muda quando o atendente troca a imagem.
router.get('/:id', async (req, res) => {
  const [dono] = await db.select({
    fotoUrl: tenantUsers.fotoUrl,
    fotoVersao: tenantUsers.fotoVersao,
    tenantId: tenantUsers.tenantId,
  }).from(tenantUsers).where(eq(tenantUsers.id, req.params.id)).limit(1);

  // Só gente do mesmo provedor: sem esta checagem, um id vazado mostraria o
  // rosto de atendente de outro provedor.
  if (!dono?.fotoUrl || dono.tenantId !== req.user.tenantId) return res.status(404).end();

  const imagem = lerFotoDataUri(dono.fotoUrl);
  if (!imagem) return res.status(404).end();

  const etag = `"${dono.fotoVersao || 'sem-versao'}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  res.setHeader('Content-Type', imagem.mime);
  res.setHeader('ETag', etag);
  // Sobrescreve o no-store que os cabeçalhos de segurança aplicam a tudo.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(imagem.buffer);
});

export default router;
