import { Router } from 'express';
import { db } from '../db/index.js';
import { npsRespostas, clientes } from '../db/schema.js';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.status(403).json({ erro: 'Acesso negado' });

  const respostas = await db.select({
    id: npsRespostas.id,
    nota: npsRespostas.nota,
    categoria: npsRespostas.categoria,
    clienteWhatsapp: npsRespostas.clienteWhatsapp,
    clienteNome: clientes.nome,
    enviadoEm: npsRespostas.enviadoEm,
    respondidoEm: npsRespostas.respondidoEm,
  })
    .from(npsRespostas)
    .leftJoin(clientes, eq(npsRespostas.clienteId, clientes.id))
    .where(and(
      eq(npsRespostas.tenantId, tenantId),
      isNotNull(npsRespostas.nota),
    ))
    .orderBy(desc(npsRespostas.respondidoEm))
    .limit(100);

  const total = respostas.length;

  if (total === 0) {
    return res.json({ score: null, total: 0, promotores: 0, neutros: 0, detratores: 0, respostas: [] });
  }

  const promotores  = respostas.filter(r => r.categoria === 'promotor').length;
  const neutros     = respostas.filter(r => r.categoria === 'neutro').length;
  const detratores  = respostas.filter(r => r.categoria === 'detrator').length;
  const score       = Math.round(((promotores - detratores) / total) * 100);
  const media       = (respostas.reduce((s, r) => s + r.nota, 0) / total).toFixed(1);

  res.json({ score, media: Number(media), total, promotores, neutros, detratores, respostas });
});

export default router;
