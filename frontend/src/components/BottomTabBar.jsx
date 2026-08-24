import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, Clock, BarChart2, Users, Settings, UserCheck, Archive } from 'lucide-react';

function Tab({ Icon, label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative ${
        active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      <div className="relative">
        <Icon className="w-5 h-5" />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold px-1 rounded-full min-w-[15px] text-center leading-[15px]">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

export default function BottomTabBar({ isAdmin, counts = {} }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  const filial = params.get('filial');
  const naInbox = location.pathname === '/inbox';

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-stretch shadow-[0_-1px_6px_rgba(0,0,0,0.05)]">
      <Tab
        Icon={Activity}
        label="Conversas"
        active={naInbox && !view && !filial}
        badge={counts.todos}
        onClick={() => navigate('/inbox')}
      />
      <Tab
        Icon={Clock}
        label="Fila"
        active={naInbox && view === 'fila'}
        badge={counts.fila}
        onClick={() => navigate('/inbox?view=fila')}
      />
      {isAdmin ? (
        <>
          <Tab
            Icon={BarChart2}
            label="Relatórios"
            active={location.pathname === '/relatorio'}
            onClick={() => navigate('/relatorio')}
          />
          <Tab
            Icon={Users}
            label="Equipe"
            active={location.pathname === '/agents'}
            onClick={() => navigate('/agents')}
          />
          <Tab
            Icon={Settings}
            label="Configurações"
            active={location.pathname === '/settings'}
            onClick={() => navigate('/settings')}
          />
        </>
      ) : (
        <>
          <Tab
            Icon={UserCheck}
            label="Meus"
            active={naInbox && view === 'mine'}
            badge={counts.mine}
            onClick={() => navigate('/inbox?view=mine')}
          />
          <Tab
            Icon={Archive}
            label="Histórico"
            active={naInbox && view === 'historico'}
            onClick={() => navigate('/inbox?view=historico')}
          />
        </>
      )}
    </nav>
  );
}
