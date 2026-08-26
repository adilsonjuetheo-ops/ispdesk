// Fonte única dos planos do ISPDesk.
//
// Antes esta tabela existia copiada em oito lugares, e já tinha divergido: o
// painel anunciava o Pro por R$ 299,90 enquanto o Mercado Pago cobrava
// R$ 249,90, e o Enterprise caía no limite do Basic porque ninguém lembrou de
// incluí-lo em LIMITES. Um plano novo tinha que ser escrito oito vezes para
// funcionar inteiro — daí o espalhamento virar erro.
//
// Quem cobra, quem limita e quem exibe leem daqui. O espelho do frontend fica em
// frontend/src/lib/planos.js e precisa acompanhar este arquivo.
export const PLANOS = {
  basic: {
    label: 'Basic',
    valor: 149.90,
    limiteIa: 3000,
    contrato: false,
  },
  exclusivo: {
    label: 'Exclusivo',
    valor: 199.90,
    limiteIa: 6000,
    contrato: true,
  },
  pro: {
    label: 'Pro',
    valor: 249.90,
    limiteIa: 10000,
    contrato: true,
  },
  enterprise: {
    label: 'Enterprise',
    valor: 549.90,
    // Estava sem entrada em LIMITES e por isso herdava os 3.000 do Basic — um
    // provedor pagando R$ 549,90 era cortado como se pagasse R$ 149,90. Igualado
    // ao Pro para parar o prejuízo; o teto que o Enterprise merece de verdade é
    // decisão comercial, não técnica.
    limiteIa: 10000,
    contrato: true,
  },
};

const PADRAO = 'basic';

export function getPlano(plano) {
  return PLANOS[plano] || PLANOS[PADRAO];
}

export function getValorPlano(plano) {
  return getPlano(plano).valor;
}

export function getLabelPlano(plano) {
  return getPlano(plano).label;
}

export function getLimitePlano(plano) {
  return getPlano(plano).limiteIa;
}

// Assinatura digital de contrato não entra no Basic.
export function planoTemContrato(plano) {
  return getPlano(plano).contrato === true;
}
