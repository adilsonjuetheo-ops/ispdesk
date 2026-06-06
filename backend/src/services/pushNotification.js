import webpush from 'web-push';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'admin@ispdesk.com.br'),
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

export async function enviarPushParaTenant(tenantId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.tenantId, tenantId));

  const json = JSON.stringify(payload);
  await Promise.allSettled(
    subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        json,
      ).catch(() =>
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint))
      )
    )
  );
}
