import { Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { HardHat, LogOut } from 'lucide-react';

// Casca do app de campo. Sem barra lateral, sem menu, sem navegação: o técnico
// está na rua, muitas vezes de pé e com uma mão só. A tela tem um assunto e é
// a fila dele.
export default function CampoLayout() {
  const { user, logout } = useAuth();

  // Limpar o localStorage não encerra a sessão: o cookie é HttpOnly e vive no
  // servidor. Sem esta chamada, "Sair" só apagava a tela — o celular
  // continuava autenticado, e num aparelho que a equipe compartilha isso é
  // sessão aberta na mão de quem pegar depois.
  const sair = async () => {
    await api.post('/auth/logout').catch(() => {});
    logout();
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between gap-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <HardHat className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {user?.nome || 'Técnico'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Chamados de campo</p>
          </div>
        </div>
        {/* 44px de alvo: dedo, no sol, dentro do carro. */}
        <button onClick={sair} title="Sair"
          className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors shrink-0">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Outlet />
      </main>
    </div>
  );
}
