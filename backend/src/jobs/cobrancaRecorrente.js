import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq, and, lte, isNotNull } from 'drizzle-orm';
import { criarPIX, consultarPagamento, getValorPlano } from '../services/mercadopago.js';
import { getLabelPlano } from '../config/planos.js';
import { enviarMensagem } from '../services/whatsapp.js';

async function processarCobrancas() {
  const agora = new Date();

  // 1. Tenants ATIVOS com vencimento chegando → gera novo PIX
  const paraRenovar = await db.select().from(tenants)
    .where(and(
      eq(tenants.statusPagamento, 'ativo'),
      eq(tenants.ativo, true),
      isNotNull(tenants.proximoVencimento),
      lte(tenants.proximoVencimento, agora),
    ));

  for (const tenant of paraRenovar) {
    try {
      const pagamento = await criarPIX(tenant);
      const pixData       = pagamento.point_of_interaction?.transaction_data;
      const pixCopiaECola = pixData?.qr_code;
      const ticketUrl     = pixData?.ticket_url;
      const pixExpira     = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      await db.update(tenants)
        .set({ mpPaymentId: String(pagamento.id), statusPagamento: 'pendente', proximoVencimento: pixExpira })
        .where(eq(tenants.id, tenant.id));

      if (tenant.whatsappContato && tenant.whatsappNumberId && tenant.whatsappToken) {
        const numero = tenant.whatsappContato.replace(/\D/g, '');
        const valor  = getValorPlano(tenant.plano).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        const label  = getLabelPlano(tenant.plano);
        const vencStr = pixExpira.toLocaleDateString('pt-BR');

        const msg =
          `💳 *ISPDesk — Nova fatura disponível*\n\n` +
          `Olá, ${tenant.nomeFantasia || tenant.nome}!\n\n` +
          `Sua mensalidade do *Plano ${label}* está disponível.\n` +
          `💰 Valor: *R$ ${valor}*\n` +
          `📅 Vencimento: *${vencStr}*\n\n` +
          `*PIX Copia e Cola:*\n${pixCopiaECola}\n\n` +
          `Ou acesse o link:\n${ticketUrl}`;

        enviarMensagem(tenant, numero, msg).catch(() => {});
      }

      console.log(`[cobrança] Nova fatura gerada: ${tenant.nome}`);
    } catch (err) {
      console.error(`[cobrança] Erro ao renovar ${tenant.nome}:`, err.message);
    }
  }

  // 2. Tenants PENDENTES com PIX expirado → verifica MP e suspende se não pago
  const pendentesExpirados = await db.select().from(tenants)
    .where(and(
      eq(tenants.statusPagamento, 'pendente'),
      isNotNull(tenants.proximoVencimento),
      lte(tenants.proximoVencimento, agora),
    ));

  for (const tenant of pendentesExpirados) {
    try {
      // Consulta o status real no MP antes de suspender
      if (tenant.mpPaymentId) {
        const pag = await consultarPagamento(tenant.mpPaymentId);
        if (pag.status === 'approved') {
          // Pago mas webhook não chegou — ativa manualmente
          const prox = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await db.update(tenants)
            .set({ statusPagamento: 'ativo', proximoVencimento: prox })
            .where(eq(tenants.id, tenant.id));
          console.log(`[cobrança] Ativado via fallback: ${tenant.nome}`);
          continue;
        }
      }

      // Suspende
      await db.update(tenants)
        .set({ statusPagamento: 'suspenso' })
        .where(eq(tenants.id, tenant.id));

      console.log(`[cobrança] Suspenso por inadimplência: ${tenant.nome}`);

      if (tenant.whatsappContato && tenant.whatsappNumberId && tenant.whatsappToken) {
        const numero = tenant.whatsappContato.replace(/\D/g, '');
        const msg =
          `⛔ *ISPDesk — Conta suspensa*\n\n` +
          `Olá, ${tenant.nomeFantasia || tenant.nome}!\n\n` +
          `Seu pagamento não foi identificado e o bot de atendimento foi *suspenso*.\n\n` +
          `Para reativar, entre em contato com o suporte ISPDesk e regularize sua situação.\n\n` +
          `Seus dados estão preservados. 🔒`;
        enviarMensagem(tenant, numero, msg).catch(() => {});
      }
    } catch (err) {
      console.error(`[cobrança] Erro ao processar expirado ${tenant.nome}:`, err.message);
    }
  }
}

export function agendarCobrancaRecorrente() {
  // Roda imediatamente ao iniciar e depois uma vez por dia
  processarCobrancas().catch(err => console.error('[cobrança] Erro inicial:', err.message));
  setInterval(() => {
    processarCobrancas().catch(err => console.error('[cobrança] Erro no cron:', err.message));
  }, 24 * 60 * 60 * 1000);

  console.log('[cobrança] Cron de recorrência agendado (24h)');
}
