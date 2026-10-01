// Reconhece mensagens que só agradecem ou confirmam — "obrigado", "ok",
// "valeu, boa noite", "👍" — para não gastar uma chamada inteira de IA com
// elas. Cada uma custava o mesmo que uma pergunta de verdade: prompt completo,
// contexto do SGP e histórico.
//
// Errar para o lado de chamar a IA é barato; errar para o outro lado deixa o
// cliente sem resposta. Por isso a mensagem só é reconhecida quando TODAS as
// palavras estão nas listas abaixo, e qualquer pergunta, negação ou palavra
// fora delas devolve null.

const AGRADECIMENTO = new Set([
  'obrigado', 'obrigada', 'obrigadao', 'obg', 'obgd', 'obgda', 'brigado', 'brigada',
  'brigadao', 'valeu', 'vlw', 'agradeco', 'agradecido', 'agradecida', 'grato', 'grata',
]);

// Confirmação neutra. Fora daqui de propósito: "sim", "pode", "quero" e "isso"
// são respostas a perguntas, e "bom"/"boa" abrem conversa ("bom dia").
const CONFIRMACAO = new Set([
  'ok', 'okay', 'oks', 'okk', 'blz', 'beleza', 'certo', 'certinho', 'entendi',
  'entendido', 'combinado', 'show', 'otimo', 'perfeito', 'joia', 'top', 'tranquilo', 'ta',
]);

// Só acompanham as palavras acima; sozinhas não reconhecem nada.
const ACOMPANHAMENTO = new Set([
  'muito', 'muitissimo', 'mto', 'mt', 'demais', 'de', 'novo', 'nao', 'so', 'isso', 'era',
  'nada', 'mais', 'tudo', 'viu', 'ai', 'entao', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'deus', 'abencoe', 'amem', 'tchau', 'ate', 'logo', 'abraco', 'abracos', 'beijo', 'bjs',
  'ah', 'aham', 'uhum', 'e', 'pela', 'pelo', 'ajuda', 'atencao', 'atendimento', 'voce', 'vc',
]);

const EMOJIS_POSITIVOS = new Set([
  '👍', '👌', '🙏', '🤝', '👏', '🙌', '✅', '✔', '😊', '😀', '😁', '😃', '😄', '🙂',
  '☺', '😉', '🥰', '😍', '😘', '🤗', '🫶', '❤', '💙', '💚', '💜', '🧡', '💛',
]);

const MAX_PALAVRAS = 8;

// 'agradecimento'         — "obrigado", "não, obrigado", "valeu, boa noite"
// 'agradecimento_com_ok'  — "ok, obrigado": agradece, mas também pode estar
//                           aceitando algo que o bot ofereceu
// 'confirmacao'           — "ok", "entendi", "👍"
// null                    — qualquer outra coisa: vai para a IA
export function classificarMensagemCurta(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto || bruto.includes('?')) return null;

  const emojis = bruto.match(/\p{Extended_Pictographic}/gu) || [];
  if (emojis.some(e => !EMOJIS_POSITIVOS.has(e))) return null;

  const palavras = bruto
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍]/gu, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,!;:\-…]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // "obrigadoooo", "okkkk", "vlwww" — letra esticada não muda o sentido.
    .map(p => p.replace(/(.)\1{2,}/g, '$1'));

  if (!palavras.length) return emojis.length ? 'confirmacao' : null;
  if (palavras.length > MAX_PALAVRAS) return null;

  const conhecida = p => AGRADECIMENTO.has(p) || CONFIRMACAO.has(p) || ACOMPANHAMENTO.has(p);
  if (!palavras.every(conhecida)) return null;

  const agradece = palavras.some(p => AGRADECIMENTO.has(p));
  const confirma = palavras.some(p => CONFIRMACAO.has(p));

  if (agradece) return confirma ? 'agradecimento_com_ok' : 'agradecimento';
  // Sem agradecer, "não" muda tudo: "não entendi" é o oposto de confirmar.
  if (palavras.includes('nao')) return null;
  return confirma ? 'confirmacao' : null;
}

export const RESPOSTA_AGRADECIMENTO = 'Por nada! 😊 Qualquer coisa, é só chamar.';

// Decide se a mensagem dispensa a IA, olhando também o que o atendimento disse
// por último. Devolve { responder: texto | null } quando dispensa, ou null
// quando a IA precisa ver a mensagem.
export function dispensaIa(texto, ultimaDoAtendimento) {
  // Sem nada dito antes nesta conversa, um "👍" ou "ok" é abertura — a IA
  // cumprimenta e se apresenta.
  if (!ultimaDoAtendimento) return null;

  const tipo = classificarMensagemCurta(texto);
  if (!tipo) return null;

  // Se a última fala foi pergunta, "ok" pode ser um "sim" a "quer que eu
  // desbloqueie?". Só o agradecimento puro ("obrigado", "não, obrigado") é
  // seguro aqui — é a resposta típica a "posso ajudar em algo mais?".
  const perguntou = ultimaDoAtendimento.includes('?');
  if (perguntou && tipo !== 'agradecimento') return null;

  if (tipo === 'confirmacao') return { responder: null };

  // Não agradece de volta duas vezes seguidas.
  if (ultimaDoAtendimento === RESPOSTA_AGRADECIMENTO) return { responder: null };
  return { responder: RESPOSTA_AGRADECIMENTO };
}
