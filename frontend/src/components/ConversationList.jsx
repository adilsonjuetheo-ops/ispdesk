import { useState, useEffect, useRef } from 'react';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';
import { MapPin, Search } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

const STATUS_BADGE = {
  bot: 'bg-emerald-100 text-emerald-800',
  aguardando: 'bg-amber-100 text-amber-800',
  aguardando_filial: 'bg-purple-100 text-purple-800',
  humano: 'bg-blue-100 text-blue-800',
  encerrada: 'bg-gray-100 text-gray-600',
};
const STATUS_LABEL = {
  bot: 'Bot',
  aguardando: 'Aguardando',
  aguardando_filial: 'Sel. cidade',
  humano: 'Humano',
  encerrada: 'Encerrada',
};

const VIEW_LABEL = {
  todos: 'Acontecendo agora',
  fila: 'Fila',
  mine: 'Meus atendimentos',
  historico: 'Histórico',
  filial: 'Filial',
};

// Badge de não lidas: usa localStorage para guardar quando cada conversa foi vista
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
  return <span className={`text-xs font-semibold ${color}`}>{label}</span>;
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

function Iniciais({ nome }) {
  const partes = (nome || '?').split(' ');
  const ini = partes.length >= 2 ? partes[0][0] + partes[1][0] : partes[0][0];
  return (
    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold text-sm shrink-0">
      {ini.toUpperCase()}
    </div>
  );
}

export default function ConversationList({ conversas, selecionada, onSelecionar, view = 'todos', filialId }) {
  const { user } = useAuth();
  const [busca, setBusca] = useState('');
  const filtrados = filtrar(conversas, view, filialId, user?.id, busca);

  const handleSelecionar = (c) => {
    markSeen(c.id);
    onSelecionar(c);
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200" style={{ width: 280 }}>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">{VIEW_LABEL[view] || 'Conversas'}</h2>
          <span className="text-xs text-gray-400">{filtrados.length}</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtrados.length === 0 && (
          <div className="p-6 text-center text-gray-400 text-sm">Nenhuma conversa</div>
        )}
        {filtrados.map(c => {
          const naoLida = hasUnread(c);
          return (
            <button key={c.id} onClick={() => handleSelecionar(c)}
              className={clsx('w-full text-left flex items-start gap-3 p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors', {
                'bg-blue-50 border-l-2 border-l-blue-500': selecionada?.id === c.id,
                'bg-amber-50': naoLida && selecionada?.id !== c.id,
              })}>
              <div className="relative shrink-0">
                <Iniciais nome={c.clienteNome || c.clienteWhatsapp} />
                {naoLida && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className={clsx('text-sm truncate', naoLida ? 'font-bold text-gray-900' : 'font-medium text-gray-800')}>
                    {c.clienteNome || c.clienteWhatsapp}
                  </p>
                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <WaitTime iniciadaEm={c.iniciadaEm} status={c.status} />
                    {!['aguardando', 'aguardando_filial'].includes(c.status) && (
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(c.iniciadaEm), { locale: ptBR, addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
                {c.filialNome && (
                  <p className="text-xs text-indigo-600 font-medium flex items-center gap-0.5 truncate">
                    <MapPin className="w-3 h-3 shrink-0" />{c.filialNome}
                  </p>
                )}
                {!c.filialNome && c.clienteFilial && (
                  <p className="text-xs text-gray-400 truncate">{c.clienteFilial}</p>
                )}
                <span className={clsx('inline-block text-xs px-1.5 py-0.5 rounded-full mt-1', STATUS_BADGE[c.status] || STATUS_BADGE.bot)}>
                  {STATUS_LABEL[c.status] || c.status}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
