export async function transcreverAudioMeta(tenant, mediaId) {
  // 1. Obtém a URL de download da Meta
  const infoRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${tenant.whatsappToken}` },
  });
  if (!infoRes.ok) throw new Error(`Meta media info ${infoRes.status}`);
  const { url, mime_type } = await infoRes.json();

  // 2. Baixa o arquivo de áudio
  const audioRes = await fetch(url, {
    headers: { Authorization: `Bearer ${tenant.whatsappToken}` },
  });
  if (!audioRes.ok) throw new Error(`Meta media download ${audioRes.status}`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());

  // 3. Transcreve com OpenAI Whisper
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime_type || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!whisperRes.ok) {
    const err = await whisperRes.json().catch(() => ({}));
    throw new Error(`Whisper ${whisperRes.status}: ${JSON.stringify(err)}`);
  }
  const { text } = await whisperRes.json();
  return text?.trim() || null;
}

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
