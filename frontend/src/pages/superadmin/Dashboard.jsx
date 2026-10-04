import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import { Building2, MessageSquare, AlertCircle, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getPlano, labelPlano, precoPlano } from '../../lib/planos.js';

// Dólar só para dar ordem de grandeza na comparação com a mensalidade, que é
// em real. Não precisa de cotação do dia: a conclusão que interessa — "este
// provedor come metade do que paga" — não muda por causa de centavos.
const DOLAR_APROX = 5.5;

const usd = v => `US$ ${v.toFixed(2)}`;
const brl = v => `R$ ${v.toFixed(2).replace('.', ',')}`;
const milhares = n => n.toLocaleString('pt-BR');

function ConsumoIa() {
  const [dados, setDados] = useState(null);
  const [dias, setDias] = useState(30);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setErro('');
    api.get(`/tenants/consumo-ia?dias=${dias}`)
      .then(r => setDados(r.data))
      .catch(err => setErro(err.response?.data?.erro || 'Não foi possível carregar o consumo.'));
  }, [dias]);

  const economia = dados ? dados.total.custoSemCache - dados.total.custo : 0;
  const pctEconomia = dados?.total.custoSemCache
    ? (economia / dados.total.custoSemCache) * 100
    : 0;

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 mb-8">
      <div className="p-5 border-b border-gray-700 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-white">Consumo da API de IA</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            O que cada provedor gasta de modelo, comparado com o que ele paga de mensalidade.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                dias === d ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {erro && <p className="px-5 py-4 text-sm text-red-300">{erro}</p>}

      {!erro && !dados && <p className="px-5 py-4 text-sm text-gray-400">Carregando...</p>}

      {dados && dados.provedores.length === 0 && (
        <p className="px-5 py-4 text-sm text-gray-400">
          Nenhum consumo registrado nesse período. A contagem começa no primeiro atendimento
          depois que esta medição entrou no ar.
        </p>
      )}

      {dados && dados.provedores.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4 p-5 border-b border-gray-700">
            <div>
              <p className="text-gray-400 text-xs">Custo no período</p>
              <p className="text-2xl font-bold text-white mt-0.5">{usd(dados.total.custo)}</p>
              <p className="text-gray-500 text-xs mt-0.5">≈ {brl(dados.total.custo * DOLAR_APROX)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Economia do cache</p>
              {/* Escrita de cache custa 125% da entrada e leitura custa 10%. Se
                  o prefixo for curto demais ou o movimento for esparso, grava e
                  nunca lê — e aí o cache sai mais caro. Esse caso precisa
                  aparecer em vermelho, não sumir atrás de um traço. */}
              <p className={`text-2xl font-bold mt-0.5 ${
                economia > 0 ? 'text-emerald-400' : economia < 0 ? 'text-red-300' : 'text-gray-500'
              }`}>
                {economia < 0 ? `+${usd(-economia)}` : usd(economia)}
              </p>
              <p className="text-gray-500 text-xs mt-0.5">
                {economia > 0 ? `${pctEconomia.toFixed(0)}% do que custaria sem cache`
                  : economia < 0 ? `está custando ${(-pctEconomia).toFixed(0)}% a mais — grava e não lê`
                  : 'o cache ainda não engatou'}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Chamadas ao modelo</p>
              <p className="text-2xl font-bold text-white mt-0.5">{milhares(dados.total.chamadas)}</p>
              <p className="text-gray-500 text-xs mt-0.5">desde {dados.desde}</p>
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                <th className="text-left px-5 py-3">Provedor</th>
                <th className="text-right px-5 py-3">Chamadas</th>
                <th className="text-right px-5 py-3">Custo</th>
                <th className="text-right px-5 py-3">Cache</th>
                <th className="text-right px-5 py-3">% da mensalidade</th>
              </tr>
            </thead>
            <tbody>
              {dados.provedores.map(p => {
                const mensalidade = getPlano(p.plano).valor;
                const custoBrl = p.custo * DOLAR_APROX;
                // Proporcional, porque o período pode ser 7 ou 90 dias e a
                // mensalidade é sempre de um mês.
                const pctMensalidade = mensalidade
                  ? (custoBrl / (mensalidade * (dados.dias / 30))) * 100
                  : 0;
                const economiaP = p.custoSemCache - p.custo;
                const pctCache = p.custoSemCache ? (economiaP / p.custoSemCache) * 100 : 0;
                return (
                  <tr key={p.tenantId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="px-5 py-3">
                      <div className="text-white font-medium">{p.nome}</div>
                      <div className="text-gray-500 text-xs capitalize">
                        {labelPlano(p.plano)} · {precoPlano(p.plano)}/mês
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-300 tabular-nums">{milhares(p.chamadas)}</td>
                    <td className="px-5 py-3 text-right text-white tabular-nums">
                      {usd(p.custo)}
                      <div className="text-gray-500 text-xs">{brl(custoBrl)}</div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={
                        pctCache > 0 ? 'text-emerald-400' : pctCache < 0 ? 'text-red-300' : 'text-gray-500'
                      }>
                        {pctCache > 0 ? `−${pctCache.toFixed(0)}%`
                          : pctCache < 0 ? `+${(-pctCache).toFixed(0)}%`
                          : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={
                        pctMensalidade >= 30 ? 'text-red-300 font-semibold'
                        : pctMensalidade >= 15 ? 'text-amber-300'
                        : 'text-gray-300'
                      }>
                        {pctMensalidade.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="px-5 py-3 text-xs text-gray-500 border-t border-gray-700">
            Dólar aproximado em R$ {DOLAR_APROX.toFixed(2)} — serve para a ordem de grandeza, não para fechar caixa.
            A coluna da direita fica âmbar acima de 15% e vermelha acima de 30%: aí o plano está
            pequeno para o tamanho da base do provedor.
          </p>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const navigate = useNavigate();

  const carregar = () => {
    setLoading(true);
    setErro('');
    Promise.all([
      api.get('/tenants'),
      api.get('/conversations'),
    ]).then(([t, c]) => {
      setTenants(t.data);
      setConversations(c.data);
    // Sem este catch a tela ficava com tudo zerado e a tabela vazia quando uma
    // das buscas falhava — indistinguível de uma plataforma sem provedor
    // nenhum. O painel precisa dizer que falhou, não fingir que está vazio.
    }).catch(err => {
      setErro(err.response?.data?.erro
        || (err.response ? `O servidor respondeu ${err.response.status}.` : 'Sem resposta do servidor.'));
    }).finally(() => setLoading(false));
  };

  useEffect(() => { carregar(); }, []);

  const ativas = conversations.filter(c => c.status !== 'encerrada').length;
  const aguardando = conversations.filter(c => c.status === 'aguardando').length;

  const cards = [
    { label: 'Provedores', value: tenants.length, icon: Building2, color: 'bg-indigo-500' },
    { label: 'Conversas ativas', value: ativas, icon: MessageSquare, color: 'bg-emerald-500' },
    { label: 'Aguardando humano', value: aguardando, icon: AlertCircle, color: 'bg-amber-500' },
  ];

  if (loading) return (
    <div className="p-8 text-gray-400">Carregando...</div>
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Visão geral da plataforma ISPDesk</p>
      </div>

      {erro && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4">
          <p className="text-sm text-red-300 font-medium">Não foi possível carregar os dados.</p>
          <p className="text-xs text-red-400/80 mt-1">{erro}</p>
          <button onClick={carregar}
            className="mt-3 text-xs font-medium text-red-200 hover:text-white underline underline-offset-2">
            Tentar de novo
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">{card.label}</p>
                <p className="text-3xl font-bold text-white mt-1">{card.value}</p>
              </div>
              <div className={`${card.color} rounded-lg p-3`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConsumoIa />

      <div className="bg-gray-800 rounded-xl border border-gray-700">
        <div className="p-5 border-b border-gray-700">
          <h2 className="font-semibold text-white">Provedores cadastrados</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="text-left px-5 py-3">Nome</th>
              <th className="text-left px-5 py-3">Plano</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-5 py-3">
                  <div className="text-white font-medium">{t.nome}</div>
                  <div className="text-gray-500 text-xs">{t.slug}</div>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-full capitalize">
                    {t.plano}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    t.ativo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                  }`}>
                    {t.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => navigate(`/admin/tenants/${t.id}`)}
                    className="text-indigo-400 hover:text-indigo-300 text-xs font-medium"
                  >
                    Gerenciar →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
