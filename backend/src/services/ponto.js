// Regras do registro de jornada do técnico.
//
// Fica fora da rota porque é a parte que erra em silêncio: sequência trocada
// ou desconto de intervalo errado viram hora a mais ou a menos no espelho, e
// ninguém percebe olhando a tela.

export const TIPOS = ['entrada', 'intervalo_inicio', 'intervalo_fim', 'saida'];

export const ROTULO = {
  entrada:          'Entrada',
  intervalo_inicio: 'Início do intervalo',
  intervalo_fim:    'Volta do intervalo',
  saida:            'Saída',
};

// Aplica as correções do escritório.
//
// Nada é editado no banco: a correção é uma linha nova apontando para a
// original. Aqui a original sai de cena e a correção entra no lugar — ou
// ninguém entra, quando a correção só anula (batida duplicada).
export function efetivos(registros) {
  const corrigidos = new Set(
    registros.filter(r => r.ajusteDeId).map(r => r.ajusteDeId),
  );
  return registros
    .filter(r => !corrigidos.has(r.id) && !r.anulado)
    .sort((a, b) => new Date(a.registradoEm) - new Date(b.registradoEm));
}

// O que o botão pode oferecer agora. Lista, porque depois de uma entrada o
// técnico pode tanto sair para o almoço quanto encerrar o dia.
//
// Devolve ['entrada'] também depois de uma saída: técnico volta à rua no mesmo
// dia com frequência, e travar em um par por dia obrigaria o escritório a
// lançar o segundo turno na mão.
export function proximosTipos(efetivosDoDia) {
  const ultimo = efetivosDoDia[efetivosDoDia.length - 1];
  if (!ultimo || ultimo.tipo === 'saida') return ['entrada'];
  if (ultimo.tipo === 'intervalo_inicio') return ['intervalo_fim'];
  return ['intervalo_inicio', 'saida'];
}

export function tipoPermitido(efetivosDoDia, tipo) {
  return proximosTipos(efetivosDoDia).includes(tipo);
}

// Minutos trabalhados no dia, já descontado o intervalo.
//
// Turno aberto (entrada sem saída) não entra na conta e é devolvido como
// `emAndamento`: somar até "agora" faria o total crescer sozinho enquanto a
// tela estivesse aberta, e o espelho de ontem mudaria de valor a cada consulta.
export function resumoDoDia(efetivosDoDia) {
  let entradaEm = null;
  let intervaloEm = null;
  let trabalhados = 0;
  let intervalo = 0;

  for (const r of efetivosDoDia) {
    const t = new Date(r.registradoEm).getTime();
    if (r.tipo === 'entrada') entradaEm = t;
    else if (r.tipo === 'intervalo_inicio') intervaloEm = t;
    else if (r.tipo === 'intervalo_fim') {
      if (intervaloEm != null) { intervalo += t - intervaloEm; intervaloEm = null; }
    } else if (r.tipo === 'saida') {
      if (entradaEm != null) { trabalhados += t - entradaEm; entradaEm = null; }
    }
  }

  const minutos = Math.max(0, Math.round((trabalhados - intervalo) / 60000));
  return {
    minutos,
    intervaloMinutos: Math.round(intervalo / 60000),
    emAndamento: entradaEm != null,
    // Pendências que o escritório precisa ver: jornada aberta ou intervalo que
    // começou e não terminou. Sem isso o dia fecha com total menor e parece
    // que o técnico trabalhou pouco.
    intervaloAberto: intervaloEm != null,
  };
}

export function formatarDuracao(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
