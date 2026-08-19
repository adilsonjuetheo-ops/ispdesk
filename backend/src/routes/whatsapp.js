import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, filiais, filialWhatsappExtra } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';

const router = Router();
const GRAPH = 'https://graph.facebook.com/v19.0';

// Troca o code do Embedded Signup por um token de longa duração e resolve
// wabaId/phoneNumberId — usado tanto pro número principal do tenant/filial
// quanto pra números adicionais de uma filial.
async function concluirEmbeddedSignup(code, { wabaId: bodyWabaId, phoneNumberId: bodyPhoneId } = {}) {
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
    if (!wabaScope?.target_ids?.length) throw new Error('Nenhuma conta WhatsApp Business (WABA) encontrada no token');
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

  return { accessToken, tokenExpiraEm, wabaId, phoneNumberId, displayPhone };
}

router.post('/embedded-signup', autenticar, apenasAdmin, async (req, res) => {
  const { code, wabaId: bodyWabaId, phoneNumberId: bodyPhoneId } = req.body;
  const tenantId = req.user.tenantId;

  if (!code) return res.status(400).json({ erro: 'Código de autorização não informado' });
  if (!tenantId) return res.status(403).json({ erro: 'Sem tenant' });
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(500).json({ erro: 'Variáveis META_APP_ID e META_APP_SECRET não configuradas' });
  }

  try {
    const { accessToken, tokenExpiraEm, wabaId, phoneNumberId, displayPhone } =
      await concluirEmbeddedSignup(code, { wabaId: bodyWabaId, phoneNumberId: bodyPhoneId });

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
    const { accessToken, tokenExpiraEm, wabaId, phoneNumberId, displayPhone } =
      await concluirEmbeddedSignup(code, { wabaId: bodyWabaId, phoneNumberId: bodyPhoneId });

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

// Números adicionais de uma filial — uma filial pode receber por mais de um
// número (ex: manteve o fixo antigo funcionando junto com o celular novo).
router.post('/embedded-signup-filial-extra/:filialId', autenticar, apenasAdmin, async (req, res) => {
  const { code, wabaId: bodyWabaId, phoneNumberId: bodyPhoneId, rotulo } = req.body;
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
    const { accessToken, tokenExpiraEm, wabaId, phoneNumberId, displayPhone } =
      await concluirEmbeddedSignup(code, { wabaId: bodyWabaId, phoneNumberId: bodyPhoneId });

    const [extra] = await db.insert(filialWhatsappExtra).values({
      filialId,
      rotulo: rotulo || displayPhone || null,
      wabaId,
      whatsappNumberId: phoneNumberId,
      whatsappToken: accessToken,
      whatsappTokenExpiraEm: tokenExpiraEm,
      whatsappConectadoEm: new Date(),
    }).returning();

    res.json({ ok: true, id: extra.id, wabaId, phoneNumberId, displayPhone });
  } catch (err) {
    console.error('[whatsapp/embedded-signup-filial-extra]', err.message);
    res.status(400).json({ erro: err.message || 'Erro ao conectar número adicional' });
  }
});

router.delete('/desconectar-filial-extra/:id', autenticar, apenasAdmin, async (req, res) => {
  const [extra] = await db.select({ id: filialWhatsappExtra.id, filialId: filialWhatsappExtra.filialId })
    .from(filialWhatsappExtra)
    .innerJoin(filiais, eq(filiais.id, filialWhatsappExtra.filialId))
    .where(and(eq(filialWhatsappExtra.id, req.params.id), eq(filiais.tenantId, req.user.tenantId)))
    .limit(1);
  if (!extra) return res.status(404).json({ erro: 'Número não encontrado' });

  await db.delete(filialWhatsappExtra).where(eq(filialWhatsappExtra.id, req.params.id));
  res.json({ ok: true });
});

// Move um número já conectado (principal de uma filial ou extra) para outra
// filial — sem passar pelo Embedded Signup de novo, já que o número/token/WABA
// continuam os mesmos, só muda qual filial é dona da conexão no nosso banco.
// Se a filial de destino já tiver número principal, entra como extra dela.
router.post('/mover-numero', autenticar, apenasAdmin, async (req, res) => {
  const { origemFilialId, origemExtraId, destinoFilialId } = req.body;
  const tenantId = req.user.tenantId;

  if (!destinoFilialId || (!origemFilialId && !origemExtraId)) {
    return res.status(400).json({ erro: 'Informe a origem e o destino' });
  }

  const [destino] = await db.select().from(filiais)
    .where(and(eq(filiais.id, destinoFilialId), eq(filiais.tenantId, tenantId)))
    .limit(1);
  if (!destino) return res.status(404).json({ erro: 'Filial de destino não encontrada' });

  let numero; // { wabaId, whatsappNumberId, whatsappToken, whatsappTokenExpiraEm, rotulo }

  if (origemExtraId) {
    const [extra] = await db.select({
      rotulo: filialWhatsappExtra.rotulo,
      wabaId: filialWhatsappExtra.wabaId,
      whatsappNumberId: filialWhatsappExtra.whatsappNumberId,
      whatsappToken: filialWhatsappExtra.whatsappToken,
      whatsappTokenExpiraEm: filialWhatsappExtra.whatsappTokenExpiraEm,
    })
      .from(filialWhatsappExtra)
      .innerJoin(filiais, eq(filiais.id, filialWhatsappExtra.filialId))
      .where(and(eq(filialWhatsappExtra.id, origemExtraId), eq(filiais.tenantId, tenantId)))
      .limit(1);
    if (!extra) return res.status(404).json({ erro: 'Número de origem não encontrado' });
    numero = extra;
  } else {
    const [origem] = await db.select().from(filiais)
      .where(and(eq(filiais.id, origemFilialId), eq(filiais.tenantId, tenantId)))
      .limit(1);
    if (!origem) return res.status(404).json({ erro: 'Filial de origem não encontrada' });
    if (!origem.whatsappNumberId || !origem.whatsappToken) {
      return res.status(400).json({ erro: 'Filial de origem não tem WhatsApp conectado' });
    }
    if (origem.id === destinoFilialId) return res.status(400).json({ erro: 'Origem e destino são a mesma filial' });
    numero = origem;
  }

  const semPrincipal = !destino.whatsappNumberId;
  if (semPrincipal) {
    await db.update(filiais).set({
      wabaId: numero.wabaId,
      whatsappNumberId: numero.whatsappNumberId,
      whatsappToken: numero.whatsappToken,
      whatsappTokenExpiraEm: numero.whatsappTokenExpiraEm,
      whatsappConectadoEm: new Date(),
    }).where(eq(filiais.id, destinoFilialId));
  } else {
    await db.insert(filialWhatsappExtra).values({
      filialId: destinoFilialId,
      rotulo: numero.rotulo || null,
      wabaId: numero.wabaId,
      whatsappNumberId: numero.whatsappNumberId,
      whatsappToken: numero.whatsappToken,
      whatsappTokenExpiraEm: numero.whatsappTokenExpiraEm,
      whatsappConectadoEm: new Date(),
    });
  }

  if (origemExtraId) {
    await db.delete(filialWhatsappExtra).where(eq(filialWhatsappExtra.id, origemExtraId));
  } else {
    await db.update(filiais).set({
      wabaId: null,
      whatsappNumberId: null,
      whatsappToken: null,
      whatsappTokenExpiraEm: null,
      whatsappConectadoEm: null,
    }).where(eq(filiais.id, origemFilialId));
  }

  res.json({ ok: true, entrouComo: semPrincipal ? 'principal' : 'extra' });
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
