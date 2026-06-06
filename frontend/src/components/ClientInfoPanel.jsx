import { Phone, MapPin, FileText, Cpu } from 'lucide-react';

export default function ClientInfoPanel({ conversa }) {
  if (!conversa) return null;

  const statusContrato = conversa.clienteStatus;
  const statusColor = statusContrato === 'bloqueado'
    ? 'bg-red-100 text-red-700'
    : statusContrato === 'ativo'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-gray-100 text-gray-600';

  return (
    <div className="w-52 shrink-0 bg-white border-l border-gray-200 p-4 overflow-y-auto">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Cliente</h3>

      {/* avatar */}
      <div className="flex flex-col items-center mb-4">
        <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-lg mb-2">
          {(conversa.clienteNome || conversa.clienteWhatsapp || '?')[0].toUpperCase()}
        </div>
        <p className="font-semibold text-gray-800 text-sm text-center">{conversa.clienteNome || '—'}</p>
      </div>

      <div className="space-y-3">
        <InfoItem icon={Phone} label="WhatsApp" value={conversa.clienteWhatsapp} />
        {conversa.clienteFilial && <InfoItem icon={MapPin} label="Filial" value={conversa.clienteFilial} />}
        {conversa.clienteStatus && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Contrato</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor}`}>
              {conversa.clienteStatus}
            </span>
          </div>
        )}
      </div>

      {conversa.resumoIa && (
        <div className="mt-5">
          <div className="flex items-center gap-1.5 mb-2">
            <Cpu className="w-3.5 h-3.5 text-emerald-600" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Resumo IA</p>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-3">
            {conversa.resumoIa}
          </p>
        </div>
      )}
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <p className="text-sm text-gray-700 truncate">{value}</p>
      </div>
    </div>
  );
}
