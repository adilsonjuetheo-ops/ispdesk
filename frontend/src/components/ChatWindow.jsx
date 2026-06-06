import { useState, useEffect, useRef } from 'react';
import api from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePolling } from '../hooks/usePolling.js';
import { useNotificationSound } from '../hooks/useNotificationSound.js';
import {
  Send, UserCheck, Bot, X, Loader2, Paperclip, FileText,
  ImageIcon, Mic, Search, StickyNote, ArrowRightLeft, Tag,
} from 'lucide-react';
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
  const isNota = msg.origem === 'nota';
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

  if (isNota) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 max-w-[80%]">
          <div className="flex items-center gap-1.5 mb-1">
            <StickyNote className="w-3 h-3 text-yellow-600" />
            <span className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wide">Nota interna</span>
          </div>
          <p className="text-xs text-yellow-900 whitespace-pre-wrap">{msg.conteudo}</p>
          <p className="text-[10px] text-yellow-600 mt-1">
            {format(new Date(msg.enviadaEm), 'HH:mm', { locale: ptBR })}
          </p>
        </div>
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

function applyVars(texto, conversa) {
  return texto
    .replace(/\{\{nome\}\}/gi, conversa.clienteNome || '')
    .replace(/\{\{contrato\}\}/gi, conversa.clienteContratoId || '')
    .replace(/\{\{filial\}\}/gi, conversa.clienteFilial || conversa.filialNome || '');
}

