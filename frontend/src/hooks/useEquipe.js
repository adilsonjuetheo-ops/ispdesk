import { useState, useEffect } from 'react';
import api from '../lib/api.js';

// O diretório da equipe vale para a aba inteira. Sem isto, cada tela que
// precisa de avatar — lista de conversas, balões do chat, painel do cliente —
// pediria a própria cópia da mesma lista, e o painel já é pesado em polling.
//
// A equipe muda raramente: alguém entra, alguém sai, alguém troca a foto. Meia
// hora de validade é folgado para isso e barato para o banco.
const VALIDADE_MS = 30 * 60 * 1000;

let cache = null;   // { lista, em }
let emVoo = null;
const ouvintes = new Set();

function buscar() {
  if (emVoo) return emVoo;
  emVoo = api.get('/conversations/agentes')
    .then(r => {
      cache = { lista: r.data || [], em: Date.now() };
      ouvintes.forEach(fn => fn(cache.lista));
      return cache.lista;
    })
    // Falhou: segue com o que tiver em mãos. Avatar é enfeite — a tela não
    // pode quebrar porque a foto não veio.
    .catch(() => cache?.lista || [])
    .finally(() => { emVoo = null; });
  return emVoo;
}

// Força a próxima leitura a ir ao servidor. Usado quando o próprio atendente
// troca a foto: sem isso o rosto novo só apareceria nos balões meia hora
// depois.
export function recarregarEquipe() {
  cache = null;
  buscar();
}

export function useEquipe() {
  const [lista, setLista] = useState(() => cache?.lista || []);

  useEffect(() => {
    ouvintes.add(setLista);
    if (!cache || Date.now() - cache.em > VALIDADE_MS) buscar();
    return () => { ouvintes.delete(setLista); };
  }, []);

  return lista;
}

// A mensagem guarda o nome de quem respondeu, não o id — é assim desde sempre e
// vale para o histórico inteiro. Então o avatar nos balões sai de uma busca por
// nome.
//
// Nome repetido na equipe não dá para desambiguar a partir disso. Nesse caso
// ninguém ganha foto, em vez de arriscar mostrar o rosto do colega errado numa
// conversa com cliente.
export function indexarPorNome(lista) {
  const vezes = new Map();
  for (const a of lista) vezes.set(a.nome, (vezes.get(a.nome) || 0) + 1);

  const mapa = new Map();
  for (const a of lista) if (vezes.get(a.nome) === 1) mapa.set(a.nome, a);
  return mapa;
}

export function indexarPorId(lista) {
  return new Map(lista.map(a => [a.id, a]));
}
