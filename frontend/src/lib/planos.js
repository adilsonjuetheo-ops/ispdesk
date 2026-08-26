// Espelho de exibição da tabela de planos. A fonte da verdade é
// backend/src/config/planos.js — quem cobra é o backend, e este arquivo só
// desenha. Mexeu num, mexa no outro.
//
// Existe porque a tabela vivia copiada dentro de cada tela, e já tinha
// divergido: a lista de Provedores anunciava o Pro por R$ 299,90 enquanto o
// Mercado Pago cobrava R$ 249,90.
export const PLANOS = {
  basic:      { label: 'Basic',      valor: 149.90, limiteIa: 3000,  contrato: false },
  exclusivo:  { label: 'Exclusivo',  valor: 199.90, limiteIa: 6000,  contrato: true  },
  pro:        { label: 'Pro',        valor: 249.90, limiteIa: 10000, contrato: true  },
  enterprise: { label: 'Enterprise', valor: 549.90, limiteIa: 10000, contrato: true  },
};

// Ordem de exibição — do mais barato ao mais caro, que é como a pessoa compara.
export const ORDEM_PLANOS = ['basic', 'exclusivo', 'pro', 'enterprise'];

export function getPlano(p) {
  return PLANOS[p] || PLANOS.basic;
}

export function labelPlano(p) {
  return getPlano(p).label;
}

export function precoPlano(p) {
  return `R$${getPlano(p).valor.toFixed(2).replace('.', ',')}`;
}

export function planoTemContrato(p) {
  return getPlano(p).contrato === true;
}
