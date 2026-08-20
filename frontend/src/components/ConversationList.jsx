import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { differenceInMinutes } from 'date-fns';
import clsx from 'clsx';
import { Search, Check, User, Menu, MapPin, Phone, PenSquare } from 'lucide-react';
import NovaConversaModal from './NovaConversaModal.jsx';
import { useAuth } from '../hooks/useAuth.js';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];

function presenceColor(nome) {
  let hash = 0;
  for (const c of (nome || '?')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

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

// Tons suaves de propósito: a tag identifica o assunto, não pede ação, então
// não pode competir com o vermelho de SLA nem com a cor da marca.
const TAG_COLORS = [
  'bg-indigo-50 text-indigo-700',
  'bg-purple-50 text-purple-700',
  'bg-pink-50 text-pink-700',
  'bg-teal-50 text-teal-700',
  'bg-sky-50 text-sky-700',
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
  const color = mins < 5 ? 'text-ok-600' : mins < 15 ? 'text-atencao-600' : 'text-critico-600';
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
        <Check className="w-3 h-3 text-brand-600 shrink-0" />
        <span className="text-brand-700 font-medium shrink-0">{ultimaMsgNome.split(' ')[0]}:</span>
        <span className="truncate">{ultimaMensagem}</span>
      </span>
    );
  }
  if (ultimaMsgOrigem === 'bot') {
    return <span className="truncate text-gray-400">{ultimaMensagem}</span>;
  }
  return <span className="truncate">{ultimaMensagem}</span>;
}

const SUB_TABS = [
  { key: 'todos', label: 'Acontecendo agora', href: '/inbox' },
  { key: 'fila', label: 'Fila', href: '/inbox?view=fila' },
  { key: 'mine', label: 'Meus atendimentos', href: '/inbox?view=mine' },
  { key: 'historico', label: 'Histórico', href: '/inbox?view=historico' },
];

