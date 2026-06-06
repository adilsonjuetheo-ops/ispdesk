import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { MessageSquare, Users, Settings, LogOut, Wifi, BarChart2 } from 'lucide-react';
import api from '../../lib/api.js';

export default function TenantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    api.get('/tenants/me').then(r => setTenant(r.data)).catch(() => {});
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 text-blue-700'
        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
    }`;

  const cor = tenant?.corPrimaria || '#0066CC';

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-52 bg-white border-r border-gray-200 flex flex-col">
        {/* logo / nome do provedor */}
        <div className="p-4 border-b border-gray-200">
          {tenant?.logoUrl ? (
            <div className="flex items-center gap-2">
              <img
                src={tenant.logoUrl}
                alt={tenant.nome}
                className="h-9 w-9 object-contain rounded-lg border border-gray-100 bg-gray-50 p-0.5"
              />
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
                  {tenant?.nomeFantasia || tenant?.nome || 'ISPDesk'}
                </p>
                <p className="text-xs text-gray-400">Painel de atendimento</p>
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <NavLink to="/inbox" className={navClass}>
            <MessageSquare className="w-4 h-4" />
            Atendimento
          </NavLink>
          {user?.role === 'admin' && (
            <>
              <NavLink to="/agents" className={navClass}>
                <Users className="w-4 h-4" />
                Equipe
              </NavLink>
              <NavLink to="/relatorio" className={navClass}>
                <BarChart2 className="w-4 h-4" />
                Relatório
              </NavLink>
              <NavLink to="/settings" className={navClass}>
                <Settings className="w-4 h-4" />
                Configurações
              </NavLink>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <div className="px-3 py-1 mb-2">
            <p className="text-xs font-medium text-gray-800 truncate">{user?.nome}</p>
            <p className="text-xs text-gray-500 truncate capitalize">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
