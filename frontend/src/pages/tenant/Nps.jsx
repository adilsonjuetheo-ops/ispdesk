import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { Star, TrendingUp, TrendingDown, Minus, Users } from 'lucide-react';

function ScoreGauge({ score }) {
  if (score === null) return null;
  const cor = score >= 50 ? 'text-green-600' : score >= 0 ? 'text-yellow-600' : 'text-red-600';
  const label = score >= 50 ? 'Excelente' : score >= 0 ? 'Bom' : 'Precisa melhorar';
  return (
    <div className="flex flex-col items-center">
      <span className={`text-6xl font-bold ${cor}`}>{score}</span>
      <span className="text-sm text-gray-500 mt-1">{label}</span>
      <span className="text-xs text-gray-500 mt-0.5">NPS Score</span>
    </div>
  );
}

function BadgeCategoria({ cat }) {
  const map = {
    promotor:  { label: 'Promotor',  cls: 'bg-green-100 text-green-800' },
    neutro:    { label: 'Neutro',    cls: 'bg-yellow-100 text-yellow-800' },
    detrator:  { label: 'Detrator', cls: 'bg-red-100 text-red-800' },
  };
  const { label, cls } = map[cat] || { label: cat, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function Nps() {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/nps')
      .then(r => setDados(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const semDados = !dados || dados.total === 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" /> NPS — Satisfação dos clientes
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Enviado automaticamente após cada atendimento encerrado por agente.
          </p>
        </div>

        {semDados ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Star className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Nenhuma avaliação recebida ainda.</p>
            <p className="text-sm text-gray-500 mt-1">
              O NPS é enviado automaticamente quando um agente encerra uma conversa.
            </p>
          </div>
        ) : (
          <>
            {/* Cards de resumo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center">
                <ScoreGauge score={dados.score} />
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center gap-1">
                <span className="text-3xl font-bold text-gray-800">{dados.media}</span>
                <span className="text-xs text-gray-500">Média das notas</span>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center justify-center gap-1">
                <Users className="w-5 h-5 text-gray-400 mb-1" />
                <span className="text-3xl font-bold text-gray-800">{dados.total}</span>
                <span className="text-xs text-gray-500">Respostas</span>
              </div>

              {/* Barra de categorias */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col justify-center gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-green-700">
                    <TrendingUp className="w-3.5 h-3.5" /> Promotores
                  </span>
                  <span className="font-bold">{dados.promotores}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-yellow-700">
                    <Minus className="w-3.5 h-3.5" /> Neutros
                  </span>
                  <span className="font-bold">{dados.neutros}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-red-700">
                    <TrendingDown className="w-3.5 h-3.5" /> Detratores
                  </span>
                  <span className="font-bold">{dados.detratores}</span>
                </div>
              </div>
            </div>

            {/* Barra visual de distribuição */}
            {dados.total > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Distribuição</p>
                <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                  {dados.promotores > 0 && (
                    <div
                      className="bg-green-400"
                      style={{ width: `${(dados.promotores / dados.total) * 100}%` }}
                      title={`Promotores: ${dados.promotores}`}
                    />
                  )}
                  {dados.neutros > 0 && (
                    <div
                      className="bg-yellow-400"
                      style={{ width: `${(dados.neutros / dados.total) * 100}%` }}
                      title={`Neutros: ${dados.neutros}`}
                    />
                  )}
                  {dados.detratores > 0 && (
                    <div
                      className="bg-red-400"
                      style={{ width: `${(dados.detratores / dados.total) * 100}%` }}
                      title={`Detratores: ${dados.detratores}`}
                    />
                  )}
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1.5">
                  <span className="text-green-600">{Math.round((dados.promotores / dados.total) * 100)}% promotores</span>
                  <span className="text-red-600">{Math.round((dados.detratores / dados.total) * 100)}% detratores</span>
                </div>
              </div>
            )}

            {/* Tabela de respostas recentes */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700">Respostas recentes</p>
              </div>
              <div className="divide-y divide-gray-50">
                {dados.respostas.map(r => (
                  <div key={r.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 shrink-0">
                      <span className="text-lg font-bold text-gray-700">{r.nota}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {r.clienteNome || r.clienteWhatsapp}
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.respondidoEm
                          ? new Date(r.respondidoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                          : '—'}
                      </p>
                    </div>
                    <BadgeCategoria cat={r.categoria} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
