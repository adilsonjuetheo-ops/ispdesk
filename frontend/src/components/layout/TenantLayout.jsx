import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { usePolling } from '../../hooks/usePolling.js';
import { usePushNotifications } from '../../hooks/usePushNotifications.js';
import {
  LogOut, Wifi, BarChart2, Users, Settings,
  Activity, Clock, UserCheck, Archive, MapPin, MessageSquare, Zap, AlertTriangle, Star, X,
} from 'lucide-react';
import api from '../../lib/api.js';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];

function avatarColor(nome) {
  let hash = 0;
  for (const c of nome) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function TenantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [temIncidenteAtivo, setTemIncidenteAtivo] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [filiais, setFiliais] = useState([]);
  const [counts, setCounts] = useState({ todos: 0, mine: 0, fila: 0, porFilial: {} });
  const [online, setOnline] = useState([]);
  const [usoIa, setUsoIa] = useState(null);

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

  const subItem = (active, onClick, Icon, label, badge) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full pl-3 pr-2 py-1.5 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
      {badge > 0 && (
        <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
          {badge}
        </span>
      )}
    </button>
  );

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
    }`;

  const cor = tenant?.corPrimaria || '#0066CC';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed md:static inset-y-0 left-0 z-30 h-full
        w-72 md:w-56 bg-white border-r border-gray-200 flex flex-col select-none
        transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Botão fechar — mobile only */}
        <button onClick={() => setSidebarOpen(false)}
          className="absolute top-3 right-3 md:hidden p-1 text-gray-400 hover:text-gray-700 transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* logo / nome do provedor */}
        <div className="p-4 border-b border-gray-200">
          {tenant?.logoUrl ? (
            <div className="flex items-center gap-2">
              <img src={tenant.logoUrl} alt={tenant.nome}
                className="h-9 w-9 object-contain rounded-lg border border-gray-100 bg-gray-50 p-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate leading-tight">
                  {tenant.nomeFantasia || tenant.nome}
                </p>
                <p className="text-xs text-gray-400 truncate">Painel de atendimento</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="rounded-lg p-1.5 shrink-0" style={{ backgroundColor: cor }}>
                <Wifi className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate leading-tight">
                  {tenant?.nomeFantasia || tenant?.nome}
                </p>
                <p className="text-xs text-gray-400">Painel de atendimento</p>
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {/* Conversas */}
          <div className="mb-2">
            <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> Conversas
            </p>
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
              <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Filiais
              </p>
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

          {/* Admin */}
          {user?.role === 'admin' && (
            <div className="pt-2 mt-1 border-t border-gray-100 space-y-0.5">
              <NavLink to="/relatorio" className={navClass}>
                <BarChart2 className="w-4 h-4" /> Relatório
              </NavLink>
              <NavLink to="/nps" className={navClass}>
                <Star className="w-4 h-4" /> NPS
              </NavLink>
              <NavLink to="/agents" className={navClass}>
                <Users className="w-4 h-4" /> Equipe
              </NavLink>
              <NavLink to="/atalhos" className={navClass}>
                <Zap className="w-4 h-4" /> Atalhos
              </NavLink>
              <NavLink to="/incidentes" className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}>
                <AlertTriangle className="w-4 h-4" />
                <span className="flex-1">Incidentes</span>
                {temIncidenteAtivo && (
                  <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                )}
              </NavLink>
            </div>
          )}
        </nav>

        {usoIa && usoIa.percentual >= 80 && (
          <div className={`mx-2 mb-2 p-2.5 rounded-lg border text-xs ${
            usoIa.percentual >= 100
              ? 'bg-red-50 border-red-200 text-red-800'
              : usoIa.percentual >= 90
                ? 'bg-orange-50 border-orange-200 text-orange-800'
                : 'bg-yellow-50 border-yellow-200 text-yellow-800'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold">
                {usoIa.percentual >= 100 ? 'Limite de IA atingido' : `IA: ${usoIa.percentual}% utilizada`}
              </span>
            </div>
            <div className="w-full bg-white/60 rounded-full h-1.5 mb-1.5">
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

        <div className="p-3 border-t border-gray-200">
          {user?.role === 'admin' && (
            <NavLink to="/settings" className={navClass}>
              <Settings className="w-4 h-4" /> Configurações
            </NavLink>
          )}
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-gray-800 truncate">{user?.nome}</p>
            <p className="text-xs text-gray-500 truncate capitalize">{user?.role}</p>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
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
        <div className="flex-1 overflow-hidden">
          <Outlet context={{ online, currentUser: user, onOpenSidebar: () => setSidebarOpen(true) }} />
        </div>
      </main>
    </div>
  );
}
