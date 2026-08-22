import webpush from 'web-push';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// setVapidDetails LANÇA quando as chaves vêm vazias, e isso acontece na
// importação do módulo. Como o webhook e o envio de contrato importam este
// arquivo só para disparar uma notificação, um ambiente sem VAPID derrubava os
// dois junto — ou seja, o bot inteiro parava por causa de um push.
const pushConfigurado = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (pushConfigurado) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@ispdesk.com.br'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes — notificações desativadas.');
}

async function enviarParaSubs(subs, payload) {
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

export async function enviarPushParaTenant(tenantId, payload) {
  if (!pushConfigurado) return;
  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.tenantId, tenantId));
  await enviarParaSubs(subs, payload);
}

export async function enviarPushParaUsuario(userId, tenantId, payload) {
  if (!pushConfigurado) return;
  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  // Se o agente não tem subscription própria, manda para todo o tenant
  if (subs.length === 0) return enviarPushParaTenant(tenantId, payload);
  await enviarParaSubs(subs, payload);
}
