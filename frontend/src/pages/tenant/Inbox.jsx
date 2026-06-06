import { useState, useCallback } from 'react';
import api from '../../lib/api.js';
import { usePolling } from '../../hooks/usePolling.js';
import ConversationList from '../../components/ConversationList.jsx';
import ChatWindow from '../../components/ChatWindow.jsx';
import ClientInfoPanel from '../../components/ClientInfoPanel.jsx';
import { MessageSquare } from 'lucide-react';

export default function Inbox() {
  const [conversas, setConversas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [filtro, setFiltro] = useState('todos');

  const carregarConversas = useCallback(async () => {
    const { data } = await api.get('/conversations');
    setConversas(data);
    // atualiza conversa selecionada se ela ainda existir
    if (selecionada) {
      const atualizada = data.find(c => c.id === selecionada.id);
      if (atualizada) setSelecionada(atualizada);
    }
  }, [selecionada?.id]);

  usePolling(carregarConversas, 5000);

  const handleSelecionar = c => setSelecionada(c);
  const handleAtualizar = () => carregarConversas();

  return (
    <div className="flex h-full">
      <ConversationList
        conversas={conversas}
        selecionada={selecionada}
        onSelecionar={handleSelecionar}
        filtro={filtro}
        onFiltro={setFiltro}
      />

      <div className="flex-1 flex overflow-hidden">
        {selecionada ? (
          <>
            <div className="flex-1 overflow-hidden">
              <ChatWindow
                conversa={selecionada}
                onAtualizar={handleAtualizar}
              />
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
