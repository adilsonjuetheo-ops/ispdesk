import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function injetarTenant(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  if (!req.user.tenantId) return res.status(403).json({ erro: 'tenantId ausente no token' });

  const [tenant] = await db.select().from(tenants)
    .where(eq(tenants.id, req.user.tenantId))
    .limit(1);

  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  if (!tenant.ativo) return res.status(403).json({ erro: 'Provedor desativado' });

  req.tenant = tenant;
  next();
}
