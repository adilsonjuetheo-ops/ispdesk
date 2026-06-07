import { useState, useCallback, useRef } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import api from '../../lib/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import { useNotificationSound } from '../../hooks/useNotificationSound.js';
import ConversationList from '../../components/ConversationList.jsx';
import ChatWindow from '../../components/ChatWindow.jsx';
import ClientInfoPanel from '../../components/ClientInfoPanel.jsx';
import { MessageSquare } from 'lucide-react';

export default function Inbox() {
  const { online = [], currentUser } = useOutletContext() || {};
  const [conversas, setConversas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [searchParams] = useSearchParams();
  const convIdsRef = useRef(null);
  const tocarNotificacao = useNotificationSound();

  const view = searchParams.get('view') || 'todos';
  const filialId = searchParams.get('filial') || null;

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
      />

      <div className="flex-1 flex overflow-hidden">
        {selecionada ? (
          <>
            <div className="flex-1 overflow-hidden">
              <ChatWindow conversa={selecionada} onAtualizar={carregarConversas} />
            </div>
            <ClientInfoPanel conversa={selecionada} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Selecione uma conversa para começar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
