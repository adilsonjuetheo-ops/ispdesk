import { useState, useEffect } from 'react';
import api from '../lib/api.js';

// "audio/ogg" puro deixa o Chrome em dúvida — canPlayType devolve "maybe" e,
// num blob, ele pode desistir antes de acionar o decodificador. Com o codec
// declarado a resposta vira "probably" e o Ogg do WhatsApp toca.
function tipoPreciso(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return base === 'audio/ogg' ? 'audio/ogg; codecs=opus' : base;
}

// Cada mídia já baixada vale para a aba inteira: o id vem do WhatsApp e o
// arquivo por trás dele nunca muda. Sem isto, sair de uma conversa e voltar
// baixava tudo de novo — e a primeira busca de um áudio é cara, porque o
// servidor ainda converte o Ogg para MP3 antes de responder.
const cache = new Map();

// O navegador abre umas 6 conexões por domínio. Uma conversa com vários áudios
// e imagens tomava todas, e aí a busca das mensagens da conversa seguinte ficava
// na fila atrás delas — era isso que fazia a conversa demorar a abrir. Deixando
// mídia usar no máximo três, sobra caminho livre para o resto do painel.
const TETO = 3;
let emVoo = 0;
const espera = [];

function liberar() {
  emVoo--;
  const proximo = espera.shift();
  if (proximo) proximo();
}

function agendar(tarefa) {
  return new Promise((resolve, reject) => {
    const executar = () => {
      emVoo++;
      // Promise.resolve().then(tarefa) e não tarefa() direto: se a chamada
      // estourasse de forma síncrona, a vaga nunca seria devolvida e três
      // desses travariam o download de mídia para o resto da sessão.
      Promise.resolve().then(tarefa).then(resolve, reject).finally(liberar);
    };
    if (emVoo < TETO) executar();
    else espera.push(executar);
  });
}

export function useMidiaBlob(conversaId, mediaId) {
  const [src, setSrc] = useState(() => cache.get(mediaId) || null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!conversaId || !mediaId) return undefined;

    const pronto = cache.get(mediaId);
    if (pronto) { setSrc(pronto); setErro(false); return undefined; }

    let cancelado = false;
    // Antes só existia a flag: a requisição continuava correndo depois da troca
    // de conversa, segurando conexão e CPU do servidor por um arquivo que
    // ninguém ia mais ver. Abortar de verdade devolve os dois na hora.
    const controle = new AbortController();

    setSrc(null);
    setErro(false);

    agendar(() => api.get(`/conversations/${conversaId}/media/${mediaId}`, {
      responseType: 'blob',
      signal: controle.signal,
    }))
      .then(r => {
        if (cancelado) return;
        const mime = tipoPreciso(r.headers?.['content-type'] || r.data?.type);
        const blob = mime && r.data.type !== mime
          ? new Blob([r.data], { type: mime })
          : r.data;
        const url = URL.createObjectURL(blob);
        cache.set(mediaId, url);
        setSrc(url);
      })
      .catch(err => {
        // Abortar é saída limpa, não falha: marcar erro pintaria "não foi
        // possível reproduzir" numa mídia que só deixou de ser necessária.
        if (cancelado || controle.signal.aborted) return;
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setErro(true);
      });

    // A URL não é revogada de propósito. Revogar na limpeza do efeito derruba a
    // fonte debaixo do player quando o efeito reexecuta, e o <audio> relata
    // isso como "formato não suportado" — indistinguível de codec errado. São
    // poucos KB por áudio, liberados quando a aba fecha.
    return () => { cancelado = true; controle.abort(); };
  }, [conversaId, mediaId]);

  return { src, erro };
}
