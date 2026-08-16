import { useState, useEffect, useRef } from 'react';

const INTERVALO_MS = 5 * 60 * 1000; // checa a cada 5 minutos

export function useAppUpdate() {
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState(false);
  const versaoInicial = useRef(null);

  useEffect(() => {
    let cancelado = false;

    async function checar() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (cancelado) return;

        if (versaoInicial.current === null) {
          versaoInicial.current = version;
        } else if (version !== versaoInicial.current) {
          setAtualizacaoDisponivel(true);
        }
      } catch {
        // offline ou rota indisponível — ignora, tenta de novo no próximo ciclo
      }
    }

    checar();
    const intervalId = setInterval(checar, INTERVALO_MS);
    const onFocus = () => checar();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelado = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  return atualizacaoDisponivel;
}
