import { useEffect, useRef } from 'react';

export function usePolling(callback, intervalMs = 5000, enabled = true) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current();
      }
    };

    tick(); // executa imediatamente
    const id = setInterval(tick, intervalMs);
    // Atualiza na hora quando a aba volta a ficar visível
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
}
