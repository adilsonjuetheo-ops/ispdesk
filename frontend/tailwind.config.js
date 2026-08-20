/** @type {import('tailwindcss').Config} */

const TONS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

// A marca de cada provedor entra por custom property (ver src/lib/marca.js).
// O formato `rgb(var(...) / <alpha-value>)` é o que mantém `bg-brand-600/40`
// funcionando mesmo com a cor vindo em tempo de execução.
const marca = Object.fromEntries(
  TONS.map(t => [t, `rgb(var(--brand-${t}) / <alpha-value>)`])
);
marca.DEFAULT = marca[600];
// Texto que fica por cima do tom sólido — branco ou quase preto, conforme a
// luminância da marca. Sem isso um provedor de cor clara ganha botão ilegível.
marca.contraste = 'rgb(var(--brand-contraste) / <alpha-value>)';

// Estado é uma escala à parte, deliberadamente NÃO derivada da marca: um
// provedor de identidade vermelha não pode fazer "tudo certo" parecer erro.
const ok = {
  50: '#ecfdf6', 100: '#d3f8e7', 200: '#a8efd0', 300: '#6fe0b4', 400: '#34c894',
  500: '#12ab7a', 600: '#0a8a63', 700: '#0a6e51', 800: '#0b5742', 900: '#0a4736',
};
const atencao = {
  50: '#fff8eb', 100: '#ffedc7', 200: '#ffd98a', 300: '#ffc14d', 400: '#fbaa24',
  500: '#ef8c0b', 600: '#d06a06', 700: '#a54c09', 800: '#863c0e', 900: '#71320f',
};
const critico = {
  50: '#fff1f2', 100: '#ffe0e2', 200: '#ffc6ca', 300: '#ff9ea6', 400: '#fb6a78',
  500: '#ef3d51', 600: '#db2038', 700: '#b8172c', 800: '#99172a', 900: '#831828',
};

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: marca,
        ok,
        atencao,
        critico,
        // Verde do WhatsApp — é cor de terceiro, não da marca nem de estado.
        whatsapp: '#25D366',
        // Identidade do assistente no balão. É verde, mas não quer dizer
        // "sucesso": fica fora da escala de estado justamente para ninguém ler
        // como tal. Nomeado porque a alternativa neutra deixou o texto apagado.
        assistente: { 50: '#ecfdf5', 100: '#d1fae5', 900: '#064e3b' },
      },
      // Largura confortável de leitura para o balão de mensagem. O valor antigo
      // era 280px fixo, um número de celular que sobrava metade da tela no desktop.
      maxWidth: {
        balao: '34rem',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
