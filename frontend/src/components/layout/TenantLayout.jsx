import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import {
  LogOut, Wifi, BarChart2, Users, Settings,
  Activity, Clock, UserCheck, Archive, MapPin, MessageSquare, Zap,
} from 'lucide-react';
import api from '../../lib/api.js';

export default function TenantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tenant, setTenant] = useState(null);
  const [filiais, setFiliais] = useState([]);
  const [counts, setCounts] = useState({ todos: 0, mine: 0, fila: 0 });

  useEffect(() => {
    api.get('/tenants/me').then(r => setTenant(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/filiais`).then(r => setFiliais(r.data)).catch(() => {});
  }, [user?.tenantId]);

  useEffect(() => {
    const fetchCounts = () => {
      api.get('/conversations/counts').then(r => setCounts(r.data)).catch(() => {});
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 10000);
    return () => clearInterval(id);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

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
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col select-none">
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
                {filiais.map(f =>
                  subItem(
                    isFilialActive(f.id),
                    () => navigate(`/inbox?filial=${f.id}`),
                    MapPin,
                    f.nome,
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
              <NavLink to="/agents" className={navClass}>
                <Users className="w-4 h-4" /> Equipe
              </NavLink>
              <NavLink to="/atalhos" className={navClass}>
                <Zap className="w-4 h-4" /> Atalhos
              </NavLink>
            </div>
          )}
        </nav>

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

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
