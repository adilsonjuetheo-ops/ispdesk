const DIAS_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DIAS_NOME = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

function agoraBrasilia(data = new Date()) {
  return new Date(data.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

// Os horários configurados definem quando existe ATENDENTE HUMANO disponível.
// Fora deles o assistente continua atendendo, apenas ciente de que não há
// ninguém da equipe para assumir a conversa no momento.
//
// `data` existe para a tela de Resultados contar quantos atendimentos caíram
// fora do expediente; no atendimento ao vivo vale sempre o agora.
export function dentroDoHorario(horarios, data = new Date()) {
  if (!horarios?.dias) return true;
  const agora = agoraBrasilia(data);
  const cfg = horarios.dias[DIAS_KEYS[agora.getDay()]];
  if (!cfg?.ativo) return false;

  const [hI, mI] = cfg.inicio.split(':').map(Number);
  const [hF, mF] = cfg.fim.split(':').map(Number);
  const minAtual = agora.getHours() * 60 + agora.getMinutes();
  return minAtual >= hI * 60 + mI && minAtual < hF * 60 + mF;
}

// Texto pronto para o assistente dizer quando a equipe volta — ex.: "amanhã às
// 08:00". Retorna null se nenhum dia estiver ativo (não há previsão a informar).
export function proximoAtendimento(horarios) {
  if (!horarios?.dias) return null;
  const agora = agoraBrasilia();
  const minAtual = agora.getHours() * 60 + agora.getMinutes();

  for (let offset = 0; offset < 7; offset++) {
    const idx = (agora.getDay() + offset) % 7;
    const cfg = horarios.dias[DIAS_KEYS[idx]];
    if (!cfg?.ativo || !cfg.inicio) continue;

    const [h, m] = cfg.inicio.split(':').map(Number);
    // Hoje só serve se o expediente ainda não começou.
    if (offset === 0 && minAtual >= h * 60 + m) continue;

    const quando = offset === 0 ? 'hoje'
      : offset === 1 ? 'amanhã'
      : `na ${DIAS_NOME[idx]}`;
    return `${quando} às ${cfg.inicio}`;
  }
  return null;
}
