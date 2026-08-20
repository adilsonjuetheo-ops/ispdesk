// A cor primária que o provedor cadastra é um hex só, mas a interface precisa
// de uma rampa inteira — fundo suave para item ativo, tom sólido para botão,
// tom escuro para hover. Aqui essa rampa é derivada da cor e publicada como
// custom property.
//
// Os valores saem em canais RGB separados por espaço ("0 102 204") e não em
// hex porque é o formato que o Tailwind exige para os modificadores de opacidade
// (`bg-brand-600/40`) continuarem funcionando.

export const COR_PADRAO = '#0066CC';

// Peso da mistura com branco (tons claros) e com preto (tons escuros). A cor
// do provedor fica exatamente no 600, que é o tom sólido de botão.
const CLAROS = { 50: 0.94, 100: 0.88, 200: 0.76, 300: 0.58, 400: 0.32, 500: 0.14 };
const ESCUROS = { 700: 0.16, 800: 0.32, 900: 0.48 };

export function paraRgb(hex) {
  const limpo = String(hex || '').trim().replace(/^#/, '');
  const cheio = limpo.length === 3 ? limpo.split('').map(c => c + c).join('') : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) return null;
  const n = parseInt(cheio, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const misturar = (rgb, alvo, peso) => rgb.map(c => Math.round(c + (alvo - c) * peso));

// Luminância relativa (WCAG 2.x). Decide se o texto sobre a cor sólida sai
// branco ou quase preto — sem isso uma marca amarela ou lima ganharia botão
// com texto branco ilegível.
function luminancia([r, g, b]) {
  const canal = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function rampaDaMarca(hex) {
  const base = paraRgb(hex) || paraRgb(COR_PADRAO);
  const lum = luminancia(base);
  const rampa = { 600: base };

  for (const [tom, peso] of Object.entries(CLAROS)) rampa[tom] = misturar(base, 255, peso);

  // Marca quase preta não tem para onde escurecer — o hover ficaria idêntico ao
  // estado normal. Nesse caso os tons "escuros" clareiam.
  const inverter = lum < 0.05;
  for (const [tom, peso] of Object.entries(ESCUROS)) {
    rampa[tom] = inverter ? misturar(base, 255, peso) : misturar(base, 0, peso);
  }

  rampa.contraste = lum > 0.45 ? [23, 23, 23] : [255, 255, 255];
  return rampa;
}

export function aplicarCorDaMarca(hex) {
  if (typeof document === 'undefined') return;
  const rampa = rampaDaMarca(hex);
  const raiz = document.documentElement;
  for (const [tom, rgb] of Object.entries(rampa)) {
    raiz.style.setProperty(`--brand-${tom}`, rgb.join(' '));
  }
}
