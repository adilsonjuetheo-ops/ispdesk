import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { differenceInMinutes } from 'date-fns';
import clsx from 'clsx';
import { Search, Check, User, Menu, MapPin, Phone, PenSquare, Clock } from 'lucide-react';
import NovaConversaModal from './NovaConversaModal.jsx';
import AvatarAtendente from './AvatarAtendente.jsx';
import { useEquipe, indexarPorId } from '../hooks/useEquipe.js';
import { STATUS } from '../hooks/usePresencaStatus.js';
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

// "MARCOS VIEIRA DA SILVA SANTOS" não cabe na coluna e vira "MARCOS VIEI...",
// que não identifica ninguém. Primeiro e último nome cabem e identificam.
function nomeCurto(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return nome;
  const conectivos = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const ultimo = [...partes].reverse().find(p => !conectivos.has(p.toLowerCase())) || partes[partes.length - 1];
  return `${partes[0]} ${ultimo}`;
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
  todos: 'Em andamento',
  fila: 'Fila',
  mine: 'Meus atendimentos',
  historico: 'Histórico',
  filial: 'Filial',
};

const TAG_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
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
  // Este número convive com o horário da última mensagem, logo acima no mesmo
  // item. Sem rótulo os dois viravam "1h" e "1h26m" soltos, sem dizer qual era
  // qual — o chip diz o que está sendo contado.
  const tom = mins < 5 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : mins < 15 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
  const tempo = mins < 60
    ? `${mins}min`
    : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
  return (
    <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tom}`}>
      <Clock className="w-2.5 h-2.5 shrink-0" />
      {tempo} na fila
    </span>
  );
}

// Conversa com atendente cuja última mensagem é do cliente: alguém precisa
// responder. Com o bot não conta — ele responde sozinho —, e a fila já tem o
// próprio contador ("40min na fila").
function minutosSemResposta(c) {
  if (c.status !== 'humano' || c.ultimaMsgOrigem !== 'cliente' || !c.ultimaMsgEm) return null;
  return Math.max(0, differenceInMinutes(new Date(), new Date(c.ultimaMsgEm)));
}

// O tempo da linha vira o alerta: cinza quando ninguém espera resposta;
// verde, amarelo e vermelho conforme o cliente espera, na escala do SLA.
function TempoConversa({ c, tempoRef, limite }) {
  const mins = minutosSemResposta(c);
  if (mins === null) {
    return <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 shrink-0">{tempoCompacto(tempoRef)}</span>;
  }
  const lim = limite || 15;
  const tom = mins >= lim ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
    : mins >= 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  return (
    <span title="Tempo desde a última mensagem do cliente, sem resposta"
      className={`ml-auto shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tom}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {tempoCompacto(tempoRef)}
    </span>
  );
}

function filtrar(conversas, view, filialId, userId, busca) {
  let lista = conversas;
  if (filialId) {
    // Mesmo corte das outras visões e do contador da barra lateral, que já
    // ignora encerradas. Sem ele a filial listava conversas de dias atrás e
    // discordava do próprio badge — 3 no menu, 67 na lista.
    lista = lista.filter(c => c.filialId === filialId && c.status !== 'encerrada');
  } else {
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
    return <span className="text-gray-500 dark:text-gray-400 italic">Sem mensagens</span>;
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
    return <span className="truncate text-gray-500 dark:text-gray-400">{ultimaMensagem}</span>;
  }
  return <span className="truncate">{ultimaMensagem}</span>;
}

const SUB_TABS = [
  { key: 'todos', label: 'Em andamento', href: '/inbox' },
  { key: 'fila', label: 'Fila', href: '/inbox?view=fila' },
  { key: 'mine', label: 'Meus atendimentos', href: '/inbox?view=mine' },
  { key: 'historico', label: 'Histórico', href: '/inbox?view=historico' },
];