export default function ConversationList({ conversas, selecionada, onSelecionar, onConversaCriada, view = 'todos', filialId, online = [], currentUser, slaMinutos = 0, onOpenSidebar }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [novaConversa, setNovaConversa] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Vindo de Contatos > Iniciar conversa: abre o modal já com o número
  const telefoneNovo = searchParams.get('novo') || '';
  useEffect(() => {
    if (telefoneNovo) setNovaConversa(true);
  }, [telefoneNovo]);

  const fecharNovaConversa = () => {
    setNovaConversa(false);
    if (telefoneNovo) {
      const p = new URLSearchParams(searchParams);
      p.delete('novo');
      setSearchParams(p, { replace: true });
    }
  };
  const filtrados = filtrar(conversas, view, filialId, user?.id, busca);

  const slaExcedido = (c) => {
    if (!slaMinutos || !c.iniciadaEm) return false;
    if (c.status !== 'aguardando' && c.status !== 'aguardando_filial') return false;
    return differenceInMinutes(new Date(), new Date(c.iniciadaEm)) >= slaMinutos;
  };

  const handleSelecionar = (c) => {
    markSeen(c.id);
    onSelecionar(c);
  };

  const isPendente = c => c.status === 'aguardando' || c.status === 'aguardando_filial';

  return (
    <div className="flex flex-col h-full min-w-0 bg-white border-r border-gray-200 w-full md:w-[296px]">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {onOpenSidebar && (
              <button onClick={onOpenSidebar} className="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors">
                <Menu className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-sm font-semibold text-gray-800">{VIEW_LABEL[view] || 'Conversas'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{filtrados.length}</span>
            <button
              onClick={() => setNovaConversa(true)}
              title="Nova conversa"
              className="p-1.5 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            >
              <PenSquare className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-0"
          />
        </div>
      </div>

      {/* Abas de navegação — mobile only, substituem a barra lateral pra essas visões */}
      {!filialId && (
        <div className="md:hidden flex items-center gap-1.5 px-4 py-2 min-w-0 overflow-x-auto border-b border-gray-100 [scrollbar-width:none]">
          {SUB_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => navigate(t.href)}
              className={clsx(
                'shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors whitespace-nowrap',
                view === t.key ? 'bg-brand-600 text-brand-contraste' : 'bg-gray-100 text-gray-500'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-gray-50 md:bg-white">
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

          const statusAberto = c.status !== 'encerrada';
          const avatarNode = (
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
              <span className="absolute -bottom-1.5 -right-1.5 w-[28px] h-[20px] bg-whatsapp rounded-[7px] border-2 border-white flex items-center justify-center shadow">
                <svg className="w-3.5 h-3.5 fill-white" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                </svg>
              </span>
              {slaExcedido(c) && !ativa && (
                <span className="absolute -top-1 -left-1 w-3 h-3 bg-critico-500 rounded-full border-2 border-white animate-pulse" />
              )}
              {naoLida && !slaExcedido(c) && (
                <span className="absolute -top-1 -left-1 w-3 h-3 bg-atencao-500 rounded-full border-2 border-white" />
              )}
            </div>
          );

          return (
            <button key={c.id} onClick={() => handleSelecionar(c)}
              className={clsx(
                'w-full text-left relative transition-colors',
                ativa && 'bg-brand-50 md:border-l-[3px] md:border-l-brand-600',
                !ativa && slaExcedido(c) && 'bg-critico-50 md:border-l-[3px] md:border-l-critico-500',
                naoLida && !ativa && !slaExcedido(c) && 'bg-atencao-50/60',
              )}>

              {/* ── Linha compacta (desktop) ── */}
              <div className="hidden md:flex items-start gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
                {avatarNode}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <p className={clsx('text-sm truncate flex-1 min-w-0', naoLida ? 'font-bold text-gray-900' : 'font-semibold text-gray-800')}>
                      {nomeExib}
                    </p>
                    {tags.slice(0, 1).map(t => (
                      <span key={t} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', tagColor(t))}>
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{tempoCompacto(tempoRef)}</span>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <div className="flex-1 min-w-0 truncate">
                      <PreviewMsg c={c} />
                    </div>
                    {isPendente(c) && (
                      <span className="shrink-0 bg-critico-100 text-critico-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                        Pendente
                      </span>
                    )}
                  </div>

                  <WaitTime iniciadaEm={c.iniciadaEm} status={c.status} />

                  {(c.agenteNome || c.filialNome) && (
                    <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                      {[c.agenteNome, c.filialNome].filter(Boolean).join(' › ')}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Card (mobile) ── */}
              <div className="md:hidden mx-3 my-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5">
                <div className="flex items-start gap-3">
                  {avatarNode}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={clsx('text-sm truncate flex-1 min-w-0', naoLida ? 'font-bold text-gray-900' : 'font-semibold text-gray-800')}>
                        {nomeExib}
                      </p>
                      {tags.slice(0, 1).map(t => (
                        <span key={t} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', tagColor(t))}>
                          {t}
                        </span>
                      ))}
                      <span className="ml-auto text-xs text-gray-400 shrink-0">{tempoCompacto(tempoRef)}</span>
                    </div>

                    <p className={clsx('text-xs font-medium mt-0.5', statusAberto ? 'text-ok-600' : 'text-gray-400')}>
                      {statusAberto ? 'Atendimento Aberto' : 'Atendimento Encerrado'}
                    </p>

                    {c.clienteWhatsapp && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.clienteWhatsapp}</span>
                      </div>
                    )}
                    {c.filialNome && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.filialNome}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1.5 pt-1.5 border-t border-gray-100">
                      <div className="flex-1 min-w-0 truncate"><PreviewMsg c={c} /></div>
                      {isPendente(c) && (
                        <span className="shrink-0 bg-critico-100 text-critico-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                          Pendente
                        </span>
                      )}
                    </div>
                    <WaitTime iniciadaEm={c.iniciadaEm} status={c.status} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Presença: Online agora */}
      {online.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 bg-white">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Online agora</p>
          <div className="flex flex-wrap gap-1.5">
            {online.map(u => (
              <div key={u.id} className="relative group">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                    u.id === (currentUser?.id || user?.id) ? 'ring-2 ring-offset-1 ring-brand-400' : ''
                  }`}
                  style={{ backgroundColor: presenceColor(u.nome) }}
                >
                  {u.nome[0].toUpperCase()}
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-ok-500 rounded-full border-2 border-white" />
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                  {u.nome}{u.id === (currentUser?.id || user?.id) ? ' (você)' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {novaConversa && (
        <NovaConversaModal
          telefoneInicial={telefoneNovo}
          onClose={fecharNovaConversa}
          onCriada={id => onConversaCriada?.(id)}
        />
      )}
    </div>
  );
}
