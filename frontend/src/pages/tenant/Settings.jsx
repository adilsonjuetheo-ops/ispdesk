import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { aplicarCorDaMarca } from '../../lib/marca.js';
import { Save, Loader2, Copy, Check, Upload, X, Building2, Plus, Trash2, MapPin, Lock, Clock, Wifi, WifiOff, ChevronDown, ChevronUp, FileSignature, Tag, AlertCircle, GitBranch, ToggleLeft, ToggleRight, ArrowRightLeft } from 'lucide-react';

function carregarFbSdk() {
  return new Promise((resolve) => {
    if (window.FB) { resolve(); return; }
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: import.meta.env.VITE_META_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v19.0',
      });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

function WhatsappSection({ onConectado, mostrarManual, onToggleManual }) {
  const [status, setStatus] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const carregarStatus = () => {
    setCarregando(true);
    api.get('/whatsapp/status')
      .then(r => setStatus(r.data))
      .finally(() => setCarregando(false));
  };

  useEffect(() => { carregarStatus(); }, []);

  const handleConectar = async () => {
    setErro(''); setSucesso('');
    if (!import.meta.env.VITE_META_APP_ID) {
      setErro('VITE_META_APP_ID não configurado. Adicione essa variável de ambiente no Coolify.');
      return;
    }
    if (!import.meta.env.VITE_META_CONFIG_ID) {
      setErro('VITE_META_CONFIG_ID não configurado. Adicione essa variável de ambiente no Coolify.');
      return;
    }
    setConectando(true);
    try {
      await carregarFbSdk();

      let sessionInfo = null;
      window.FB.Event.subscribe('WhatsAppBusinessSignup:finish', (data) => {
        sessionInfo = data;
      });

      window.FB.login((response) => {
        if (response.authResponse?.code) {
          enviarCodigo(response.authResponse.code, sessionInfo);
        } else {
          setConectando(false);
          if (response.status !== 'connected') {
            setErro('Fluxo cancelado ou permissões negadas.');
          }
        }
      }, {
        config_id: import.meta.env.VITE_META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      });
    } catch (e) {
      setConectando(false);
      setErro('Erro ao carregar o SDK do Facebook. Verifique sua conexão.');
    }
  };

  const enviarCodigo = async (code, sessionInfo) => {
    try {
      const r = await api.post('/whatsapp/embedded-signup', {
        code,
        wabaId: sessionInfo?.waba_id || null,
        phoneNumberId: sessionInfo?.phone_number_id || null,
      });
      setSucesso(`WhatsApp conectado! Número: ${r.data.displayPhone}`);
      carregarStatus();
      onConectado?.();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao conectar WhatsApp');
    } finally {
      setConectando(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-700 mb-1">WhatsApp Business</h2>
      <p className="text-xs text-gray-400 mb-4">
        Conecte sua conta WhatsApp Business diretamente via Meta. O processo leva menos de 2 minutos.
      </p>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Verificando conexão...
        </div>
      ) : status?.conectado ? (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <Wifi className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-emerald-800">WhatsApp conectado via Embedded Signup</p>
            <p className="text-xs text-emerald-600 mt-0.5">WABA ID: <code className="bg-emerald-100 px-1 rounded">{status.wabaId}</code></p>
            <p className="text-xs text-emerald-600">Phone Number ID: <code className="bg-emerald-100 px-1 rounded">{status.phoneNumberId}</code></p>
            {status.conectadoEm && (
              <p className="text-xs text-emerald-500 mt-0.5">
                Conectado em {new Date(status.conectadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <WifiOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">WhatsApp não conectado</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Clique em "Conectar WhatsApp" para autorizar o acesso à sua conta WhatsApp Business via Meta.
            </p>
            {status?.phoneNumberId && (
              <p className="text-xs text-amber-500 mt-1">
                Configuração manual detectada — Phone ID: <code>{status.phoneNumberId}</code>
              </p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleConectar}
        disabled={conectando}
        className="flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {conectando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
        {status?.conectado ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}
      </button>

      {sucesso && (
        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-emerald-700 text-sm">
          {sucesso}
        </div>
      )}
      {erro && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-600 text-sm">
          {erro}
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onToggleManual}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {mostrarManual ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Configuração manual (avançado)
        </button>
      </div>
    </section>
  );
}

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
  const [instrucaoForaHorario, setInstrucaoForaHorario] = useState('');
  const [slaMinutos, setSlaMinutos] = useState(15);

  useEffect(() => {
    api.get('/tenants/me/horarios').then(r => {
      if (r.data) {
        setHorarios(r.data.dias || HORARIO_DEFAULT);
        // Provedores antigos guardavam aqui a mensagem fixa de "fechado";
        // ela vira o ponto de partida da instrução.
        setInstrucaoForaHorario(r.data.instrucaoForaHorario ?? r.data.msgForaHorario ?? '');
        setSlaMinutos(r.data.slaMinutos ?? 15);
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
      const { data: atual } = await api.get('/tenants/me/horarios');
      await api.put('/tenants/me/horarios', {
        horarios: { ...(atual || {}), dias: horarios, instrucaoForaHorario, slaMinutos: Number(slaMinutos) || 0 },
      });
      setSucesso(true);
      setTimeout(() => setSucesso(false), 3000);
    } finally { setSaving(false); }
  };

  if (loading || !horarios) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" /> Horário de atendimento humano
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Marque os dias e horários em que há atendente de plantão. Fora deles o assistente continua
        atendendo sozinho e, ao transferir, avisa o cliente de quando a equipe retorna.
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
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-gray-400 text-sm">até</span>
                <input type="time" value={horarios[key]?.fim || '18:00'}
                  onChange={e => setDia(key, 'fim', e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400" />
              </>
            ) : (
              <span className="text-xs text-gray-300 italic">Sem atendente</span>
            )}
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Instrução para o assistente fora do horário</label>
        <textarea value={instrucaoForaHorario} onChange={e => setInstrucaoForaHorario(e.target.value)} rows={3}
          placeholder="Ex: Fora do horário comercial, não prometa visita técnica. Oriente o cliente a reiniciar o roteador e registre o chamado para a equipe avaliar pela manhã."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
        <p className="text-xs text-gray-400 mt-1">
          Vale apenas quando não há atendente de plantão. O assistente já avisa sozinho que a equipe
          retorna no próximo horário — use este campo para regras específicas do provedor.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 font-medium whitespace-nowrap">SLA da fila:</label>
          <input type="number" min="0" max="1440" value={slaMinutos}
            onChange={e => setSlaMinutos(e.target.value)}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <span className="text-xs text-gray-400">minutos — conversas aguardando além desse tempo ficam com alerta vermelho</span>
        </div>
      </div>

      {sucesso && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-emerald-700 text-sm">
          Horários salvos com sucesso!
        </div>
      )}

      <button type="button" onClick={salvar} disabled={saving}
        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-brand-contraste px-5 py-2 rounded-lg text-sm font-medium transition-colors">
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

function TestarSgp() {
  const [modo, setModo] = useState('telefone'); // 'telefone' | 'documento'
  const [valor, setValor] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  async function testar() {
    if (!valor.trim()) return;
    setCarregando(true);
    setResultado(null);
    setErro('');
    try {
      const body = modo === 'documento'
        ? { documento: valor.trim() }
        : { telefone: valor.trim() };
      const { data } = await api.post('/tenants/me/testar-sgp', body);
      setResultado(data.resultado);
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao testar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mt-3 border border-dashed border-gray-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-medium text-gray-500">Testar conexão com SGP</p>
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => { setModo('telefone'); setResultado(null); setErro(''); }}
          className={`px-2.5 py-1 rounded-md transition-colors ${modo === 'telefone' ? 'bg-brand-600 text-brand-contraste' : 'bg-gray-100 text-gray-500'}`}
        >
          Por telefone
        </button>
        <button
          type="button"
          onClick={() => { setModo('documento'); setResultado(null); setErro(''); }}
          className={`px-2.5 py-1 rounded-md transition-colors ${modo === 'documento' ? 'bg-brand-600 text-brand-contraste' : 'bg-gray-100 text-gray-500'}`}
        >
          Por CPF/CNPJ
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={valor}
          onChange={e => setValor(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && testar()}
          placeholder={modo === 'documento' ? 'CPF ou CNPJ do cliente' : 'Telefone do cliente (ex: 31999887766)'}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="button"
          onClick={testar}
          disabled={carregando || !valor.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-brand-contraste text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Testar
        </button>
      </div>
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 whitespace-pre-wrap">{erro}</div>
      )}
      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap font-mono">{resultado}</div>
      )}
    </div>
  );
}

function TestarLembretes() {
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  async function testar() {
    const confirmado = window.confirm(
      'Isso vai enviar lembretes REAIS agora para todos os clientes com fatura vencendo amanhã ou vencida há 5 dias. Não é uma simulação. Confirma?'
    );
    if (!confirmado) return;

    setCarregando(true);
    setResultado(null);
    setErro('');
    try {
      const { data } = await api.post('/tenants/me/testar-lembretes');
      setResultado(data.resultado);
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao testar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mt-3 border border-dashed border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
      <p className="text-xs text-amber-700">Isso dispara o processo real agora — envia mensagem de verdade para os clientes elegíveis hoje, não é uma simulação.</p>
      <button
        type="button"
        onClick={testar}
        disabled={carregando}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
      >
        {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Testar agora (envio real)
      </button>
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 whitespace-pre-wrap">{erro}</div>
      )}
      {resultado && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          {resultado.erro ? (
            <p className="text-red-600">{resultado.erro}</p>
          ) : (
            <>
              <p>Pré-vencimento: {resultado.preEncontradas === null ? 'erro na consulta' : `${resultado.preEnviadas}/${resultado.preEncontradas} enviados`}</p>
              <p>Pós-vencimento: {resultado.posEncontradas === null ? 'erro na consulta' : `${resultado.posEnviadas}/${resultado.posEncontradas} enviados`}</p>
              {resultado.falhas?.length > 0 && (
                <div className="text-red-600 mt-1">
                  <p className="font-medium">Falhas:</p>
                  <ul className="list-disc list-inside">
                    {resultado.falhas.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TestarLembreteCliente() {
  const [documento, setDocumento] = useState('');
  const [tipo, setTipo] = useState('pre');
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  async function testar() {
    if (!documento.trim()) return;
    const confirmado = window.confirm(
      `Isso vai enviar o template "${tipo === 'pos' ? 'pós-vencimento' : 'pré-vencimento'}" de verdade pro cliente com esse CPF/CNPJ, agora. Confirma?`
    );
    if (!confirmado) return;

    setCarregando(true);
    setResultado(null);
    setErro('');
    try {
      const { data } = await api.post('/tenants/me/testar-lembretes-cliente', { documento: documento.trim(), tipo });
      setResultado(data.resultado);
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao testar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mt-3 border border-dashed border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
      <p className="text-xs text-amber-700">Testa o envio real com um cliente específico (por CPF/CNPJ), sem depender da data de vencimento de hoje.</p>
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setTipo('pre')}
          className={`px-2.5 py-1 rounded-md transition-colors ${tipo === 'pre' ? 'bg-amber-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
        >
          Pré-vencimento
        </button>
        <button
          type="button"
          onClick={() => setTipo('pos')}
          className={`px-2.5 py-1 rounded-md transition-colors ${tipo === 'pos' ? 'bg-amber-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
        >
          Pós-vencimento
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={documento}
          onChange={e => setDocumento(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && testar()}
          placeholder="CPF ou CNPJ do cliente"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          type="button"
          onClick={testar}
          disabled={carregando || !documento.trim()}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Enviar teste
        </button>
      </div>
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 whitespace-pre-wrap">{erro}</div>
      )}
      {resultado && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          {resultado.erro ? (
            <p className="text-red-600">{resultado.erro}</p>
          ) : (
            <>
              <p>Cliente: {resultado.cliente}</p>
              <p>Valor: R$ {resultado.valor} | Vencimento: {resultado.vencimento}</p>
              <p className={resultado.enviado ? 'text-green-600' : 'text-red-600'}>
                {resultado.enviado ? '✓ Enviado com sucesso' : `✗ Falha: ${resultado.motivo}`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const CORES_TAGS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];

function TagsSection() {
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novaCor, setNovaCor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/tenants/me/horarios').then(r => {
      setCatalogo(r.data?.tagsCatalog || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const salvarCatalogo = async (novo) => {
    setSaving(true);
    try {
      const { data: atual } = await api.get('/tenants/me/horarios');
      await api.put('/tenants/me/horarios', { horarios: { ...(atual || {}), tagsCatalog: novo } });
      setCatalogo(novo);
    } finally { setSaving(false); }
  };

  const adicionar = async () => {
    const nome = novoNome.trim();
    if (!nome || catalogo.find(t => t.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarCatalogo([...catalogo, { nome, cor: novaCor }]);
    setNovoNome('');
    setNovaCor(CORES_TAGS[(catalogo.length + 1) % CORES_TAGS.length]);
  };

  const remover = (idx) => salvarCatalogo(catalogo.filter((_, i) => i !== idx));

  if (loading) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
      <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Tag className="w-4 h-4 text-indigo-500" /> Tags de Atendimento
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Crie etiquetas para categorizar atendimentos. Os agentes poderão aplicá-las nas conversas abertas.
      </p>

      {catalogo.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {catalogo.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
              <span className="text-sm font-medium text-gray-700">{t.nome}</span>
              <button type="button" onClick={() => remover(i)} className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input type="color" value={novaCor} onChange={e => setNovaCor(e.target.value)}
          className="h-9 w-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 shrink-0" />
        <input type="text" value={novoNome} onChange={e => setNovoNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          placeholder="Nome da tag (ex: Suporte técnico)"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
        <button type="button" onClick={adicionar} disabled={saving || !novoNome.trim()}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar
        </button>
      </div>
    </section>
  );
}

function RoteamentoSection() {
  const { user } = useAuth();
  const [regras, setRegras] = useState([]);
  const [filiais, setFiliais] = useState([]);
  const [agentes, setAgentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nova, setNova] = useState({ nome: '', tipo: 'keyword', valor: '', acao: 'filial', destinoId: '' });

  useEffect(() => {
    Promise.all([
      api.get('/tenants/me/horarios'),
      api.get(`/tenants/${user.tenantId}/filiais`),
      api.get(`/tenants/${user.tenantId}/agents`),
    ]).then(([h, f, a]) => {
      setRegras(h.data?.regrasRoteamento || []);
      setFiliais((f.data || []).filter(x => x.ativo));
      setAgentes((a.data || []).filter(x => x.ativo));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const salvar = async (novas) => {
    setSaving(true);
    try {
      const { data: atual } = await api.get('/tenants/me/horarios');
      await api.put('/tenants/me/horarios', { horarios: { ...(atual || {}), regrasRoteamento: novas } });
      setRegras(novas);
    } finally { setSaving(false); }
  };

  const adicionar = async () => {
    if (!nova.nome.trim() || !nova.valor.trim() || !nova.destinoId) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    await salvar([...regras, { ...nova, id, ativo: true }]);
    setNova({ nome: '', tipo: 'keyword', valor: '', acao: 'filial', destinoId: '' });
  };

  const remover = (id) => salvar(regras.filter(r => r.id !== id));
  const toggleAtivo = (id) => salvar(regras.map(r => r.id === id ? { ...r, ativo: !r.ativo } : r));

  const destinos = nova.acao === 'filial' ? filiais : agentes;

  if (loading) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
      <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-purple-500" /> Roteamento Automático
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Crie regras para direcionar atendimentos a filiais ou agentes específicos com base em palavras-chave na mensagem do cliente. A primeira regra que casar vence.
      </p>

      {regras.length > 0 && (
        <div className="space-y-2 mb-4">
          {regras.map(r => {
            const destinoLista = r.acao === 'filial' ? filiais : agentes;
            const destinoNome = destinoLista.find(d => d.id === r.destinoId)?.nome || r.destinoId;
            return (
              <div key={r.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-opacity ${r.ativo !== false ? 'bg-gray-50 border-gray-200' : 'bg-gray-50/50 border-gray-100 opacity-50'}`}>
                <button type="button" onClick={() => toggleAtivo(r.id)} className="mt-0.5 shrink-0 transition-colors">
                  {r.ativo !== false
                    ? <ToggleRight className="w-5 h-5 text-purple-600" />
                    : <ToggleLeft className="w-5 h-5 text-gray-300" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{r.nome}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Palavras: <code className="bg-gray-100 px-1 rounded text-gray-700">{r.valor}</code>
                    {' → '}
                    <span className={r.acao === 'filial' ? 'text-indigo-600' : 'text-amber-600'}>
                      {r.acao === 'filial' ? 'Filial' : 'Agente'}: {destinoNome}
                    </span>
                  </p>
                </div>
                <button type="button" onClick={() => remover(r.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 mt-0.5">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="border border-dashed border-purple-200 rounded-lg p-3 space-y-2 bg-purple-50/30">
        <p className="text-xs font-medium text-purple-700">Nova regra</p>
        <input type="text" value={nova.nome} onChange={e => setNova(n => ({ ...n, nome: e.target.value }))}
          placeholder="Nome da regra (ex: Suporte Fibra)"
          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
        <input type="text" value={nova.valor} onChange={e => setNova(n => ({ ...n, valor: e.target.value }))}
          placeholder="Palavras-chave separadas por vírgula: fibra, cabo, sem internet, lento"
          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
        <div className="flex gap-2 flex-wrap">
          <select value={nova.acao} onChange={e => setNova(n => ({ ...n, acao: e.target.value, destinoId: '' }))}
            className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="filial">→ Filial</option>
            <option value="agente">→ Agente</option>
          </select>
          <select value={nova.destinoId} onChange={e => setNova(n => ({ ...n, destinoId: e.target.value }))}
            className="flex-1 min-w-36 border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="">Selecionar destino...</option>
            {destinos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <button type="button" onClick={adicionar}
            disabled={saving || !nova.nome.trim() || !nova.valor.trim() || !nova.destinoId}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium shrink-0 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Adicionar
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mostrarManualWpp, setMostrarManualWpp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const fileRef = useRef(null);

  const [filiais, setFiliais] = useState([]);
  const [formFilial, setFormFilial] = useState({ nome: '', cidade: '', uf: '' });
  const [savingFilial, setSavingFilial] = useState(false);
  const [erroFilial, setErroFilial] = useState('');

  const [conectandoFilialId, setConectandoFilialId] = useState(null);
  const [erroFilialWpp, setErroFilialWpp] = useState({});
  const [conectandoExtraFilialId, setConectandoExtraFilialId] = useState(null);
  const [movendo, setMovendo] = useState(null); // { filialId, extraId?, rotulo }
  const [destinoMover, setDestinoMover] = useState('');
  const [movendoSalvando, setMovendoSalvando] = useState(false);

  const [formSenha, setFormSenha] = useState({ senhaAtual: '', novaSenha: '', confirmar: '' });
  const [savingSenha, setSavingSenha] = useState(false);
  const [sucessoSenha, setSucessoSenha] = useState('');
  const [erroSenha, setErroSenha] = useState('');

  const carregarFiliais = () =>
    api.get(`/tenants/${user.tenantId}/filiais`).then(r => setFiliais(r.data));

  const recarregarTenant = () =>
    api.get('/tenants/me').then(r => setTenant(r.data));

  useEffect(() => {
    api.get('/tenants/me')
      .then(r => setTenant(r.data))
      .finally(() => setLoading(false));
    carregarFiliais();
  }, []);

  const sinalizarMudancaFiliais = () =>
    window.dispatchEvent(new CustomEvent('ispdesk:filiais-updated'));

  const handleAddFilial = async (e) => {
    e?.preventDefault();
    if (!formFilial.nome || !formFilial.cidade) {
      setErroFilial('Preencha o nome e a cidade da filial.');
      return;
    }
    setSavingFilial(true);
    setErroFilial('');
    try {
      await api.post(`/tenants/${user.tenantId}/filiais`, formFilial);
      setFormFilial({ nome: '', cidade: '', uf: '' });
      carregarFiliais();
      sinalizarMudancaFiliais();
    } catch (err) {
      setErroFilial(err.response?.data?.erro || `Erro ${err.response?.status || ''}: ${err.message}`);
    } finally {
      setSavingFilial(false);
    }
  };

  const handleRemoverFilial = async id => {
    await api.delete(`/tenants/${user.tenantId}/filiais/${id}`);
    carregarFiliais();
    sinalizarMudancaFiliais();
  };

  const handleConectarFilial = async (filialId) => {
    setErroFilialWpp(e => ({ ...e, [filialId]: '' }));
    if (!import.meta.env.VITE_META_APP_ID || !import.meta.env.VITE_META_CONFIG_ID) {
      setErroFilialWpp(e => ({ ...e, [filialId]: 'VITE_META_APP_ID / VITE_META_CONFIG_ID não configurados' }));
      return;
    }
    setConectandoFilialId(filialId);
    try {
      await carregarFbSdk();
      await new Promise((resolve, reject) => {
        let sessionInfo = null;
        window.FB.Event.subscribe('WhatsAppBusinessSignup:finish', (data) => { sessionInfo = data; });
        window.FB.login((response) => {
          if (!response.authResponse?.code) {
            reject(new Error('Login cancelado'));
            return;
          }
          const { code } = response.authResponse;
          const wabaId = sessionInfo?.waba_id || null;
          const phoneNumberId = sessionInfo?.phone_number_id || null;
          api.post(`/whatsapp/embedded-signup-filial/${filialId}`, { code, wabaId, phoneNumberId })
            .then(() => { carregarFiliais(); resolve(); })
            .catch(err => reject(err));
        }, {
          config_id: import.meta.env.VITE_META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        });
      });
    } catch (err) {
      setErroFilialWpp(e => ({ ...e, [filialId]: err.response?.data?.erro || err.message || 'Erro ao conectar' }));
    } finally {
      setConectandoFilialId(null);
    }
  };

  const handleDesconectarFilial = async (filialId) => {
    try {
      await api.delete(`/whatsapp/desconectar-filial/${filialId}`);
      carregarFiliais();
    } catch (err) {
      setErroFilialWpp(e => ({ ...e, [filialId]: err.response?.data?.erro || 'Erro ao desconectar' }));
    }
  };

  const handleConectarNumeroExtra = async (filialId) => {
    setErroFilialWpp(e => ({ ...e, [filialId]: '' }));
    if (!import.meta.env.VITE_META_APP_ID || !import.meta.env.VITE_META_CONFIG_ID) {
      setErroFilialWpp(e => ({ ...e, [filialId]: 'VITE_META_APP_ID / VITE_META_CONFIG_ID não configurados' }));
      return;
    }
    setConectandoExtraFilialId(filialId);
    try {
      await carregarFbSdk();
      await new Promise((resolve, reject) => {
        let sessionInfo = null;
        window.FB.Event.subscribe('WhatsAppBusinessSignup:finish', (data) => { sessionInfo = data; });
        window.FB.login((response) => {
          if (!response.authResponse?.code) {
            reject(new Error('Login cancelado'));
            return;
          }
          const { code } = response.authResponse;
          const wabaId = sessionInfo?.waba_id || null;
          const phoneNumberId = sessionInfo?.phone_number_id || null;
          api.post(`/whatsapp/embedded-signup-filial-extra/${filialId}`, { code, wabaId, phoneNumberId })
            .then(() => { carregarFiliais(); resolve(); })
            .catch(err => reject(err));
        }, {
          config_id: import.meta.env.VITE_META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        });
      });
    } catch (err) {
      setErroFilialWpp(e => ({ ...e, [filialId]: err.response?.data?.erro || err.message || 'Erro ao conectar' }));
    } finally {
      setConectandoExtraFilialId(null);
    }
  };

  const handleDesconectarNumeroExtra = async (filialId, extraId) => {
    try {
      await api.delete(`/whatsapp/desconectar-filial-extra/${extraId}`);
      carregarFiliais();
    } catch (err) {
      setErroFilialWpp(e => ({ ...e, [filialId]: err.response?.data?.erro || 'Erro ao desconectar' }));
    }
  };

  const handleMoverNumero = async () => {
    if (!movendo || !destinoMover) return;
    setMovendoSalvando(true);
    try {
      await api.post('/whatsapp/mover-numero', {
        origemFilialId: movendo.extraId ? undefined : movendo.filialId,
        origemExtraId: movendo.extraId || undefined,
        destinoFilialId: destinoMover,
      });
      setMovendo(null);
      setDestinoMover('');
      carregarFiliais();
    } catch (err) {
      setErroFilialWpp(e => ({ ...e, [movendo.filialId]: err.response?.data?.erro || 'Erro ao mover número' }));
    } finally {
      setMovendoSalvando(false);
    }
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
      // Repinta o painel na hora — o layout só relê o tenant a cada 5 min e a
      // troca de cor primária ficaria invisível até lá.
      aplicarCorDaMarca(tenant.corPrimaria);
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
    if (formSenha.novaSenha.length < 10) return setErroSenha('Nova senha: mínimo 10 caracteres');
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
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400">
                  <option value="">—</option>
                  {ESTADOS_BR.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Field label="CEP" value={tenant.cep || ''} onChange={v => set('cep', v)} placeholder="39000-000" />
              </div>
            </div>
          </section>

          {/* whatsapp embedded signup */}
          <WhatsappSection
            onConectado={recarregarTenant}
            mostrarManual={mostrarManualWpp}
            onToggleManual={() => setMostrarManualWpp(v => !v)}
          />

          {/* whatsapp — campos manuais (fallback avançado) */}
          {mostrarManualWpp && (
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-700 mb-1">WhatsApp — Configuração Manual</h2>
              <p className="text-xs text-gray-400 mb-4">
                Use apenas se não utilizar o fluxo de conexão automática acima.
              </p>
              <div className="space-y-3">
                <Field label="WhatsApp Number ID" value={tenant.whatsappNumberId || ''} onChange={v => set('whatsappNumberId', v)} placeholder="123456789012345" />
                <Field label="Token de Acesso" value={tenant.whatsappToken || ''} onChange={v => set('whatsappToken', v)} type="password" placeholder="EAAxxxxx..." />
              </div>
            </section>
          )}

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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400">
                  <option value="">Nenhum (sem integração)</option>
                  <option value="atlaz">Atlaz</option>
                  <option value="ixc">IXC Soft</option>
                  <option value="mkauth">MK-Auth</option>
                  <option value="tsmx">SGP TSMX</option>
                  <option value="generico">Outro (API genérica)</option>
                </select>
              </div>

              {['ixc', 'mkauth', 'generico', 'tsmx'].includes(tenant.sgpTipo) && (
                <Field
                  label="URL base da API do SGP"
                  value={tenant.sgpApiUrl || ''}
                  onChange={v => set('sgpApiUrl', v)}
                  placeholder={tenant.sgpTipo === 'tsmx' ? 'https://seuprovedor.sgp.tsmx.com.br' : 'https://sistema.meuprovedor.com.br'}
                />
              )}

              {tenant.sgpTipo && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {tenant.sgpTipo === 'atlaz'    && 'Token Atlaz'}
                    {tenant.sgpTipo === 'ixc'      && 'Credencial IXC — usuário:token (ex: admin:abc123)'}
                    {tenant.sgpTipo === 'mkauth'   && 'Auth token MK-Auth'}
                    {tenant.sgpTipo === 'tsmx'     && 'Credencial SGP — app:token (o "app" é o valor em Aplicações ao editar o token, ex: Bia)'}
                    {tenant.sgpTipo === 'generico' && 'Token de autenticação'}
                  </label>
                  <input
                    type="password"
                    value={tenant.sgpApiKey || ''}
                    onChange={e => set('sgpApiKey', e.target.value)}
                    placeholder="Token de acesso à API"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              )}

              {tenant.sgpTipo === 'generico' && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-xs text-brand-700 leading-relaxed">
                  <strong>Endpoints esperados no seu sistema:</strong><br />
                  POST /consultar — body: &#123; token, whatsapp &#125;<br />
                  POST /desbloquear — body: &#123; token, id_cliente, id_contrato &#125;<br />
                  POST /segunda_via — body: &#123; token, id_cliente &#125;<br />
                  POST /chamado — body: &#123; token, id_contrato, detalhes &#125;
                </div>
              )}

              {tenant.sgpTipo && (
                <label className="flex items-start gap-2 text-sm text-gray-700 pt-1">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!tenant.exigirDocumento}
                    onChange={e => set('exigirDocumento', e.target.checked)}
                  />
                  <span>
                    Exigir CPF/CNPJ para identificar o cliente
                    <span className="block text-xs text-gray-400">
                      O assistente ignora o número do WhatsApp e sempre pede o documento do titular antes de
                      consultar dados, enviar 2ª via ou desbloquear.
                    </span>
                  </span>
                </label>
              )}

              {tenant.sgpTipo && <TestarSgp />}

              {tenant.sgpTipo === 'tsmx' && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Lembretes automáticos de fatura</h3>
                  <p className="text-xs text-gray-400 mb-3">
                    Envia um template do WhatsApp 1 dia antes do vencimento e outro 5 dias depois do vencimento.
                    Requer templates já aprovados pela Meta (categoria "Utilidade") no WhatsApp Manager do provedor.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
                    <input
                      type="checkbox"
                      checked={!!tenant.lembreteFaturaAtivo}
                      onChange={e => set('lembreteFaturaAtivo', e.target.checked)}
                    />
                    Ativar lembretes automáticos
                  </label>
                  <div className="space-y-3">
                    <Field
                      label="Nome do template — pré-vencimento (D-1)"
                      value={tenant.lembreteFaturaTemplatePre || ''}
                      onChange={v => set('lembreteFaturaTemplatePre', v)}
                      placeholder="ex: lembrete_vencimento"
                    />
                    <Field
                      label="Nome do template — pós-vencimento (D+5)"
                      value={tenant.lembreteFaturaTemplatePos || ''}
                      onChange={v => set('lembreteFaturaTemplatePos', v)}
                      placeholder="ex: lembrete_atraso"
                    />
                    <Field
                      label="Idioma do template"
                      value={tenant.lembreteFaturaIdioma || 'pt_BR'}
                      onChange={v => set('lembreteFaturaIdioma', v)}
                      placeholder="pt_BR"
                    />
                  </div>
                  {tenant.lembreteFaturaAtivo && <TestarLembretes />}
                  {tenant.lembreteFaturaAtivo && <TestarLembreteCliente />}
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
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
                  <div key={f.id} className="bg-gray-50 rounded-lg border border-gray-200 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-sm font-medium text-gray-800">{f.nome}</span>
                        <span className="text-xs text-gray-400">{f.cidade}{f.uf ? ` — ${f.uf}` : ''}</span>
                        {f.whatsappConectado
                          ? <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><Wifi className="w-3 h-3" /> WhatsApp</span>
                          : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {f.whatsappConectado ? (
                          <>
                            <button type="button" onClick={() => setMovendo({ filialId: f.id, rotulo: 'número principal' })}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
                              <ArrowRightLeft className="w-3 h-3" /> Mover
                            </button>
                            <button type="button" onClick={() => handleDesconectarFilial(f.id)}
                              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors">
                              <WifiOff className="w-3 h-3" /> Desconectar
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => handleConectarFilial(f.id)}
                            disabled={conectandoFilialId === f.id}
                            className="flex items-center gap-1 text-xs text-[#25D366] hover:text-[#1ebe5d] disabled:opacity-50 transition-colors font-medium">
                            {conectandoFilialId === f.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Wifi className="w-3 h-3" />}
                            Conectar WhatsApp
                          </button>
                        )}
                        <button type="button" onClick={() => handleRemoverFilial(f.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {erroFilialWpp[f.id] && (
                      <p className="text-xs text-red-500 mt-1">{erroFilialWpp[f.id]}</p>
                    )}
                    {f.whatsappConectado && (
                      <div className="mt-2 pl-5 space-y-1.5">
                        {(f.numerosExtras || []).map(extra => (
                          <div key={extra.id} className="flex items-center justify-between">
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Wifi className="w-3 h-3 text-green-500" />
                              {extra.rotulo || extra.whatsappNumberId}
                            </span>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => setMovendo({ filialId: f.id, extraId: extra.id, rotulo: extra.rotulo || extra.whatsappNumberId })}
                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
                                <ArrowRightLeft className="w-3 h-3" /> Mover
                              </button>
                              <button type="button" onClick={() => handleDesconectarNumeroExtra(f.id, extra.id)}
                                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors">
                                <WifiOff className="w-3 h-3" /> Desconectar
                              </button>
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => handleConectarNumeroExtra(f.id)}
                          disabled={conectandoExtraFilialId === f.id}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#25D366] disabled:opacity-50 transition-colors">
                          {conectandoExtraFilialId === f.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Plus className="w-3 h-3" />}
                          Conectar número adicional (ex: fixo)
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {movendo && (
              <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5">
                <p className="text-xs text-indigo-800 mb-2">
                  Mover <strong>{movendo.rotulo}</strong> para qual filial?
                </p>
                <div className="flex gap-2 flex-wrap items-center">
                  <select value={destinoMover} onChange={e => setDestinoMover(e.target.value)}
                    className="flex-1 min-w-32 border border-indigo-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    <option value="">Selecione a filial de destino</option>
                    {filiais.filter(f => f.ativo && f.id !== movendo.filialId).map(f => (
                      <option key={f.id} value={f.id}>{f.nome} — {f.cidade}</option>
                    ))}
                  </select>
                  <button type="button" onClick={handleMoverNumero} disabled={!destinoMover || movendoSalvando}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                    {movendoSalvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirmar'}
                  </button>
                  <button type="button" onClick={() => { setMovendo(null); setDestinoMover(''); }}
                    className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <input value={formFilial.nome} onChange={e => setFormFilial(f => ({ ...f, nome: e.target.value }))}
                placeholder="Nome da filial (ex: Araçuaí)"
                className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                onKeyDown={e => e.key === 'Enter' && handleAddFilial(e)} />
              <input value={formFilial.cidade} onChange={e => setFormFilial(f => ({ ...f, cidade: e.target.value }))}
                placeholder="Cidade"
                className="flex-1 min-w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                onKeyDown={e => e.key === 'Enter' && handleAddFilial(e)} />
              <select value={formFilial.uf} onChange={e => setFormFilial(f => ({ ...f, uf: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                <option value="">UF</option>
                {ESTADOS_BR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
              <button type="button" onClick={handleAddFilial} disabled={savingFilial || !formFilial.nome || !formFilial.cidade}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium">
                {savingFilial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar
              </button>
            </div>
            {erroFilial && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erroFilial}</p>
            )}
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
                className="text-gray-400 hover:text-brand-600 shrink-0 transition-colors">
                {copiado ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              URL do webhook: <code className="bg-gray-100 px-1 rounded">https://seu-dominio.com/api/webhook</code>
            </p>
          </section>

          {/* assinatura digital — apenas Pro e Enterprise */}
          {['pro', 'enterprise'].includes(tenant.plano) && (
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-brand-500" /> Assinatura Digital de Contratos
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Configure a integração com ZapSign ou D4Sign para enviar contratos para assinatura diretamente pelo atendimento.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plataforma</label>
                <select value={tenant.assinaturaTipo || ''} onChange={e => set('assinaturaTipo', e.target.value || null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400">
                  <option value="">Nenhuma (desativado)</option>
                  <option value="zapsign">ZapSign</option>
                  <option value="d4sign">D4Sign</option>
                </select>
              </div>

              {tenant.assinaturaTipo && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {tenant.assinaturaTipo === 'zapsign' ? 'Token da API ZapSign' : 'Token da API D4Sign (tokenAPI)'}
                  </label>
                  <input type="password" value={tenant.assinaturaToken || ''}
                    onChange={e => set('assinaturaToken', e.target.value)}
                    placeholder={tenant.assinaturaTipo === 'zapsign' ? 'Bearer token do ZapSign' : 'Token de API do D4Sign'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400" />
                </div>
              )}

              {tenant.assinaturaTipo === 'zapsign' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Token do Modelo de Contrato (ZapSign)</label>
                  <input type="text" value={tenant.assinaturaExtra?.templateToken || ''}
                    onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), templateToken: e.target.value })}
                    placeholder="Token do modelo criado no ZapSign"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400" />
                  <p className="text-[11px] text-gray-400 mt-1">Encontre em ZapSign → Modelos → seu modelo → copie o token da URL.</p>
                </div>
              )}

              {tenant.assinaturaTipo === 'd4sign' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">CryptKey D4Sign</label>
                    <input type="password" value={tenant.assinaturaExtra?.cryptKey || ''}
                      onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), cryptKey: e.target.value })}
                      placeholder="cryptKey da sua conta D4Sign"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">UUID do Cofre D4Sign</label>
                    <input type="text" value={tenant.assinaturaExtra?.cofreUuid || ''}
                      onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), cofreUuid: e.target.value })}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400" />
                  </div>
                </>
              )}

              {tenant.assinaturaTipo && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-xs text-brand-700 leading-relaxed">
                  <strong>Webhook de confirmação:</strong><br />
                  Configure esta URL na plataforma para atualizar o status quando o contrato for assinado:<br />
                  <code className="select-all break-all mt-1 block bg-brand-100 rounded px-2 py-1">
                    {`${import.meta.env.VITE_API_URL || window.location.origin}/api/contracts/webhook/${tenant.assinaturaTipo}`}
                  </code>
                </div>
              )}
            </div>
          </section>
          )}

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
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-brand-contraste px-6 py-2.5 rounded-lg font-medium text-sm transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configurações
          </button>
        </form>

        {/* Fora do form principal */}
        <HorariosSection />
        <TagsSection />
        <RoteamentoSection />

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
                placeholder="Mínimo 10 caracteres" />
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
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400" />
    </div>
  );
}
