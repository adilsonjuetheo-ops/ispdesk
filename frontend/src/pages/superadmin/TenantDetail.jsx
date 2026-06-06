import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { ArrowLeft, Plus, X, Loader2, Pencil, Trash2, Save } from 'lucide-react';

export default function TenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [agentes, setAgentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');
  const [modalAgente, setModalAgente] = useState(false);
  const [formAgente, setFormAgente] = useState({ nome: '', email: '', senha: '', role: 'agente' });
  const [editandoAgente, setEditandoAgente] = useState(null);

  const carregar = () =>
    api.get(`/tenants/${id}`).then(r => {
      setTenant(r.data);
      setAgentes(r.data.agentes || []);
    }).finally(() => setLoading(false));

  useEffect(() => { carregar(); }, [id]);

  const handleSalvarTenant = async e => {
    e.preventDefault();
    setSaving(true);
    setErro(''); setSucesso('');
    try {
      await api.put(`/tenants/${id}`, tenant);
      setSucesso('Salvo com sucesso!');
      setTimeout(() => setSucesso(''), 3000);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleSalvarAgente = async e => {
    e.preventDefault();
    setSaving(true);
    setErro('');
    try {
      if (editandoAgente) {
        await api.put(`/tenants/${id}/agents/${editandoAgente.id}`, formAgente);
      } else {
        await api.post(`/tenants/${id}/agents`, formAgente);
      }
      setModalAgente(false);
      setFormAgente({ nome: '', email: '', senha: '', role: 'agente' });
      setEditandoAgente(null);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar agente');
    } finally {
      setSaving(false);
    }
  };

  const abrirEditar = ag => {
    setEditandoAgente(ag);
    setFormAgente({ nome: ag.nome, email: ag.email, senha: '', role: ag.role });
    setModalAgente(true);
  };

  const desativar = async ag => {
    await api.delete(`/tenants/${id}/agents/${ag.id}`);
    carregar();
  };

  if (loading) return <div className="p-8 text-gray-400">Carregando...</div>;
  if (!tenant) return <div className="p-8 text-red-400">Provedor não encontrado</div>;

  return (
    <div className="p-8 max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-2xl font-bold text-white mb-8">{tenant.nome}</h1>

      <form onSubmit={handleSalvarTenant} className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Dados do provedor</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field dark label="Nome" value={tenant.nome} onChange={v => setTenant(t => ({ ...t, nome: v }))} />
          <Field dark label="Slug" value={tenant.slug} onChange={v => setTenant(t => ({ ...t, slug: v }))} />
          <Field dark label="Nome do assistente" value={tenant.nomeAssistente || ''} onChange={v => setTenant(t => ({ ...t, nomeAssistente: v }))} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Plano</label>
            <select value={tenant.plano} onChange={e => setTenant(t => ({ ...t, plano: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <Field dark label="WhatsApp Number ID" value={tenant.whatsappNumberId || ''} onChange={v => setTenant(t => ({ ...t, whatsappNumberId: v }))} />
          <Field dark label="WhatsApp Token" value={tenant.whatsappToken || ''} onChange={v => setTenant(t => ({ ...t, whatsappToken: v }))} />
        </div>
        {/* SGP */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Sistema de gestão (SGP)</label>
          <div className="grid grid-cols-2 gap-4">
            <select value={tenant.sgpTipo || ''} onChange={e => setTenant(t => ({ ...t, sgpTipo: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
              <option value="">Nenhum</option>
              <option value="atlaz">Atlaz</option>
              <option value="ixc">IXC Soft</option>
              <option value="mkauth">MK-Auth</option>
              <option value="generico">Outro (genérico)</option>
            </select>
            {['ixc', 'mkauth', 'generico'].includes(tenant.sgpTipo) && (
              <Field dark label="" value={tenant.sgpApiUrl || ''}
                onChange={v => setTenant(t => ({ ...t, sgpApiUrl: v }))}
                placeholder="URL base da API (https://...)" />
            )}
          </div>
          {tenant.sgpTipo && (
            <div className="mt-2">
              <Field dark
                label={
                  tenant.sgpTipo === 'atlaz'    ? 'Token Atlaz' :
                  tenant.sgpTipo === 'ixc'      ? 'Credencial IXC (usuário:token)' :
                  tenant.sgpTipo === 'mkauth'   ? 'Auth token MK-Auth' :
                  'Token de autenticação'
                }
                value={tenant.sgpApiKey || ''}
                onChange={v => setTenant(t => ({ ...t, sgpApiKey: v }))}
                placeholder="Token da API"
              />
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">System Prompt</label>
          <textarea rows={6} value={tenant.systemPrompt}
            onChange={e => setTenant(t => ({ ...t, systemPrompt: e.target.value }))}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
          <p className="text-xs text-gray-500 mb-1">Webhook Verify Token (gerado automaticamente)</p>
          <code className="text-xs text-indigo-300 break-all">{tenant.webhookVerifyToken}</code>
        </div>
        {sucesso && <p className="text-emerald-400 text-sm mb-3">{sucesso}</p>}
        {erro && <p className="text-red-400 text-sm mb-3">{erro}</p>}
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2 rounded-lg text-sm font-medium">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
      </form>

      {/* funcionários */}
      <div className="bg-gray-800 rounded-xl border border-gray-700">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-white font-semibold">Funcionários</h2>
          <button onClick={() => { setEditandoAgente(null); setFormAgente({ nome: '', email: '', senha: '', role: 'agente' }); setModalAgente(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="text-left px-5 py-3">Nome</th>
              <th className="text-left px-5 py-3">E-mail</th>
              <th className="text-left px-5 py-3">Papel</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {agentes.map(ag => (
              <tr key={ag.id} className="border-b border-gray-700/50">
                <td className="px-5 py-3 text-white text-sm">{ag.nome}</td>
                <td className="px-5 py-3 text-gray-400 text-sm">{ag.email}</td>
                <td className="px-5 py-3">
                  <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{ag.role}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ag.ativo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                    {ag.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-5 py-3 flex gap-2 justify-end">
                  <button onClick={() => abrirEditar(ag)} className="text-gray-400 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => desativar(ag)} className="text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAgente && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <h2 className="text-white font-semibold">{editandoAgente ? 'Editar funcionário' : 'Novo funcionário'}</h2>
              <button onClick={() => setModalAgente(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSalvarAgente} className="p-5 space-y-3">
              <Field dark label="Nome*" value={formAgente.nome} onChange={v => setFormAgente(f => ({ ...f, nome: v }))} />
              <Field dark label="E-mail*" value={formAgente.email} onChange={v => setFormAgente(f => ({ ...f, email: v }))} type="email" />
              <Field dark label={editandoAgente ? 'Nova senha (opcional)' : 'Senha*'} value={formAgente.senha}
                onChange={v => setFormAgente(f => ({ ...f, senha: v }))} type="password" />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Papel</label>
                <select value={formAgente.role} onChange={e => setFormAgente(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
                  <option value="agente">Agente</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {erro && <p className="text-red-400 text-sm">{erro}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalAgente(false)}
                  className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
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

function Field({ dark, label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
          dark ? 'bg-gray-900 border-gray-700' : 'bg-gray-800 border-gray-700'
        }`} />
    </div>
  );
}
