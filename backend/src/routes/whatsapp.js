import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, filiais, filialWhatsappExtra } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';
import { listarTemplates, editarTemplate, componentesComBotaoPagamento, corpoSemVariavelPagamento } from '../services/metaTemplates.js';

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

  try {
    // Limpa a origem ANTES de escrever no destino: whatsappNumberId tem
    // índice único em ambas as tabelas, então gravar o mesmo número em duas
    // linhas ao mesmo tempo (mesmo que só entre esses dois passos) quebra a
    // constraint e a rota falhava com 500 sem mover nada.
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
  } catch (err) {
    console.error('[whatsapp/mover-numero]', err.message);
    return res.status(500).json({ erro: 'Erro ao mover número. Se a origem já foi desconectada mas o destino não recebeu, reconecte manualmente.' });
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


// ---------------------------------------------------------------------------
// Templates aprovados
//
// Editar um template aprovado é permitido pela Meta (até 10 vezes por mês, uma
// a cada 24h) e não muda o nome dele — por isso dá pra converter o lembrete de
// fatura pro formato com botão de pagamento sem mexer no código que envia. A
// edição volta pra análise, e só passa a valer quando for aprovada.
// ---------------------------------------------------------------------------

function baseDaPaginaPagamento() {
  return String(process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
}

// Um template está no formato novo quando tem botão de URL apontando pra nossa
// página. Olhar o componente, e não um campo nosso, evita o caso em que alguém
// edita o template por fora, pelo WhatsApp Manager, e o painel passa a mentir.
function temBotaoPagamento(template, base) {
  const botoes = (template.components || []).find(c => c.type === 'BUTTONS')?.buttons || [];
  return botoes.some(b => b.type === 'URL' && String(b.url || '').startsWith(`${base}/p/`));
}

async function tenantDaRequisicao(req) {
  const tenantId = req.user.tenantId;
  if (!tenantId) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant || null;
}

router.get('/templates', autenticar, apenasAdmin, async (req, res) => {
  const tenant = await tenantDaRequisicao(req);
  if (!tenant) return res.status(403).json({ erro: 'Sem tenant' });

  const base = baseDaPaginaPagamento();
  try {
    const lista = await listarTemplates(tenant);
    res.json({
      baseUrl: base || null,
      botaoAtivo: !!tenant.lembreteFaturaBotaoUrl,
      templatesLembrete: {
        pre: tenant.lembreteFaturaTemplatePre || null,
        pos: tenant.lembreteFaturaTemplatePos || null,
      },
      templates: lista.map(t => {
        const corpo = (t.components || []).find(c => c.type === 'BODY')?.text || '';
        return {
          id: t.id,
          nome: t.name,
          status: t.status,
          categoria: t.category,
          idioma: t.language,
          motivoRecusa: t.rejected_reason || null,
          corpo,
          // O painel precisa mostrar o que mudaria antes de mandar pra análise:
          // enquanto a Meta não responde, não dá pra voltar atrás.
          corpoSugerido: corpoSemVariavelPagamento(corpo),
          temVariavelPagamento: corpo.includes('{{5}}'),
          jaTemBotao: base ? temBotaoPagamento(t, base) : false,
        };
      }),
    });
  } catch (err) {
    console.error('[templates] Falha ao listar:', err.message);
    res.status(502).json({ erro: err.message });
  }
});

router.post('/templates/:id/botao-pagamento', autenticar, apenasAdmin, async (req, res) => {
  const tenant = await tenantDaRequisicao(req);
  if (!tenant) return res.status(403).json({ erro: 'Sem tenant' });

  const base = baseDaPaginaPagamento();
  if (!base) {
    return res.status(500).json({ erro: 'API_PUBLIC_URL não está configurada no servidor — sem ela não dá pra montar a URL do botão.' });
  }

  const corpo = String(req.body?.corpo || '').trim();
  const textoBotao = String(req.body?.textoBotao || 'Pagar agora').trim();
  if (!corpo) return res.status(400).json({ erro: 'Corpo do template vazio.' });
  if (corpo.includes('{{5}}')) {
    return res.status(400).json({ erro: 'O corpo ainda tem {{5}}. No formato com botão o corpo vai até {{4}} — o código de pagamento sai do texto.' });
  }
  // A Meta recusa numeração com buraco, e o erro dela não diz qual variável
  // faltou. Melhor barrar aqui, onde dá pra nomear.
  for (let i = 1; i <= 4; i++) {
    if (!corpo.includes(`{{${i}}}`)) {
      return res.status(400).json({ erro: `O corpo precisa usar {{${i}}} — a Meta exige as variáveis em sequência, de {{1}} a {{4}}.` });
    }
  }
  if (textoBotao.length > 25) {
    return res.status(400).json({ erro: 'O texto do botão passa de 25 caracteres, que é o limite da Meta.' });
  }

  try {
    const lista = await listarTemplates(tenant);
    const alvo = lista.find(t => String(t.id) === String(req.params.id));
    if (!alvo) return res.status(404).json({ erro: 'Template não encontrado nessa conta do WhatsApp.' });

    // A edição substitui os componentes inteiros, e o envio aponta pro botão de
    // índice 0. Com botão pré-existente seria preciso escolher entre apagar o
    // que o provedor criou ou mandar o parâmetro no índice errado — nenhum dos
    // dois em silêncio.
    const botoesAtuais = (alvo.components || []).find(c => c.type === 'BUTTONS')?.buttons || [];
    if (botoesAtuais.length) {
      return res.status(409).json({
        erro: `O template "${alvo.name}" já tem ${botoesAtuais.length} botão(ões). Remova pelo WhatsApp Manager antes, ou adicione o botão de pagamento por lá.`,
      });
    }

    const componentes = componentesComBotaoPagamento(alvo.components, { corpo, baseUrl: base, textoBotao });
    await editarTemplate(tenant, alvo.id, componentes);

    res.json({
      ok: true,
      nome: alvo.name,
      // Aprovar é da Meta e leva de minutos a algumas horas. Até lá o provedor
      // segue no formato antigo — por isso a chave não vira aqui.
      aviso: 'Edição enviada para análise da Meta. Quando for aprovada, volte aqui e ligue o botão de pagamento.',
    });
  } catch (err) {
    console.error('[templates] Falha ao editar:', err.message);
    res.status(502).json({ erro: err.message });
  }
});

// Vira a chave do formato novo — e só depois de conferir na Meta que os dois
// templates de lembrete estão aprovados e com o botão. Ligar antes faria todo
// envio falhar com "number of parameters does not match", de madrugada, sem
// ninguém olhando.
router.post('/templates/ativar-botao', autenticar, apenasAdmin, async (req, res) => {
  const tenant = await tenantDaRequisicao(req);
  if (!tenant) return res.status(403).json({ erro: 'Sem tenant' });

  const ligar = req.body?.ligar !== false;
  if (!ligar) {
    await db.update(tenants).set({ lembreteFaturaBotaoUrl: false }).where(eq(tenants.id, tenant.id));
    return res.json({ ok: true, botaoAtivo: false });
  }

  const base = baseDaPaginaPagamento();
  if (!base) return res.status(500).json({ erro: 'API_PUBLIC_URL não está configurada no servidor.' });

  const nomes = [tenant.lembreteFaturaTemplatePre, tenant.lembreteFaturaTemplatePos].filter(Boolean);
  if (!nomes.length) return res.status(400).json({ erro: 'Nenhum template de lembrete configurado.' });

  try {
    const lista = await listarTemplates(tenant);
    const pendencias = [];

    for (const nome of nomes) {
      const t = lista.find(x => x.name === nome);
      if (!t) { pendencias.push(`${nome}: não existe nessa conta.`); continue; }
      if (t.status !== 'APPROVED') { pendencias.push(`${nome}: está como ${t.status}, ainda não aprovado.`); continue; }
      if (!temBotaoPagamento(t, base)) { pendencias.push(`${nome}: aprovado, mas sem o botão apontando pra ${base}/p/.`); continue; }
      const corpo = (t.components || []).find(c => c.type === 'BODY')?.text || '';
      if (corpo.includes('{{5}}')) pendencias.push(`${nome}: o corpo ainda tem {{5}}.`);
    }

    if (pendencias.length) return res.status(409).json({ erro: 'Ainda não dá pra ligar o botão.', pendencias });

    await db.update(tenants).set({ lembreteFaturaBotaoUrl: true }).where(eq(tenants.id, tenant.id));
    res.json({ ok: true, botaoAtivo: true });
  } catch (err) {
    console.error('[templates] Falha ao ativar botão:', err.message);
    res.status(502).json({ erro: err.message });
  }
});

export default router;
