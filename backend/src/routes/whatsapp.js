import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, filiais } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
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

    // 3. debug_token: extrai wabaId das granular_scopes e phoneNumberId do body (evento frontend)
    const debugResp = await fetch(
      `${GRAPH}/debug_token?input_token=${accessToken}&access_token=${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    );
    const debugData = await debugResp.json();
    console.log('[whatsapp] debug_token granular_scopes:', JSON.stringify(debugData?.data?.granular_scopes));
    if (debugData.error) throw new Error('Não foi possível validar o token Meta');

    let wabaId = req.body.wabaId || null;
    let phoneNumberId = req.body.phoneNumberId || null;
    let displayPhone = null;

    if (!wabaId) {
      const wabaScope = (debugData.data?.granular_scopes || [])
        .find(s => s.scope === 'whatsapp_business_management');
      if (!wabaScope?.target_ids?.length) {
        throw new Error('Nenhuma conta WhatsApp Business (WABA) encontrada no token. Certifique-se de selecionar a WABA no fluxo de autorização.');
      }
      wabaId = wabaScope.target_ids[0];
    }

    if (!phoneNumberId) {
      // 4. Busca números de telefone da WABA
      const phoneResp = await fetch(
        `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${accessToken}`
      );
      const phoneData = await phoneResp.json();
      if (phoneData.error || !phoneData.data?.length) {
        throw new Error('Nenhum número de telefone encontrado no WABA. Adicione um número no Meta Business Manager.');
      }
      ({ id: phoneNumberId, display_phone_number: displayPhone } = phoneData.data[0]);
    } else {
      const phoneResp = await fetch(
        `${GRAPH}/${phoneNumberId}?fields=display_phone_number&access_token=${accessToken}`
      );
      const phoneData = await phoneResp.json();
      displayPhone = phoneData.display_phone_number || phoneNumberId;
    }

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

router.post('/embedded-signup-filial/:filialId', autenticar, apenasAdmin, async (req, res) => {
  const { code, wabaId: bodyWabaId, phoneNumberId: bodyPhoneId } = req.body;
  const { filialId } = req.params;
  const tenantId = req.user.tenantId;

  if (!code) return res.status(400).json({ erro: 'Código de autorização não informado' });
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(500).json({ erro: 'Variáveis META_APP_ID e META_APP_SECRET não configuradas' });
  }

  const [filial] = await db.select().from(filiais)
    .where(and(eq(filiais.id, filialId), eq(filiais.tenantId, tenantId)))
    .limit(1);
  if (!filial) return res.status(404).json({ erro: 'Filial não encontrada' });

  try {
    const tokenResp = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&code=${encodeURIComponent(code)}`
    );
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(`Token exchange: ${tokenData.error.message}`);

    const longResp = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longResp.json();
    if (longData.error) throw new Error(`Long-lived token: ${longData.error.message}`);
    const accessToken = longData.access_token;
    const tokenExpiraEm = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : null;

    const debugResp = await fetch(
      `${GRAPH}/debug_token?input_token=${accessToken}&access_token=${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    );
    const debugData = await debugResp.json();
    if (debugData.error) throw new Error('Não foi possível validar o token Meta');

    let wabaId = bodyWabaId || null;
    let phoneNumberId = bodyPhoneId || null;
    let displayPhone = null;

    if (!wabaId) {
      const wabaScope = (debugData.data?.granular_scopes || [])
        .find(s => s.scope === 'whatsapp_business_management');
      if (!wabaScope?.target_ids?.length) throw new Error('Nenhuma WABA encontrada no token');
      wabaId = wabaScope.target_ids[0];
    }

    if (!phoneNumberId) {
      const phoneResp = await fetch(
        `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number&access_token=${accessToken}`
      );
      const phoneData = await phoneResp.json();
      if (phoneData.error || !phoneData.data?.length) throw new Error('Nenhum número encontrado no WABA');
      ({ id: phoneNumberId, display_phone_number: displayPhone } = phoneData.data[0]);
    } else {
      const phoneResp = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number&access_token=${accessToken}`);
      const phoneData = await phoneResp.json();
      displayPhone = phoneData.display_phone_number || phoneNumberId;
    }

    try {
      await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {}

    await db.update(filiais).set({
      wabaId,
      whatsappNumberId: phoneNumberId,
      whatsappToken: accessToken,
      whatsappTokenExpiraEm: tokenExpiraEm,
      whatsappConectadoEm: new Date(),
    }).where(eq(filiais.id, filialId));

    res.json({ ok: true, wabaId, phoneNumberId, displayPhone });
  } catch (err) {
    console.error('[whatsapp/embedded-signup-filial]', err.message);
    res.status(400).json({ erro: err.message || 'Erro ao conectar WhatsApp da filial' });
  }
});

router.delete('/desconectar-filial/:filialId', autenticar, apenasAdmin, async (req, res) => {
  const { filialId } = req.params;
  const [filial] = await db.select().from(filiais)
    .where(and(eq(filiais.id, filialId), eq(filiais.tenantId, req.user.tenantId)))
    .limit(1);
  if (!filial) return res.status(404).json({ erro: 'Filial não encontrada' });

  await db.update(filiais).set({
    whatsappNumberId: null,
    whatsappToken: null,
    whatsappTokenExpiraEm: null,
    wabaId: null,
    whatsappConectadoEm: null,
  }).where(eq(filiais.id, filialId));

  res.json({ ok: true });
});

router.post('/registrar-numero', autenticar, apenasAdmin, async (req, res) => {
  const isSuperAdmin = req.user.role === 'superadmin' || req.user.role === 'super_admin';
  const tenantId = isSuperAdmin ? (req.body.tenantId || req.user.tenantId) : req.user.tenantId;
  if (!tenantId) return res.status(403).json({ erro: 'Sem tenant. Super admin deve informar tenantId no body.' });

  const [tenant] = await db.select({
    whatsappNumberId: tenants.whatsappNumberId,
    whatsappToken: tenants.whatsappToken,
  }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  if (!tenant?.whatsappNumberId || !tenant?.whatsappToken) {
    return res.status(400).json({ erro: 'WhatsApp não configurado para este tenant' });
  }

  try {
    const regResp = await fetch(`${GRAPH}/${tenant.whatsappNumberId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: '000000',
        access_token: tenant.whatsappToken,
      }),
    });
    const regData = await regResp.json();
    console.log('[whatsapp] register:', JSON.stringify(regData));

    if (regData.error) {
      return res.status(400).json({ erro: regData.error.message, detalhes: regData.error });
    }

    res.json({ ok: true, resultado: regData });
  } catch (err) {
    console.error('[whatsapp/registrar-numero]', err.message);
    res.status(500).json({ erro: err.message });
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
