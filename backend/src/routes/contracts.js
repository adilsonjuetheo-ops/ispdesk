import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, clientes, tenants, mensagens } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';
import { enviarContrato } from '../services/assinatura.js';
import { enviarMensagem } from '../services/whatsapp.js';

const router = Router();

// Envia contrato para assinatura digital
router.post('/:conversaId/send', autenticar, apenasAdmin, async (req, res) => {
  const { conversaId } = req.params;
  const dados = req.body;

  if (!['pro', 'enterprise'].includes(req.user.plano)) {
    return res.status(403).json({ erro: 'O módulo de assinatura digital está disponível apenas nos planos Pro e Enterprise.' });
  }

  if (!dados.nome_contratante || !dados.cpf_cnpj || !dados.identificacao_oferta || !dados.mensalidade) {
    return res.status(400).json({ erro: 'Campos obrigatórios: nome_contratante, cpf_cnpj, identificacao_oferta, mensalidade' });
  }

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, conversaId)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (conversa.tenantId !== req.user.tenantId) return res.status(403).json({ erro: 'Acesso negado' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

  if (!tenant.assinaturaTipo) {
    return res.status(400).json({ erro: 'Plataforma de assinatura não configurada. Acesse Configurações → Assinatura Digital.' });
  }

  try {
    const resultado = await enviarContrato(tenant, cliente.whatsapp, dados);

    await db.update(conversas).set({
      contratoUuid: resultado.uuid,
      contratoStatus: 'pendente',
      contratoEnviadoEm: new Date(),
    }).where(eq(conversas.id, conversaId));

    // Registra no histórico da conversa
    await db.insert(mensagens).values({
      conversaId,
      origem: 'bot',
      conteudo: `[Sistema] Contrato enviado para assinatura digital (${tenant.assinaturaTipo}).`,
    });

    // Avisa o cliente via WhatsApp
    const msg = resultado.linkAssinatura
      ? `Olá, ${dados.nome_contratante}! Seu contrato de internet está pronto para assinatura. Acesse o link: ${resultado.linkAssinatura}`
      : `Olá, ${dados.nome_contratante}! Seu contrato foi enviado para assinatura. Verifique seu e-mail ou WhatsApp para assinar.`;

    await enviarMensagem(tenant, cliente.whatsapp, msg).catch(err =>
      console.error('[Contrato] Erro ao avisar cliente:', err.message)
    );

    res.json({ uuid: resultado.uuid, linkAssinatura: resultado.linkAssinatura });
  } catch (err) {
    console.error('[Contrato] Erro ao enviar:', err.message);
    res.status(502).json({ erro: err.message });
  }
});

// Webhook ZapSign — chamado quando documento é assinado
router.post('/webhook/zapsign', async (req, res) => {
  res.sendStatus(200); // responde rápido

  const payload = req.body;
  const docToken = payload?.document?.token;
  const status   = payload?.document?.status;

  if (!docToken) return;

  try {
    const [conversa] = await db.select().from(conversas)
      .where(eq(conversas.contratoUuid, docToken)).limit(1);
    if (!conversa) return;

    if (status === 'signed' || payload?.event_action === 'all_signed') {
      await db.update(conversas)
        .set({ contratoStatus: 'assinado' })
        .where(eq(conversas.id, conversa.id));

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
      const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: '[Sistema] Contrato assinado digitalmente com sucesso!',
      });

      if (tenant?.whatsappToken && cliente?.whatsapp) {
        await enviarMensagem(
          tenant, cliente.whatsapp,
          'Seu contrato foi assinado com sucesso! Bem-vindo(a) à nossa rede. Em breve entraremos em contato para agendar a instalação.'
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Webhook ZapSign]', err.message);
  }
});

// Webhook D4Sign — chamado quando documento é assinado
router.post('/webhook/d4sign', async (req, res) => {
  res.sendStatus(200);

  const payload = req.body;
  const docUuid = payload?.uuid;
  const type    = payload?.type_post; // '1' = assinado

  if (!docUuid) return;

  try {
    const [conversa] = await db.select().from(conversas)
      .where(eq(conversas.contratoUuid, docUuid)).limit(1);
    if (!conversa) return;

    if (type === '1' || payload?.type === '1') {
      await db.update(conversas)
        .set({ contratoStatus: 'assinado' })
        .where(eq(conversas.id, conversa.id));

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
      const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: '[Sistema] Contrato assinado digitalmente com sucesso!',
      });

      if (tenant?.whatsappToken && cliente?.whatsapp) {
        await enviarMensagem(
          tenant, cliente.whatsapp,
          'Seu contrato foi assinado com sucesso! Bem-vindo(a) à nossa rede. Em breve entraremos em contato para agendar a instalação.'
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Webhook D4Sign]', err.message);
  }
});

export default router;
