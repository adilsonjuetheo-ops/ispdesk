import { Router } from 'express';
import { autenticar } from '../middleware/auth.js';

const router = Router();
router.use(autenticar);

const presenceMap = new Map();
const TIMEOUT_MS = 2 * 60 * 1000;

router.post('/ping', (req, res) => {
  presenceMap.set(req.user.id, {
    nome: req.user.nome,
    role: req.user.role,
    tenantId: req.user.tenantId,
    lastSeen: Date.now(),
  });
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const now = Date.now();
  const tenantId = req.user.tenantId;
  const online = [];

  for (const [userId, data] of presenceMap.entries()) {
    if (now - data.lastSeen > TIMEOUT_MS) {
      presenceMap.delete(userId);
      continue;
    }
    if (data.tenantId !== tenantId) continue;
    online.push({ id: userId, nome: data.nome, role: data.role });
  }

  res.json(online);
});

export default router;
