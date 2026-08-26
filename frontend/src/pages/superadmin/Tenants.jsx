import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api.js';
import { useNavigate } from 'react-router-dom';
import { precoPlano, ORDEM_PLANOS, labelPlano } from '../../lib/planos.js';
import { Plus, X, Loader2, Building2, Upload } from 'lucide-react';

const PLANO_BADGE = {
  basic:      'bg-gray-700/60 text-gray-300',
  exclusivo:  'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  pro:        'bg-blue-900/50 text-blue-300 border border-blue-800',
  enterprise: 'bg-amber-900/50 text-amber-300 border border-amber-800',
};

const FORM_VAZIO = {
  slug: '', nome: '', corPrimaria: '#0066CC', whatsappNumberId: '',
  whatsappToken: '', systemPrompt: '', nomeAssistente: 'Assistente', plano: 'basic', logoUrl: '',
};

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [erroLista, setErroLista] = useState('');
  const navigate = useNavigate();
  const fileRef = useRef(null);

  // O catch não existia: uma busca que falhasse deixava a lista vazia e a tela
  // parecia dizer que não há provedor cadastrado.
  const carregar = () => api.get('/tenants')
    .then(r => { setTenants(r.data); setErroLista(''); })
    .catch(err => setErroLista(err.response?.data?.erro
      || (err.response ? `O servidor respondeu ${err.response.status}.` : 'Sem resposta do servidor.')));
  useEffect(() => { carregar(); }, []);

  const handleLogoUpload = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, logoUrl: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleSalvar = async e => {
    e.preventDefault();
    setSaving(true);
    setErro('');
    try {
      await api.post('/tenants', form);
      setModal(false);
      setForm(FORM_VAZIO);
      carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Provedores</h1>
          <p className="text-gray-400 text-sm mt-1">{tenants.length} provedores cadastrados</p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo provedor
        </button>
      </div>

      {erroLista && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4">
          <p className="text-sm text-red-300 font-medium">Não foi possível carregar os provedores.</p>
          <p className="text-xs text-red-400/80 mt-1">{erroLista}</p>
          <button onClick={carregar}
            className="mt-3 text-xs font-medium text-red-200 hover:text-white underline underline-offset-2">
            Tentar de novo
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {tenants.map(t => (
          <div key={t.id} className="bg-gray-800 rounded-xl border border-gray-700 p-5 flex items-center justify-between hover:border-gray-600 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0"
                style={{ backgroundColor: t.logoUrl ? 'transparent' : t.corPrimaria }}>
                {t.logoUrl
                  ? <img src={t.logoUrl} alt={t.nome} className="w-full h-full object-contain" />
                  : t.nome[0]
                }
              </div>
              <div>
                <p className="text-white font-medium">{t.nome}</p>
                <p className="text-gray-500 text-xs">{t.slug}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PLANO_BADGE[t.plano] || PLANO_BADGE.basic}`}>
                {t.plano} · {precoPlano(t.plano)}
              </span>
              <span className={`text-xs px-2 py-1 rounded-full ${t.ativo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                {t.ativo ? 'Ativo' : 'Inativo'}
              </span>
              <button
                onClick={() => navigate(`/admin/tenants/${t.id}`)}
                className="text-indigo-400 hover:text-indigo-300 text-sm font-medium"
              >
                Gerenciar →
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <h2 className="text-white font-semibold">Novo provedor</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSalvar} className="p-5 space-y-4">
              {/* logo */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Logo do provedor</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
                    {form.logoUrl
                      ? <img src={form.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                      : <Building2 className="w-6 h-6 text-gray-600" />
                    }
                  </div>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg">
                    <Upload className="w-3.5 h-3.5" />
                    {form.logoUrl ? 'Trocar' : 'Enviar logo'}
                  </button>
                  {form.logoUrl && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, logoUrl: '' }))}
                      className="text-xs text-red-400 hover:text-red-300">Remover</button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nome*" value={form.nome} onChange={v => setForm(f => ({ ...f, nome: v }))} />
                <Field label="Slug*" value={form.slug} onChange={v => setForm(f => ({ ...f, slug: v }))} placeholder="meu-provedor" />
              </div>
              <Field label="Nome do assistente" value={form.nomeAssistente} onChange={v => setForm(f => ({ ...f, nomeAssistente: v }))} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Cor primária</label>
                  <input type="color" value={form.corPrimaria}
                    onChange={e => setForm(f => ({ ...f, corPrimaria: e.target.value }))}
                    className="w-full h-10 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Plano</label>
                  <select value={form.plano} onChange={e => setForm(f => ({ ...f, plano: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
                    {ORDEM_PLANOS.map(v => (
                      <option key={v} value={v}>{labelPlano(v)} — {precoPlano(v)}/mês</option>
                    ))}
                  </select>
                </div>
              </div>
              <Field label="WhatsApp Number ID" value={form.whatsappNumberId}
                onChange={v => setForm(f => ({ ...f, whatsappNumberId: v }))} />
              <Field label="WhatsApp Token" type="password" value={form.whatsappToken}
                onChange={v => setForm(f => ({ ...f, whatsappToken: v }))} />
              <div>
                <label className="block text-xs text-gray-400 mb-1">System Prompt*</label>
                <textarea rows={5} value={form.systemPrompt}
                  onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Você é um assistente virtual do provedor..." />
              </div>
              {erro && <p className="text-red-400 text-sm">{erro}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 text-sm">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Criar provedor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}
