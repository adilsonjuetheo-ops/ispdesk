import { useState, useEffect, useRef } from 'react';
import api from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Send, UserCheck, Bot, X, Loader2, Paperclip, FileText, ImageIcon, Mic, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';

function MidiaBolao({ conteudo, isCliente }) {
  const isImagem = conteudo.startsWith('[Imagem]');
  const isAudio = conteudo.startsWith('[Áudio]');
  const nome = conteudo.replace(/^\[(Imagem|Arquivo|Áudio)\] /, '');
  const Icon = isImagem ? ImageIcon : isAudio ? Mic : FileText;
  const cor = isCliente
    ? 'bg-white border border-gray-200 text-gray-700'
    : 'bg-blue-50 border border-blue-100 text-blue-800';
  const label = isImagem ? 'Imagem enviada' : isAudio ? 'Áudio transcrito' : 'Documento enviado';

  return (
    <div className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm max-w-[280px] ${cor}`}>
      <Icon className="w-5 h-5 shrink-0 opacity-60 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs opacity-60 mb-0.5 font-medium">{label}</p>
        <p className="text-xs leading-relaxed">{nome}</p>
      </div>
    </div>
  );
}

function BolaoMsg({ msg, agenteNome }) {
  const isCliente = msg.origem === 'cliente';
  const isBot = msg.origem === 'bot';
  const isSistema = msg.conteudo.startsWith('[Sistema]');
  const isMidia = msg.conteudo.startsWith('[Arquivo]') || msg.conteudo.startsWith('[Imagem]') || msg.conteudo.startsWith('[Áudio]');

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
        {isMidia ? (
          <MidiaBolao conteudo={msg.conteudo} isCliente={isCliente} />
        ) : (
          <div className={clsx('rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap', {
            'bg-white border border-gray-200 text-gray-800 rounded-tl-sm': isCliente,
            'bg-emerald-50 text-emerald-900 rounded-tr-sm border border-emerald-100': isBot,
            'bg-blue-50 text-blue-900 rounded-tr-sm border border-blue-100': !isCliente && !isBot,
          })}>
            {msg.conteudo}
          </div>
        )}
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
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [acao, setAcao] = useState(false);
  const [aba, setAba] = useState('resposta');
  const [atalhosList, setAtalhosList] = useState([]);
  const [buscaAtalho, setBuscaAtalho] = useState('');
  const bottomRef = useRef(null);
  const fileRef = useRef(null);

  const carregarMsgs = () =>
    api.get(`/conversations/${conversa.id}/messages`).then(r => setMsgs(r.data));

  useEffect(() => {
    setMsgs([]);
    carregarMsgs();
    setAba('resposta');
  }, [conversa.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  useEffect(() => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/atalhos`).then(r => setAtalhosList(r.data)).catch(() => {});
  }, [user?.tenantId]);

  const podeAtuar = conversa.status !== 'encerrada';
  const eHumano = conversa.status === 'humano';

  const handleAsumir = async () => {
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/assume`); onAtualizar(); carregarMsgs(); }
    finally { setAcao(false); }
  };

  const handleLiberar = async () => {
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/release`); onAtualizar(); carregarMsgs(); }
    finally { setAcao(false); }
  };

  const handleEncerrar = async () => {
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/close`); onAtualizar(); carregarMsgs(); }
    finally { setAcao(false); }
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

  const handleEnviarArquivo = async e => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setEnviandoArquivo(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      await api.post(`/conversations/${conversa.id}/send-media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      carregarMsgs();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao enviar arquivo');
    } finally {
      setEnviandoArquivo(false);
      e.target.value = '';
    }
  };

  const selecionarAtalho = (atalho) => {
    setTexto(atalho.conteudo);
    setAba('resposta');
    setBuscaAtalho('');
  };

  const atalhosFiltrados = atalhosList.filter(a =>
    a.titulo.toLowerCase().includes(buscaAtalho.toLowerCase()) ||
    (a.atalho || '').toLowerCase().includes(buscaAtalho.toLowerCase())
  );

  const tabClass = (t) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      aba === t
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

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
              <UserCheck className="w-3.5 h-3.5" /> Assumir
            </button>
          )}
          {eHumano && (
            <>
              <button onClick={handleLiberar} disabled={acao}
                className="flex items-center gap-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <Bot className="w-3.5 h-3.5" /> Liberar para bot
              </button>
              <button onClick={handleEncerrar} disabled={acao}
                className="flex items-center gap-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" /> Encerrar
              </button>
            </>
          )}
        </div>
      </div>

      {/* mensagens */}
      <div className="flex-1 overflow-y-auto p-4">
        {msgs.map(m => <BolaoMsg key={m.id} msg={m} agenteNome={user?.nome} />)}
        <div ref={bottomRef} />
      </div>

      {/* área de input com tabs */}
      <div className="bg-white border-t border-gray-200">
        {/* tabs — só aparecem quando agente assumiu */}
        {eHumano && (
          <div className="flex border-b border-gray-100 px-3">
            <button className={tabClass('resposta')} onClick={() => setAba('resposta')}>
              Resposta
            </button>
            <button className={tabClass('atalhos')} onClick={() => setAba('atalhos')}>
              Atalhos
            </button>
          </div>
        )}

        {/* painel Atalhos */}
        {eHumano && aba === 'atalhos' && (
          <div className="max-h-56 flex flex-col">
            <div className="px-3 pt-2 pb-1">
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Pesquisar atalhos..."
                  value={buscaAtalho}
                  onChange={e => setBuscaAtalho(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {atalhosFiltrados.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  {atalhosList.length === 0 ? 'Nenhum atalho configurado' : 'Nenhum resultado'}
                </p>
              ) : (
                atalhosFiltrados.map(a => (
                  <button
                    key={a.id}
                    onClick={() => selecionarAtalho(a)}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      {a.atalho && (
                        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                          {a.atalho}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-700 truncate">{a.titulo}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5 pl-0">{a.conteudo}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* input Resposta */}
        {(!eHumano || aba === 'resposta') && (
          <form onSubmit={handleEnviar} className="p-3 flex gap-2 items-center">
            <input ref={fileRef} type="file" className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleEnviarArquivo}
              disabled={!eHumano}
            />
            <button type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!eHumano || enviandoArquivo}
              title="Enviar arquivo"
              className="text-gray-400 hover:text-blue-600 disabled:opacity-30 transition-colors p-1 shrink-0">
              {enviandoArquivo
                ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                : <Paperclip className="w-5 h-5" />}
            </button>
            <input
              type="text"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              disabled={!eHumano}
              placeholder={eHumano ? 'Digite sua mensagem...' : 'Assuma a conversa para responder'}
              className="flex-1 bg-gray-100 rounded-xl px-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button type="submit" disabled={!eHumano || !texto.trim() || enviando}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl px-4 py-2 transition-colors shrink-0">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
