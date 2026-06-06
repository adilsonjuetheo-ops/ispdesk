export function dentroDoHorario(horarios) {
  if (!horarios?.dias) return true;
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const diasKeys = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const diaKey = diasKeys[agora.getDay()];
  const cfg = horarios.dias[diaKey];
  if (!cfg?.ativo) return false;

  const [hI, mI] = cfg.inicio.split(':').map(Number);
  const [hF, mF] = cfg.fim.split(':').map(Number);
  const minAtual = agora.getHours() * 60 + agora.getMinutes();
  return minAtual >= hI * 60 + mI && minAtual < hF * 60 + mF;
}
