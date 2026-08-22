import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { LayoutDashboard, Building2, LogOut, CreditCard } from 'lucide-react';
import api from '../../lib/api.js';
import UpdateBanner from '../UpdateBanner.jsx';

export default function SuperAdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    logout();
    navigate('/login');
  };

  const navClass = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-gray-500 hover:text-white hover:bg-gray-800'
    }`;

  return (
    <div className="flex h-screen bg-gray-950">
      {/* sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <img src="/logoisp.png" alt="ISPDesk" className="h-14 w-14 rounded-2xl object-cover mb-1" />
          <div className="text-xs text-gray-500 mt-1">Super Admin</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <NavLink to="/admin/dashboard" className={navClass}>
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </NavLink>
          <NavLink to="/admin/tenants" className={navClass}>
            <Building2 className="w-4 h-4" />
            Provedores
          </NavLink>
          <NavLink to="/admin/cobrancas" className={navClass}>
            <CreditCard className="w-4 h-4" />
            Cobranças
          </NavLink>
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="px-3 py-1 mb-2">
            <p className="text-xs font-medium text-white truncate">{user?.nome}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* conteúdo */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <UpdateBanner />
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
