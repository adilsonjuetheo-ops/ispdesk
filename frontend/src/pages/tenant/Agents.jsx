import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { Plus, X, Loader2, Pencil, UserX, MapPin } from 'lucide-react';

const FORM_VAZIO = { nome: '', email: '', senha: '', confirmar: '', role: 'agente', filialId: '' };

export default function Agents() {
  const { user } = useAuth();
  const [agentes, setAgentes] = useState([]);
  const [filiais, setFiliais] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = () =>
    api.get(`/tenants/${user.tenantId}/agents`).then(r => setAgentes(r.data)).finally(() => setLoading(false));

  useEffect(() => {
    carregar();
    api.get(`/tenants/${user.tenantId}/filiais`).then(r => setFiliais(r.data.filter(f => f.ativo)));
  }, []);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_VAZIO);
    setErro('');
    setModal(true);
  };

  const abrirEditar = ag => {
    setEditando(ag);
    setForm({ nome: ag.nome, email: ag.email, senha: '', confirmar: '', role: ag.role, filialId: ag.filialId || '' });
    setErro('');
    setModal(true);
  };

  const handleSalvar = async e => {
    e.preventDefault();
    setErro('');
    if (!editando && form.senha.length < 6) return setErro('Senha mínimo 6 caracteres');
    if (form.senha && form.senha !== form.confirmar) return setErro('Senhas não conferem');

    setSaving(true);
    try {
      const payload = { nome: form.nome, email: form.email, role: form.role, filialId: form.filialId || null };
      if (form.senha) payload.senha = form.senha;

      if (editando) {
        await api.put(`/tenants/${user.tenantId}/agents/${editando.id}`, payload);
      } else {
        payload.senha = form.senha;
        await api.post(`/tenants/${user.tenantId}/agents`, payload);
      }
      setModal(false);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDesativar = async ag => {
    if (!confirm(`Desativar ${ag.nome}?`)) return;
    await api.delete(`/tenants/${user.tenantId}/agents/${ag.id}`);
    carregar();
  };

  const filialNome = id => filiais.find(f => f.id === id)?.nome;

  if (loading) return <div className="p-8 text-gray-400">Carregando...</div>;

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Equipe</h1>
          <p className="text-gray-500 text-sm mt-0.5">{agentes.length} funcionários cadastrados</p>
        </div>
        <button onClick={abrirNovo}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> Novo funcionário
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-200">
              <th className="text-left px-5 py-3">Funcionário</th>
              <th className="text-left px-5 py-3">Filial</th>
              <th className="text-left px-5 py-3">Papel</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {agentes.map(ag => (
              <tr key={ag.id} className="border-b border-gray-100 last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs">
                      {ag.nome[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{ag.nome}</p>
                      <p className="text-xs text-gray-400">{ag.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  {ag.filialId ? (
                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                      <MapPin className="w-3 h-3" />{filialNome(ag.filialId) || '—'}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Todas</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">{ag.role}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ag.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {ag.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => abrirEditar(ag)} className="text-gray-400 hover:text-blue-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {ag.ativo && (
                      <button onClick={() => handleDesativar(ag)} className="text-gray-400 hover:text-red-500">
                        <UserX className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm border border-gray-200 shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="font-semibold text-gray-800">{editando ? 'Editar funcionário' : 'Novo funcionário'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSalvar} className="p-5 space-y-3">
              <Field label="Nome*" value={form.nome} onChange={v => setForm(f => ({ ...f, nome: v }))} />
              <Field label="E-mail*" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
              <Field label={editando ? 'Nova senha (opcional)' : 'Senha*'} value={form.senha}
                onChange={v => setForm(f => ({ ...f, senha: v }))} type="password" />
              <Field label="Confirmar senha" value={form.confirmar}
                onChange={v => setForm(f => ({ ...f, confirmar: v }))} type="password" />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Papel</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="agente">Agente</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {filiais.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Filial / Cidade</label>
                  <select value={form.filialId} onChange={e => setForm(f => ({ ...f, filialId: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Todas as filiais</option>
                    {filiais.map(f => (
                      <option key={f.id} value={f.id}>{f.nome} — {f.cidade}</option>
                    ))}
                  </select>
                </div>
              )}
              {erro && <p className="text-red-500 text-sm">{erro}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}
