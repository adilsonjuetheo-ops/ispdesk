import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { usePolling } from '../../hooks/usePolling.js';
import { usePushNotifications } from '../../hooks/usePushNotifications.js';
import { useTheme } from '../../hooks/useTheme.js';
import {
  LogOut, Wifi, BarChart2, Users, Settings,
  Activity, Clock, UserCheck, Archive, MapPin, Zap, AlertTriangle, Star, X, BookUser,
  PanelLeftClose, PanelLeftOpen, BellRing, Sun, Moon } from 'lucide-react';
import api from '../../lib/api.js';
import UpdateBanner from '../UpdateBanner.jsx';
import BottomTabBar from '../BottomTabBar.jsx';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];

// Preferência de layout do operador, guardada no navegador: é ajuste de tela,
// não dado de conta.
const PREF_MENU = 'ispdesk_menu_recolhido';
function lerMenuRecolhido() {
  try { return localStorage.getItem(PREF_MENU) === '1'; } catch { return false; }
}

// Tratamento único dos ícones da barra lateral. Conviviam três tamanhos ali
// (12, 14 e 16px) vindos de trechos de código diferentes, sem que a diferença
// quisesse dizer nada. Fica como variante de filho para o tamanho e o traço
// serem definidos uma vez, e não repetidos em cada ícone.
const ICONE = '[&>svg]:w-4 [&>svg]:h-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75] [&>svg]:transition-colors';
// O ícone sai um tom mais claro que o rótulo: a palavra lidera, o ícone apoia.
// Antes os dois usavam exatamente a mesma cor e competiam entre si.
const ICONE_APAGADO = '[&>svg]:text-gray-400 hover:[&>svg]:text-gray-600 dark:[&>svg]:text-gray-500 dark:hover:[&>svg]:text-gray-300';

