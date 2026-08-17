// Normaliza o que o atendente digitou para o formato que a Meta usa:
// 55 + DDD + número, só dígitos. Aceita máscara, +55 e 00 na frente.
export function normalizarTelefoneBR(entrada) {
  let d = String(entrada || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith('55')) d = `55${d}`;
  // 55 + DDD(2) + 8 ou 9 dígitos
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

// Volta para leitura humana: 553399796002 -> (33) 99979-6002
export function formatarTelefoneBR(numero) {
  const d = String(numero || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero;
}
