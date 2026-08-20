/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
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