function TagsBar({ conversa, onUpdate }) {
  const tags = Array.isArray(conversa.tags) ? conversa.tags : [];

  const removerTag = async (tag) => {
    const novo = tags.filter(t => t !== tag);
    await api.patch(`/conversations/${conversa.id}/tags`, { tags: novo });
    onUpdate();
  };

  if (tags.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map(t => (
        <span key={t}
          className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
          {t}
          <button onClick={() => removerTag(t)} className="hover:text-indigo-900 transition-colors">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function TransferModal({ conversa, tenantId, onClose, onTransferred }) {
  const [agentes, setAgentes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/tenants/${tenantId}/agents`).then(r =>
      setAgentes(r.data.filter(a => a.ativo && a.id !== conversa.agenteId))
    ).catch(() => {});
  }, [tenantId, conversa.agenteId]);

  const transferir = async (agenteId) => {
    setLoading(true);
    try {
      await api.post(`/conversations/${conversa.id}/transfer`, { agenteId });
      onTransferred();
      onClose();
    } catch { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-80 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Transferir conversa</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        {agentes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhum agente disponível</p>
        ) : (
          <div className="space-y-1">
            {agentes.map(a => (
              <button key={a.id} onClick={() => transferir(a.id)} disabled={loading}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 rounded-xl transition-colors text-left">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                  {(a.nome || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{a.nome}</p>
                  <p className="text-xs text-gray-400 capitalize">{a.role}</p>
                </div>
              </button>
            ))}
          </div>
        )}
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
  const [showTransfer, setShowTransfer] = useState(false);
  const bottomRef = useRef(null);
  const msgAreaRef = useRef(null);
  const fileRef = useRef(null);
  const msgIdsRef = useRef(new Set());
  const inicialRef = useRef(false);
  const atBottomRef = useRef(true);
  const tocarNotificacao = useNotificationSound();

  const checkAtBottom = () => {
    const el = msgAreaRef.current;
    atBottomRef.current = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const carregarMsgs = () => {
    checkAtBottom();
    return api.get(`/conversations/${conversa.id}/messages`).then(r => {
      if (inicialRef.current) {
        const temNovaCliente = r.data.some(
          m => m.origem === 'cliente' && !msgIdsRef.current.has(m.id)
        );
        if (temNovaCliente) {
          tocarNotificacao();
          atBottomRef.current = true;
        }
      }
      msgIdsRef.current = new Set(r.data.map(m => m.id));
      inicialRef.current = true;
      setMsgs(r.data);
    });
  };

  useEffect(() => {
    setMsgs([]);
    inicialRef.current = false;
    msgIdsRef.current = new Set();
    atBottomRef.current = true;
    carregarMsgs();
    setAba('resposta');
  }, [conversa.id]);

  usePolling(carregarMsgs, 5000);

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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
      if (aba === 'nota') {
        await api.post(`/conversations/${conversa.id}/note`, { texto });
      } else {
        await api.post(`/conversations/${conversa.id}/send`, { texto });
      }
      setTexto('');
      carregarMsgs();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao enviar mensagem. Verifique o token do WhatsApp.');
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
    setTexto(applyVars(atalho.conteudo, conversa));
    setAba('resposta');
    setBuscaAtalho('');
  };

  const atalhosFiltrados = atalhosList.filter(a =>
    a.titulo.toLowerCase().includes(buscaAtalho.toLowerCase()) ||
    (a.atalho || '').toLowerCase().includes(buscaAtalho.toLowerCase())
  );

  const tabClass = (t) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      aba === t
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

  const isNota = aba === 'nota';

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-800">{conversa.clienteNome || conversa.clienteWhatsapp}</p>
            <p className="text-xs text-gray-400">{conversa.clienteWhatsapp}{conversa.clienteFilial ? ` · ${conversa.clienteFilial}` : ''}</p>
          </div>
          <div className="flex gap-2 items-center">
            {eHumano && (
              <button onClick={() => setShowTransfer(true)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <ArrowRightLeft className="w-3.5 h-3.5" /> Transferir
              </button>
            )}
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

        {/* Tags (só exibe se houver tags) */}
        {Array.isArray(conversa.tags) && conversa.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-gray-300 shrink-0" />
            <TagsBar conversa={conversa} onUpdate={onAtualizar} />
          </div>
        )}
      </div>

      {/* mensagens */}
      <div ref={msgAreaRef} className="flex-1 overflow-y-auto p-4">
        {msgs.map(m => <BolaoMsg key={m.id} msg={m} agenteNome={user?.nome} />)}
        <div ref={bottomRef} />
      </div>

      {/* área de input com tabs */}
      <div className="bg-white border-t border-gray-200">
        {eHumano && (
          <div className="flex border-b border-gray-100 px-3">
            <button className={tabClass('resposta')} onClick={() => setAba('resposta')}>Resposta</button>
            <button className={tabClass('nota')} onClick={() => setAba('nota')}>
              <span className="flex items-center gap-1"><StickyNote className="w-3 h-3" /> Nota</span>
            </button>
            <button className={tabClass('atalhos')} onClick={() => setAba('atalhos')}>Atalhos</button>
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
                  <button key={a.id} onClick={() => selecionarAtalho(a)}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      {a.atalho && (
                        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                          {a.atalho}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-700 truncate">{a.titulo}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{a.conteudo}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* input Resposta / Nota */}
        {(!eHumano || aba === 'resposta' || aba === 'nota') && (
          <form onSubmit={handleEnviar} className="p-3 flex gap-2 items-center">
            {!isNota && (
              <>
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
              </>
            )}
            <input
              type="text"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              disabled={!eHumano && !isNota}
              placeholder={
                isNota
                  ? 'Nota interna (só a equipe vê)...'
                  : eHumano ? 'Digite sua mensagem...' : 'Assuma a conversa para responder'
              }
              className={clsx(
                'flex-1 rounded-xl px-4 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 disabled:opacity-50',
                isNota
                  ? 'bg-yellow-50 text-yellow-900 focus:ring-yellow-300'
                  : 'bg-gray-100 text-gray-800 focus:ring-blue-400'
              )}
            />
            <button type="submit"
              disabled={(!eHumano && !isNota) || !texto.trim() || enviando}
              className={clsx(
                'disabled:opacity-40 text-white rounded-xl px-4 py-2 transition-colors shrink-0',
                isNota ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'
              )}>
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>

      {showTransfer && (
        <TransferModal
          conversa={conversa}
          tenantId={user?.tenantId}
          onClose={() => setShowTransfer(false)}
          onTransferred={() => { onAtualizar(); carregarMsgs(); }}
        />
      )}
    </div>
  );
}
