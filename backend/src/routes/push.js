import { Router } from 'express';
import webpush from 'web-push';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router();

webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'admin@ispdesk.com.br'),
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

// Retorna a chave pública VAPID para o frontend usar no subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// Salva a subscription do navegador
router.post('/subscribe', autenticar, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys) return res.status(400).json({ erro: 'endpoint e keys obrigatórios' });

  await db.insert(pushSubscriptions)
    .values({ userId: req.user.id, tenantId: req.user.tenantId, endpoint, keys: JSON.stringify(keys) })
    .onConflictDoNothing();

  res.json({ ok: true });
});

// Remove a subscription (logout)
router.delete('/subscribe', autenticar, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }
  res.json({ ok: true });
});

export default router;
