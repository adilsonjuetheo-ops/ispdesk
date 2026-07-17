import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { autenticar, apenasSuper } from '../middleware/auth.js';
import { criarPIX, consultarPagamento, getValorPlano } from '../services/mercadopago.js';
import { enviarMensagem } from '../services/whatsapp.js';

const router = Router();

// SuperAdmin dispara a primeira (ou qualquer) cobrança PIX
router.post('/tenants/:id/gerar-cobranca', autenticar, apenasSuper, async (req, res) => {
  const { id } = req.params;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });

  try {
    const pagamento = await criarPIX(tenant);
    const pixData      = pagamento.point_of_interaction?.transaction_data;
    const pixCopiaECola = pixData?.qr_code;
    const ticketUrl    = pixData?.ticket_url;

    const pixExpira = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await db.update(tenants)
      .set({
        mpPaymentId: String(pagamento.id),
        statusPagamento: 'pendente',
        proximoVencimento: pixExpira,
      })
      .where(eq(tenants.id, id));

    // Envia WhatsApp ao admin do provedor
    if (tenant.whatsappContato && tenant.whatsappNumberId && tenant.whatsappToken) {
      const numero = tenant.whatsappContato.replace(/\D/g, '');
      const valor  = getValorPlano(tenant.plano).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      const label  = tenant.plano === 'pro' ? 'Pro' : tenant.plano === 'enterprise' ? 'Enterprise' : 'Basic';
      const vencStr = pixExpira.toLocaleDateString('pt-BR');

      const msg =
        `💳 *ISPDesk — Fatura disponível*\n\n` +
        `Olá, ${tenant.nomeFantasia || tenant.nome}!\n\n` +
        `Sua mensalidade do *Plano ${label}* está disponível.\n` +
        `💰 Valor: *R$ ${valor}*\n` +
        `📅 Vencimento: *${vencStr}*\n\n` +
        `*PIX Copia e Cola:*\n${pixCopiaECola}\n\n` +
        `Ou acesse o link para pagar:\n${ticketUrl}\n\n` +
        `Após o pagamento seu sistema é ativado automaticamente. ✅`;

      enviarMensagem(tenant, numero, msg).catch(e =>
        console.error('[cobrança] Erro ao enviar WhatsApp:', e.message)
      );
    }

    res.json({ ok: true, paymentId: pagamento.id, pixCopiaECola, ticketUrl });
  } catch (err) {
    console.error('[cobrança] Erro ao gerar PIX:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// SuperAdmin verifica manualmente se um pagamento pendente foi aprovado no MP
router.post('/tenants/:id/verificar-pagamento', autenticar, apenasSuper, async (req, res) => {
  const { id } = req.params;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) return res.status(404).json({ erro: 'Provedor não encontrado' });
  if (!tenant.mpPaymentId) return res.status(400).json({ erro: 'Nenhum pagamento registrado para este provedor' });

  try {
    const pag = await consultarPagamento(tenant.mpPaymentId);
    if (pag.status === 'approved') {
      const proxVencimento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.update(tenants)
        .set({ statusPagamento: 'ativo', proximoVencimento: proxVencimento })
        .where(eq(tenants.id, id));
      return res.json({ ok: true, pago: true, proximoVencimento: proxVencimento });
    }
    res.json({ ok: true, pago: false, statusMP: pag.status });
  } catch (err) {
    console.error('[verificar-pagamento]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// Webhook do Mercado Pago — confirma pagamentos
router.post('/mp/webhook', async (req, res) => {
  res.sendStatus(200); // responde antes de processar para não timeout

  try {
    const { action, data } = req.body;
    if (action !== 'payment.updated' || !data?.id) return;

    const pagamento = await consultarPagamento(data.id);
    if (pagamento.status !== 'approved') return;

    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.mpPaymentId, String(data.id)))
      .limit(1);
    if (!tenant) return;

    const proxVencimento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.update(tenants)
      .set({ statusPagamento: 'ativo', proximoVencimento: proxVencimento })
      .where(eq(tenants.id, tenant.id));

    console.log(`[cobrança] ✅ Pago: ${tenant.nome} — próximo: ${proxVencimento.toLocaleDateString('pt-BR')}`);

    // Confirmação WhatsApp
    if (tenant.whatsappContato && tenant.whatsappNumberId && tenant.whatsappToken) {
      const numero = tenant.whatsappContato.replace(/\D/g, '');
      const proxStr = proxVencimento.toLocaleDateString('pt-BR');
      const msg =
        `✅ *Pagamento confirmado — ISPDesk*\n\n` +
        `Obrigado! Seu plano está ativo até *${proxStr}*.\n` +
        `O bot de atendimento continuará funcionando normalmente. 🤖`;
      enviarMensagem(tenant, numero, msg).catch(() => {});
    }
  } catch (err) {
    console.error('[cobrança webhook] Erro:', err.message);
  }
});

export default router;
