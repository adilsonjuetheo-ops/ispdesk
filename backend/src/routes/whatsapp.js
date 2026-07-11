import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';

const router = Router();
const GRAPH = 'https://graph.facebook.com/v19.0';

router.post('/embedded-signup', autenticar, apenasAdmin, async (req, res) => {
  const { code } = req.body;
  const tenantId = req.user.tenantId;

  if (!code) return res.status(400).json({ erro: 'Código de autorização não informado' });
  if (!tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(500).json({ erro: 'Variáveis META_APP_ID e META_APP_SECRET não configuradas' });
  }

  try {
    // 1. Trocar código por token de curta duração
    const tokenResp = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&code=${encodeURIComponent(code)}`
    );
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(`Token exchange: ${tokenData.error.message}`);
    const shortToken = tokenData.access_token;

    // 2. Trocar por token de longa duração (60 dias)
    const longResp = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${shortToken}`
    );
    const longData = await longResp.json();
    if (longData.error) throw new Error(`Long-lived token: ${longData.error.message}`);
    const accessToken = longData.access_token;
    const tokenExpiraEm = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000)
      : null;

    // 3. Obter user_id via debug_token
    const debugResp = await fetch(
      `${GRAPH}/debug_token?input_token=${accessToken}&access_token=${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    );
    const debugData = await debugResp.json();
    if (debugData.error || !debugData.data?.user_id) {
      throw new Error('Não foi possível identificar o usuário Meta');
    }
    const userId = debugData.data.user_id;

    // 4. Listar businesses do usuário
    const bizResp = await fetch(
      `${GRAPH}/${userId}/businesses?fields=id,name&access_token=${accessToken}`
    );
    const bizData = await bizResp.json();
    if (bizData.error || !bizData.data?.length) {
      throw new Error('Nenhuma conta Business Meta encontrada. Verifique se o usuário tem acesso a um Business Manager.');
    }
    const businessId = bizData.data[0].id;

    // 5. Listar WABAs da business
    const wabaResp = await fetch(
      `${GRAPH}/${businessId}/owned_whatsapp_business_accounts?access_token=${accessToken}`
    );
    const wabaData = await wabaResp.json();
    if (wabaData.error || !wabaData.data?.length) {
      throw new Error('Nenhuma conta WhatsApp Business (WABA) encontrada neste Business Manager.');
    }
    const wabaId = wabaData.data[0].id;

    // 6. Listar números de telefone do WABA
    const phoneResp = await fetch(
      `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${accessToken}`
    );
    const phoneData = await phoneResp.json();
    if (phoneData.error || !phoneData.data?.length) {
      throw new Error('Nenhum número de telefone encontrado no WABA. Adicione um número no Meta Business Manager.');
    }
    const { id: phoneNumberId, display_phone_number: displayPhone } = phoneData.data[0];

    // 7. Subscrever app no webhook do WABA
    try {
      const subResp = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const subData = await subResp.json();
      if (subData.error) console.warn('[whatsapp] subscribed_apps falhou:', subData.error.message);
    } catch (e) {
      console.warn('[whatsapp] subscribed_apps erro:', e.message);
    }

    // 8. Salvar no banco
    await db.update(tenants).set({
      wabaId,
      whatsappNumberId: phoneNumberId,
      whatsappToken: accessToken,
      whatsappTokenExpiraEm: tokenExpiraEm,
      whatsappConectadoEm: new Date(),
      atualizadoEm: new Date(),
    }).where(eq(tenants.id, tenantId));

    res.json({ ok: true, wabaId, phoneNumberId, displayPhone });
  } catch (err) {
    console.error('[whatsapp/embedded-signup]', err.message);
    res.status(400).json({ erro: err.message || 'Erro ao conectar WhatsApp' });
  }
});

router.get('/status', autenticar, async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.status(403).json({ erro: 'Sem tenant' });

  const [tenant] = await db.select({
    wabaId: tenants.wabaId,
    whatsappNumberId: tenants.whatsappNumberId,
    whatsappConectadoEm: tenants.whatsappConectadoEm,
  }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  res.json({
    conectado: !!(tenant?.wabaId && tenant?.whatsappNumberId),
    wabaId: tenant?.wabaId || null,
    phoneNumberId: tenant?.whatsappNumberId || null,
    conectadoEm: tenant?.whatsappConectadoEm || null,
  });
});

export default router;
