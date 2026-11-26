import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useNotificationSound } from '../../hooks/useNotificationSound.js';
import ConversationList from '../../components/ConversationList.jsx';
import ChatWindow from '../../components/ChatWindow.jsx';
import ClientInfoPanel from '../../components/ClientInfoPanel.jsx';
import { Bot, Zap, Users, BarChart2, Star, ArrowRight, BookUser, ExternalLink, Clock, UserCheck, Settings, MessageCircleWarning, CheckCircle2 } from 'lucide-react';
import { differenceInMinutes, format } from 'date-fns';

// Preferência de layout do operador. Fica no navegador de propósito: é ajuste
// de tela, não dado de conta — quem usa dois computadores costuma querer
// arranjos diferentes em cada um.
const PREF = 'ispdesk_painel_cliente';
function lerPreferencia(chave, padrao) {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : v === '1';
  } catch { return padrao; }
}
function gravarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor ? '1' : '0'); } catch { /* modo privado */ }
}

function saudacao(nome) {
  const h = new Date().getHours();
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return nome ? `${periodo}, ${nome.split(' ')[0]}!` : `${periodo}!`;
}

const ATALHOS = [
  { icon: BookUser, title: 'Contatos', href: '/contatos' },
  { icon: Zap, title: 'Atalhos de resposta', href: '/atalhos', admin: true },
  { icon: Users, title: 'Equipe e filiais', href: '/agents', admin: true },
  { icon: BarChart2, title: 'Relatórios', href: '/relatorio', admin: true },
  { icon: Star, title: 'Pesquisa de satisfação', href: '/nps', admin: true },
  { icon: Settings, title: 'Configurações', href: '/settings', admin: true },
];

// Identifica a build no rodapé. Serve para o suporte: em vez de perguntar "você
// atualizou?", basta pedir o que aparece na tela. A data vem primeiro por ser
// legível ao telefone e por existir sempre — o hash depende de o Coolify passar
// SOURCE_COMMIT para dentro da imagem.
function useBuild() {
  const [build, setBuild] = useState(null);
  useEffect(() => {
    fetch('/version.json')
      .then(r => r.json())
      .then(({ commit, data }) => setBuild({ commit, data }))
      .catch(() => {});
  }, []);
  return build;
}

function Rodape() {
  const build = useBuild();
  return (
    <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 text-center space-y-1">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        ISPDesk — atendimento por WhatsApp para provedores de internet
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Desenvolvido por{' '}
        <a
          href="https://www.adilsondev.com.br"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          adilsondev.com.br
          <ExternalLink className="w-3 h-3" />
        </a>
      </p>
      {build?.data && (
        <p className="text-[10px] text-gray-300 dark:text-gray-600 font-mono pt-1">
          versão de {format(new Date(build.data), 'dd/MM/yyyy HH:mm')}
          {build.commit ? ` · ${build.commit}` : ''}
        </p>
      )}
    </footer>
  );
}

const EM_ESPERA = ['aguardando', 'aguardando_filial'];

