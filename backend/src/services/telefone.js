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

// Chave para comparar dois números que podem estar escritos de formas
// diferentes. O que isto resolve de verdade é o nono dígito: o mesmo celular
// chega da Meta como 553398777553 (12 dígitos) ou 5533998777553 (13),
// dependendo de quando o contato foi salvo no aparelho. Comparar texto com
// texto deixaria metade dos casos passar.
//
// A chave é DDD + os 8 últimos dígitos, que é a parte que nunca muda.
export function chaveTelefone(entrada) {
  let d = String(entrada || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  // Só tira o 55 quando ainda sobra DDD + linha. Sem esse tamanho mínimo, um
  // celular do DDD 55 (Santa Maria) perderia o próprio DDD.
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  // Fora do padrão brasileiro (DDD + 8 ou 9 dígitos) não há nono dígito para
  // resolver: compara o que veio.
  if (d.length !== 10 && d.length !== 11) return d || null;
  return d.slice(0, 2) + d.slice(-8);
}

// As duas grafias do mesmo celular brasileiro: com e sem o nono dígito. O SGP
// costuma ter 5533998777553, e a Meta pode entregar a resposta do cliente como
// 553398777553. Gravar o lembrete numa grafia e receber na outra criava dois
// contatos — e a resposta "ok" caía numa conversa sem o lembrete.
export function variantesTelefoneBR(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (!d.startsWith('55')) return d ? [d] : [];
  if (d.length === 13 && d[4] === '9') return [d, d.slice(0, 4) + d.slice(5)];
  if (d.length === 12 && /[6-9]/.test(d[4])) return [d, `${d.slice(0, 4)}9${d.slice(4)}`];
  return [d];
}

// Números particulares do provedor. O campo é texto livre, um por linha, do
// jeito que o dono digitou — a normalização acontece só na comparação. Assim a
// tela devolve o número legível, qualquer máscara funciona e ele pode anotar de
// quem é ("Mãe — (33) 99877-7553"): o que não é dígito é descartado.
//
// Linha sem número nenhum vira null e é jogada fora aqui. Isso importa: uma
// linha em branco que escapasse viraria chave vazia e bloquearia todo mundo.
export function chavesParticulares(texto) {
  return String(texto || '')
    .split(/[\n,;]+/)
    .map(chaveTelefone)
    .filter(Boolean);
}

export function numeroParticular(texto, numero) {
  if (!texto) return false;
  const alvo = chaveTelefone(numero);
  if (!alvo) return false;
  return chavesParticulares(texto).includes(alvo);
}
