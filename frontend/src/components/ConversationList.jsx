import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';
import { MapPin } from 'lucide-react';
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

function filtrar(conversas, view, filialId, userId) {
  if (filialId) return conversas.filter(c => c.filialId === filialId);
  switch (view) {
    case 'fila':      return conversas.filter(c => c.status === 'aguardando' || c.status === 'aguardando_filial');
    case 'mine':      return conversas.filter(c => c.agenteId === userId && c.status !== 'encerrada');
    case 'historico': return conversas.filter(c => c.status === 'encerrada');
    default:          return conversas.filter(c => c.status !== 'encerrada');
  }
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
  const filtrados = filtrar(conversas, view, filialId, user?.id);

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200" style={{ width: 280 }}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700">{VIEW_LABEL[view] || 'Conversas'}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{filtrados.length} conversa{filtrados.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtrados.length === 0 && (
          <div className="p-6 text-center text-gray-400 text-sm">Nenhuma conversa</div>
        )}
        {filtrados.map(c => (
          <button key={c.id} onClick={() => onSelecionar(c)}
            className={clsx('w-full text-left flex items-start gap-3 p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors', {
              'bg-blue-50 border-l-2 border-l-blue-500': selecionada?.id === c.id,
            })}>
            <Iniciais nome={c.clienteNome || c.clienteWhatsapp} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-sm font-medium text-gray-800 truncate">{c.clienteNome || c.clienteWhatsapp}</p>
                <span className="text-xs text-gray-400 shrink-0 ml-1">
                  {formatDistanceToNow(new Date(c.iniciadaEm), { locale: ptBR, addSuffix: true })}
                </span>
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
        ))}
      </div>
    </div>
  );
}
