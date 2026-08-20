import { RefreshCw } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate.js';

export default function UpdateBanner() {
  const atualizacaoDisponivel = useAppUpdate();
  if (!atualizacaoDisponivel) return null;

  return (
    <div className="flex items-center justify-center gap-3 bg-brand-600 text-brand-contraste text-sm px-4 py-2">
      <span>Uma nova atualização do ISPDesk está disponível.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 bg-white text-brand-700 font-medium px-3 py-1 rounded-md hover:bg-brand-50 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Atualizar agora
      </button>
    </div>
  );
}
