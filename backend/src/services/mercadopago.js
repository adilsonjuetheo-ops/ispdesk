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