export default function ConversationList({ conversas, selecionada, onSelecionar, onConversaCriada, view = 'todos', filialId, online = [], currentUser, slaMinutos = 0, onOpenSidebar }) {
  // Foto do responsável na linha da conversa. Vem por id, que a lista já traz.
  const equipe = useEquipe();
  const equipePorId = useMemo(() => indexarPorId(equipe), [equipe]);
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

  return (
    <div className="flex flex-col h-full min-w-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 md:border-r-0 w-full md:w-[296px] md:rounded-2xl md:border md:border-gray-200 dark:md:border-gray-800 md:shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {onOpenSidebar && (
              <button onClick={onOpenSidebar} className="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 transition-colors">
                <Menu className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{VIEW_LABEL[view] || 'Conversas'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5">{filtrados.length}</span>
            <button
              onClick={() => setNovaConversa(true)}
              title="Nova conversa"
              className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-950 transition-colors"
            >
              <PenSquare className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10 transition">
          <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="flex-1 min-w-0 bg-transparent p-0 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none border-0 focus:ring-0"
          />
        </div>
      </div>

      {/* Abas de navegação — mobile only, substituem a barra lateral pra essas visões */}
      {!filialId && (
        <div className="md:hidden flex items-center gap-1.5 px-4 py-2 min-w-0 overflow-x-auto border-b border-gray-100 dark:border-gray-800 [scrollbar-width:none]">
          {SUB_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => navigate(t.href)}
              className={clsx(
                'shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-colors whitespace-nowrap',
                view === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-gray-50 md:bg-white dark:bg-gray-950 dark:md:bg-gray-900">
        {filtrados.length === 0 && (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">Nenhuma conversa</div>
        )}
        {filtrados.map(c => {
          const naoLida = hasUnread(c);
          const destaque = naoLida || minutosSemResposta(c) !== null;
          const ativa = selecionada?.id === c.id;
          const tags = Array.isArray(c.tags) ? c.tags : [];
          const temNome = c.clienteNome && c.clienteNome !== c.clienteWhatsapp;
          const nomeExib = temNome ? nomeCurto(c.clienteNome) : c.clienteWhatsapp;
          const tempoRef = c.ultimaMsgEm || c.iniciadaEm;

          const statusAberto = c.status !== 'encerrada';
          const avatarNode = (
            <div className="relative shrink-0 mt-0.5">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ backgroundColor: avatarColor(c.clienteNome || c.clienteWhatsapp) }}
              >
                {c.clienteNome && c.clienteNome !== c.clienteWhatsapp
                  ? iniciais(c.clienteNome)
                  : <User className="w-5 h-5 text-white" />
                }
              </div>
              {slaExcedido(c) && !ativa && (
                <span className="absolute -top-1 -left-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
              )}
              {naoLida && !slaExcedido(c) && (
                <span className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />
              )}
            </div>
          );

          return (
            <button key={c.id} onClick={() => handleSelecionar(c)}
              className={clsx(
                'w-full text-left relative transition-colors',
                ativa && 'bg-blue-50 dark:bg-blue-950 md:border-l-[3px] md:border-l-blue-500',
                !ativa && slaExcedido(c) && 'bg-red-50 dark:bg-red-950 md:border-l-[3px] md:border-l-red-500',
                naoLida && !ativa && !slaExcedido(c) && 'bg-amber-50/60 dark:bg-amber-950/40',
              )}>

              {/* ── Linha compacta (desktop) ── */}
              <div className="hidden md:flex items-start gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                {avatarNode}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <p title={c.clienteNome || undefined} className={clsx('text-sm truncate flex-1 min-w-0', destaque ? 'font-bold text-gray-900 dark:text-gray-50' : 'font-medium text-gray-700 dark:text-gray-200')}>
                      {nomeExib}
                    </p>
                    {tags.slice(0, 1).map(t => (
                      <span key={t} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', tagColor(t))}>
                        {t}
                      </span>
                    ))}
                    <TempoConversa c={c} tempoRef={tempoRef} limite={slaMinutos} />
                  </div>

                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex-1 min-w-0 truncate">
                      <PreviewMsg c={c} />
                    </div>
                  </div>

                  <WaitTime iniciadaEm={c.iniciadaEm} status={c.status} />

                  {(c.agenteNome || c.filialNome) && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate flex items-center gap-1">
                      {c.agenteId && equipePorId.get(c.agenteId) && (
                        <AvatarAtendente
                          id={c.agenteId}
                          nome={c.agenteNome}
                          fotoVersao={equipePorId.get(c.agenteId)?.fotoVersao}
                          tamanho={14}
                          cor={presenceColor(c.agenteNome)}
                        />
                      )}
                      <span className="truncate">{[c.agenteNome, c.filialNome].filter(Boolean).join(' › ')}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* ── Card (mobile) ── */}
              <div className="md:hidden mx-3 my-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-3.5">
                <div className="flex items-start gap-3">
                  {avatarNode}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p title={c.clienteNome || undefined} className={clsx('text-sm truncate flex-1 min-w-0', destaque ? 'font-bold text-gray-900 dark:text-gray-50' : 'font-medium text-gray-700 dark:text-gray-200')}>
                        {nomeExib}
                      </p>
                      {tags.slice(0, 1).map(t => (
                        <span key={t} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', tagColor(t))}>
                          {t}
                        </span>
                      ))}
                      <TempoConversa c={c} tempoRef={tempoRef} limite={slaMinutos} />
                    </div>

                    <p className={clsx('text-xs font-medium mt-0.5', statusAberto ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500')}>
                      {statusAberto ? 'Atendimento Aberto' : 'Atendimento Encerrado'}
                    </p>

                    {c.clienteWhatsapp && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.clienteWhatsapp}</span>
                      </div>
                    )}
                    {c.filialNome && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.filialNome}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex-1 min-w-0 truncate"><PreviewMsg c={c} /></div>
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
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Online agora</p>
          <div className="flex flex-wrap gap-1.5">
            {online.map(u => (
              <div key={u.id} className="relative group">
                <AvatarAtendente
                  id={u.id}
                  nome={u.nome}
                  fotoVersao={u.fotoVersao}
                  tamanho={28}
                  cor={presenceColor(u.nome)}
                  className={u.id === (currentUser?.id || user?.id) ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                />
                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                  (STATUS[u.status] || STATUS.disponivel).cor
                }`} />
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                  {u.nome}{u.id === (currentUser?.id || user?.id) ? ' (você)' : ''} · {(STATUS[u.status] || STATUS.disponivel).rotulo}
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