function formatarEspera(mins) {
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

// O painel abre com o estado da operação, não com um passo a passo de
// instalação: quem usa isso todo dia já configurou a plataforma faz tempo.
function resumoDaOperacao(conversas) {
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const fila = conversas.filter(c => EM_ESPERA.includes(c.status));
  const esperas = fila
    .filter(c => c.iniciadaEm)
    .map(c => differenceInMinutes(new Date(), new Date(c.iniciadaEm)));

  const desdeHoje = campo => conversas.filter(
    c => c[campo] && new Date(c[campo]) >= inicioDoDia
  ).length;

  return {
    fila: fila.length,
    maiorEspera: esperas.length ? Math.max(...esperas) : null,
    emAtendimento: conversas.filter(c => c.status === 'humano').length,
    comAssistente: conversas.filter(c => c.status === 'bot').length,
    // Encerradas hoje sem nenhum atendente: o bot resolveu do começo ao fim.
    botResolveuHoje: conversas.filter(c => c.status === 'encerrada' && !c.agenteId
      && c.encerradaEm && new Date(c.encerradaEm) >= inicioDoDia).length,
    abertasHoje: desdeHoje('iniciadaEm'),
    encerradasHoje: desdeHoje('encerradaEm'),
  };
}

function Indicador({ icon: Icon, rotulo, valor, detalhe, tom, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3.5 ${
        onClick ? 'hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm transition-all duration-150' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 text-gray-500 dark:text-gray-400">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">{rotulo}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${tom || 'text-gray-900 dark:text-gray-50'}`}>{valor}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 truncate">{detalhe || ' '}</p>
    </Tag>
  );
}

function PainelAgora({ conversas, online, slaMinutos, navigate }) {
  const r = resumoDaOperacao(conversas);

  // Mesma escala do relógio na lista de conversas, para os dois lugares não
  // contarem a mesma urgência de formas diferentes.
  const limite = slaMinutos || 15;
  const tomDaFila = r.maiorEspera == null ? null
    : r.maiorEspera >= limite ? 'text-red-600'
    : r.maiorEspera >= limite / 2 ? 'text-amber-600'
    : 'text-emerald-600';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      <Indicador
        icon={Clock}
        rotulo="Na fila"
        valor={r.fila}
        tom={r.fila > 0 ? tomDaFila : undefined}
        detalhe={r.maiorEspera != null ? `maior espera ${formatarEspera(r.maiorEspera)}` : 'ninguém esperando'}
        onClick={() => navigate('/inbox?view=fila')}
      />
      <Indicador
        icon={UserCheck}
        rotulo="Em atendimento"
        valor={r.emAtendimento}
        detalhe={online.length ? `${online.length} da equipe online` : 'ninguém online'}
      />
      <Indicador
        icon={Bot}
        rotulo="Com o bot"
        valor={r.comAssistente}
        detalhe={`${r.botResolveuHoje} resolvida${r.botResolveuHoje === 1 ? '' : 's'} sozinho hoje`}
      />
      <Indicador
        icon={BarChart2}
        rotulo="Hoje"
        valor={r.abertasHoje}
        detalhe={`${r.encerradasHoje} encerrada${r.encerradasHoje === 1 ? '' : 's'}`}
      />
    </div>
  );
}

// Quem está esperando a equipe agora: na fila ou com atendente, com a última
// mensagem do cliente ainda sem resposta. Mais antigo primeiro.
function esperandoResposta(conversas) {
  const agora = Date.now();
  return conversas
    .filter(c => (EM_ESPERA.includes(c.status) || (c.status === 'humano' && c.ultimaMsgOrigem === 'cliente')))
    .map(c => {
      const desde = EM_ESPERA.includes(c.status) ? (c.iniciadaEm || c.ultimaMsgEm) : c.ultimaMsgEm;
      return { c, mins: desde ? Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60000)) : 0 };
    })
    .sort((a, b) => b.mins - a.mins);
}

function tomEspera(mins, limite) {
  return mins >= limite ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
    : mins >= 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
}

function Bloco({ icon: Icon, titulo, children, acao }) {
  return (
    <section className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <Icon className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex-1">{titulo}</h3>
        {acao}
      </header>
      {children}
    </section>
  );
}

function EsperandoAgora({ conversas, slaMinutos, onAbrir, navigate }) {
  const lista = esperandoResposta(conversas);
  const limite = slaMinutos || 15;
  return (
    <Bloco
      icon={MessageCircleWarning}
      titulo="Esperando resposta"
      acao={lista.length > 5 && (
        <button onClick={() => navigate('/inbox?view=fila')} className="text-xs font-medium text-blue-600 hover:underline">
          ver todas ({lista.length})
        </button>
      )}
    >
      {lista.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Nenhum cliente esperando resposta.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {lista.slice(0, 5).map(({ c, mins }) => (
            <li key={c.id}>
              <button onClick={() => onAbrir?.(c)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {c.clienteNome && c.clienteNome !== c.clienteWhatsapp ? c.clienteNome : c.clienteWhatsapp}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {EM_ESPERA.includes(c.status) ? 'Na fila' : c.agenteNome || 'Em atendimento'}
                    {c.ultimaMensagem ? ` · ${c.ultimaMensagem}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tomEspera(mins, limite)}`}>
                  {formatarEspera(mins)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

function EquipeAgora({ conversas, online }) {
  const carga = new Map();
  for (const c of conversas) {
    if (c.status === 'humano' && c.agenteId) carga.set(c.agenteId, (carga.get(c.agenteId) || 0) + 1);
  }
  const pessoas = [...online].sort((a, b) => (carga.get(b.id) || 0) - (carga.get(a.id) || 0));
  const maior = Math.max(1, ...pessoas.map(p => carga.get(p.id) || 0));
  return (
    <Bloco icon={Users} titulo="Equipe agora">
      {pessoas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Ninguém da equipe online.</p>
      ) : (
        <ul className="px-4 py-2">
          {pessoas.map(p => {
            const n = carga.get(p.id) || 0;
            return (
              <li key={p.id} className="py-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-200 truncate">{p.nome}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums shrink-0 ml-2">
                    {n} conversa{n === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${(n / maior) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}

function chamada(conversas, isAdmin) {
  const fila = conversas.filter(c => EM_ESPERA.includes(c.status)).length;
  if (fila > 0) {
    return fila === 1
      ? 'Tem 1 conversa esperando atendimento agora.'
      : `Tem ${fila} conversas esperando atendimento agora.`;
  }
  return 'Ninguém na fila. Selecione uma conversa na lista ao lado.';
}

function WelcomePanel({ currentUser, conversas = [], online = [], slaMinutos = 0, onAbrir }) {
  const navigate = useNavigate();
  const nome = currentUser?.nome || '';
  const isAdmin = currentUser?.role === 'admin';
  // As rotas de admin redirecionam quem não tem permissão. Mostrar o atalho
  // para o atendente devolvia ele ao inbox sem explicar nada.
  const atalhos = ATALHOS.filter(c => !c.admin || isAdmin);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50/60 dark:bg-gray-900 md:rounded-2xl md:border md:border-gray-200 dark:md:border-gray-800 md:shadow-sm py-8 px-6 lg:px-8">
      <div className="w-full max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <img src="/logoisp.png" alt="Logo" className="h-11 rounded-xl shadow-sm" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">{saudacao(nome)}</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">{chamada(conversas, isAdmin)}</p>
          </div>
        </div>

        <PainelAgora
          conversas={conversas}
          online={online}
          slaMinutos={slaMinutos}
          navigate={navigate}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-8">
          <EsperandoAgora conversas={conversas} slaMinutos={slaMinutos} onAbrir={onAbrir} navigate={navigate} />
          <EquipeAgora conversas={conversas} online={online} />
        </div>

        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Atalhos</p>
        <div className="flex flex-wrap gap-2">
          {atalhos.map(a => (
            <button key={a.title} onClick={() => navigate(a.href)}
              className="group inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
              <a.icon className="w-4 h-4 text-gray-400 group-hover:text-blue-500" />
              {a.title}
              <ArrowRight className="w-3 h-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </button>
          ))}
        </div>

        <Rodape />
      </div>
    </div>
  );
}

export default function Inbox() {
  const { online = [], currentUser, onOpenSidebar, onChatMobileChange } = useOutletContext() || {};
  const [conversas, setConversas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [slaMinutos, setSlaMinutos] = useState(0);
  const [painelAberto, setPainelAberto] = useState(() => lerPreferencia(PREF, true));
  const [searchParams] = useSearchParams();
  const convIdsRef = useRef(null);
  const novaIdRef = useRef(null);
  const tocarNotificacao = useNotificationSound();

  useEffect(() => {
    api.get('/tenants/me/horarios').then(r => {
      if (r.data?.slaMinutos) setSlaMinutos(Number(r.data.slaMinutos));
    }).catch(() => {});
  }, []);

  const view = searchParams.get('view') || 'todos';
  const filialId = searchParams.get('filial') || null;
  const conversaParam = searchParams.get('conversa') || null;

  useEffect(() => {
    setSelecionada(null);
  }, [view, filialId]);

  // Deep link de outras telas (Lembretes, Contratos): abre direto a conversa
  // indicada, mesmo que ela não esteja na lista carregada agora — encerradas
  // mais antigas que o limite trazido por GET /conversations não vêm nela.
  useEffect(() => {
    if (!conversaParam) return;
    const jaCarregada = conversas.find(c => c.id === conversaParam);
    if (jaCarregada) { setSelecionada(jaCarregada); return; }
    api.get(`/conversations/${conversaParam}`)
      .then(r => setSelecionada(r.data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaParam]);

  useEffect(() => {
    onChatMobileChange?.(!!selecionada);
    return () => onChatMobileChange?.(false);
  }, [selecionada, onChatMobileChange]);

  // As abertas mudam o tempo todo; as encerradas quase nunca. Vinham juntas a
  // cada 5 segundos — as 150 encerradas mais recentes em toda consulta. Agora
  // cada parte tem o seu ritmo e a lista exibida é a junção das duas.
  const abertasRef = useRef([]);
  const encerradasRef = useRef([]);
  const juntarListas = () => {
    const idsAbertas = new Set(abertasRef.current.map(c => c.id));
    // Reaberta há pouco ainda pode estar na lista de encerradas antiga: a
    // versão aberta é a que vale.
    return [...abertasRef.current, ...encerradasRef.current.filter(c => !idsAbertas.has(c.id))];
  };

  const carregarEncerradas = useCallback(async () => {
    const { data } = await api.get('/conversations', { params: { escopo: 'encerradas' } });
    encerradasRef.current = data;
    const todas = juntarListas();
    setConversas(todas);
    setSelecionada(prev => (prev ? todas.find(c => c.id === prev.id) || prev : prev));
  }, []);

  const carregarConversas = useCallback(async () => {
    const { data } = await api.get('/conversations', { params: { escopo: 'abertas' } });

    // Conversa recém-iniciada pelo atendente: abre assim que entrar na lista
    if (novaIdRef.current) {
      const nova = data.find(c => c.id === novaIdRef.current);
      if (nova) { novaIdRef.current = null; setSelecionada(nova); }
    }

    if (convIdsRef.current !== null) {
      const temNova = data.some(c => !convIdsRef.current.has(c.id));
      if (temNova) tocarNotificacao();
    }
    convIdsRef.current = new Set(data.map(c => c.id));

    abertasRef.current = data;
    const todas = juntarListas();
    setConversas(todas);

    // Pela forma funcional, de propósito. Antes isto lia `selecionada` do
    // fechamento de quando a busca começou: clicar noutra conversa enquanto uma
    // requisição estava no ar fazia a resposta antiga chegar depois e devolver a
    // seleção para a conversa anterior — a tela "voltava" sozinha. `prev` é
    // sempre a conversa aberta agora, não a de quando a busca saiu.
    setSelecionada(prev => (prev ? todas.find(c => c.id === prev.id) || prev : prev));
  }, [tocarNotificacao]);

  usePolling(carregarConversas, 5000);
  usePolling(carregarEncerradas, 60000);

  // Ação do atendente (encerrar, transferir, assumir) pode mover a conversa de
  // uma lista para a outra — aí as duas atualizam na hora, sem esperar o ciclo.
  const atualizarTudo = useCallback(() => {
    carregarConversas();
    carregarEncerradas();
  }, [carregarConversas, carregarEncerradas]);

  // Quem abre o Histórico quer ver o que acabou de encerrar, não a lista de
  // até um minuto atrás.
  useEffect(() => {
    if (view === 'historico') carregarEncerradas();
  }, [view, carregarEncerradas]);

  return (
    <div className="flex h-full md:gap-3">
      {/* Lista — ocupa tela toda no mobile quando não há conversa selecionada */}
      <div className={`h-full min-w-0 ${selecionada ? 'hidden md:block' : 'flex-1 md:flex-none'}`}>
        <ConversationList
          conversas={conversas}
          selecionada={selecionada}
          onSelecionar={setSelecionada}
          onConversaCriada={id => { novaIdRef.current = id; carregarConversas(); }}
          view={filialId ? 'filial' : view}
          filialId={filialId}
          online={online}
          currentUser={currentUser}
          slaMinutos={slaMinutos}
          onOpenSidebar={onOpenSidebar}
        />
      </div>

      {/* Chat/Welcome — escondido no mobile quando nenhuma conversa está aberta */}
      <div className={`flex-1 flex overflow-hidden ${!selecionada ? 'hidden md:flex' : ''}`}>
        {selecionada ? (
          <>
            <div className="flex-1 overflow-hidden">
              <ChatWindow
                conversa={selecionada}
                onAtualizar={atualizarTudo}
                onVoltar={() => setSelecionada(null)}
                painelAberto={painelAberto}
                onTogglePainel={() => setPainelAberto(v => { gravarPreferencia(PREF, !v); return !v; })}
              />
            </div>
            {painelAberto && (
              <div className="hidden md:block">
                <ClientInfoPanel conversa={selecionada} onAtualizar={atualizarTudo} conversas={conversas} />
              </div>
            )}
          </>
        ) : (
          <WelcomePanel
            currentUser={currentUser}
            conversas={conversas}
            online={online}
            slaMinutos={slaMinutos}
            onAbrir={setSelecionada}
          />
        )}
      </div>
    </div>
  );
}
