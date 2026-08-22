import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useNotificationSound } from '../../hooks/useNotificationSound.js';
import ConversationList from '../../components/ConversationList.jsx';
import ChatWindow from '../../components/ChatWindow.jsx';
import ClientInfoPanel from '../../components/ClientInfoPanel.jsx';
import { Bot, Zap, Users, BarChart2, Star, MessageCircle, ArrowRight, BookUser, ExternalLink, Clock, UserCheck } from 'lucide-react';
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

const CARDS = [
  {
    icon: BookUser,
    bg: 'bg-sky-100',
    color: 'text-sky-600',
    title: 'Contatos',
    desc: 'Salve o número dos clientes e inicie uma conversa a partir da agenda.',
    href: '/contatos',
    label: 'Abrir agenda',
  },
  {
    icon: MessageCircle,
    bg: 'bg-green-100',
    color: 'text-green-600',
    title: 'WhatsApp Business',
    desc: 'Configure seu número e token para começar a receber mensagens.',
    href: '/settings',
    label: 'Configurar',
    admin: true,
  },
  {
    icon: Bot,
    bg: 'bg-blue-100',
    color: 'text-blue-600',
    title: 'Assistente com IA',
    desc: 'Treine o bot para responder automaticamente 24 horas por dia.',
    href: '/settings',
    label: 'Configurar',
    admin: true,
  },
  {
    icon: Zap,
    bg: 'bg-amber-100',
    color: 'text-amber-600',
    title: 'Atalhos de Resposta',
    desc: 'Crie mensagens prontas para agilizar o atendimento da equipe.',
    href: '/atalhos',
    label: 'Gerenciar',
    admin: true,
  },
  {
    icon: Users,
    bg: 'bg-purple-100',
    color: 'text-purple-600',
    title: 'Equipe & Filiais',
    desc: 'Adicione agentes, defina senhas e organize por filial.',
    href: '/agents',
    label: 'Gerenciar',
    admin: true,
  },
  {
    icon: BarChart2,
    bg: 'bg-indigo-100',
    color: 'text-indigo-600',
    title: 'Relatórios',
    desc: 'Acompanhe volume de atendimentos, tempo de resposta e NPS.',
    href: '/relatorio',
    label: 'Ver relatórios',
    admin: true,
  },
  {
    icon: Star,
    bg: 'bg-teal-100',
    color: 'text-teal-600',
    title: 'Pesquisa de Satisfação',
    desc: 'Colete avaliações automáticas ao encerrar cada atendimento.',
    href: '/nps',
    label: 'Ver avaliações',
    admin: true,
  },
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
    <footer className="mt-12 pt-6 border-t border-gray-200 text-center space-y-1">
      <p className="text-xs text-gray-400">
        ISPDesk — atendimento por WhatsApp para provedores de internet
      </p>
      <p className="text-xs text-gray-400">
        Desenvolvido por{' '}
        <a
          href="https://www.adilsondev.com.br"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-gray-500 hover:text-blue-600 transition-colors"
        >
          adilsondev.com.br
          <ExternalLink className="w-3 h-3" />
        </a>
      </p>
      {build?.data && (
        <p className="text-[10px] text-gray-300 font-mono pt-1">
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
    abertasHoje: desdeHoje('iniciadaEm'),
    encerradasHoje: desdeHoje('encerradaEm'),
  };
}

function Indicador({ icon: Icon, rotulo, valor, detalhe, tom, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-white rounded-2xl border border-gray-200 px-4 py-3.5 ${
        onClick ? 'hover:border-gray-300 hover:shadow-sm transition-all duration-150' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 text-gray-400">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">{rotulo}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${tom || 'text-gray-900'}`}>{valor}</p>
      <p className="text-[11px] text-gray-400 mt-1.5 truncate">{detalhe || ' '}</p>
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
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
        rotulo="Com o assistente"
        valor={r.comAssistente}
        detalhe="respondendo sozinho"
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

function chamada(conversas, isAdmin) {
  const fila = conversas.filter(c => EM_ESPERA.includes(c.status)).length;
  if (fila > 0) {
    return fila === 1
      ? 'Tem 1 conversa esperando atendimento agora.'
      : `Tem ${fila} conversas esperando atendimento agora.`;
  }
  return isAdmin
    ? 'Ninguém na fila. Selecione uma conversa ou ajuste sua plataforma abaixo.'
    : 'Ninguém na fila. Selecione uma conversa na lista ao lado.';
}

function WelcomePanel({ currentUser, conversas = [], online = [], slaMinutos = 0 }) {
  const navigate = useNavigate();
  const nome = currentUser?.nome || '';
  const isAdmin = currentUser?.role === 'admin';
  // As rotas de admin redirecionam quem não tem permissão. Mostrar o atalho
  // para o atendente devolvia ele ao inbox sem explicar nada.
  const cards = CARDS.filter(c => !c.admin || isAdmin);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col items-center justify-start py-12 px-8">
      <div className="w-full max-w-2xl">
        {/* Logo + greeting */}
        <div className="flex flex-col items-center text-center mb-8">
          <img src="/logoisp.png" alt="Logo" className="h-16 rounded-xl mb-6 shadow-sm" />
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{saudacao(nome)}</h1>
          <p className="text-gray-500 text-sm">{chamada(conversas, isAdmin)}</p>
        </div>

        <PainelAgora
          conversas={conversas}
          online={online}
          slaMinutos={slaMinutos}
          navigate={navigate}
        />

        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {isAdmin ? 'Configurar a plataforma' : 'Atalhos'}
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-4">
          {cards.map((card, i) => {
            const Icon = card.icon;
            // Grade de duas colunas: com contagem ímpar o último card ficaria
            // sozinho, quebrando o alinhamento. Ocupando a linha inteira, a
            // sobra vira intenção.
            const ultimoImpar = cards.length % 2 === 1 && i === cards.length - 1;
            return (
              <button
                key={card.title}
                onClick={() => navigate(card.href)}
                className={`group text-left bg-white rounded-2xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all duration-150 ${ultimoImpar ? 'col-span-2' : ''}`}
              >
                <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <p className="text-sm font-semibold text-gray-900 mb-1">{card.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{card.desc}</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 group-hover:gap-2 transition-all">
                  {card.label}
                  <ArrowRight className="w-3 h-3" />
                </span>
              </button>
            );
          })}
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

  useEffect(() => {
    setSelecionada(null);
  }, [view, filialId]);

  useEffect(() => {
    onChatMobileChange?.(!!selecionada);
    return () => onChatMobileChange?.(false);
  }, [selecionada, onChatMobileChange]);

  const carregarConversas = useCallback(async () => {
    const { data } = await api.get('/conversations');

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

    setConversas(data);
    if (selecionada) {
      const atualizada = data.find(c => c.id === selecionada.id);
      if (atualizada) setSelecionada(atualizada);
    }
  }, [selecionada?.id, tocarNotificacao]);

  usePolling(carregarConversas, 5000);

  return (
    <div className="flex h-full">
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
                onAtualizar={carregarConversas}
                onVoltar={() => setSelecionada(null)}
                painelAberto={painelAberto}
                onTogglePainel={() => setPainelAberto(v => { gravarPreferencia(PREF, !v); return !v; })}
              />
            </div>
            {painelAberto && (
              <div className="hidden md:block">
                <ClientInfoPanel conversa={selecionada} onAtualizar={carregarConversas} conversas={conversas} />
              </div>
            )}
          </>
        ) : (
          <WelcomePanel
            currentUser={currentUser}
            conversas={conversas}
            online={online}
            slaMinutos={slaMinutos}
          />
        )}
      </div>
    </div>
  );
}
