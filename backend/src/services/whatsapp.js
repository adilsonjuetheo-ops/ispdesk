export async function uploadMidia(tenant, buffer, mimeType, filename) {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);
  formData.append('type', mimeType);
  formData.append('messaging_product', 'whatsapp');

  const url = `https://graph.facebook.com/v19.0/${tenant.whatsappNumberId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenant.whatsappToken}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta upload erro ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

export async function enviarMidia(tenant, para, mediaId, tipo, nome) {
  const url = `https://graph.facebook.com/v19.0/${tenant.whatsappNumberId}/messages`;
  const mediaObj = tipo === 'image'
    ? { image: { id: mediaId } }
    : { document: { id: mediaId, filename: nome } };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenant.whatsappToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: tipo,
      ...mediaObj,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API erro ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

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
