// A Meta devolve código e um título em inglês — "Re-engagement message",
// "Business eligibility payment issue". Isso não diz nada para quem atende, e
// pior: não diz o que fazer. A atendente da UaiFibra mandou "Boa tarde!" duas
// vezes sem entender por que não chegava.
//
// Aqui cada código vira uma frase que termina numa ação.
const MOTIVOS = {
  131047: 'fora da janela de 24h. O cliente não escreve há mais de um dia — só dá para falar com ele por um modelo aprovado.',
  131026: 'o número não recebe mensagem no WhatsApp. Confirme o número com o cliente.',
  131042: 'a conta de WhatsApp do provedor está com pendência de pagamento na Meta. Nenhuma mensagem sai até resolver.',
  131031: 'a conta de WhatsApp do provedor foi suspensa pela Meta.',
  131049: 'a Meta limitou mensagens de marketing para este cliente hoje. Tente outro dia ou use outro tipo de modelo.',
  131051: 'tipo de mensagem não suportado.',
  132000: 'o modelo tem um número de variáveis diferente do que foi enviado.',
  132001: 'o modelo não existe ou não está aprovado para este idioma.',
  132005: 'o texto enviado não bate com o modelo aprovado.',
  132007: 'o modelo foi reprovado pela Meta.',
  132012: 'o formato de uma das variáveis do modelo está incorreto.',
  132015: 'o modelo está pausado pela Meta por baixa qualidade.',
  132016: 'o modelo foi desativado pela Meta por baixa qualidade.',
  133010: 'o número do provedor não está registrado na Meta.',
  368:    'a conta do provedor está temporariamente bloqueada por violação de política.',
};

// `titulo` é o texto cru da Meta; entra como reserva quando o código é novo ou
// desconhecido, para a mensagem nunca ficar vazia.
// Sem prefixo de "não entregue": o balão já mostra isso ao lado do horário, e
// repetir deixa a linha redundante.
export function motivoLegivel(codigo, titulo) {
  const conhecido = MOTIVOS[Number(codigo)];
  if (conhecido) return conhecido;

  const cru = String(titulo || '').trim();
  return cru
    ? `a Meta recusou (${codigo}): ${cru}`
    : `a Meta recusou (${codigo}).`;
}
