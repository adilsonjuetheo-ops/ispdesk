import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import {
  TrendingUp, Bot, Clock, Moon, FileText, Unlock, BellRing, FileSignature, MessageSquare, Star,
} from 'lucide-react';

const PERIODOS = [7, 30, 90];

const num = n => Number(n || 0).toLocaleString('pt-BR');

function Cartao({ icone: Icone, cor, valor, titulo, detalhe }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${cor}`}>
        <Icone className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{valor}</p>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{titulo}</p>
      {detalhe && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{detalhe}</p>}
    </div>
  );
}

export default function Resultados() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setCarregando(true);
    setErro('');
    api.get('/relatorio/resultados', { params: { dias } })
      .then(r => setDados(r.data))
      .catch(err => setErro(err.response?.data?.erro || 'Não foi possível carregar os resultados.'))
      .finally(() => setCarregando(false));
  }, [dias]);

  const pctResolvido = dados?.encerrados ? Math.round((dados.resolvidosBot / dados.encerrados) * 100) : 0;
  const registradoDesde = dados?.acoesRegistradasDesde
    ? new Date(dados.acoesRegistradasDesde).toLocaleDateString('pt-BR')
    : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" /> Resultados
            </h1>
            <p className="text-sm text-gray-500 mt-1">O que o ISPDesk resolveu para você no período.</p>
          </div>
          <div className="flex gap-1.5">
            {PERIODOS.map(p => (
              <button key={p} onClick={() => setDias(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  dias === p ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}>
                {p} dias
              </button>
            ))}
          </div>
        </div>

        {erro && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 mb-6">{erro}</div>}

        {carregando && !dados ? (
          <div className="p-8 text-gray-500 text-sm">Carregando...</div>
        ) : dados && (
          <>
            {/* Destaque: o número que paga a mensalidade */}
            <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl p-6 text-white mb-6">
              <div className="flex items-center gap-2 text-emerald-100 text-sm font-medium">
                <Bot className="w-4 h-4" /> Resolvidos pelo assistente, sem atendente
              </div>
              <p className="text-4xl font-bold mt-2">{num(dados.resolvidosBot)}</p>
              <p className="text-emerald-50 text-sm mt-1">
                {pctResolvido}% dos {num(dados.encerrados)} atendimentos encerrados no período
              </p>
              <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-100" />
                <p className="text-sm">
                  <strong className="text-lg">≈ {num(dados.horasPoupadas)} horas</strong> de atendente poupadas
                  <span className="text-emerald-100"> (estimando {dados.minutosPorAtendimento} min por atendimento)</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Cartao icone={MessageSquare} cor="bg-blue-50 text-blue-600"
                valor={num(dados.atendimentos)} titulo="Atendimentos"
                detalhe={`${num(dados.mensagensRespondidas)} mensagens respondidas pelo assistente`} />

              {dados.foraDoHorario !== null && (
                <Cartao icone={Moon} cor="bg-indigo-50 text-indigo-600"
                  valor={num(dados.foraDoHorario)} titulo="Fora do horário"
                  detalhe="clientes atendidos quando a equipe não estava" />
              )}

              <Cartao icone={FileText} cor="bg-amber-50 text-amber-600"
                valor={num(dados.segundasVias)} titulo="Segundas vias enviadas"
                detalhe={registradoDesde ? `registrado desde ${registradoDesde}` : 'começou a ser registrado agora'} />

              <Cartao icone={Unlock} cor="bg-emerald-50 text-emerald-600"
                valor={num(dados.desbloqueios)} titulo="Desbloqueios em confiança"
                detalhe={registradoDesde ? `registrado desde ${registradoDesde}` : 'começou a ser registrado agora'} />

              {dados.lembretesFatura > 0 && (
                <Cartao icone={BellRing} cor="bg-orange-50 text-orange-600"
                  valor={num(dados.lembretesFatura)} titulo="Lembretes de fatura"
                  detalhe="enviados automaticamente" />
              )}

              {dados.contratosAssinados > 0 && (
                <Cartao icone={FileSignature} cor="bg-violet-50 text-violet-600"
                  valor={num(dados.contratosAssinados)} titulo="Contratos assinados"
                  detalhe="digitalmente, pelo WhatsApp" />
              )}

              {dados.nps && (
                <Cartao icone={Star} cor="bg-yellow-50 text-yellow-600"
                  valor={dados.nps.score} titulo="NPS (satisfação)"
                  detalhe={`${num(dados.nps.respostas)} avaliações de clientes`} />
              )}
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
              "Resolvido pelo assistente" conta só atendimentos encerrados sem transferência e sem atendente ter assumido.
              As horas poupadas são estimativa.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
