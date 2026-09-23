// Numa requisição com responseType 'blob', o corpo de erro também chega como
// Blob: err.response.data.erro sai undefined e a mensagem que o backend
// escreveu se perde, sobrando um aviso genérico que não diz o que houve.
export async function motivoDoErroBlob(err, padrao) {
  try {
    const texto = await err?.response?.data?.text?.();
    const erro = texto && JSON.parse(texto)?.erro;
    if (erro) return erro;
  } catch { /* corpo não era JSON — fica o texto padrão */ }
  return padrao;
}
