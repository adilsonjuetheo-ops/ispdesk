import { useState, useEffect, useRef } from 'react';

export const STATUS = {
  disponivel: { valor: 'disponivel', rotulo: 'Disponível', cor: 'bg-green-500' },
  ocupado:    { valor: 'ocupado',    rotulo: 'Ocupado',    cor: 'bg-red-500' },
  ausente:    { valor: 'ausente',    rotulo: 'Ausente',    cor: 'bg-amber-400' },
};

const CHAVE = 'ispdesk_status_atendente';
const OCIOSO_MS = 5 * 60 * 1000;

// Status do atendente para os colegas: o que ele escolheu, rebaixado para
// "ausente" quando fica um tempo sem mexer no computador.
//
// A escolha fica no navegador porque é preferência de quem está na máquina —
// quem atende de dois lugares costuma querer estados diferentes em cada um.
export function usePresencaStatus() {
  const [escolhido, setEscolhido] = useState(() => {
    try {
      const salvo = localStorage.getItem(CHAVE);
      return STATUS[salvo] ? salvo : 'disponivel';
    } catch { return 'disponivel'; }
  });
  const [ocioso, setOcioso] = useState(false);
  const ultimaInteracao = useRef(Date.now());

  useEffect(() => {
    try { localStorage.setItem(CHAVE, escolhido); } catch { /* aba anônima */ }
  }, [escolhido]);

  useEffect(() => {
    const marcar = () => {
      ultimaInteracao.current = Date.now();
      // Só muda o estado se estava ocioso: sem isso cada mousemove
      // re-renderizaria o painel inteiro.
      setOcioso(atual => (atual ? false : atual));
    };
    const eventos = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'];
    eventos.forEach(e => window.addEventListener(e, marcar, { passive: true }));

    const id = setInterval(() => {
      setOcioso(Date.now() - ultimaInteracao.current >= OCIOSO_MS);
    }, 30000);

    return () => {
      eventos.forEach(e => window.removeEventListener(e, marcar));
      clearInterval(id);
    };
  }, []);

  // Ociosidade só rebaixa quem está disponível: quem se marcou ocupado
  // continua ocupado mesmo parado, e quem já está ausente não muda.
  const status = escolhido === 'disponivel' && ocioso ? 'ausente' : escolhido;

  return { status, escolhido, setEscolhido, ocioso };
}