function avatarColor(nome) {
  let hash = 0;
  for (const c of nome) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function TenantLayout() {
  const { user, logout } = useAuth();
  const { escuro, alternar } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recolhido, setRecolhido] = useState(lerMenuRecolhido);
  const [temIncidenteAtivo, setTemIncidenteAtivo] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [filiais, setFiliais] = useState([]);
  const [counts, setCounts] = useState({ todos: 0, mine: 0, fila: 0, porFilial: {} });
  const [lembretes, setLembretes] = useState({ abertos: 0, vencidos: 0 });
  const [online, setOnline] = useState([]);
  const [usoIa, setUsoIa] = useState(null);
  const [chatMobileAberto, setChatMobileAberto] = useState(false);

  // Recarrega tenant periodicamente para detectar suspensão
  usePolling(() => {
    api.get('/tenants/me').then(r => setTenant(r.data)).catch(() => {});
  }, 300000);

  usePolling(() => {
    api.get('/tenants/me/uso-ia').then(r => setUsoIa(r.data)).catch(() => {});
  }, 60000, user?.role === 'admin');

  usePolling(() => {
    api.get('/incidentes/ativo').then(r => setTemIncidenteAtivo(!!r.data)).catch(() => {});
  }, 30000, user?.role === 'admin');

  const fetchFiliais = () => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/filiais`)
      .then(r => setFiliais(r.data))
      .catch(() => {});
  };
  usePolling(fetchFiliais, 30000, !!user?.tenantId);

  useEffect(() => {
    window.addEventListener('ispdesk:filiais-updated', fetchFiliais);
    return () => window.removeEventListener('ispdesk:filiais-updated', fetchFiliais);
  }, [user?.tenantId]);

  usePolling(() => {
    api.get('/conversations/counts').then(r => setCounts(r.data)).catch(() => {});
  }, 15000);

  const buscarLembretes = () => {
    api.get('/lembretes/contagem').then(r => setLembretes(r.data)).catch(() => {});
  };
  usePolling(buscarLembretes, 60000);
  // Concluir um lembrete atualiza o contador na hora, sem esperar o ciclo.
  useEffect(() => {
    window.addEventListener('ispdesk:lembretes-updated', buscarLembretes);
    return () => window.removeEventListener('ispdesk:lembretes-updated', buscarLembretes);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const ping = () => api.post('/presence/ping').catch(() => {});
    const fetchOnline = () =>
      api.get('/presence').then(r => setOnline(r.data)).catch(() => {});

    ping();
    fetchOnline();

    const pingId = setInterval(ping, 30000);
    const pollId = setInterval(fetchOnline, 15000);

    return () => { clearInterval(pingId); clearInterval(pollId); };
  }, [user?.id]);

  // Fecha sidebar ao navegar no mobile
  useEffect(() => { setSidebarOpen(false); }, [location.pathname, location.search]);

  usePushNotifications(!!user?.tenantId);
  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    logout();
    navigate('/login');
  };

  const params = new URLSearchParams(location.search);
  const currentView = params.get('view');
  const currentFilial = params.get('filial');
  const isInbox = location.pathname === '/inbox';

  const isView = v => isInbox && currentView === v && !currentFilial;
  const isTodos = isInbox && !currentView && !currentFilial;
  const isFilialActive = id => isInbox && currentFilial === id;

  // No celular a barra é uma gaveta que abre por cima; recolher ali não faz
  // sentido, então o modo ícone só vale quando ela está fixa no desktop.
  const colapsado = recolhido && !sidebarOpen;

  const alternarRecolhido = () => setRecolhido(v => {
    try { localStorage.setItem(PREF_MENU, v ? '0' : '1'); } catch { /* modo privado */ }
    return !v;
  });

  const subItem = (active, onClick, Icon, label, badge) => (
    <button
      onClick={onClick}
      title={colapsado ? label : undefined}
      className={`relative flex items-center gap-2.5 w-full py-1.5 rounded-lg text-sm transition-colors ${ICONE} ${
        colapsado ? 'justify-center px-0' : 'pl-3 pr-2'
      } ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium [&>svg]:text-blue-600 dark:bg-blue-950 dark:text-blue-300 dark:[&>svg]:text-blue-400'
          : `text-gray-500 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 ${ICONE_APAGADO}`
      }`}
    >
      <Icon />
      {!colapsado && <span className="flex-1 text-left truncate">{label}</span>}
      {badge > 0 && (colapsado ? (
        <span className="absolute top-0.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full" />
      ) : (
        <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
          {badge}
        </span>
      ))}
    </button>
  );

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${ICONE} ${
      colapsado ? 'justify-center px-0' : 'px-3'
    } ${
      isActive
        ? 'bg-blue-50 text-blue-700 [&>svg]:text-blue-600 dark:bg-blue-950 dark:text-blue-300 dark:[&>svg]:text-blue-400'
        : `text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 ${ICONE_APAGADO}`
    }`;

  const cor = tenant?.corPrimaria || '#0066CC';

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden md:p-3 md:gap-3">

      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed md:static inset-y-0 left-0 z-30 h-full
        w-72 ${colapsado ? 'md:w-14' : 'md:w-56'} bg-white dark:bg-gray-900 flex flex-col select-none
        border-r border-gray-200 dark:border-gray-800 md:border md:rounded-2xl md:shadow-sm md:overflow-hidden
        transition-all duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Botão fechar — mobile only */}
        <button onClick={() => setSidebarOpen(false)}
          className="absolute top-3 right-3 md:hidden p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* logo / nome do provedor */}
        <div className={`border-b border-gray-200 dark:border-gray-800 ${colapsado ? 'p-2' : 'p-4'}`}>
          {tenant?.logoUrl ? (
            <div className="flex items-center gap-2">
              <img src={tenant.logoUrl} alt={tenant.nome}
                className="h-9 w-9 object-contain rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-0.5" />
              <div className={`min-w-0 ${colapsado ? 'hidden' : ''}`}>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate leading-tight">
                  {tenant.nomeFantasia || tenant.nome}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Painel de atendimento</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="rounded-lg p-1.5 shrink-0" style={{ backgroundColor: cor }}>
                <Wifi className="w-4 h-4 text-white" />
              </div>
              <div className={`min-w-0 ${colapsado ? 'hidden' : ''}`}>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate leading-tight">
                  {tenant?.nomeFantasia || tenant?.nome}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Painel de atendimento</p>
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {/* Conversas */}
          <div className="mb-2">
            {!colapsado && (
              <p className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Conversas
              </p>
            )}
            <div className="space-y-0.5">
              {subItem(isTodos, () => navigate('/inbox'), Activity, 'Acontecendo agora', counts.todos)}
              {subItem(isView('fila'), () => navigate('/inbox?view=fila'), Clock, 'Fila', counts.fila)}
              {subItem(isView('mine'), () => navigate('/inbox?view=mine'), UserCheck, 'Meus atendimentos', counts.mine)}
              {subItem(isView('historico'), () => navigate('/inbox?view=historico'), Archive, 'Histórico')}
            </div>
          </div>

          {/* Filiais */}
          {filiais.length > 0 && (
            <div className="mb-2">
              {!colapsado && (
                <p className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                  Filiais
                </p>
              )}
              <div className="space-y-0.5">
                {filiais.filter(f => f.ativo).map(f =>
                  subItem(
                    isFilialActive(f.id),
                    () => navigate(`/inbox?filial=${f.id}`),
                    MapPin,
                    f.nome,
                    counts.porFilial?.[f.id] || 0,
                  )
                )}
              </div>
            </div>
          )}

          {/* Separado das filiais de propósito: sem a divisória o item lia como
              se fosse mais uma unidade da lista acima. */}
          <div className="pt-2 mt-1 border-t border-gray-100 dark:border-gray-800 space-y-0.5">
            {/* Vencido pinta de vermelho: um contador azul de tarefa atrasada não
                comunica atraso nenhum. */}
            <NavLink to="/lembretes" title={colapsado ? 'Lembretes' : undefined}
              className={props => `${navClass(props)} relative`}>
              <BellRing />
              {!colapsado && <span className="flex-1">Lembretes</span>}
              {lembretes.abertos > 0 && (colapsado ? (
                <span className={`absolute top-0.5 right-1.5 w-2 h-2 rounded-full ${
                  lembretes.vencidos > 0 ? 'bg-red-500' : 'bg-blue-600'}`} />
              ) : (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none text-white ${
                  lembretes.vencidos > 0 ? 'bg-red-500' : 'bg-blue-600'}`}>
                  {lembretes.abertos}
                </span>
              ))}
            </NavLink>
            <NavLink to="/contatos" className={navClass} title={colapsado ? 'Contatos' : undefined}>
              <BookUser /> {!colapsado && 'Contatos'}
            </NavLink>
          </div>

          {/* Admin */}
          {user?.role === 'admin' && (
            <div className="pt-2 mt-1 border-t border-gray-100 dark:border-gray-800 space-y-0.5">
              <NavLink to="/relatorio" className={navClass} title={colapsado ? 'Relatório' : undefined}>
                <BarChart2 /> {!colapsado && 'Relatório'}
              </NavLink>
              <NavLink to="/nps" className={navClass} title={colapsado ? 'NPS' : undefined}>
                <Star /> {!colapsado && 'NPS'}
              </NavLink>
              <NavLink to="/agents" className={navClass} title={colapsado ? 'Equipe' : undefined}>
                <Users /> {!colapsado && 'Equipe'}
              </NavLink>
              <NavLink to="/atalhos" className={navClass} title={colapsado ? 'Atalhos' : undefined}>
                <Zap /> {!colapsado && 'Atalhos'}
              </NavLink>
              <NavLink to="/incidentes" title={colapsado ? 'Incidentes' : undefined} className={({ isActive }) =>
                `flex items-center gap-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${ICONE} ${
                  colapsado ? 'justify-center px-0' : 'px-3'
                } ${
                  isActive
                    ? 'bg-red-50 text-red-700 [&>svg]:text-red-600 dark:bg-red-950 dark:text-red-300 dark:[&>svg]:text-red-400'
                    : `text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 ${ICONE_APAGADO}`
                }`}>
                <AlertTriangle />
                {!colapsado && <span className="flex-1">Incidentes</span>}
                {temIncidenteAtivo && (
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                )}
              </NavLink>
            </div>
          )}
        </nav>

        {usoIa && usoIa.percentual >= 80 && !colapsado && (
          <div className={`mx-2 mb-2 p-2.5 rounded-lg border text-xs ${
            usoIa.percentual >= 100
              ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-900 dark:text-red-300'
              : usoIa.percentual >= 90
                ? 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950 dark:border-orange-900 dark:text-orange-300'
                : 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-900 dark:text-yellow-300'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold">
                {usoIa.percentual >= 100 ? 'Limite de IA atingido' : `IA: ${usoIa.percentual}% utilizada`}
              </span>
            </div>
            <div className="w-full bg-white/60 dark:bg-black/30 rounded-full h-1.5 mb-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  usoIa.percentual >= 100 ? 'bg-red-500' : usoIa.percentual >= 90 ? 'bg-orange-500' : 'bg-yellow-500'
                }`}
                style={{ width: `${Math.min(usoIa.percentual, 100)}%` }}
              />
            </div>
            <p className="leading-tight mb-1.5">
              {usoIa.contagem.toLocaleString('pt-BR')}/{usoIa.limite.toLocaleString('pt-BR')} atendimentos
              {usoIa.percentual >= 100 && ' — bot pausado'}
            </p>
            <p className="leading-tight font-medium">
              Upgrade: Plano Pro 10.000 atend. R$249,90/mês ou R$0,03/excedente
            </p>
          </div>
        )}

        <div className={`border-t border-gray-200 dark:border-gray-800 ${colapsado ? 'p-2' : 'p-3'}`}>
          {/* Tema, recolher etc. são preferência de tela, não navegação — por
              isso moram aqui embaixo, junto com sair e configurações. */}
          <button onClick={alternar}
            title={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
            aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
            className={`flex items-center gap-2.5 w-full py-2 rounded-lg text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors ${ICONE} ${ICONE_APAGADO} ${
              colapsado ? 'justify-center px-0' : 'px-3'
            }`}>
            {escuro ? <Sun /> : <Moon />}
            {!colapsado && (escuro ? 'Tema claro' : 'Tema escuro')}
          </button>

          <button onClick={alternarRecolhido}
            title={colapsado ? 'Expandir menu' : 'Recolher menu'}
            aria-label={colapsado ? 'Expandir menu' : 'Recolher menu'}
            className={`hidden md:flex items-center gap-2.5 w-full py-2 rounded-lg text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors ${ICONE} ${ICONE_APAGADO} ${
              colapsado ? 'justify-center px-0' : 'px-3'
            }`}>
            {colapsado ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!colapsado && 'Recolher menu'}
          </button>

          {user?.role === 'admin' && (
            <NavLink to="/settings" className={navClass} title={colapsado ? 'Configurações' : undefined}>
              <Settings /> {!colapsado && 'Configurações'}
            </NavLink>
          )}
          {!colapsado && (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{user?.nome}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize">{user?.role}</p>
            </div>
          )}
          <button onClick={handleLogout}
            title={colapsado ? 'Sair' : undefined}
            className={`flex items-center gap-2.5 w-full py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-950 rounded-lg transition-colors ${ICONE} [&>svg]:text-gray-500 hover:[&>svg]:text-red-600 dark:[&>svg]:text-gray-400 dark:hover:[&>svg]:text-red-400 ${
              colapsado ? 'justify-center px-0' : 'px-3'
            }`}>
            <LogOut /> {!colapsado && 'Sair'}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden flex flex-col md:gap-3">
        {/* Todo mundo roda o mesmo build — restringir a admin deixava agente
            preso em código antigo sem nunca ser avisado pra recarregar. */}
        <UpdateBanner />
        {tenant?.statusPagamento === 'suspenso' && user?.role === 'admin' && (
          <div className="bg-red-900/80 border-b border-red-700 px-4 py-2.5 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
            <p className="text-red-200 text-sm">
              <strong>Conta suspensa por inadimplência.</strong> O bot de atendimento está pausado. Entre em contato com o suporte ISPDesk para regularizar.
            </p>
          </div>
        )}
        {tenant?.statusPagamento === 'pendente' && user?.role === 'admin' && (
          <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-2 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <p className="text-amber-200 text-xs">
              Pagamento PIX pendente — vencimento em {tenant.proximoVencimento ? new Date(tenant.proximoVencimento).toLocaleDateString('pt-BR') : '—'}. Verifique seu WhatsApp.
            </p>
          </div>
        )}
        <div className={`flex-1 overflow-hidden ${!chatMobileAberto ? 'pb-14 md:pb-0' : ''}`}>
          <Outlet context={{
            online,
            currentUser: user,
            onOpenSidebar: () => setSidebarOpen(true),
            onChatMobileChange: setChatMobileAberto,
          }} />
        </div>
      </main>

      {!chatMobileAberto && (
        <BottomTabBar isAdmin={user?.role === 'admin'} counts={counts} />
      )}
    </div>
  );
}
