// Preço da API da Anthropic, em dólares por milhão de tokens.
//
// Fonte única: se a Anthropic mudar a tabela, muda aqui e o painel inteiro
// acompanha. A chave é o começo do id do modelo, porque o que vai na chamada
// tem data no fim (claude-haiku-4-5-20251001) e isso mudaria a cada versão.
//
// Leitura de cache custa 10% da entrada; escrita custa 125%. É daí que vem o
// ganho de separar o prompt em prefixo estável e parte volátil.
const TABELA = [
  { prefixo: 'claude-haiku-4-5',  entrada: 1.00, saida: 5.00 },
  { prefixo: 'claude-sonnet-5',   entrada: 2.00, saida: 10.00 },
  { prefixo: 'claude-sonnet-4-6', entrada: 3.00, saida: 15.00 },
  { prefixo: 'claude-opus-5',     entrada: 5.00, saida: 25.00 },
];

const FATOR_CACHE_ESCRITA = 1.25;
const FATOR_CACHE_LEITURA = 0.10;
const POR_MILHAO = 1_000_000;

function precoDe(modelo) {
  return TABELA.find(p => String(modelo || '').startsWith(p.prefixo)) || null;
}

// Custo em dólares de uma linha de consumo. Devolve null para modelo que não
// está na tabela — melhor o painel mostrar "—" do que um número inventado.
export function custoDolares({ modelo, entrada = 0, saida = 0, cacheEscrito = 0, cacheLido = 0 }) {
  const p = precoDe(modelo);
  if (!p) return null;

  return (
    entrada * p.entrada +
    saida * p.saida +
    cacheEscrito * p.entrada * FATOR_CACHE_ESCRITA +
    cacheLido * p.entrada * FATOR_CACHE_LEITURA
  ) / POR_MILHAO;
}

// Quanto a entrada teria custado sem nenhum cache, para medir o que o cache
// está de fato economizando. Sem essa comparação não dá para saber se a
// separação do prompt valeu — o total sozinho sobe junto com o movimento.
export function custoSemCacheDolares({ modelo, entrada = 0, saida = 0, cacheEscrito = 0, cacheLido = 0 }) {
  const p = precoDe(modelo);
  if (!p) return null;
  return ((entrada + cacheEscrito + cacheLido) * p.entrada + saida * p.saida) / POR_MILHAO;
}
