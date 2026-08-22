import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import { AlertTriangle, Plus, Check, X, Loader2, Clock, ShieldCheck } from 'lucide-react';

function tempoRelativo(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const FORM_VAZIO = { titulo: '', descricao: '', mensagemBot: '' };

export default function Incidentes() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [showForm, setShowForm] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = () =>
    api.get('/incidentes').then(r => setLista(r.data)).finally(() => setLoading(false));

  useEffect(() => { carregar(); }, []);

  const criar = async () => {
    if (!form.titulo.trim()) return;
    setSaving(true);
    setErro('');
    try {
      await api.post('/incidentes', form);
      setForm(FORM_VAZIO);
      setShowForm(false);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao criar incidente');
    } finally { setSaving(false); }
  };

  const resolver = async (id) => {
    await api.patch(`/incidentes/${id}`, { status: 'resolvido' });
    carregar();
  };

  const excluir = async (id) => {
    await api.delete(`/incidentes/${id}`);
    carregar();
  };

  const ativos = lista.filter(i => i.status === 'ativo');
  const resolvidos = lista.filter(i => i.status === 'resolvido');

  if (loading) return <div className="p-8 text-gray-500 text-sm">Carregando...</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-2xl">

        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Central de Incidentes</h1>
            <p className="text-sm text-gray-500 mt-1">
              Declare uma queda ou instabilidade: o bot responde automaticamente a todos os clientes que entrarem em contato enquanto o incidente estiver ativo.
            </p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="shrink-0 flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> Declarar incidente
            </button>
          )}
        </div>

        {/* Formulário novo incidente */}
        {showForm && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
            <h2 className="font-semibold text-red-800 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Declarar novo incidente
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-red-700 mb-1">Título do incidente *</label>
                <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  placeholder="Ex: Queda de link na Região Norte"
                  className="w-full border border-red-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-red-700 mb-1">Descrição interna (opcional)</label>
                <textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  placeholder="Detalhes internos sobre o incidente — não enviado aos clientes"
                  rows={2}
                  className="w-full border border-red-200 bg-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-red-700 mb-1">Mensagem automática para clientes</label>
                <textarea value={form.mensagemBot} onChange={e => setForm(f => ({ ...f, mensagemBot: e.target.value }))}
                  placeholder="Deixe em branco para usar a mensagem padrão. Ex: ⚠️ Instabilidade na Região Norte — nossa equipe já está atuando. Previsão: 2h."
                  rows={3}
                  className="w-full border border-red-200 bg-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                <p className="text-xs text-red-500 mt-1">
                  Esta mensagem será enviada a todos os clientes que entrarem em contato enquanto o incidente estiver ativo.
                </p>
              </div>
              {erro && <p className="text-sm text-red-700 bg-red-100 rounded-lg px-3 py-2">{erro}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={criar} disabled={saving || !form.titulo.trim()}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                  Declarar ativo
                </button>
                <button onClick={() => { setShowForm(false); setForm(FORM_VAZIO); setErro(''); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status atual */}
        {ativos.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">Nenhum incidente ativo</p>
              <p className="text-xs text-green-600 mt-0.5">Seus clientes estão sendo atendidos normalmente pelo bot.</p>
            </div>
          </div>
        ) : (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" />
              Incidentes ativos ({ativos.length})
            </h2>
            <div className="space-y-3">
              {ativos.map(inc => (
                <div key={inc.id} className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-red-800 mb-1">{inc.titulo}</p>
                      {inc.descricao && (
                        <p className="text-xs text-red-600 mb-2">{inc.descricao}</p>
                      )}
                      {inc.mensagemBot && (
                        <div className="bg-white border border-red-200 rounded-lg p-2.5 mb-2">
                          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Mensagem enviada aos clientes</p>
                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{inc.mensagemBot}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-red-400">
                        <Clock className="w-3 h-3" />
                        Declarado {tempoRelativo(inc.criadoEm)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button onClick={() => resolver(inc.id)}
                        className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                        <Check className="w-3.5 h-3.5" /> Resolver
                      </button>
                      <button onClick={() => excluir(inc.id)}
                        className="flex items-center gap-1.5 justify-center text-red-300 hover:text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs transition-colors">
                        <X className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Histórico */}
        {resolvidos.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Histórico</h2>
            <div className="space-y-2">
              {resolvidos.slice(0, 20).map(inc => (
                <div key={inc.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 font-medium truncate">{inc.titulo}</p>
                    <p className="text-xs text-gray-500">
                      {tempoRelativo(inc.criadoEm)}
                      {inc.resolvidoEm && ` → resolvido ${tempoRelativo(inc.resolvidoEm)}`}
                    </p>
                  </div>
                  <button onClick={() => excluir(inc.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
