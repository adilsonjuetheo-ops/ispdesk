import { Phone, MapPin, FileText, Cpu, User, Hash, Wifi, Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

const SGP_BADGE = {
  atlaz:    { label: 'Atlaz',    bg: 'bg-purple-100', text: 'text-purple-700' },
  ixc:      { label: 'IXC',      bg: 'bg-blue-100',   text: 'text-blue-700'   },
  mkauth:   { label: 'MK-Auth',  bg: 'bg-orange-100', text: 'text-orange-700' },
  generico: { label: 'Genérico', bg: 'bg-gray-100',   text: 'text-gray-600'   },
};

const STATUS_STYLE = {
  ativo:     'bg-emerald-100 text-emerald-700',
  bloqueado: 'bg-red-100 text-red-700',
  inativo:   'bg-gray-100 text-gray-500',
};

function Iniciais({ nome }) {
  const partes = (nome || '?').trim().split(' ');
  const ini = partes.length >= 2 ? partes[0][0] + partes[partes.length - 1][0] : partes[0][0];
  return (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-base shrink-0">
      {ini.toUpperCase()}
    </div>
  );
}

function Row({ icon: Icon, label, value, mono }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-gray-100 last:border-0">
      <Icon className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">{label}</p>
        <p className={`text-xs text-gray-700 break-all leading-snug ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

export default function ClientInfoPanel({ conversa }) {
  const { user } = useAuth();
  if (!conversa) return null;

  const sgpTipo = user?.sgpTipo;
  const sgpBadge = SGP_BADGE[sgpTipo];
  const statusStyle = STATUS_STYLE[conversa.clienteStatus] || 'bg-gray-100 text-gray-500';
  const filialExibida = conversa.filialNome || conversa.clienteFilial;

  return (
    <div className="w-56 shrink-0 bg-white border-l border-gray-200 overflow-y-auto flex flex-col">

      {/* Cabeçalho */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Informações do cliente</p>

        <div className="flex items-center gap-3 mb-3">
          <Iniciais nome={conversa.clienteNome} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 text-sm leading-tight truncate">
              {conversa.clienteNome || 'Desconhecido'}
            </p>
            {sgpBadge && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 ${sgpBadge.bg} ${sgpBadge.text}`}>
                <Wifi className="w-2.5 h-2.5" />{sgpBadge.label}
              </span>
            )}
          </div>
        </div>

        {conversa.clienteStatus && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusStyle}`}>
            {conversa.clienteStatus}
          </span>
        )}
      </div>

      {/* Dados do cliente */}
      <div className="px-4 py-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Contato</p>
        <div>
          <Row icon={Phone}    label="WhatsApp"  value={conversa.clienteWhatsapp} mono />
          <Row icon={Hash}     label="Contrato"  value={conversa.clienteContratoId} mono />
          <Row icon={MapPin}   label="Filial SGP" value={conversa.clienteFilial} />
        </div>
      </div>

      {/* Atribuição */}
      <div className="px-4 py-2 border-t border-gray-100">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Atribuição</p>
        <div>
          <Row icon={User}      label="Atendente" value={conversa.agenteNome || 'Nenhum'} />
          <Row icon={Building2} label="Filial"    value={filialExibida} />
        </div>
      </div>

      {/* Resumo IA */}
      {conversa.resumoIa && (
        <div className="px-4 py-3 border-t border-gray-100 mt-auto">
          <div className="flex items-center gap-1.5 mb-2">
            <Cpu className="w-3 h-3 text-emerald-600" />
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Resumo IA</p>
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed bg-emerald-50 rounded-lg p-2.5">
            {conversa.resumoIa}
          </p>
        </div>
      )}
    </div>
  );
}
