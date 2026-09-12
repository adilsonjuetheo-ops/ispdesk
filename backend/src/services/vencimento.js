const DIAS_CICLO = 30;
const MS_DIA = 24 * 60 * 60 * 1000;

// Novo vencimento de uma assinatura renovada.
//
// Antes era sempre `hoje + 30 dias`. Como a confirmação costuma chegar depois do
// pagamento — o provedor paga dia 9 e a renovação só acontece dia 11 —, a data
// escorregava dois dias a cada ciclo e o dia da cobrança ia andando no mês.
// Esticar a partir do vencimento anterior mantém o dia fixo.
//
// A ressalva: se esticar do vencimento antigo já cair no passado (provedor que
// ficou meses sem pagar), a renovação nasceria vencida. Nesse caso recomeça de
// hoje. Essa condição substitui qualquer janela de tolerância arbitrária — ela
// se define sozinha pelo que faz sentido.
export function proximoVencimento(vencimentoAtual, agora = new Date()) {
  const base = vencimentoAtual ? new Date(vencimentoAtual) : null;
  const deHoje = new Date(agora.getTime() + DIAS_CICLO * MS_DIA);

  if (!base || Number.isNaN(base.getTime())) return deHoje;

  const doVencimento = new Date(base.getTime() + DIAS_CICLO * MS_DIA);
  return doVencimento.getTime() > agora.getTime() ? doVencimento : deHoje;
}
