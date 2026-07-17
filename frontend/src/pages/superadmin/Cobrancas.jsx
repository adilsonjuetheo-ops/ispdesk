import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import {
  CreditCard, CheckCircle, Clock, Ban, RefreshCw,
  Loader2, ExternalLink, AlertCircle, ThumbsUp,
} from 'lucide-react';

const STATUS_BADGE = {
  ativo:    'bg-emerald-500/20 text-emerald-300 border border-emerald-700/40',
  pendente: 'bg-amber-500/20 text-amber-300 border border-amber-700/40',
  suspenso: 'bg-red-500/20 text-red-300 border border-red-700/40',
  null:     'bg-gray-700/50 text-gray-400 border border-gray-700',
};
const STATUS_LABEL = {
  ativo: 'Ativo', pendente: 'PIX pendente', suspenso: 'Suspenso',
};
const STATUS_ICON = {
  ativo:    CheckCircle,
  pendente: Clock,
  suspenso: Ban,
};

const PLANO_LABEL = { basic: 'Basic', pro: 'Pro', enterprise: 'Enterprise' };

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR');
}

export default function Cobrancas() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acao, setAcao] = useState({}); // { [tenantId]: 'verificando' | 'baixa' | null }
  const [feedback, setFeedback] = useState({}); // { [tenantId]: { ok, msg } }

  const carregar = useCallback(() => {
    setLoading(true);
    api.get('/cobrancas').then(r => setRows(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const setAcaoId = (id, val) => setAcao(a => ({ ...a, [id]: val }));
  const setFeedbackId = (id, val) => setFeedback(f => ({ ...f, [id]: val }));

  const handleVerificar = async (tenant) => {
    if (!tenant.mpPaymentId) return;
    setAcaoId(tenant.id, 'verificando');
    setFeedbackId(tenant.id, null);
    try {
      const { data } = await api.post(`/tenants/${tenant.id}/verificar-pagamento`);
      if (data.pago) {
        setRows(r => r.map(t => t.id === tenant.id
          ? { ...t, statusPagamento: 'ativo', proximoVencimento: data.proximoVencimento }
          : t));
        setFeedbackId(tenant.id, { ok: true, msg: 'Pago! Status atualizado.' });
      } else {
        setFeedbackId(tenant.id, { ok: false, msg: `MP: ${data.statusMP}` });
      }
    } catch (err) {
      setFeedbackId(tenant.id, { ok: false, msg: err.response?.data?.erro || 'Erro' });
    } finally {
      setAcaoId(tenant.id, null);
    }
  };

  const handleBaixaManual = async (tenant) => {
    setAcaoId(tenant.id, 'baixa');
    setFeedbackId(tenant.id, null);
    try {
      const { data } = await api.post(`/tenants/${tenant.id}/baixa-manual`);
      setRows(r => r.map(t => t.id === tenant.id
        ? { ...t, statusPagamento: 'ativo', proximoVencimento: data.proximoVencimento }
        : t));
      setFeedbackId(tenant.id, { ok: true, msg: 'Baixa registrada manualmente.' });
    } catch (err) {
      setFeedbackId(tenant.id, { ok: false, msg: err.response?.data?.erro || 'Erro' });
    } finally {
      setAcaoId(tenant.id, null);
    }
  };

  const totais = {
    ativo:    rows.filter(r => r.statusPagamento === 'ativo').length,
    pendente: rows.filter(r => r.statusPagamento === 'pendente').length,
    suspenso: rows.filter(r => r.statusPagamento === 'suspenso').length,
    sem:      rows.filter(r => !r.statusPagamento).length,
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-indigo-400" />
            Cobranças
          </h1>
          <p className="text-gray-400 text-sm mt-1">Gestão de pagamentos de todos os provedores</p>
        </div>
        <button onClick={carregar} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Ativos', count: totais.ativo,    cor: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-800/40' },
          { label: 'Pendentes', count: totais.pendente, cor: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-800/40' },
          { label: 'Suspensos', count: totais.suspenso, cor: 'text-red-400',     bg: 'bg-red-500/10 border-red-800/40' },
          { label: 'Sem cobrança', count: totais.sem, cor: 'text-gray-400',    bg: 'bg-gray-800 border-gray-700' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.bg}`}>
            <p className="text-xs text-gray-400">{c.label}</p>
            <p className={`text-3xl font-bold mt-1 ${c.cor}`}>{c.count}</p>
          </div>
        ))}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th className="text-left px-5 py-3">Provedor</th>
                <th className="text-left px-5 py-3">Plano</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Vencimento / Expira</th>
                <th className="text-left px-5 py-3">Payment ID</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const StatusIcon = STATUS_ICON[t.statusPagamento] || AlertCircle;
                const busy = acao[t.id];
                const fb = feedback[t.id];
                const isPendente = t.statusPagamento === 'pendente';
                const isAtivo = t.statusPagamento === 'ativo';

                return (
                  <tr key={t.id} className="border-b border-gray-700/50 hover:bg-gray-750/30 transition-colors">
                    {/* Provedor */}
                    <td className="px-5 py-3">
                      <button
                        onClick={() => navigate(`/admin/tenants/${t.id}`)}
                        className="flex items-center gap-1.5 text-sm text-white hover:text-indigo-300 font-medium"
                      >
                        {t.nome}
                        <ExternalLink className="w-3 h-3 opacity-40" />
                      </button>
                      {!t.ativo && (
                        <span className="text-xs text-red-400">inativo</span>
                      )}
                    </td>

                    {/* Plano */}
                    <td className="px-5 py-3">
                      <span className="text-xs text-gray-300 capitalize">
                        {PLANO_LABEL[t.plano] || t.plano}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${STATUS_BADGE[t.statusPagamento] || STATUS_BADGE.null}`}>
                        <StatusIcon className="w-3 h-3" />
                        {STATUS_LABEL[t.statusPagamento] || 'Sem cobrança'}
                      </span>
                      {fb && (
                        <p className={`text-xs mt-1 ${fb.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {fb.msg}
                        </p>
                      )}
                    </td>

                    {/* Vencimento */}
                    <td className="px-5 py-3 text-sm text-gray-300">
                      {fmt(t.proximoVencimento)}
                    </td>

                    {/* Payment ID */}
                    <td className="px-5 py-3">
                      {t.mpPaymentId
                        ? <code className="text-xs text-gray-400 font-mono">{t.mpPaymentId}</code>
                        : <span className="text-xs text-gray-600">—</span>
                      }
                    </td>

                    {/* Ações */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {/* Verificar MP */}
                        {isPendente && t.mpPaymentId && (
                          <button
                            onClick={() => handleVerificar(t)}
                            disabled={!!busy}
                            title="Consultar status no Mercado Pago agora"
                            className="flex items-center gap-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            {busy === 'verificando'
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <RefreshCw className="w-3.5 h-3.5" />
                            }
                            Verificar MP
                          </button>
                        )}

                        {/* Baixa manual */}
                        {!isAtivo && (
                          <button
                            onClick={() => handleBaixaManual(t)}
                            disabled={!!busy}
                            title="Marcar como pago manualmente (+30 dias)"
                            className="flex items-center gap-1 text-xs bg-emerald-700/40 hover:bg-emerald-700/70 disabled:opacity-50 text-emerald-300 border border-emerald-700/50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            {busy === 'baixa'
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <ThumbsUp className="w-3.5 h-3.5" />
                            }
                            Baixa manual
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
