import { useState, useEffect } from 'react';
import api from '../lib/api.js';

// Baixa a mídia pelo axios e devolve uma blob: URL.
//
// As tags <img>, <audio> e <video> não conseguem mandar cabeçalho, então
// dependiam só do cookie de sessão — e o app autentica por token no
// localStorage. Buscando pelo axios, a mídia usa o mesmo caminho de
// autenticação do resto do painel, e a blob: URL ainda é local: o player pode
// buscar a duração e navegar no áudio sem depender de CORS nem de Range.
export function useMidiaBlob(conversaId, mediaId) {
  const [src, setSrc] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!conversaId || !mediaId) return;
    let cancelado = false;
    let criada = null;

    setSrc(null);
    setErro(false);

    api.get(`/conversations/${conversaId}/media/${mediaId}`, { responseType: 'blob' })
      .then(r => {
        if (cancelado) return;
        criada = URL.createObjectURL(r.data);
        setSrc(criada);
      })
      .catch(() => { if (!cancelado) setErro(true); });

    return () => {
      cancelado = true;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [conversaId, mediaId]);

  return { src, erro };
}
