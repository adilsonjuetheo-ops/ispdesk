const MP_BASE = 'https://api.mercadopago.com';

import { getValorPlano as valorDoPlano, getLabelPlano } from '../config/planos.js';

export function getValorPlano(plano) {
  return valorDoPlano(plano);
}

export async function criarPIX(tenant) {
  const valor = getValorPlano(tenant.plano);

  // Expira às 23:59:59 do 3º dia (horário de Brasília -03:00)
  const expiracao = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  expiracao.setHours(23, 59, 59, 0);
  const expiracaoISO = expiracao.toISOString().replace('Z', '-03:00');

  const mesRef = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const label  = getLabelPlano(tenant.plano);

  const body = {
    transaction_amount: valor,
    description: `ISPDesk - Plano ${label} - ${mesRef}`,
    payment_method_id: 'pix',
    date_of_expiration: expiracaoISO,
    payer: {
      email: tenant.email || 'cobranca@ispdesk.com.br',
    },
  };

  // Sem isto o Mercado Pago nunca avisava que o PIX foi pago: a rota
  // /api/mp/webhook existia e ninguém a chamava. Na prática o pagamento só era
  // reconhecido se alguém abrisse o painel e clicasse em "Verificar pagamento"
  // — e enquanto ninguém clicava, o provedor pagava em dia e continuava
  // marcado como pendente.
  const baseApi = (process.env.API_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (baseApi) body.notification_url = `${baseApi}/api/mp/webhook`;
  else console.warn('[cobrança] API_PUBLIC_URL ausente — o Mercado Pago não terá para onde avisar o pagamento.');

  const res = await fetch(`${MP_BASE}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'X-Idempotency-Key': `ispdesk-${tenant.id}-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`MP API erro ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

export async function consultarPagamento(paymentId) {
  const res = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`MP consulta erro ${res.status}`);
  return res.json();
}
