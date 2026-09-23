import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { FileSignature, Clock, CheckCircle2, ExternalLink } from 'lucide-react';

function BadgeStatus({ status }) {
  if (status === 'assinado') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
        <CheckCircle2 className="w-3 h-3" /> Assinado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
      <Clock className="w-3 h-3" /> Pendente
    </span>
  );
}

export default function Contratos() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [abrindo, setAbrindo] = useState(null);
  const navigate = useNavigate();

  const abrirContrato = async (conversaId) => {
    if (abrindo) return;
    // Aba aberta no clique, antes do await: depois dele o navegador bloqueia.
    const aba = window.open('', '_blank');
    setAbrindo(conversaId);
    try {
      const { data } = await api.get(`/contracts/${conversaId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      if (aba) aba.location = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      aba?.close();
      alert('Não foi possível abrir o contrato agora.');
    } finally {
      setAbrindo(null);
    }
  };

  useEffect(() => {
    api.get('/contracts').then(r => setLista(r.data || [])).finally(() => setLoading(false));
  }, []);

  const pendentes = lista.filter(c => c.contratoStatus === 'pendente');
  const assinados = lista.filter(c => c.contratoStatus === 'assinado');
  const visiveis = filtro === 'pendentes' ? pendentes : filtro === 'assinados' ? assinados : lista;

  if (loading) return <div className="p-8 text-gray-500 text-sm">Carregando...</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-blue-600" /> Contratos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Contratos de assinatura digital enviados aos clientes pelo atendimento. O documento em si fica guardado na sua conta de assinatura digital — aqui você acompanha o status.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{lista.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{pendentes.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Aguardando assinatura</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{assinados.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Assinados</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {[
            { id: 'todos', label: 'Todos' },
            { id: 'pendentes', label: 'Pendentes' },
            { id: 'assinados', label: 'Assinados' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filtro === f.id ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visiveis.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileSignature className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Nenhum contrato por aqui.</p>
            <p className="text-sm text-gray-500 mt-1">
              Contratos enviados a partir de uma conversa aparecem nesta lista.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="divide-y divide-gray-50">
              {visiveis.map(c => (
                <div key={c.conversaId} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {c.clienteNome || c.clienteWhatsapp}
                    </p>
                    <p className="text-xs text-gray-500">
                      {c.filialNome ? `${c.filialNome} · ` : ''}
                      {c.contratoEnviadoEm
                        ? `Enviado em ${new Date(c.contratoEnviadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                        : 'Data de envio não registrada'}
                      {c.agenteNome ? ` · por ${c.agenteNome}` : ''}
                    </p>
                  </div>
                  <BadgeStatus status={c.contratoStatus} />
                  {c.contratoStatus === 'assinado' && (
                    <button
                      onClick={() => abrirContrato(c.conversaId)}
                      disabled={abrindo === c.conversaId}
                      className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900 disabled:text-gray-400 shrink-0"
                    >
                      <FileSignature className="w-3 h-3" />
                      {abrindo === c.conversaId ? 'Abrindo...' : 'Ver contrato'}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/inbox?conversa=${c.conversaId}`)}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 shrink-0"
                  >
                    Ver conversa <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
