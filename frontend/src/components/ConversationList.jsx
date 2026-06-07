import { useState, useEffect } from 'react';
import { differenceInMinutes } from 'date-fns';
import clsx from 'clsx';
import { Search, Check, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];

function avatarColor(nome) {
  let hash = 0;
  for (const c of (nome || '?')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function iniciais(nome) {
  const partes = (nome || '?').split(' ').filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return partes[0]?.[0]?.toUpperCase() || '?';
}

function tempoCompacto(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const VIEW_LABEL = {
  todos: 'Acontecendo agora',
  fila: 'Fila',
  mine: 'Meus atendimentos',
  historico: 'Histórico',
  filial: 'Filial',
};

const TAG_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-purple-100 text-purple-700',
  'bg-pink-100 text-pink-700',
  'bg-amber-100 text-amber-700',
  'bg-teal-100 text-teal-700',
];
function tagColor(tag) {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

const STORAGE_KEY = 'ispdesk_seen_msgs';
function getSeenMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function markSeen(conversaId) {
  const m = getSeenMap();
  m[conversaId] = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}
function hasUnread(conversa) {
  const m = getSeenMap();
  const seen = m[conversa.id];
  if (!seen) return false;
  const ultimaMsg = conversa.ultimaMsgEm ? new Date(conversa.ultimaMsgEm).getTime() : null;
  if (!ultimaMsg) return false;
  return ultimaMsg > seen && conversa.ultimaMsgOrigem === 'cliente';
}

function WaitTime({ iniciadaEm, status }) {
  const [mins, setMins] = useState(0);
  useEffect(() => {
    const update = () => setMins(differenceInMinutes(new Date(), new Date(iniciadaEm)));
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [iniciadaEm]);
  if (!['aguardando', 'aguardando_filial'].includes(status)) return null;
  const color = mins < 5 ? 'text-emerald-600' : mins < 15 ? 'text-amber-600' : 'text-red-600';
  const label = mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h${mins % 60 ? `${mins % 60}m` : ''}`;
  return <span className={`text-xs font-bold ${color}`}>{label}</span>;
}

function filtrar(conversas, view, filialId, userId, busca) {
  let lista = conversas;
  if (filialId) lista = lista.filter(c => c.filialId === filialId);
  else {
    switch (view) {
      case 'fila':      lista = lista.filter(c => c.status === 'aguardando' || c.status === 'aguardando_filial'); break;
      case 'mine':      lista = lista.filter(c => c.agenteId === userId && c.status !== 'encerrada'); break;
      case 'historico': lista = lista.filter(c => c.status === 'encerrada'); break;
      default:          lista = lista.filter(c => c.status !== 'encerrada');
    }
  }
  if (busca.trim()) {
    const q = busca.toLowerCase();
    lista = lista.filter(c =>
      (c.clienteNome || '').toLowerCase().includes(q) ||
      (c.clienteWhatsapp || '').includes(q)
    );
  }
  return lista;
}

function PreviewMsg({ c }) {
  const { ultimaMensagem, ultimaMsgOrigem, ultimaMsgNome } = c;
  if (!ultimaMensagem) {
    return <span className="text-gray-400 italic">Sem mensagens</span>;
  }
  if (ultimaMsgOrigem === 'agente' && ultimaMsgNome) {
    return (
      <span className="flex items-center gap-0.5 min-w-0">
        <Check className="w-3 h-3 text-blue-500 shrink-0" />
        <span className="text-blue-600 font-medium shrink-0">{ultimaMsgNome.split(' ')[0]}:</span>
        <span className="truncate">{ultimaMensagem}</span>
      </span>
    );
  }
  if (ultimaMsgOrigem === 'bot') {
    return <span className="truncate text-gray-400">{ultimaMensagem}</span>;
  }
  return <span className="truncate">{ultimaMensagem}</span>;
}

export default function ConversationList({ conversas, selecionada, onSelecionar, view = 'todos', filialId }) {
  const { user } = useAuth();
  const [busca, setBusca] = useState('');
  const filtrados = filtrar(conversas, view, filialId, user?.id, busca);

  const handleSelecionar = (c) => {
    markSeen(c.id);
    onSelecionar(c);
  };

  const isPendente = c => c.status === 'aguardando' || c.status === 'aguardando_filial';

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200" style={{ width: 296 }}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">{VIEW_LABEL[view] || 'Conversas'}</h2>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{filtrados.length}</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtrados.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhuma conversa</div>
        )}
        {filtrados.map(c => {
          const naoLida = hasUnread(c);
          const ativa = selecionada?.id === c.id;
          const tags = Array.isArray(c.tags) ? c.tags : [];
          const nomeExib = c.clienteNome && c.clienteNome !== c.clienteWhatsapp
            ? c.clienteNome
            : c.clienteWhatsapp;
          const tempoRef = c.ultimaMsgEm || c.iniciadaEm;

          return (
            <button key={c.id} onClick={() => handleSelecionar(c)}
              className={clsx(
                'w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors relative',
                ativa && 'bg-blue-50 border-l-[3px] border-l-blue-500',
                naoLida && !ativa && 'bg-amber-50/60',
              )}>

              {/* Avatar */}
              <div className="relative shrink-0 mt-0.5">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: avatarColor(nomeExib) }}
                >
                  {c.clienteNome && c.clienteNome !== c.clienteWhatsapp
                    ? iniciais(c.clienteNome)
                    : <User className="w-5 h-5 text-white" />
                  }
                </div>
                {/* Badge WhatsApp */}
                <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] bg-[#25D366] rounded-full border-2 border-white flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                </span>
                {naoLida && (
                  <span className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
                )}
              </div>

              {/* Conteúdo */}
              <div className="flex-1 min-w-0">
                {/* Linha 1: nome + tags + tempo */}
                <div className="flex items-center gap-1 mb-0.5">
                  <p className={clsx('text-sm truncate', naoLida ? 'font-bold text-gray-900' : 'font-semibold text-gray-800')}>
                    {nomeExib}
                  </p>
                  {tags.slice(0, 1).map(t => (
                    <span key={t} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', tagColor(t))}>
                      {t}
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-gray-400 shrink-0">{tempoCompacto(tempoRef)}</span>
                </div>

                {/* Linha 2: preview da última mensagem + badge pendente */}
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <div className="flex-1 min-w-0 truncate">
                    <PreviewMsg c={c} />
                  </div>
                  {isPendente(c) && (
                    <span className="shrink-0 bg-red-100 text-red-600 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                      Pendente
                    </span>
                  )}
                  {!isPendente(c) && ['aguardando', 'aguardando_filial'].includes(c.status) && null}
                </div>

                {/* Tempo de espera para fila */}
                <WaitTime iniciadaEm={c.iniciadaEm} status={c.status} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
