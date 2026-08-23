import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, Check, Trash2, User, MessageSquare, Loader2, RotateCcw } from 'lucide-react';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import api from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.js';

// Prazo em linguagem de gente. "Venceu ontem" pesa mais que "22/08 14:00" numa
// lista que existe para cobrar ação.
function prazo(venceEm) {
  if (!venceEm) return { texto: 'Sem prazo', cor: 'text-gray-400' };
  const d = new Date(venceEm);
  const hora = format(d, 'HH:mm');
  if (isPast(d) && !isToday(d)) {
    return { texto: `Venceu ${format(d, "d 'de' MMM", { locale: ptBR })}`, cor: 'text-red-600 font-semibold' };
  }
  if (isToday(d)) {
    return { texto: isPast(d) ? `Venceu hoje às ${hora}` : `Hoje às ${hora}`,
      cor: isPast(d) ? 'text-red-600 font-semibold' : 'text-amber-600 font-medium' };
  }
  if (isTomorrow(d)) return { texto: `Amanhã às ${hora}`, cor: 'text-amber-600' };
  return { texto: format(d, "d 'de' MMM 'às' HH:mm", { locale: ptBR }), cor: 'text-gray-500' };
}

export default function Lembretes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('abertos');
  const [somenteMeus, setSomenteMeus] = useState(false);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [agindo, setAgindo] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get('/lembretes', { params: { status, meus: somenteMeus || undefined } });
      setLista(data);
    } catch { setLista([]); }
    finally { setCarregando(false); }
  }, [status, somenteMeus]);

  useEffect(() => { carregar(); }, [carregar]);

  const concluir = async (id, reabrir = false) => {
    setAgindo(id);
    try {
      await api.patch(`/lembretes/${id}/concluir`, { reabrir });
      // Avisa a barra lateral para o contador não ficar desatualizado.
      window.dispatchEvent(new CustomEvent('ispdesk:lembretes-updated'));
      await carregar();
    } finally { setAgindo(null); }
  };

  const apagar = async (id) => {
    if (!confirm('Apagar este lembrete?')) return;
    setAgindo(id);
    try {
      await api.delete(`/lembretes/${id}`);
      window.dispatchEvent(new CustomEvent('ispdesk:lembretes-updated'));
      await carregar();
    } finally { setAgindo(null); }
  };

  const aba = (chave, rotulo) => (
    <button onClick={() => setStatus(chave)}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        status === chave ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
      }`}>
      {rotulo}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-3xl">
        <div className="flex items-center gap-2 mb-1">
          <BellRing className="w-5 h-5 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-800">Lembretes</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Tarefas que a equipe precisa resolver. Criadas na aba <strong>Lembrete</strong> de
          uma conversa, ou soltas aqui.
        </p>

        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {aba('abertos', 'Em aberto')}
          {aba('concluidos', 'Concluídos')}
          <label className="flex items-center gap-2 text-sm text-gray-500 ml-auto cursor-pointer">
            <input type="checkbox" checked={somenteMeus} onChange={e => setSomenteMeus(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-400" />
            Só os meus
          </label>
        </div>

        {carregando ? (
          <p className="text-sm text-gray-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </p>
        ) : lista.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <BellRing className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {status === 'abertos'
                ? 'Nenhum lembrete em aberto. Tudo resolvido.'
                : 'Nenhum lembrete concluído ainda.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {lista.map(l => {
              const p = prazo(l.venceEm);
              const concluido = !!l.concluidoEm;
              return (
                <div key={l.id}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3">
                  <button
                    onClick={() => concluir(l.id, concluido)}
                    disabled={agindo === l.id}
                    title={concluido ? 'Reabrir' : 'Marcar como resolvido'}
                    className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      concluido
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-gray-300 hover:border-emerald-500 hover:bg-emerald-50'
                    }`}>
                    {concluido
                      ? <Check className="w-3.5 h-3.5" />
                      : agindo === l.id ? <Loader2 className="w-3 h-3 animate-spin text-gray-400" /> : null}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-relaxed ${concluido ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {l.texto}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap mt-1.5 text-xs">
                      {!concluido && <span className={p.cor}>{p.texto}</span>}
                      {concluido && (
                        <span className="text-gray-400">
                          Concluído {format(new Date(l.concluidoEm), "d 'de' MMM", { locale: ptBR })}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-gray-500">
                        <User className="w-3 h-3" />
                        {l.responsavelNome || 'Equipe'}
                      </span>
                      {l.clienteNome && (
                        <button
                          onClick={() => navigate(l.conversaId ? `/inbox?conversa=${l.conversaId}` : '/inbox')}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors">
                          <MessageSquare className="w-3 h-3" />
                          {l.clienteNome}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {concluido && (
                      <button onClick={() => concluir(l.id, true)} title="Reabrir"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => apagar(l.id)} title="Apagar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
