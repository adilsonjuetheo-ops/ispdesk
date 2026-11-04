// Espelho de exibição da tabela de planos. A fonte da verdade é
// backend/src/config/planos.js — quem cobra é o backend, e este arquivo só
// desenha. Mexeu num, mexa no outro.
//
// Existe porque a tabela vivia copiada dentro de cada tela, e já tinha
// divergido: a lista de Provedores anunciava o Pro por R$ 299,90 enquanto o
// Mercado Pago cobrava R$ 249,90.
export const PLANOS = {
  basic:      { label: 'Basic',      ordem: 1, valor: 149.90, limiteIa: 3000,  contrato: false },
  exclusivo:  { label: 'Exclusivo',  ordem: 2, valor: 199.90, limiteIa: 6000,  contrato: true  },
  pro:        { label: 'Pro',        ordem: 3, valor: 249.90, limiteIa: 10000, contrato: true  },
  personalizado: { label: 'Personalizado', ordem: 4, valor: 349.90, limiteIa: 10000, contrato: true },
  enterprise: { label: 'Enterprise', ordem: 5, valor: 549.90, limiteIa: 10000, contrato: true  },
};

// Ordem de exibição — do mais barato ao mais caro, que é como a pessoa compara.
export const ORDEM_PLANOS = ['basic', 'exclusivo', 'pro', 'personalizado', 'enterprise'];

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

// Abertura de chamado técnico: do Enterprise para cima. Aqui serve só para
// esconder o botão — quem recusa de verdade é o backend.
export const PLANO_MINIMO_CHAMADO = 'enterprise';

export function planoTemChamado(p) {
  return getPlano(p).ordem >= PLANOS[PLANO_MINIMO_CHAMADO].ordem;
}
