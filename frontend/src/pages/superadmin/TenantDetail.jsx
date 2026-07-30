import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { ArrowLeft, Plus, X, Loader2, Pencil, Trash2, Save, Upload, Building2, MapPin, AlertTriangle, ToggleLeft, ToggleRight, KeyRound, QrCode, CheckCircle, Clock, Ban } from 'lucide-react';

const PLANOS = [
  { value: 'basic',      label: 'Basic',      preco: 'R$149,90/mês', cor: 'text-gray-300'  },
  { value: 'pro',        label: 'Pro',         preco: 'R$249,90/mês', cor: 'text-blue-400'  },
  { value: 'enterprise', label: 'Enterprise',  preco: 'R$549,90/mês', cor: 'text-amber-400' },
];

const PLANO_BADGE = {
  basic:      'bg-gray-700 text-gray-300',
  pro:        'bg-blue-900/50 text-blue-300 border border-blue-700',
  enterprise: 'bg-amber-900/50 text-amber-300 border border-amber-700',
};

export default function TenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [agentes, setAgentes] = useState([]);
  const [filiais, setFiliais] = useState([]);
  const [formFilial, setFormFilial] = useState({ nome: '', cidade: '', uf: '' });
  const [savingFilial, setSavingFilial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');
  const [modalAgente, setModalAgente] = useState(false);
  const [formAgente, setFormAgente] = useState({ nome: '', email: '', senha: '', role: 'agente' });
  const [editandoAgente, setEditandoAgente] = useState(null);
  const [modalExcluir, setModalExcluir] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState('');
  const [excluindo, setExcluindo] = useState(false);

  const [modalResetSenha, setModalResetSenha] = useState(null);
  const [novaSenhaReset, setNovaSenhaReset] = useState('');
  const [savingReset, setSavingReset] = useState(false);
  const [erroReset, setErroReset] = useState('');
  const fileRef = useRef(null);

  const [gerandoPIX, setGerandoPIX] = useState(false);
  const [pixGerado, setPixGerado] = useState(null); // { pixCopiaECola, ticketUrl }
  const [erroCobranca, setErroCobranca] = useState('');
  const [verificandoPIX, setVerificandoPIX] = useState(false);
  const [resultadoVerif, setResultadoVerif] = useState(null);

  const handleLogoUpload = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setTenant(t => ({ ...t, logoUrl: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const carregarFiliais = () =>
    api.get(`/tenants/${id}/filiais`).then(r => setFiliais(r.data));

  const handleAddFilial = async e => {
    e.preventDefault();
    if (!formFilial.nome || !formFilial.cidade) return;
    setSavingFilial(true);
    try {
      await api.post(`/tenants/${id}/filiais`, formFilial);
      setFormFilial({ nome: '', cidade: '', uf: '' });
      carregarFiliais();
    } finally { setSavingFilial(false); }
  };

  const handleRemoverFilial = async filialId => {
    await api.delete(`/tenants/${id}/filiais/${filialId}`);
    carregarFiliais();
  };

  const carregar = () =>
    api.get(`/tenants/${id}`).then(r => {
      setTenant(r.data);
      setAgentes(r.data.agentes || []);
    }).finally(() => setLoading(false));

  useEffect(() => { carregar(); carregarFiliais(); }, [id]);

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

  const handleToggleAtivo = async () => {
    const novoAtivo = !tenant.ativo;
    await api.put(`/tenants/${id}`, { ...tenant, ativo: novoAtivo });
    setTenant(t => ({ ...t, ativo: novoAtivo }));
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

  const handleResetSenha = async () => {
    if (!novaSenhaReset || novaSenhaReset.length < 10) return setErroReset('Mínimo 10 caracteres');
    setSavingReset(true);
    setErroReset('');
    try {
      await api.put(`/tenants/${id}/agents/${modalResetSenha.id}`, {
        nome: modalResetSenha.nome,
        email: modalResetSenha.email,
        role: modalResetSenha.role,
        senha: novaSenhaReset,
      });
      setModalResetSenha(null);
      setNovaSenhaReset('');
    } catch (err) {
      setErroReset(err.response?.data?.erro || 'Erro ao redefinir senha');
    } finally {
      setSavingReset(false);
    }
  };

  const handleVerificarPagamento = async () => {
    setVerificandoPIX(true);
    setResultadoVerif(null);
    try {
      const { data } = await api.post(`/tenants/${id}/verificar-pagamento`);
      if (data.pago) {
        setTenant(t => ({ ...t, statusPagamento: 'ativo', proximoVencimento: data.proximoVencimento }));
        setResultadoVerif({ ok: true, msg: 'Pagamento confirmado! Status atualizado para ativo.' });
      } else {
        setResultadoVerif({ ok: false, msg: `Pagamento ainda não aprovado no Mercado Pago (status: ${data.statusMP}).` });
      }
    } catch (err) {
      setResultadoVerif({ ok: false, msg: err.response?.data?.erro || 'Erro ao verificar pagamento.' });
    } finally {
      setVerificandoPIX(false);
    }
  };

  const handleGerarCobranca = async () => {
    setGerandoPIX(true);
    setErroCobranca('');
    setPixGerado(null);
    try {
      const { data } = await api.post(`/tenants/${id}/gerar-cobranca`);
      setPixGerado(data);
      setTenant(t => ({ ...t, statusPagamento: 'pendente' }));
    } catch (err) {
      setErroCobranca(err.response?.data?.erro || 'Erro ao gerar cobrança');
    } finally {
      setGerandoPIX(false);
    }
  };

  const handleExcluirDefinitivo = async () => {
    if (confirmaExcluir !== tenant.nome) return;
    setExcluindo(true);
    try {
      await api.delete(`/tenants/${id}/excluir`);
      navigate('/admin/tenants');
    } catch {
      setErro('Erro ao excluir provedor');
      setExcluindo(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Carregando...</div>;
  if (!tenant) return <div className="p-8 text-red-400">Provedor não encontrado</div>;

  const planoBadge = PLANO_BADGE[tenant.plano] || PLANO_BADGE.basic;
  const planoInfo = PLANOS.find(p => p.value === tenant.plano);

  return (
    <div className="p-8 max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{tenant.nome}</h1>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${planoBadge}`}>
            {planoInfo?.label || tenant.plano} · {planoInfo?.preco}
          </span>
        </div>
        <button
          onClick={handleToggleAtivo}
          className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
            tenant.ativo
              ? 'bg-emerald-900/40 text-emerald-300 hover:bg-red-900/40 hover:text-red-300'
              : 'bg-red-900/40 text-red-300 hover:bg-emerald-900/40 hover:text-emerald-300'
          }`}
        >
          {tenant.ativo ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {tenant.ativo ? 'Ativo' : 'Inativo'}
        </button>
      </div>

      {/* Formulário principal */}
      <form onSubmit={handleSalvarTenant} className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Dados do provedor</h2>

        {/* logo */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-2">Logo</label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl border border-gray-700 bg-gray-900 flex items-center justify-center overflow-hidden shrink-0">
              {tenant.logoUrl
                ? <img src={tenant.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                : <Building2 className="w-7 h-7 text-gray-600" />
              }
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg">
                <Upload className="w-3.5 h-3.5" />
                {tenant.logoUrl ? 'Trocar logo' : 'Enviar logo'}
              </button>
              {tenant.logoUrl && (
                <button type="button" onClick={() => setTenant(t => ({ ...t, logoUrl: null }))}
                  className="text-xs text-red-400 hover:text-red-300 px-2">Remover</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field dark label="Nome" value={tenant.nome} onChange={v => setTenant(t => ({ ...t, nome: v }))} />
          <Field dark label="Slug" value={tenant.slug} onChange={v => setTenant(t => ({ ...t, slug: v }))} />
          <Field dark label="Nome do assistente" value={tenant.nomeAssistente || ''} onChange={v => setTenant(t => ({ ...t, nomeAssistente: v }))} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Plano</label>
            <select value={tenant.plano} onChange={e => setTenant(t => ({ ...t, plano: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
              {PLANOS.map(p => (
                <option key={p.value} value={p.value}>{p.label} — {p.preco}</option>
              ))}
            </select>
          </div>
          <Field dark label="WhatsApp Number ID" value={tenant.whatsappNumberId || ''} onChange={v => setTenant(t => ({ ...t, whatsappNumberId: v }))} />
          <Field dark label="WhatsApp Token" type="password" value={tenant.whatsappToken || ''} onChange={v => setTenant(t => ({ ...t, whatsappToken: v }))} />
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
                  tenant.sgpTipo === 'atlaz'  ? 'Token Atlaz' :
                  tenant.sgpTipo === 'ixc'    ? 'Credencial IXC (usuário:token)' :
                  tenant.sgpTipo === 'mkauth' ? 'Auth token MK-Auth' :
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

      {/* filiais */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-indigo-400" /> Filiais / Cidades
        </h2>

        {filiais.filter(f => f.ativo).length > 0 && (
          <div className="mb-4 space-y-2">
            {filiais.filter(f => f.ativo).map(f => (
              <div key={f.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2 border border-gray-700">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-sm text-white font-medium">{f.nome}</span>
                  <span className="text-xs text-gray-400">{f.cidade}{f.uf ? ` — ${f.uf}` : ''}</span>
                </div>
                <button onClick={() => handleRemoverFilial(f.id)} className="text-gray-500 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddFilial} className="flex gap-2 flex-wrap">
          <input value={formFilial.nome} onChange={e => setFormFilial(f => ({ ...f, nome: e.target.value }))}
            placeholder="Nome (ex: Araçuaí)"
            className="flex-1 min-w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input value={formFilial.cidade} onChange={e => setFormFilial(f => ({ ...f, cidade: e.target.value }))}
            placeholder="Cidade"
            className="flex-1 min-w-28 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input value={formFilial.uf} onChange={e => setFormFilial(f => ({ ...f, uf: e.target.value }))}
            placeholder="UF" maxLength={2}
            className="w-16 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="submit" disabled={savingFilial || !formFilial.nome || !formFilial.cidade}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium">
            {savingFilial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Adicionar
          </button>
        </form>
      </div>

      {/* funcionários */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 mb-6">
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
                  <button onClick={() => { setModalResetSenha(ag); setNovaSenhaReset(''); setErroReset(''); }}
                    title="Redefinir senha" className="text-gray-400 hover:text-amber-400">
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => abrirEditar(ag)} className="text-gray-400 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => desativar(ag)} className="text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cobrança */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <QrCode className="w-4 h-4 text-indigo-400" /> Cobrança
        </h2>

        {/* WhatsApp destino */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">WhatsApp do responsável (destino da cobrança)</label>
          <div className="flex gap-2">
            <input
              type="tel"
              value={tenant.whatsappContato || ''}
              onChange={e => setTenant(t => ({ ...t, whatsappContato: e.target.value }))}
              placeholder="Ex: 5531987654321"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={async () => {
                await api.put(`/tenants/${id}`, { ...tenant });
                setSucesso('Número salvo!');
                setTimeout(() => setSucesso(''), 2000);
              }}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg shrink-0"
            >
              Salvar
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Número com DDI (ex: 5531987654321). O PIX será enviado para este WhatsApp.</p>
        </div>

        {/* Status atual */}
        <div className="flex items-center gap-3 mb-4">
          {(!tenant.statusPagamento || tenant.statusPagamento === 'ativo') && (
            <span className="flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" />
              {tenant.statusPagamento === 'ativo' ? 'Ativo — pago' : 'Aguardando primeira cobrança'}
            </span>
          )}
          {tenant.statusPagamento === 'pendente' && (
            <>
              <span className="flex items-center gap-1.5 text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full">
                <Clock className="w-3.5 h-3.5" /> PIX pendente
              </span>
              <button
                onClick={handleVerificarPagamento}
                disabled={verificandoPIX}
                className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1 rounded-full transition-colors"
              >
                {verificandoPIX ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Verificar pagamento
              </button>
            </>
          )}
          {tenant.statusPagamento === 'suspenso' && (
            <span className="flex items-center gap-1.5 text-xs bg-red-500/20 text-red-300 px-3 py-1 rounded-full">
              <Ban className="w-3.5 h-3.5" /> Suspenso — inadimplente
            </span>
          )}
          {tenant.proximoVencimento && (
            <span className="text-xs text-gray-400">
              {tenant.statusPagamento === 'pendente' ? 'PIX expira em: ' : 'Próximo vencimento: '}
              <strong className="text-gray-300">
                {new Date(tenant.proximoVencimento).toLocaleDateString('pt-BR')}
              </strong>
            </span>
          )}
        </div>

        {resultadoVerif && (
          <p className={`text-xs mb-3 ${resultadoVerif.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
            {resultadoVerif.msg}
          </p>
        )}

        {/* Botão gerar cobrança */}
        <button
          onClick={handleGerarCobranca}
          disabled={gerandoPIX || !tenant.whatsappContato}
          title={!tenant.whatsappContato ? 'Informe o WhatsApp do responsável antes de gerar' : ''}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium mb-4"
        >
          {gerandoPIX ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
          {tenant.statusPagamento === 'suspenso' ? 'Gerar novo PIX (reativar)' : tenant.statusPagamento === 'pendente' ? 'Gerar novo PIX' : 'Gerar cobrança PIX'}
        </button>

        {erroCobranca && <p className="text-red-400 text-sm mb-3">{erroCobranca}</p>}

        {/* PIX gerado */}
        {pixGerado && (
          <div className="bg-gray-900 rounded-lg p-4 border border-indigo-700/50">
            <p className="text-xs text-gray-400 mb-2">PIX enviado ao WhatsApp do provedor ✅</p>
            <p className="text-xs text-gray-400 mb-1">Copia e Cola:</p>
            <div className="flex gap-2 items-start">
              <code className="text-xs text-indigo-300 break-all flex-1 bg-gray-800 p-2 rounded">{pixGerado.pixCopiaECola}</code>
              <button
                onClick={() => navigator.clipboard.writeText(pixGerado.pixCopiaECola)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded shrink-0"
              >Copiar</button>
            </div>
            {pixGerado.ticketUrl && (
              <a href={pixGerado.ticketUrl} target="_blank" rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
                Abrir link de pagamento →
              </a>
            )}
          </div>
        )}

      </div>

      {/* Zona de perigo */}
      <div className="bg-gray-800 rounded-xl border border-red-900/50 p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <h2 className="text-red-400 font-semibold">Zona de perigo</h2>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          Excluir o provedor remove permanentemente todos os dados: conversas, mensagens, clientes e funcionários.
          Esta ação é <strong className="text-red-400">irreversível</strong>.
        </p>
        <button
          onClick={() => { setConfirmaExcluir(''); setModalExcluir(true); }}
          className="flex items-center gap-2 bg-red-900/30 hover:bg-red-900/60 border border-red-700 text-red-400 hover:text-red-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Excluir provedor definitivamente
        </button>
      </div>

      {/* Modal: confirmar exclusão */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-red-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h2 className="text-white font-semibold">Confirmar exclusão</h2>
              </div>
              <button onClick={() => setModalExcluir(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-gray-300 text-sm mb-1">
                Todos os dados de <strong className="text-white">{tenant.nome}</strong> serão apagados permanentemente.
              </p>
              <p className="text-gray-400 text-sm mb-4">
                Digite o nome do provedor para confirmar:
              </p>
              <input
                value={confirmaExcluir}
                onChange={e => setConfirmaExcluir(e.target.value)}
                placeholder={tenant.nome}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex gap-3">
                <button onClick={() => setModalExcluir(false)}
                  className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-800">
                  Cancelar
                </button>
                <button
                  onClick={handleExcluirDefinitivo}
                  disabled={confirmaExcluir !== tenant.nome || excluindo}
                  className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2"
                >
                  {excluindo && <Loader2 className="w-4 h-4 animate-spin" />}
                  Excluir definitivamente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: redefinir senha */}
      {modalResetSenha && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <h2 className="text-white font-semibold">Redefinir senha</h2>
              </div>
              <button onClick={() => setModalResetSenha(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-gray-400 text-sm mb-4">
                Nova senha para <strong className="text-white">{modalResetSenha.nome}</strong>
              </p>
              <Field dark label="Nova senha (mín. 10 caracteres)" type="password"
                value={novaSenhaReset} onChange={setNovaSenhaReset} placeholder="••••••••" />
              {erroReset && <p className="text-red-400 text-sm mt-2">{erroReset}</p>}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setModalResetSenha(null)}
                  className="flex-1 px-4 py-2 border border-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-800">
                  Cancelar
                </button>
                <button onClick={handleResetSenha} disabled={savingReset || !novaSenhaReset}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
                  {savingReset && <Loader2 className="w-4 h-4 animate-spin" />}
                  Redefinir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: agente */}
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
