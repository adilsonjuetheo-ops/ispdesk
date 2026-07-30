import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useOutletContext, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useNotificationSound } from '../../hooks/useNotificationSound.js';
import ConversationList from '../../components/ConversationList.jsx';
import ChatWindow from '../../components/ChatWindow.jsx';
import ClientInfoPanel from '../../components/ClientInfoPanel.jsx';
import { Bot, Zap, Users, BarChart2, Star, MessageCircle, ArrowRight } from 'lucide-react';

function saudacao(nome) {
  const h = new Date().getHours();
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return nome ? `${periodo}, ${nome.split(' ')[0]}!` : `${periodo}!`;
}

const CARDS = [
  {
    icon: MessageCircle,
    bg: 'bg-green-100',
    color: 'text-green-600',
    title: 'WhatsApp Business',
    desc: 'Configure seu número e token para começar a receber mensagens.',
    href: '/settings',
    label: 'Configurar',
  },
  {
    icon: Bot,
    bg: 'bg-blue-100',
    color: 'text-blue-600',
    title: 'Assistente com IA',
    desc: 'Treine o bot para responder automaticamente 24 horas por dia.',
    href: '/settings',
    label: 'Configurar',
  },
  {
    icon: Zap,
    bg: 'bg-amber-100',
    color: 'text-amber-600',
    title: 'Atalhos de Resposta',
    desc: 'Crie mensagens prontas para agilizar o atendimento da equipe.',
    href: '/atalhos',
    label: 'Gerenciar',
  },
  {
    icon: Users,
    bg: 'bg-purple-100',
    color: 'text-purple-600',
    title: 'Equipe & Filiais',
    desc: 'Adicione agentes, defina senhas e organize por filial.',
    href: '/agents',
    label: 'Gerenciar',
  },
  {
    icon: BarChart2,
    bg: 'bg-indigo-100',
    color: 'text-indigo-600',
    title: 'Relatórios',
    desc: 'Acompanhe volume de atendimentos, tempo de resposta e NPS.',
    href: '/relatorio',
    label: 'Ver relatórios',
  },
  {
    icon: Star,
    bg: 'bg-teal-100',
    color: 'text-teal-600',
    title: 'Pesquisa de Satisfação',
    desc: 'Colete avaliações automáticas ao encerrar cada atendimento.',
    href: '/nps',
    label: 'Ver avaliações',
  },
];

function WelcomePanel({ currentUser }) {
  const navigate = useNavigate();
  const nome = currentUser?.nome || '';

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col items-center justify-start py-12 px-8">
      <div className="w-full max-w-2xl">
        {/* Logo + greeting */}
        <div className="flex flex-col items-center text-center mb-10">
          <img src="/logoisp.png" alt="Logo" className="h-16 rounded-xl mb-6 shadow-sm" />
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{saudacao(nome)}</h1>
          <p className="text-gray-500 text-sm">
            Pronto para atender. Selecione uma conversa ou configure sua plataforma abaixo.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-4">
          {CARDS.map(card => {
            const Icon = card.icon;
            return (
              <button
                key={card.title}
                onClick={() => navigate(card.href)}
                className="group text-left bg-white rounded-2xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all duration-150"
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
      </div>
    </div>
  );
}

export default function Inbox() {
  const { online = [], currentUser } = useOutletContext() || {};
  const [conversas, setConversas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [slaMinutos, setSlaMinutos] = useState(0);
  const [searchParams] = useSearchParams();
  const convIdsRef = useRef(null);
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

  const carregarConversas = useCallback(async () => {
    const { data } = await api.get('/conversations');

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
      <ConversationList
        conversas={conversas}
        selecionada={selecionada}
        onSelecionar={setSelecionada}
        view={filialId ? 'filial' : view}
        filialId={filialId}
        online={online}
        currentUser={currentUser}
        slaMinutos={slaMinutos}
      />

      <div className="flex-1 flex overflow-hidden">
        {selecionada ? (
          <>
            <div className="flex-1 overflow-hidden">
              <ChatWindow conversa={selecionada} onAtualizar={carregarConversas} />
            </div>
            <ClientInfoPanel conversa={selecionada} onAtualizar={carregarConversas} />
          </>
        ) : (
          <WelcomePanel currentUser={currentUser} />
        )}
      </div>
    </div>
  );
}
