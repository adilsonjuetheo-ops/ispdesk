import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { Save, Loader2, Copy, Check, Upload, X, Building2, Plus, Trash2, MapPin, Lock, Clock } from 'lucide-react';

const DIAS = [
  { key: 'dom', label: 'Domingo' },
  { key: 'seg', label: 'Segunda' },
  { key: 'ter', label: 'Terça' },
  { key: 'qua', label: 'Quarta' },
  { key: 'qui', label: 'Quinta' },
  { key: 'sex', label: 'Sexta' },
  { key: 'sab', label: 'Sábado' },
];

const HORARIO_DEFAULT = {
  dom: { ativo: false, inicio: '08:00', fim: '18:00' },
  seg: { ativo: true,  inicio: '08:00', fim: '18:00' },
  ter: { ativo: true,  inicio: '08:00', fim: '18:00' },
  qua: { ativo: true,  inicio: '08:00', fim: '18:00' },
  qui: { ativo: true,  inicio: '08:00', fim: '18:00' },
  sex: { ativo: true,  inicio: '08:00', fim: '18:00' },
  sab: { ativo: false, inicio: '08:00', fim: '12:00' },
};

function HorariosSection() {
  const [horarios, setHorarios] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [msgForaHorario, setMsgForaHorario] = useState('');

  useEffect(() => {
    api.get('/tenants/me/horarios').then(r => {
      if (r.data) {
        setHorarios(r.data.dias || HORARIO_DEFAULT);
        setMsgForaHorario(r.data.msgForaHorario || '');
      } else {
        setHorarios(HORARIO_DEFAULT);
      }
    }).finally(() => setLoading(false));
  }, []);

  const setDia = (key, campo, valor) =>
    setHorarios(h => ({ ...h, [key]: { ...h[key], [campo]: valor } }));

  const salvar = async () => {
    setSaving(true);
    try {
      await api.put('/tenants/me/horarios', { horarios: { dias: horarios, msgForaHorario } });
      setSucesso(true);
      setTimeout(() => setSucesso(false), 3000);
    } finally { setSaving(false); }
  };

  if (loading || !horarios) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" /> Horário de Atendimento
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Fora do horário configurado, o bot responde automaticamente com a mensagem abaixo.
      </p>

      <div className="space-y-2 mb-4">
        {DIAS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <label className="flex items-center gap-2 w-24 shrink-0 cursor-pointer">
              <input type="checkbox" checked={horarios[key]?.ativo || false}
                onChange={e => setDia(key, 'ativo', e.target.checked)}
                className="rounded" />
              <span className={`text-sm ${horarios[key]?.ativo ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{label}</span>
            </label>
            {horarios[key]?.ativo ? (
              <>
                <input type="time" value={horarios[key]?.inicio || '08:00'}
                  onChange={e => setDia(key, 'inicio', e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <span className="text-gray-400 text-sm">até</span>
                <input type="time" value={horarios[key]?.fim || '18:00'}
                  onChange={e => setDia(key, 'fim', e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </>
            ) : (
              <span className="text-xs text-gray-300 italic">Fechado</span>
            )}
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Mensagem fora do horário</label>
        <textarea value={msgForaHorario} onChange={e => setMsgForaHorario(e.target.value)} rows={3}
          placeholder="Ex: Olá! Nosso atendimento funciona de segunda a sexta das 8h às 18h. Deixe sua mensagem e retornaremos em breve!"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
      </div>

      {sucesso && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-emerald-700 text-sm">
          Horários salvos com sucesso!
        </div>
      )}

      <button type="button" onClick={salvar} disabled={saving}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar horários
      </button>
    </section>
  );
}

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
];

export default function Settings() {
  const { user } = useAuth();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const fileRef = useRef(null);

  const [filiais, setFiliais] = useState([]);
  const [formFilial, setFormFilial] = useState({ nome: '', cidade: '', uf: '' });
  const [savingFilial, setSavingFilial] = useState(false);

  const [formSenha, setFormSenha] = useState({ senhaAtual: '', novaSenha: '', confirmar: '' });
  const [savingSenha, setSavingSenha] = useState(false);
  const [sucessoSenha, setSucessoSenha] = useState('');
  const [erroSenha, setErroSenha] = useState('');

  const carregarFiliais = () =>
    api.get(`/tenants/${user.tenantId}/filiais`).then(r => setFiliais(r.data));

  useEffect(() => {
    api.get('/tenants/me')
      .then(r => setTenant(r.data))
      .finally(() => setLoading(false));
    carregarFiliais();
  }, []);

  const sinalizarMudancaFiliais = () =>
    window.dispatchEvent(new CustomEvent('ispdesk:filiais-updated'));

  const handleAddFilial = async e => {
    e.preventDefault();
    if (!formFilial.nome || !formFilial.cidade) return;
    setSavingFilial(true);
    try {
      await api.post(`/tenants/${user.tenantId}/filiais`, formFilial);
      setFormFilial({ nome: '', cidade: '', uf: '' });
      carregarFiliais();
      sinalizarMudancaFiliais();
    } finally {
      setSavingFilial(false);
    }
  };

  const handleRemoverFilial = async id => {
    await api.delete(`/tenants/${user.tenantId}/filiais/${id}`);
    carregarFiliais();
    sinalizarMudancaFiliais();
  };

  const set = (campo, valor) => setTenant(t => ({ ...t, [campo]: valor }));

  const handleLogoUpload = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErro('Logo deve ter no máximo 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => set('logoUrl', ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleRemoverLogo = () => {
    set('logoUrl', null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSalvar = async e => {
    e.preventDefault();
    setSaving(true);
    setErro(''); setSucesso('');
    try {
      await api.put('/tenants/me', tenant);
      setSucesso('Configurações salvas com sucesso!');
      setTimeout(() => setSucesso(''), 4000);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const copiar = texto => {
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleAlterarSenha = async e => {
    e.preventDefault();
    setErroSenha(''); setSucessoSenha('');
    if (formSenha.novaSenha.length < 6) return setErroSenha('Nova senha: mínimo 6 caracteres');
    if (formSenha.novaSenha !== formSenha.confirmar) return setErroSenha('As senhas não conferem');
    setSavingSenha(true);
    try {
      await api.put('/auth/change-password', { senhaAtual: formSenha.senhaAtual, novaSenha: formSenha.novaSenha });
      setSucessoSenha('Senha alterada com sucesso!');
      setFormSenha({ senhaAtual: '', novaSenha: '', confirmar: '' });
      setTimeout(() => setSucessoSenha(''), 4000);
    } catch (err) {
      setErroSenha(err.response?.data?.erro || 'Erro ao alterar senha');
    } finally {
      setSavingSenha(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Carregando...</div>;
  if (!tenant) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-gray-800 mb-8">Configurações do Provedor</h1>

        <form onSubmit={handleSalvar} className="space-y-5">

          {/* logo + identidade */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400" />
              Identidade Visual
            </h2>

            {/* logo */}
            <div className="mb-5">
              <label className="block text-xs text-gray-500 mb-2">Logo do provedor</label>
              <div className="flex items-start gap-4">
                {/* preview */}
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50 shrink-0">
                  {tenant.logoUrl ? (
                    <img src={tenant.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                  ) : (
                    <Building2 className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-2">PNG, JPG ou SVG — máximo 2 MB.<br />Recomendado: fundo transparente, 200×200px.</p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      {tenant.logoUrl ? 'Trocar logo' : 'Enviar logo'}
                    </button>
                    {tenant.logoUrl && (
                      <button type="button" onClick={handleRemoverLogo}
                        className="flex items-center gap-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" />
                        Remover
                      </button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Nome do provedor *" value={tenant.nome || ''} onChange={v => set('nome', v)} />
              <Field label="Nome fantasia" value={tenant.nomeFantasia || ''} onChange={v => set('nomeFantasia', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cor primária</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={tenant.corPrimaria || '#0066CC'}
                    onChange={e => set('corPrimaria', e.target.value)}
                    className="h-9 w-14 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                  <span className="text-sm text-gray-500 font-mono">{tenant.corPrimaria || '#0066CC'}</span>
                </div>
              </div>
              <Field label="Nome do assistente IA" value={tenant.nomeAssistente || ''} onChange={v => set('nomeAssistente', v)} />
            </div>
          </section>

          {/* dados da empresa */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-4">Dados da Empresa</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="CNPJ" value={tenant.cnpj || ''} onChange={v => set('cnpj', v)} placeholder="00.000.000/0001-00" />
              <Field label="E-mail" value={tenant.email || ''} onChange={v => set('email', v)} type="email" placeholder="contato@provedor.com.br" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Telefone" value={tenant.telefone || ''} onChange={v => set('telefone', v)} placeholder="(38) 3333-4444" />
              <Field label="WhatsApp de contato" value={tenant.whatsappContato || ''} onChange={v => set('whatsappContato', v)} placeholder="(38) 99999-0000" />
            </div>
            <Field label="Website" value={tenant.website || ''} onChange={v => set('website', v)} placeholder="https://meuprovedor.com.br" className="mb-3" />
            <Field label="Endereço" value={tenant.endereco || ''} onChange={v => set('endereco', v)} placeholder="Rua das Flores, 123 — Centro" className="mb-3" />
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-3">
                <Field label="Cidade" value={tenant.cidade || ''} onChange={v => set('cidade', v)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">UF</label>
                <select value={tenant.uf || ''} onChange={e => set('uf', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">—</option>
                  {ESTADOS_BR.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Field label="CEP" value={tenant.cep || ''} onChange={v => set('cep', v)} placeholder="39000-000" />
              </div>
            </div>
          </section>

          {/* whatsapp */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-4">WhatsApp (Meta API)</h2>
            <div className="space-y-3">
              <Field label="WhatsApp Number ID" value={tenant.whatsappNumberId || ''} onChange={v => set('whatsappNumberId', v)} placeholder="123456789012345" />
              <Field label="Token de Acesso" value={tenant.whatsappToken || ''} onChange={v => set('whatsappToken', v)} type="password" placeholder="EAAxxxxx..." />
            </div>
          </section>

          {/* integração SGP */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1">Sistema de Gestão (SGP)</h2>
            <p className="text-xs text-gray-400 mb-4">
              O assistente consulta o SGP em tempo real para exibir dados do cliente, faturas e executar ações como desbloqueio e 2ª via.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">SGP utilizado</label>
                <select value={tenant.sgpTipo || ''} onChange={e => set('sgpTipo', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Nenhum (sem integração)</option>
                  <option value="atlaz">Atlaz</option>
                  <option value="ixc">IXC Soft</option>
                  <option value="mkauth">MK-Auth</option>
                  <option value="generico">Outro (API genérica)</option>
                </select>
              </div>

              {['ixc', 'mkauth', 'generico'].includes(tenant.sgpTipo) && (
                <Field
                  label="URL base da API do SGP"
                  value={tenant.sgpApiUrl || ''}
                  onChange={v => set('sgpApiUrl', v)}
                  placeholder="https://sistema.meuprovedor.com.br"
                />
              )}

              {tenant.sgpTipo && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {tenant.sgpTipo === 'atlaz'    && 'Token Atlaz'}
                    {tenant.sgpTipo === 'ixc'      && 'Credencial IXC — usuário:token (ex: admin:abc123)'}
                    {tenant.sgpTipo === 'mkauth'   && 'Auth token MK-Auth'}
                    {tenant.sgpTipo === 'generico' && 'Token de autenticação'}
                  </label>
                  <input
                    type="password"
                    value={tenant.sgpApiKey || ''}
                    onChange={e => set('sgpApiKey', e.target.value)}
                    placeholder="Token de acesso à API"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              )}

              {tenant.sgpTipo === 'generico' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
                  <strong>Endpoints esperados no seu sistema:</strong><br />
                  POST /consultar — body: &#123; token, whatsapp &#125;<br />
                  POST /desbloquear — body: &#123; token, id_cliente, id_contrato &#125;<br />
                  POST /segunda_via — body: &#123; token, id_cliente &#125;<br />
                  POST /chamado — body: &#123; token, id_contrato, detalhes &#125;
                </div>
              )}
            </div>
          </section>

          {/* assistente ia */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Assistente IA — System Prompt</h2>
            <p className="text-xs text-gray-400 mb-3">
              Instrua o assistente sobre como atender seus clientes: serviços oferecidos, área de cobertura, horário de atendimento, procedimentos comuns, etc.
            </p>
            <textarea rows={10} value={tenant.systemPrompt || ''}
              onChange={e => set('systemPrompt', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Você é o assistente virtual do provedor de internet [nome]. Sua função é ajudar os clientes com dúvidas sobre..." />
          </section>

          {/* filiais */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-indigo-500" /> Filiais / Cidades de atendimento
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Cadastre as cidades que seu provedor atende. O bot vai perguntar ao cliente qual cidade ele é e rotear o atendimento para os agentes da filial correspondente.
            </p>

            {filiais.filter(f => f.ativo).length > 0 && (
              <div className="mb-4 space-y-2">
                {filiais.filter(f => f.ativo).map(f => (
                  <div key={f.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                      <span className="text-sm font-medium text-gray-800">{f.nome}</span>
                      <span className="text-xs text-gray-400">{f.cidade}{f.uf ? ` — ${f.uf}` : ''}</span>
                    </div>
                    <button type="button" onClick={() => handleRemoverFilial(f.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddFilial} className="flex gap-2 flex-wrap">
              <input value={formFilial.nome} onChange={e => setFormFilial(f => ({ ...f, nome: e.target.value }))}
                placeholder="Nome da filial (ex: Araçuaí)"
                className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <input value={formFilial.cidade} onChange={e => setFormFilial(f => ({ ...f, cidade: e.target.value }))}
                placeholder="Cidade"
                className="flex-1 min-w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <select value={formFilial.uf} onChange={e => setFormFilial(f => ({ ...f, uf: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">UF</option>
                {ESTADOS_BR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
              <button type="submit" disabled={savingFilial || !formFilial.nome || !formFilial.cidade}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium">
                {savingFilial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar
              </button>
            </form>
          </section>

          {/* webhook token */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1">Token do Webhook</h2>
            <p className="text-xs text-gray-400 mb-3">
              Use este valor no campo "Verify Token" ao configurar o webhook no Meta for Developers.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200">
              <code className="flex-1 text-xs text-gray-700 break-all select-all">{tenant.webhookVerifyToken}</code>
              <button type="button" onClick={() => copiar(tenant.webhookVerifyToken)}
                title="Copiar"
                className="text-gray-400 hover:text-blue-600 shrink-0 transition-colors">
                {copiado ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              URL do webhook: <code className="bg-gray-100 px-1 rounded">https://seu-dominio.com/api/webhook</code>
            </p>
          </section>

          {sucesso && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-emerald-700 text-sm">
              {sucesso}
            </div>
          )}
          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-sm">
              {erro}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configurações
          </button>
        </form>

        {/* Alterar senha — fora do form principal */}
        <HorariosSection />

        <form onSubmit={handleAlterarSenha} className="mt-5">
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Lock className="w-4 h-4 text-gray-400" /> Alterar minha senha
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Para sua segurança, informe a senha atual antes de definir uma nova.
            </p>
            <div className="space-y-3 max-w-sm">
              <Field label="Senha atual" type="password" value={formSenha.senhaAtual}
                onChange={v => setFormSenha(f => ({ ...f, senhaAtual: v }))} />
              <Field label="Nova senha" type="password" value={formSenha.novaSenha}
                onChange={v => setFormSenha(f => ({ ...f, novaSenha: v }))}
                placeholder="Mínimo 6 caracteres" />
              <Field label="Confirmar nova senha" type="password" value={formSenha.confirmar}
                onChange={v => setFormSenha(f => ({ ...f, confirmar: v }))} />
            </div>

            {sucessoSenha && (
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-emerald-700 text-sm">
                {sucessoSenha}
              </div>
            )}
            {erroSenha && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-600 text-sm">
                {erroSenha}
              </div>
            )}

            <button type="submit" disabled={savingSenha || !formSenha.senhaAtual || !formSenha.novaSenha}
              className="mt-4 flex items-center gap-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              {savingSenha ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Alterar senha
            </button>
          </section>
        </form>

      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}
