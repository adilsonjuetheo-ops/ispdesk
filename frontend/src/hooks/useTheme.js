import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'ispdesk_tema';

function preferenciaSalva() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function aplicarClasse(escuro) {
  document.documentElement.classList.toggle('dark', escuro);
}

// 'claro' | 'escuro' | 'sistema' (segue prefers-color-scheme do SO)
export function useTheme() {
  const [modo, setModo] = useState(() => preferenciaSalva() || 'sistema');
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const atualizar = () => {
      const ativo = modo === 'escuro' || (modo === 'sistema' && mq.matches);
      aplicarClasse(ativo);
      setEscuro(ativo);
    };

    atualizar();
    if (modo === 'sistema') {
      mq.addEventListener('change', atualizar);
      return () => mq.removeEventListener('change', atualizar);
    }
  }, [modo]);

  const mudar = useCallback((novoModo) => {
    setModo(novoModo);
    try { localStorage.setItem(STORAGE_KEY, novoModo); } catch {}
  }, []);

  // Alterna direto entre claro/escuro — a UI não precisa expor "sistema"
  // como opção pra ser simples de usar; ele só define o estado inicial.
  const alternar = useCallback(() => {
    mudar(escuro ? 'claro' : 'escuro');
  }, [escuro, mudar]);

  return { modo, escuro, mudar, alternar };
}
