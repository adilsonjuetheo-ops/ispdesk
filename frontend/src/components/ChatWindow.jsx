import { useState, useEffect, useRef } from 'react';
import api from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Send, UserCheck, Bot, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';

function BolaoMsg({ msg, agenteNome }) {
  const isCliente = msg.origem === 'cliente';
  const isBot = msg.origem === 'bot';
  const isSistema = msg.conteudo.startsWith('[Sistema]');

  if (isSistema) {
    return (
      <div className="flex justify-center my-2">
        <span className="bg-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full">
          {msg.conteudo.replace('[Sistema] ', '')}
        </span>
      </div>
    );
  }

  return (
    <div className={clsx('flex mb-3', isCliente ? 'justify-start' : 'justify-end')}>
      <div className="max-w-[70%]">
        {!isCliente && (
          <p className="text-xs mb-1 text-right">
            {isBot
              ? <span className="text-gray-400">Bot</span>
              : <span className="font-bold text-gray-700">{agenteNome || 'Agente'}</span>
            }
          </p>
        )}
        <div className={clsx('rounded-2xl px-4 py-2.5 text-sm', {
          'bg-white border border-gray-200 text-gray-800 rounded-tl-sm': isCliente,
          'bg-emerald-50 text-emerald-900 rounded-tr-sm border border-emerald-100': isBot,
          'bg-blue-50 text-blue-900 rounded-tr-sm border border-blue-100': !isCliente && !isBot,
        })}>
          {msg.conteudo}
        </div>
        <p className={clsx('text-xs text-gray-400 mt-1', isCliente ? 'text-left' : 'text-right')}>
          {format(new Date(msg.enviadaEm), 'HH:mm', { locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

export default function ChatWindow({ conversa, onAtualizar }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [acao, setAcao] = useState(false);
  const bottomRef = useRef(null);

  const carregarMsgs = () =>
    api.get(`/conversations/${conversa.id}/messages`).then(r => setMsgs(r.data));

  useEffect(() => {
    setMsgs([]);
    carregarMsgs();
  }, [conversa.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const podeAtuar = conversa.status !== 'encerrada';
  const eHumano = conversa.status === 'humano';
  const podeEscrever = eHumano;

  const handleAsumir = async () => {
    setAcao(true);
    try {
      await api.post(`/conversations/${conversa.id}/assume`);
      onAtualizar();
      carregarMsgs();
    } finally { setAcao(false); }
  };

  const handleLiberar = async () => {
    setAcao(true);
    try {
      await api.post(`/conversations/${conversa.id}/release`);
      onAtualizar();
      carregarMsgs();
    } finally { setAcao(false); }
  };

  const handleEncerrar = async () => {
    setAcao(true);
    try {
      await api.post(`/conversations/${conversa.id}/close`);
      onAtualizar();
      carregarMsgs();
    } finally { setAcao(false); }
  };

  const handleEnviar = async e => {
    e.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await api.post(`/conversations/${conversa.id}/send`, { texto });
      setTexto('');
      carregarMsgs();
    } finally { setEnviando(false); }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-gray-800">{conversa.clienteNome || conversa.clienteWhatsapp}</p>
          <p className="text-xs text-gray-400">{conversa.clienteWhatsapp}{conversa.clienteFilial ? ` · ${conversa.clienteFilial}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {podeAtuar && !eHumano && (
            <button onClick={handleAsumir} disabled={acao}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              <UserCheck className="w-3.5 h-3.5" />
              Assumir
            </button>
          )}
          {eHumano && (
            <>
              <button onClick={handleLiberar} disabled={acao}
                className="flex items-center gap-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <Bot className="w-3.5 h-3.5" />
                Liberar para bot
              </button>
              <button onClick={handleEncerrar} disabled={acao}
                className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" />
                Encerrar
              </button>
            </>
          )}
        </div>
      </div>

      {/* mensagens */}
      <div className="flex-1 overflow-y-auto p-4">
        {msgs.map(m => (
          <BolaoMsg key={m.id} msg={m} agenteNome={user?.nome} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <form onSubmit={handleEnviar} className="bg-white border-t border-gray-200 p-3 flex gap-2">
        <input
          type="text"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          disabled={!podeEscrever}
          placeholder={podeEscrever ? 'Digite sua mensagem...' : 'Assuma a conversa para responder'}
          className="flex-1 bg-gray-100 rounded-xl px-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        />
        <button type="submit" disabled={!podeEscrever || !texto.trim() || enviando}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl px-4 py-2 transition-colors">
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
