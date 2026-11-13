// Fonte única da versão da Graph API da Meta.
//
// Antes isto estava escrito à mão em quinze lugares, todos em v19.0 — que
// expirou em 21/05/2026. Nada quebrou de imediato porque a Meta não derruba
// chamada de versão vencida: ela promove em silêncio para a versão mais antiga
// ainda viva. O efeito colateral é pior que um erro, porque é invisível —
// havia meses que não éramos nós escolhendo em que versão o sistema rodava.
//
// A versão fica em variável de ambiente para dar pra voltar atrás sem deploy
// de código: basta mudar META_GRAPH_VERSION e reiniciar.
//
// Sobre o padrão: a Meta aposenta cada versão cerca de dois anos depois do
// lançamento. A v25.0 já tem meses de estrada (não é a recém-saída) e ainda
// tem bastante prazo pela frente — é o meio-termo entre pegar novidade sem
// rodagem e repetir o erro de ficar numa versão vencida.
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
