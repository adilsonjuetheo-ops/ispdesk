// Quebra a resposta do bot em mensagens separadas quando ela carrega código de
// pagamento.
//
// No celular, copiar é segurar o balão e tocar em "Copiar" — e isso copia a
// mensagem inteira. Com o PIX no meio de um parágrafo, o cliente cola no app do
// banco um texto com saudação, label e pergunta no meio, e o banco recusa.
// Selecionar só o trecho num código de 200 caracteres é justamente o que não dá
// para fazer com o dedo.
//
// Com o código sozinho num balão, segurar e copiar entrega exatamente o código.

// O BRCode do PIX é um token sem espaço que começa em "000201" e termina no
// campo 63 (CRC16): "6304" mais quatro dígitos hexadecimais. O \S* é guloso de
// propósito — o CRC é sempre o último campo, e parar no primeiro "6304" que
// aparecesse entregaria um código truncado, que o banco aceita colar e depois
// recusa. Ser guloso também deixa de fora o ponto final que o modelo às vezes
// gruda no fim.
const PIX_BRCODE = /000201\S*6304[0-9A-Fa-f]{4}/g;

// Linha digitável do boleto: 5.5 5.6 5.6 1 14.
const LINHA_DIGITAVEL = /\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}/g;

// Acima disso a divisão deixou de ajudar e virou enxurrada de notificação no
// celular do cliente. Nesse caso vale mais mandar inteiro, como era antes.
const MAX_BLOCOS = 8;

// O modelo fecha o negrito com dois asteriscos ("*Boleto:**"), o que no WhatsApp
// vira "Boleto:" em negrito com um asterisco solto atrás. Só roda no texto entre
// os códigos: o próprio BRCode tem "**" dentro (campo 62), e mexer nele
// quebraria o pagamento.
function limparNegrito(texto) {
  return texto.replace(/:\*\*(?!\*)/g, ':*');
}

export function dividirEmBlocos(texto) {
  if (!texto) return [];

  const achados = [];
  for (const padrao of [PIX_BRCODE, LINHA_DIGITAVEL]) {
    // lastIndex zera a cada uso: o /g guarda estado entre chamadas e, sem isso,
    // a segunda mensagem do dia começaria a busca no meio do texto.
    padrao.lastIndex = 0;
    for (const m of texto.matchAll(padrao)) {
      achados.push({ inicio: m.index, fim: m.index + m[0].length, codigo: m[0] });
    }
  }
  if (!achados.length) return [texto];

  achados.sort((a, b) => a.inicio - b.inicio);

  const blocos = [];
  let cursor = 0;
  for (const { inicio, fim, codigo } of achados) {
    // Um código dentro de outro (a linha digitável não vive dentro do BRCode,
    // mas garantir é barato) não pode cortar o anterior ao meio.
    if (inicio < cursor) continue;
    const antes = limparNegrito(texto.slice(cursor, inicio)).trim();
    if (antes) blocos.push(antes);
    blocos.push(codigo);
    cursor = fim;
  }
  const sobra = limparNegrito(texto.slice(cursor)).trim();
  if (sobra) blocos.push(sobra);

  if (!blocos.length || blocos.length > MAX_BLOCOS) return [texto];
  return blocos;
}
