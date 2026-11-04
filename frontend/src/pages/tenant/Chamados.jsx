import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.js';
import { planoTemChamado } from '../../lib/planos.js';
import { Wrench, RefreshCw, MapPin, User } from 'lucide-react';

// O IXC tem quase dez status. Em vez de reproduzir todos como abas, a tela
// separa pelo que o atendente precisa decidir — o que ainda demanda alguém —
// e mostra o status exato em cada linha.
const VISOES = [
  { valor: 'andamento', rotulo: 'Em andamento' },
  { valor: 'finalizados', rotulo: 'Finalizados' },
  { valor: 'todos', rotulo: 'Todos' },
];

// "2026-10-14 18:05:11" vem do IXC sem fuso. Tratar como horário local é o
// certo: é o relógio do provedor que está gravado ali.
function dataBr(valor) {
  if (!valor) return null;
  const d = new Date(String(valor).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Chamados() {
  const { user } = useAuth();
  // Consultar chamado é de todo plano; abrir é do Enterprise para cima. Quem
  // não abre não deve ler um texto que manda procurar um botão inexistente.
  const podeAbrir = user?.role === 'superadmin' || planoTemChamado(user?.plano);
  const [chamados, setChamados] = useState([]);
  const [suportado, setSuportado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [visao, setVisao] = useState('andamento');
  const [cidade, setCidade] = useState('');
  const [tecnico, setTecnico] = useState('');

  const carregar = () => {
    setCarregando(true);
    setErro('');
    api.get('/conversations/chamados')
      .then(r => {
        setSuportado(r.data.suportado);
        setChamados(r.data.chamados || []);
      })
      .catch(err => setErro(err.response?.data?.erro || 'Não foi possível carregar os chamados.'))
      .finally(() => setCarregando(false));
  };

  useEffect(carregar, []);

  // As opções saem do que veio, não de uma lista fixa: filtro que oferece
  // cidade sem chamado nenhum só gera tela vazia.
  const cidades = useMemo(
    () => [...new Set(chamados.map(c => c.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [chamados]);
  const tecnicos = useMemo(
    () => [...new Set(chamados.map(c => c.tecnico).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [chamados]);

  const doStatus = chamados.filter(c =>
    visao === 'todos' ? true : visao === 'finalizados' ? c.finalizado : !c.finalizado);

  const visiveis = doStatus.filter(c =>
    (!cidade || c.cidade === cidade) &&
    (!tecnico || (tecnico === '__sem__' ? !c.tecnico : c.tecnico === tecnico)));

  const semTecnico = chamados.filter(c => !c.tecnico).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-600" /> Chamados técnicos
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Direto do sistema do provedor.
              {podeAbrir ? ' Abrir um novo é pelo botão na conversa do cliente.' : ''}
            </p>
          </div>
          <button onClick={carregar} disabled={carregando}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>

        {erro && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 px-4 py-3">
            <p className="text-sm text-red-700 dark:text-red-300">{erro}</p>
          </div>
        )}

        {suportado === false && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            O sistema deste provedor não permite consultar chamados por aqui.
          </p>
        )}

        {suportado && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {VISOES.map(s => (
                <button key={s.valor} onClick={() => setVisao(s.valor)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    visao === s.valor
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}>
                  {s.rotulo}
                </button>
              ))}

              <select value={cidade} onChange={e => setCidade(e.target.value)}
                className="ml-auto text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-1.5">
                <option value="">Todas as cidades</option>
                {cidades.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <select value={tecnico} onChange={e => setTecnico(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-1.5">
                <option value="">Todos os técnicos</option>
                {/* Chamado sem técnico é o que precisa de alguém olhando: fica
                    como opção própria, não escondido no meio da lista. */}
                {semTecnico > 0 && <option value="__sem__">Sem técnico ({semTecnico})</option>}
                {tecnicos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {carregando && <p className="text-sm text-gray-500">Carregando...</p>}

            {!carregando && visiveis.length === 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
                <Wrench className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {chamados.length === 0 ? 'Nenhum chamado no sistema do provedor.' : 'Nenhum chamado com esses filtros.'}
                </p>
              </div>
            )}

            {!carregando && visiveis.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {visiveis.map(c => (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {c.clienteNome}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                          {c.assunto && <span>{c.assunto}</span>}
                          {c.cidade && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{c.cidade}
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-1 ${c.tecnico ? '' : 'text-amber-600 dark:text-amber-400'}`}>
                            <User className="w-3 h-3" />{c.tecnico || 'sem técnico'}
                          </span>
                        </p>
                        {c.mensagem && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{c.mensagem}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">#{c.id}</p>
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full mt-0.5 ${
                          c.finalizado
                            ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        }`}>
                          {c.statusRotulo}
                        </span>
                        {dataBr(c.abertoEm) && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{dataBr(c.abertoEm)}</p>
                        )}
                        {dataBr(c.agendadoPara) && (
                          <p className="text-[11px] text-blue-600 dark:text-blue-400">
                            agendado {dataBr(c.agendadoPara)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
