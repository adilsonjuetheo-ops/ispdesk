import { useState, useEffect } from 'react';
import api from '../lib/api.js';

// "audio/ogg" puro deixa o Chrome em dúvida — canPlayType devolve "maybe" e,
// num blob, ele pode desistir antes de acionar o decodificador. Com o codec
// declarado a resposta vira "probably" e o Ogg do WhatsApp toca.
function tipoPreciso(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return base === 'audio/ogg' ? 'audio/ogg; codecs=opus' : base;
}

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

    setSrc(null);
    setErro(false);

    api.get(`/conversations/${conversaId}/media/${mediaId}`, { responseType: 'blob' })
      .then(r => {
        if (cancelado) return;
        const mime = tipoPreciso(r.headers?.['content-type'] || r.data?.type);
        const blob = mime && r.data.type !== mime
          ? new Blob([r.data], { type: mime })
          : r.data;
        setSrc(URL.createObjectURL(blob));
      })
      .catch(() => { if (!cancelado) setErro(true); });

    // A URL não é revogada de propósito. Revogar na limpeza do efeito derruba a
    // fonte debaixo do player quando o efeito reexecuta, e o <audio> relata
    // isso como "formato não suportado" — indistinguível de codec errado. São
    // poucos KB por áudio, liberados quando a aba fecha.
    return () => { cancelado = true; };
  }, [conversaId, mediaId]);

  return { src, erro };
}
