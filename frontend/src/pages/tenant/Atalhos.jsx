import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { Plus, Pencil, Trash2, X, Save, Loader2 } from 'lucide-react';

const VAZIO = { titulo: '', atalho: '', conteudo: '' };

export default function Atalhos() {
  const { user } = useAuth();
  const [lista, setLista] = useState([]);
  const [modal, setModal] = useState(null); // null | 'novo' | {id, titulo, atalho, conteudo}
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = () =>
    api.get(`/tenants/${user.tenantId}/atalhos`).then(r => setLista(r.data)).catch(() => {});

  useEffect(() => { carregar(); }, []);

  const abrirNovo = () => { setForm(VAZIO); setErro(''); setModal('novo'); };
  const abrirEditar = (a) => { setForm({ titulo: a.titulo, atalho: a.atalho || '', conteudo: a.conteudo }); setErro(''); setModal(a); };
  const fechar = () => setModal(null);

  const salvar = async () => {
    if (!form.titulo.trim() || !form.conteudo.trim()) { setErro('Título e conteúdo são obrigatórios'); return; }
    setSalvando(true); setErro('');
    try {
      if (modal === 'novo') {
        await api.post(`/tenants/${user.tenantId}/atalhos`, form);
      } else {
        await api.put(`/tenants/${user.tenantId}/atalhos/${modal.id}`, form);
      }
      await carregar();
      fechar();
    } catch (e) {
      setErro(e.response?.data?.erro || 'Erro ao salvar');
    } finally { setSalvando(false); }
  };

  const excluir = async (id) => {
    if (!confirm('Remover este atalho?')) return;
    await api.delete(`/tenants/${user.tenantId}/atalhos/${id}`).catch(() => {});
    carregar();
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Atalhos de Resposta</h1>
          <p className="text-sm text-gray-500 mt-0.5">Textos pré-prontos disponíveis para os atendentes no chat</p>
        </div>
        <button onClick={abrirNovo}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Novo atalho
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Nenhum atalho cadastrado ainda.</p>
          <p className="text-xs mt-1">Clique em "Novo atalho" para começar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(a => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-800 text-sm">{a.titulo}</span>
                  {a.atalho && (
                    <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      {a.atalho}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 line-clamp-2 whitespace-pre-wrap">{a.conteudo}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => abrirEditar(a)}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => excluir(a.id)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                {modal === 'novo' ? 'Novo atalho' : 'Editar atalho'}
              </h2>
              <button onClick={fechar} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Título *</label>
                <input
                  type="text"
                  placeholder="Ex: Formulário de cadastro"
                  value={form.titulo}
                  onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Atalho <span className="text-gray-400 font-normal">(opcional — ex: !cadastro)</span>
                </label>
                <input
                  type="text"
                  placeholder="!meuatalho"
                  value={form.atalho}
                  onChange={e => setForm(f => ({ ...f, atalho: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Conteúdo da mensagem *</label>
                <textarea
                  rows={6}
                  placeholder="Digite o texto que será enviado ao cliente..."
                  value={form.conteudo}
                  onChange={e => setForm(f => ({ ...f, conteudo: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
              {erro && <p className="text-xs text-red-600">{erro}</p>}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={fechar} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
