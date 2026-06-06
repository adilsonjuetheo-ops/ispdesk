export async function enviarMensagem(tenant, para, texto) {
  const url = `https://graph.facebook.com/v19.0/${tenant.whatsappNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenant.whatsappToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'text',
      text: { body: texto },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API erro ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}
