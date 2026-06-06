import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import { Building2, MessageSquare, AlertCircle, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/tenants'),
      api.get('/conversations'),
    ]).then(([t, c]) => {
      setTenants(t.data);
      setConversations(c.data);
    }).finally(() => setLoading(false));
  }, []);

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
