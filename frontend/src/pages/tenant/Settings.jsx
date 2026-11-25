import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { planoTemContrato } from '../../lib/planos.js';
import { Save, Loader2, Copy, Check, Upload, X, Building2, Stethoscope, CircleCheck, TriangleAlert, CircleX, Plus, Trash2, MapPin, Lock, Clock, Wifi, WifiOff, ChevronDown, ChevronUp, FileSignature, Tag, AlertCircle, GitBranch, ToggleLeft, ToggleRight, ArrowRightLeft, Smartphone, Receipt } from 'lucide-react';

// Mostra de volta o que o backend vai reconhecer na lista de números
// particulares. A regra que vale está em backend/src/services/telefone.js —
// isto aqui é espelho, não autoridade. Existe porque sem esse retorno uma linha
// digitada errada falha calada e o provedor conclui que a lista não funciona.
function numerosReconhecidos(texto) {
  return String(texto || '')
    .split(/[\n,;]+/)
    .map(linha => {
      let d = linha.replace(/\D/g, '');
      if (d.startsWith('00')) d = d.slice(2);
      if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
      if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return null;
    })
    .filter(Boolean);
}

function carregarFbSdk() {
  return new Promise((resolve) => {
    if (window.FB) { resolve(); return; }
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: import.meta.env.VITE_META_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: import.meta.env.VITE_META_GRAPH_VERSION || 'v25.0',
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

// O que de fato acontece dentro do popup da Meta chega por postMessage, não pelo
// callback do FB.login — esse só sabe dizer que não voltou código. Sem ler isto,
// todo erro do fluxo (número preso em outro parceiro, recurso indisponível para
// o app, etapa que a Meta barrou) virava a mesma frase genérica de "cancelado",
// que não diz o que fazer a seguir.
function ouvirSignup(aoReceber) {
  const ouvinte = (evento) => {
    let host;
    try { host = new URL(evento.origin).hostname; } catch { return; }
    if (!/(^|\.)facebook\.com$/.test(host)) return;
    let msg;
    try { msg = JSON.parse(evento.data); } catch { return; }
    if (msg?.type === 'WA_EMBEDDED_SIGNUP') aoReceber(msg);
  };
  window.addEventListener('message', ouvinte);
  return () => window.removeEventListener('message', ouvinte);
}

// Devolve null quando a Meta não contou nada — aí o chamador mantém a mensagem
// antiga, em vez de inventar um motivo que não veio de lugar nenhum.
function motivoDaFalha(evento) {
  const dados = evento?.data || {};
  if (dados.error_message) return `A Meta recusou: ${dados.error_message}`;
  if (evento?.event === 'CANCEL' && dados.current_step) {
    return `Cadastro interrompido na etapa "${dados.current_step}". Se não foi você que fechou a janela, foi a Meta que barrou aí.`;
  }
  return null;
}

// A Meta descontinuou as versoes 2 e 3 do Embedded Signup em 15/10/2026 e
// lancou a v5 em 20/10, onde a coexistencia (o numero vale no app do celular e
// na Cloud API ao mesmo tempo) vem ligada por padrao. Sem `version`, quem
// escolhe a versao e a Meta — e isso pode mudar sozinho de um dia para o outro.
//
// Fica em variavel de ambiente para dar pra voltar atras sem mexer no codigo:
// vazia = o comportamento de hoje; 'v5' = a versao nova.
const ES_VERSAO = import.meta.env.VITE_META_ES_VERSION || '';

function extrasSignup(featureType = '') {
  return {
    setup: {},
    featureType,
    // Ignorado da v4 em diante, mas inofensivo e necessario se cairmos numa
    // versao antiga.
    sessionInfoVersion: '3',
    ...(ES_VERSAO ? { version: ES_VERSAO } : {}),
  };
}

// Cada versao nomeia os campos do seu jeito: a v3 devolve waba_id e a v5 fala
// em "messaging account ID". Ler os dois, e aceitar que venham aninhados em
// .data, evita que uma troca de versao da Meta quebre o cadastro sem ninguem
// entender por que.
//
// Vir vazio nao e fatal: o backend acha a WABA pelo escopo do token e o numero
// pela WABA (routes/whatsapp.js).
function dadosDoSignup(sessionInfo) {
  const d = sessionInfo?.data || sessionInfo || {};
  return {
    wabaId: d.waba_id || d.messaging_account_id || null,
    phoneNumberId: d.phone_number_id || null,
  };
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

  // featureType vazio = número novo, criado do zero na Cloud API.
  // 'whatsapp_business_app_onboarding' = coexistência: o número já roda no app
  // WhatsApp Business do provedor e passa a valer nos dois lugares. A Meta
  // mostra um QR code no fim do fluxo, que ele lê pelo aparelho.
  const handleConectar = async (featureType = '') => {
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

      let ultimoEvento = null;
      const pararDeOuvir = ouvirSignup((msg) => { ultimoEvento = msg; });

      window.FB.login((response) => {
        pararDeOuvir();
        if (response.authResponse?.code) {
          enviarCodigo(response.authResponse.code, sessionInfo);
        } else {
          setConectando(false);
          const motivo = motivoDaFalha(ultimoEvento);
          if (motivo) setErro(motivo);
          else if (response.status !== 'connected') {
            setErro('Fluxo cancelado ou permissões negadas.');
          }
        }
      }, {
        config_id: import.meta.env.VITE_META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: extrasSignup(featureType),
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
        ...dadosDoSignup(sessionInfo),
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
      <p className="text-xs text-gray-500 mb-4">
        Conecte sua conta WhatsApp Business diretamente via Meta. O processo leva menos de 2 minutos.
      </p>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
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

      <div className="flex flex-wrap items-center gap-2">
        {/* onClick={() => handleConectar()} e não onClick={handleConectar}: o
            React passa o evento do clique como primeiro argumento, que viraria
            o featureType e quebraria o fluxo padrão. */}
        <button
          type="button"
          onClick={() => handleConectar()}
          disabled={conectando}
          className="flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {conectando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          {status?.conectado ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}
        </button>

        <button
          type="button"
          onClick={() => handleConectar('whatsapp_business_app_onboarding')}
          disabled={conectando}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Smartphone className="w-4 h-4" />
          Já uso esse número no celular
        </button>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Use a segunda opção se o número já está no app WhatsApp Business. Ele continua
        funcionando no celular e passa a aparecer aqui também — a Meta mostra um QR code
        no fim do cadastro, que você lê pelo aparelho.
      </p>

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

      {status?.conectado && <PerfilWhatsApp />}

      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onToggleManual}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-600 transition-colors"
        >
          {mostrarManual ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Configuração manual (avançado)
        </button>
      </div>
    </section>
  );
}

const VERTICAIS_PT = {
  UNDEFINED: 'Não informada',
  PROF_SERVICES: 'Serviços profissionais',
  OTHER: 'Outro',
  AUTO: 'Automotivo',
  BEAUTY: 'Beleza e bem-estar',
  APPAREL: 'Vestuário',
  EDU: 'Educação',
  ENTERTAIN: 'Entretenimento',
  EVENT_PLAN: 'Eventos',
  FINANCE: 'Finanças e bancos',
  GROCERY: 'Mercado',
  GOVT: 'Governo',
  HOTEL: 'Hotelaria',
  HEALTH: 'Saúde',
  NONPROFIT: 'Sem fins lucrativos',
  RETAIL: 'Varejo',
  TRAVEL: 'Viagem',
  RESTAURANT: 'Restaurante',
  NOT_A_BIZ: 'Não é uma empresa',
};

// O WhatsApp exibe a foto de perfil sempre recortada em círculo e recusa
// imagens abaixo de 192x192. Em vez de confiar no arquivo que vier, o painel
// normaliza antes de mandar: recorta o centro em quadrado, redimensiona pra
// 640 e achata em JPEG. Isso também mantém o corpo da requisição pequeno — o
// Express aqui aceita 1 MB, e um print de celular cru estoura isso.
function prepararFoto(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const lado = 640;
      const canvas = document.createElement('canvas');
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext('2d');
      // Fundo branco porque JPEG não tem transparência: sem isto, um PNG
      // transparente vira fundo preto no perfil.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, lado, lado);
      const corte = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(
        img,
        (img.naturalWidth - corte) / 2, (img.naturalHeight - corte) / 2, corte, corte,
        0, 0, lado, lado
      );
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler essa imagem.'));
    };
    img.src = url;
  });
}

// Foto, recado, site e endereço do número — o que o cliente vê ao abrir a
// conversa. Isso não está no painel por capricho: quando o provedor entra como
// cliente de parceiro, o WhatsApp Manager mostra a conta dele em modo leitura,
// e trocar a foto por lá exigiria acesso de administrador ao portfólio de
// negócios de cada cliente.
//
// Não carrega junto com a página: é uma chamada à Meta por número, e quase
// toda visita às Configurações não tem nada a ver com isso.
function PerfilWhatsApp() {
  const [dados, setDados] = useState(null);
  const [ref, setRef] = useState(null);
  const [form, setForm] = useState({});
  const [foto, setFoto] = useState(null);       // data URL nova, ainda não salva
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const fotoRef = useRef(null);

  function doPerfil(perfil) {
    return {
      about: perfil?.about || '',
      description: perfil?.description || '',
      email: perfil?.email || '',
      address: perfil?.address || '',
      vertical: perfil?.vertical || '',
      site1: perfil?.websites?.[0] || '',
      site2: perfil?.websites?.[1] || '',
    };
  }

  async function carregar(alvo) {
    setCarregando(true);
    setErro('');
    setAviso('');
    setFoto(null);
    try {
      const { data } = await api.get('/whatsapp/perfil', { params: alvo ? { ref: alvo } : {} });
      setDados(data);
      setRef(data.ref);
      setForm(doPerfil(data.perfil));
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao carregar o perfil');
      // O 502 ainda traz a lista de números: dá pra trocar de número e tentar
      // de novo sem recarregar a página.
      if (err.response?.data?.numeros) {
        setDados(d => ({ ...(d || {}), numeros: err.response.data.numeros }));
        setRef(err.response.data.ref || null);
      }
    } finally {
      setCarregando(false);
    }
  }

  async function escolherFoto(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    setAviso('');
    try {
      setFoto(await prepararFoto(arquivo));
    } catch (err) {
      setErro(err.message);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      const sites = [form.site1, form.site2].map(s => (s || '').trim()).filter(Boolean);
      const { data } = await api.post('/whatsapp/perfil', {
        ref,
        about: form.about,
        description: form.description,
        email: form.email,
        address: form.address,
        vertical: form.vertical || undefined,
        websites: sites,
        foto: foto || undefined,
      });
      setDados(d => ({ ...d, perfil: data.perfil || d?.perfil }));
      if (data.perfil) setForm(doPerfil(data.perfil));
      setFoto(null);
      setAviso(
        'Perfil atualizado. A foto pode levar alguns minutos para aparecer para quem já tem a conversa aberta.'
      );
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao salvar o perfil');
    } finally {
      setSalvando(false);
    }
  }

  const numeros = dados?.numeros || [];
  const atual = numeros.find(n => n.ref === ref);
  const fotoAtual = dados?.perfil?.profile_picture_url || null;
  const limiteAbout = dados?.limites?.about || 139;
  const limiteDesc = dados?.limites?.description || 512;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-sm font-medium text-gray-700">Perfil do WhatsApp</p>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        A foto, o recado e o site que o cliente vê ao abrir a conversa. Dá pra editar por aqui
        mesmo quando o WhatsApp Manager mostra a conta só em leitura.
      </p>

      {!dados && (
        <button
          type="button"
          onClick={() => carregar()}
          disabled={carregando}
          className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Carregar perfil
        </button>
      )}

      {erro && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{erro}</div>
      )}
      {aviso && (
        <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">{aviso}</div>
      )}

      {dados && numeros.length === 0 && (
        <p className="text-xs text-gray-500">Nenhum número conectado neste provedor.</p>
      )}

      {dados && numeros.length > 0 && (
        <div className="space-y-3">
          {numeros.length > 1 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Número</label>
              <select
                value={ref || ''}
                onChange={e => carregar(e.target.value)}
                disabled={carregando || salvando}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                {numeros.map(n => (
                  <option key={n.ref} value={n.ref}>{n.rotulo}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-full border border-gray-200 overflow-hidden bg-gray-50 shrink-0 flex items-center justify-center">
              {foto || fotoAtual ? (
                <img src={foto || fotoAtual} alt="Foto do perfil" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-7 h-7 text-gray-300" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500 mb-2">
                {atual ? `ID do número: ${atual.phoneNumberId}` : ''}
                <br />
                O painel recorta no centro e manda em 640×640 — o WhatsApp exibe em círculo.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => fotoRef.current?.click()}
                  disabled={salvando}
                  className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {fotoAtual ? 'Trocar foto' : 'Escolher foto'}
                </button>
                {foto && (
                  <button
                    type="button"
                    onClick={() => setFoto(null)}
                    className="flex items-center gap-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Descartar
                  </button>
                )}
              </div>
              {foto && (
                <p className="text-xs text-amber-600 mt-1.5">
                  Foto escolhida — só vai para o WhatsApp quando você salvar.
                </p>
              )}
              <input ref={fotoRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={escolherFoto} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Recado <span className="text-gray-400">({(form.about || '').length}/{limiteAbout})</span>
            </label>
            <input
              value={form.about || ''}
              maxLength={limiteAbout}
              onChange={e => setForm(f => ({ ...f, about: e.target.value }))}
              placeholder="Internet de verdade pra sua casa"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Descrição <span className="text-gray-400">({(form.description || '').length}/{limiteDesc})</span>
            </label>
            <textarea
              value={form.description || ''}
              maxLength={limiteDesc}
              rows={3}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">E-mail</label>
              <input
                value={form.email || ''}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="contato@provedor.com.br"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Categoria</label>
              <select
                value={form.vertical || ''}
                onChange={e => setForm(f => ({ ...f, vertical: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Não alterar</option>
                {(dados.verticais || []).map(v => (
                  <option key={v} value={v}>{VERTICAIS_PT[v] || v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Site</label>
              <input
                value={form.site1 || ''}
                onChange={e => setForm(f => ({ ...f, site1: e.target.value }))}
                placeholder="https://provedor.com.br"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Segundo site (opcional)</label>
              <input
                value={form.site2 || ''}
                onChange={e => setForm(f => ({ ...f, site2: e.target.value }))}
                placeholder="https://central.provedor.com.br"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Endereço</label>
            <input
              value={form.address || ''}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Rua, número, bairro, cidade"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || carregando}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
            >
              {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar perfil
            </button>
            <button
              type="button"
              onClick={() => carregar(ref)}
              disabled={salvando || carregando}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50"
            >
              Recarregar da Meta
            </button>
          </div>
        </div>
      )}
    </div>
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
      <p className="text-xs text-gray-500 mb-4">
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
              <span className={`text-sm ${horarios[key]?.ativo ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{label}</span>
            </label>
            {horarios[key]?.ativo ? (
              <>
                <input type="time" value={horarios[key]?.inicio || '08:00'}
                  onChange={e => setDia(key, 'inicio', e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <span className="text-gray-500 text-sm">até</span>
                <input type="time" value={horarios[key]?.fim || '18:00'}
                  onChange={e => setDia(key, 'fim', e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
        <p className="text-xs text-gray-500 mt-1">
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
          <span className="text-xs text-gray-500">minutos — conversas aguardando além desse tempo ficam com alerta vermelho</span>
        </div>
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
          className={`px-2.5 py-1 rounded-md transition-colors ${modo === 'telefone' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}
        >
          Por telefone
        </button>
        <button
          type="button"
          onClick={() => { setModo('documento'); setResultado(null); setErro(''); }}
          className={`px-2.5 py-1 rounded-md transition-colors ${modo === 'documento' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}
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
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="button"
          onClick={testar}
          disabled={carregando || !valor.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
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

  async function testar(simular) {
    if (!simular) {
      const confirmado = window.confirm(
        'Isso vai enviar lembretes REAIS agora para todos os clientes com fatura vencendo amanhã ou já vencida. Não é uma simulação. Confirma?'
      );
      if (!confirmado) return;
    }

    setCarregando(true);
    setResultado(null);
    setErro('');
    try {
      const { data } = await api.post('/tenants/me/testar-lembretes', { simular });
      setResultado(data.resultado);
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao testar');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mt-3 border border-dashed border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
      <p className="text-xs text-amber-700">
        A simulação consulta o SGP de verdade e mostra quem receberia, sem enviar nada. O envio real dispara agora para todos os clientes elegíveis hoje.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => testar(true)}
          disabled={carregando}
          className="px-4 py-2 bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-50 text-amber-700 text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Simular (não envia)
        </button>
        <button
          type="button"
          onClick={() => testar(false)}
          disabled={carregando}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Testar agora (envio real)
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
              {resultado.simulacao && (
                <p className="font-medium text-amber-700">Simulação — nada foi enviado.</p>
              )}
              <p>Pré-vencimento: {resultado.preEncontradas === null
                ? 'erro na consulta'
                : resultado.simulacao
                  ? `${resultado.preEncontradas} fatura(s) encontrada(s)`
                  : `${resultado.preEnviadas}/${resultado.preEncontradas} enviados`}</p>
              <p>Pós-vencimento: {resultado.posEncontradas === null
                ? 'erro na consulta'
                : resultado.simulacao
                  ? `${resultado.posEncontradas} fatura(s) encontrada(s)`
                  : `${resultado.posEnviadas}/${resultado.posEncontradas} enviados`}</p>
              {resultado.previa?.length > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-2 space-y-1">
                  <p className="font-medium text-gray-600">Receberiam:</p>
                  {resultado.previa.map((p, i) => (
                    <p key={i} className="font-mono text-[11px]">
                      {p.tipo} · {p.cliente} · {p.telefone} · R$ {p.valor} · venc. {p.vencimento} · {p.pagamento}…
                    </p>
                  ))}
                </div>
              )}
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

// Converte os templates de lembrete pro formato com botão de pagamento.
//
// O código PIX ficava dentro do corpo da mensagem, e o WhatsApp não deixa
// copiar um pedaço de um balão: o cliente segurava a mensagem, copiava tudo e
// colava "Prezado cliente..." no app do banco. No formato novo o corpo vai até
// {{4}} e o pagamento vira um botão que abre /p/<token>, onde o código está
// sozinho atrás de um "Copiar".
//
// A lista não carrega junto com a página: é uma chamada à Meta, e quase toda
// visita às Configurações não tem nada a ver com template.
function TemplatesBotaoPagamento() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [pendencias, setPendencias] = useState([]);
  const [rascunhos, setRascunhos] = useState({});
  const [salvandoId, setSalvandoId] = useState(null);
  const [aviso, setAviso] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    setPendencias([]);
    try {
      const { data } = await api.get('/whatsapp/templates');
      setDados(data);
      const inicial = {};
      for (const t of data.templates || []) {
        inicial[t.id] = { corpo: t.corpoSugerido, textoBotao: 'Pagar agora' };
      }
      setRascunhos(inicial);
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao carregar templates');
    } finally {
      setCarregando(false);
    }
  }

  async function enviarEdicao(template) {
    const rascunho = rascunhos[template.id] || {};
    const confirmado = window.confirm(
      `Isso envia a edição do template "${template.nome}" para análise da Meta.\n\n` +
      'Enquanto ela não for aprovada, o lembrete continua saindo no formato antigo. ' +
      'A Meta permite uma edição a cada 24h por template. Confirma?'
    );
    if (!confirmado) return;

    setSalvandoId(template.id);
    setErro('');
    setAviso('');
    try {
      const { data } = await api.post(`/whatsapp/templates/${template.id}/botao-pagamento`, {
        corpo: rascunho.corpo,
        textoBotao: rascunho.textoBotao,
      });
      setAviso(data.aviso || 'Edição enviada.');
      await carregar();
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao enviar edição');
    } finally {
      setSalvandoId(null);
    }
  }

  async function alternarBotao(ligar) {
    setCarregando(true);
    setErro('');
    setAviso('');
    setPendencias([]);
    try {
      const { data } = await api.post('/whatsapp/templates/ativar-botao', { ligar });
      setDados(d => ({ ...d, botaoAtivo: data.botaoAtivo }));
      setAviso(data.botaoAtivo
        ? 'Pronto: os próximos lembretes saem com o botão de pagamento.'
        : 'Voltou para o formato antigo, com o código no corpo da mensagem.');
    } catch (err) {
      setErro(err.response?.data?.erro || err.message || 'Erro ao alterar');
      setPendencias(err.response?.data?.pendencias || []);
    } finally {
      setCarregando(false);
    }
  }

  const nomesLembrete = [dados?.templatesLembrete?.pre, dados?.templatesLembrete?.pos].filter(Boolean);
  const doLembrete = (dados?.templates || []).filter(t => nomesLembrete.includes(t.nome));

  return (
    <div className="mt-3 border border-gray-200 rounded-lg p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-700">Botão de pagamento no lembrete</p>
        <p className="text-xs text-gray-500 mt-1">
          O WhatsApp não deixa copiar só um pedaço de uma mensagem: com o código PIX no texto,
          o cliente copia o lembrete inteiro. Aqui o código sai do corpo e vira um botão que abre
          uma página com um "Copiar código PIX".
        </p>
      </div>

      {!dados && (
        <button
          type="button"
          onClick={carregar}
          disabled={carregando}
          className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Carregar templates da Meta
        </button>
      )}

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 whitespace-pre-wrap">
          {erro}
          {pendencias.length > 0 && (
            <ul className="list-disc list-inside mt-1">
              {pendencias.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </div>
      )}
      {aviso && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">{aviso}</div>
      )}

      {dados && !dados.baseUrl && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          O servidor está sem <code className="font-mono">API_PUBLIC_URL</code>. Sem ela não dá pra montar
          a URL do botão nem servir a página de pagamento.
        </div>
      )}

      {dados && (
        <>
          <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-600">
              <p className="font-medium text-gray-700">
                Formato atual: {dados.botaoAtivo ? 'botão de pagamento' : 'código no corpo da mensagem'}
              </p>
              {dados.baseUrl && (
                <p className="font-mono text-[11px] mt-1 break-all">{dados.baseUrl}/p/&#123;&#123;1&#125;&#125;</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => alternarBotao(!dados.botaoAtivo)}
              disabled={carregando}
              className="shrink-0 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 transition-colors"
            >
              {dados.botaoAtivo ? 'Voltar ao formato antigo' : 'Ligar botão'}
            </button>
          </div>

          {doLembrete.length === 0 && (
            <p className="text-xs text-gray-500">
              Nenhum dos templates configurados acima apareceu na conta do WhatsApp. Confira os nomes.
            </p>
          )}

          {doLembrete.map(t => (
            <div key={t.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono text-gray-700 break-all">{t.nome}</span>
                <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
                  t.status === 'APPROVED' ? 'bg-green-100 text-green-700'
                  : t.status === 'PENDING' ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'
                }`}>{t.status}</span>
              </div>
              {t.motivoRecusa && t.motivoRecusa !== 'NONE' && (
                <p className="text-xs text-red-600">Recusado: {t.motivoRecusa}</p>
              )}

              {t.jaTemBotao ? (
                <p className="text-xs text-green-700">Já está no formato com botão de pagamento.</p>
              ) : (
                <>
                  <label className="block text-xs text-gray-500">
                    Corpo sem a variável de pagamento (vai de &#123;&#123;1&#125;&#125; a &#123;&#123;4&#125;&#125;)
                  </label>
                  <textarea
                    value={rascunhos[t.id]?.corpo ?? ''}
                    onChange={e => setRascunhos(r => ({ ...r, [t.id]: { ...r[t.id], corpo: e.target.value } }))}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-xs text-gray-500 mb-1">Texto do botão (até 25 caracteres)</label>
                      <input
                        value={rascunhos[t.id]?.textoBotao ?? 'Pagar agora'}
                        maxLength={25}
                        onChange={e => setRascunhos(r => ({ ...r, [t.id]: { ...r[t.id], textoBotao: e.target.value } }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => enviarEdicao(t)}
                      disabled={salvandoId === t.id || t.status === 'PENDING'}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                    >
                      {salvandoId === t.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Enviar edição para análise
                    </button>
                  </div>
                  {t.status === 'PENDING' && (
                    <p className="text-xs text-amber-700">Já tem uma edição em análise. Espere a Meta responder.</p>
                  )}
                </>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={carregar}
            disabled={carregando}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            Atualizar status
          </button>
        </>
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

// Adaptadores que sabem varrer faturas por data de vencimento. Nos outros o
// robô herda os métodos vazios da base e não envia nada, então a seção some em
// vez de deixar configurar algo que nunca vai rodar.
const SGP_COM_LEMBRETES = ['tsmx', 'ixc'];

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
      <p className="text-xs text-gray-500 mb-4">
        Crie etiquetas para categorizar atendimentos. Os agentes poderão aplicá-las nas conversas abertas.
      </p>

      {catalogo.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {catalogo.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
              <span className="text-sm font-medium text-gray-700">{t.nome}</span>
              <button type="button" onClick={() => remover(i)} className="ml-0.5 text-gray-500 hover:text-red-500 transition-colors">
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
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
      <p className="text-xs text-gray-500 mb-4">
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

const ESTADO = {
  ok:     { Icone: CircleCheck,   cor: 'text-emerald-600', fundo: 'bg-emerald-50 border-emerald-200' },
  alerta: { Icone: TriangleAlert, cor: 'text-amber-600',   fundo: 'bg-amber-50 border-amber-200' },
  falha:  { Icone: CircleX,       cor: 'text-red-600',     fundo: 'bg-red-50 border-red-200' },
};

// Verificação sob demanda: nada roda sozinho em segundo plano, então não há
// como bater no sistema do provedor sem alguém ter pedido.
function Diagnostico() {
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  const verificar = async () => {
    setRodando(true); setErro(''); setResultado(null);
    try {
      const { data } = await api.get('/tenants/me/diagnostico');
      setResultado(data);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível concluir a verificação.');
    } finally {
      setRodando(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-gray-400" /> Verificação de funcionamento
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Testa o número do WhatsApp, a integração com o seu sistema e o recebimento
        de mensagens. Só consulta — não envia nada para ninguém.
      </p>

      <button type="button" onClick={verificar} disabled={rodando}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60">
        {rodando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />}
        {rodando ? 'Verificando...' : 'Verificar agora'}
      </button>

      {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}

      {resultado && (
        <div className="mt-4 space-y-2">
          {resultado.itens.map(item => {
            const { Icone, cor, fundo } = ESTADO[item.estado] || ESTADO.alerta;
            return (
              <div key={item.titulo} className={`flex items-start gap-2.5 border rounded-lg px-3 py-2.5 ${fundo}`}>
                <Icone className={`w-4 h-4 shrink-0 mt-0.5 ${cor}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{item.titulo}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{item.detalhe}</p>
                  {item.comoResolver && item.estado !== 'ok' && (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.comoResolver}</p>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 pt-1">
            Verificado em {new Date(resultado.verificadoEm).toLocaleString('pt-BR')}
          </p>
        </div>
      )}
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
          const { wabaId, phoneNumberId } = dadosDoSignup(sessionInfo);
          api.post(`/whatsapp/embedded-signup-filial/${filialId}`, { code, wabaId, phoneNumberId })
            .then(() => { carregarFiliais(); resolve(); })
            .catch(err => reject(err));
        }, {
          config_id: import.meta.env.VITE_META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: extrasSignup(''),
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
          const { wabaId, phoneNumberId } = dadosDoSignup(sessionInfo);
          api.post(`/whatsapp/embedded-signup-filial-extra/${filialId}`, { code, wabaId, phoneNumberId })
            .then(() => { carregarFiliais(); resolve(); })
            .catch(err => reject(err));
        }, {
          config_id: import.meta.env.VITE_META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: extrasSignup(''),
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

  if (loading) return <div className="p-8 text-gray-500">Carregando...</div>;
  if (!tenant) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-gray-800 mb-8">Configurações do Provedor</h1>

        <form onSubmit={handleSalvar} className="space-y-5">

          <Diagnostico />

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
                  <p className="text-xs text-gray-500 mb-2">PNG, JPG ou SVG — máximo 2 MB.<br />Recomendado: fundo transparente, 200×200px.</p>
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
              <p className="text-xs text-gray-500 mb-4">
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
            <p className="text-xs text-gray-500 mb-4">
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

              {/* IXC e MK-Auth não devolvem o prazo do desbloqueio em confiança na
                  resposta — é configuração de lá. Sem preencher aqui, o cliente
                  é desbloqueado sem saber que expira. Atlaz e TSMX devolvem a
                  data e ignoram este campo. */}
              {['ixc', 'mkauth'].includes(tenant.sgpTipo) && (
                <Field
                  label="Prazo do desbloqueio em confiança"
                  value={tenant.desbloqueioPrazo || ''}
                  onChange={v => set('desbloqueioPrazo', v)}
                  placeholder="24 horas"
                />
              )}

              {tenant.sgpTipo && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {tenant.sgpTipo === 'atlaz'    && 'Token Atlaz'}
                    {tenant.sgpTipo === 'ixc'      && 'Credencial IXC — ID do token : token (ex: 12:a1b2c3...)'}
                    {tenant.sgpTipo === 'mkauth'   && 'Auth token MK-Auth'}
                    {tenant.sgpTipo === 'tsmx'     && 'Credencial SGP — app:token (o "app" é o valor em Aplicações ao editar o token, ex: Bia)'}
                    {tenant.sgpTipo === 'generico' && 'Token de autenticação'}
                  </label>
                  <input
                    type="password"
                    value={tenant.sgpApiKey || ''}
                    onChange={e => set('sgpApiKey', e.target.value)}
                    placeholder={tenant.sgpTipo === 'ixc' ? '12:a1b2c3d4...' : 'Token de acesso à API'}
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
                    <span className="block text-xs text-gray-500">
                      O assistente ignora o número do WhatsApp e sempre pede o documento do titular antes de
                      consultar dados, enviar 2ª via ou desbloquear.
                    </span>
                  </span>
                </label>
              )}

              {tenant.sgpTipo && <TestarSgp />}

              {SGP_COM_LEMBRETES.includes(tenant.sgpTipo) && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Lembretes automáticos de fatura</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Envia um template do WhatsApp 1 dia antes do vencimento e outro {Number(tenant.lembreteFaturaDiasPos) || 5} dias depois do vencimento.
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
                      label={`Nome do template — pós-vencimento (D+${Number(tenant.lembreteFaturaDiasPos) || 5})`}
                      value={tenant.lembreteFaturaTemplatePos || ''}
                      onChange={v => set('lembreteFaturaTemplatePos', v)}
                      placeholder="ex: lembrete_atraso"
                    />
                    <Field
                      label="Dias após o vencimento para cobrar"
                      value={tenant.lembreteFaturaDiasPos ?? 5}
                      onChange={v => set('lembreteFaturaDiasPos', v.replace(/\D/g, ''))}
                      placeholder="5"
                    />
                    <Field
                      label="Idioma do template"
                      value={tenant.lembreteFaturaIdioma || 'pt_BR'}
                      onChange={v => set('lembreteFaturaIdioma', v)}
                      placeholder="pt_BR"
                    />
                    <Field
                      label="Link da central do assinante (opcional)"
                      value={tenant.lembreteFaturaLinkAssinante || ''}
                      onChange={v => set('lembreteFaturaLinkAssinante', v)}
                      placeholder="https://exemplo.com/central"
                    />
                    {tenant.lembreteFaturaLinkAssinante && (
                      <p className="text-xs text-gray-400 -mt-2">
                        Preenchido: o link acima substitui o código PIX/boleto na mensagem. Vazio: continua mandando o PIX/boleto normalmente. No formato com botão de pagamento este campo é ignorado — quem leva o cliente ao pagamento é o botão.
                      </p>
                    )}
                  </div>
                  {tenant.lembreteFaturaAtivo && <TestarLembretes />}
                  {tenant.lembreteFaturaAtivo && <TestarLembreteCliente />}
                  {tenant.lembreteFaturaAtivo && <TemplatesBotaoPagamento />}
                </div>
              )}
            </div>
          </section>

          {/* assistente ia */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Assistente IA — System Prompt</h2>
            <p className="text-xs text-gray-500 mb-3">
              Instrua o assistente sobre como atender seus clientes: serviços oferecidos, área de cobertura, horário de atendimento, procedimentos comuns, etc.
            </p>
            <textarea rows={10} value={tenant.systemPrompt || ''}
              onChange={e => set('systemPrompt', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Você é o assistente virtual do provedor de internet [nome]. Sua função é ajudar os clientes com dúvidas sobre..." />
          </section>

          {/* chamado técnico */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1">Chamado técnico</h2>
            <p className="text-xs text-gray-500 mb-3">
              Setor que recebe os chamados abertos pelo painel. O IXC não entrega essa lista por
              API, então o número precisa ser informado aqui uma vez.
            </p>
            <input
              value={tenant.chamadoSetorPadrao || ''}
              onChange={e => set('chamadoSetorPadrao', e.target.value.replace(/\D/g, ''))}
              placeholder="ex: 4"
              className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="text-xs text-gray-500 mt-2">
              No IXC: <span className="font-medium">Suporte → Setores</span>. Use o número da coluna
              <span className="font-medium"> ID setor</span> do setor de suporte técnico.
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              Sem isso, o chamado abre com o setor que o assunto tiver cadastrado — e se o assunto
              não tiver nenhum, o IXC recusa pedindo para preencher o setor.
            </p>
          </section>

          {/* saudação de boas-vindas */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1">Saudação de boas-vindas</h2>
            <p className="text-xs text-gray-500 mb-3">
              Enviada exatamente como escrita, antes da primeira resposta do assistente. Deixe em
              branco para não enviar nenhuma.
            </p>
            <textarea rows={8} value={tenant.mensagemBoasVindas || ''}
              onChange={e => set('mensagemBoasVindas', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder={'Olá! 👋 Seja bem-vindo!\n\nSou o assistente da equipe e estou aqui para ajudar.'} />

            <p className="text-xs font-medium text-gray-600 mt-4 mb-1.5">Quando enviar</p>
            <div className="space-y-1.5">
              {[
                { valor: 'primeiro_contato', titulo: 'Só no primeiro contato', ajuda: 'Uma vez por cliente. Quem já conversou antes não recebe de novo.' },
                { valor: 'sempre', titulo: 'A cada conversa nova', ajuda: 'Toda vez que uma conversa é aberta, inclusive com cliente antigo.' },
              ].map(op => (
                <button key={op.valor} type="button"
                  onClick={() => set('boasVindasQuando', op.valor)}
                  className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                    (tenant.boasVindasQuando || 'primeiro_contato') === op.valor
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <p className="text-sm text-gray-800">{op.titulo}</p>
                  <p className="text-xs text-gray-500">{op.ajuda}</p>
                </button>
              ))}
            </div>

            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              Cada saudação é uma mensagem de WhatsApp a mais. A Meta dá 1.000 mensagens de serviço
              grátis por mês para cada número; acima disso, cerca de R$ 0,04 cada.
            </p>
          </section>

          {/* comportamento do atendimento */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-500" /> Comportamento do Atendimento
            </h2>
            <button type="button"
              onClick={() => set('encerrarHumanoPorInatividade', !(tenant.encerrarHumanoPorInatividade !== false))}
              className="w-full flex items-start gap-3 mt-3 text-left">
              {tenant.encerrarHumanoPorInatividade !== false
                ? <ToggleRight className="w-9 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <ToggleLeft className="w-9 h-5 text-gray-300 shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-gray-800">Encerrar atendimento humano por inatividade</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Quando ativado (padrão), uma conversa em atendimento humano é encerrada automaticamente após 4 horas sem mensagens, igual às conversas com o bot. Desative para que ela só feche quando o atendente resolver e encerrar manualmente.
                </p>
              </div>
            </button>
            <button type="button"
              onClick={() => set('encerrarSemAtendente', !(tenant.encerrarSemAtendente !== false))}
              className="w-full flex items-start gap-3 mt-4 text-left">
              {tenant.encerrarSemAtendente !== false
                ? <ToggleRight className="w-9 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <ToggleLeft className="w-9 h-5 text-gray-300 shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-gray-800">Encerrar conversas que nenhum atendente assumiu</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Quando ativado (padrão), conversas só com o bot ou aguardando atendente são encerradas após 4 horas sem mensagens, e o bot encerra sozinho quando o cliente responde ao lembrete ou manda comprovante pago pelo código. Desative para que elas fiquem na fila até um atendente assumir — útil para quem quer ver de manhã tudo o que chegou de madrugada.
                </p>
              </div>
            </button>
            <button type="button"
              onClick={() => set('aceitaPix', !(tenant.aceitaPix !== false))}
              className="w-full flex items-start gap-3 mt-4 text-left">
              {tenant.aceitaPix !== false
                ? <ToggleRight className="w-9 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <ToggleLeft className="w-9 h-5 text-gray-300 shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-gray-800">Aceita pagamento via PIX</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Quando ativado (padrão), o bot pode mandar o código PIX que o sistema do provedor devolver junto com o boleto. Desative se o provedor não trabalha com PIX — o bot passa a mandar só o boleto/linha digitável, mesmo que o sistema devolva um código.
                </p>
              </div>
            </button>
            <button type="button"
              onClick={() => set('npsAtivo', !(tenant.npsAtivo !== false))}
              className="w-full flex items-start gap-3 mt-4 text-left">
              {tenant.npsAtivo !== false
                ? <ToggleRight className="w-9 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <ToggleLeft className="w-9 h-5 text-gray-300 shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-gray-800">Perguntar a nota de satisfação (NPS)</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Quando ativado (padrão), ao fim de cada atendimento o bot pergunta de 0 a 10 quanto o cliente recomendaria o suporte, no máximo uma vez a cada 30 dias por cliente. Desative para não perguntar nada — é uma mensagem a mais por atendimento, que conta na franquia do WhatsApp. As notas já respondidas continuam no relatório.
                </p>
              </div>
            </button>

            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-800">Números particulares</p>
              <p className="text-xs text-gray-500 mt-0.5 mb-2.5">
                Para quem usa o mesmo número no atendimento e no pessoal. Mensagem que vier destes
                números não é respondida pelo assistente, não abre conversa e não aparece no painel —
                você responde pelo próprio celular, como sempre. Um número por linha, com DDD.
              </p>
              <textarea rows={4} value={tenant.numerosIgnorados || ''}
                onChange={e => set('numerosIgnorados', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder={'(33) 99999-0000\n33988887777'} />
              {(tenant.numerosIgnorados || '').trim() !== '' && (
                numerosReconhecidos(tenant.numerosIgnorados).length > 0 ? (
                  <p className="text-xs text-gray-500 mt-1.5">
                    Reconhecidos: {numerosReconhecidos(tenant.numerosIgnorados).join(' · ')}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 mt-1.5">
                    Nenhum número reconhecido — confira se cada linha tem DDD e 8 ou 9 dígitos.
                  </p>
                )
              )}
            </div>
          </section>

          {/* custo das mensagens */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-500" /> Custo das mensagens no WhatsApp
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              A Meta dá 1.000 mensagens de atendimento grátis por mês para cada número e cobra da
              1.001 em diante. Quem recebe essa cobrança é você, pelo seu parceiro de WhatsApp —
              então só a sua fatura tem o preço exato. Preencha aqui e o Relatório passa a mostrar
              o gasto do mês em reais; deixando vazio, ele mostra só a quantidade.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Mensagem de atendimento (R$)
                </label>
                <input type="text" inputMode="decimal"
                  value={tenant.custoMsgServico || ''}
                  onChange={e => set('custoMsgServico', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="0,035" />
                <p className="text-xs text-gray-400 mt-1">As respostas do assistente e dos atendentes.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Lembrete de fatura (R$)
                </label>
                <input type="text" inputMode="decimal"
                  value={tenant.custoMsgUtilidade || ''}
                  onChange={e => set('custoMsgUtilidade', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="0,08" />
                <p className="text-xs text-gray-400 mt-1">Os modelos aprovados, cobrados à parte da cota.</p>
              </div>
            </div>
          </section>

          {/* filiais */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-indigo-500" /> Filiais / Cidades de atendimento
            </h2>
            <p className="text-xs text-gray-500 mb-4">
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
                        <span className="text-xs text-gray-500">{f.cidade}{f.uf ? ` — ${f.uf}` : ''}</span>
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
                          className="text-gray-500 hover:text-red-500 transition-colors">
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
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#25D366] disabled:opacity-50 transition-colors">
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
                className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                onKeyDown={e => e.key === 'Enter' && handleAddFilial(e)} />
              <input value={formFilial.cidade} onChange={e => setFormFilial(f => ({ ...f, cidade: e.target.value }))}
                placeholder="Cidade"
                className="flex-1 min-w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                onKeyDown={e => e.key === 'Enter' && handleAddFilial(e)} />
              <select value={formFilial.uf} onChange={e => setFormFilial(f => ({ ...f, uf: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
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
            <p className="text-xs text-gray-500 mb-3">
              Use este valor no campo "Verify Token" ao configurar o webhook no Meta for Developers.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200">
              <code className="flex-1 text-xs text-gray-700 break-all select-all">{tenant.webhookVerifyToken}</code>
              <button type="button" onClick={() => copiar(tenant.webhookVerifyToken)}
                title="Copiar"
                className="text-gray-500 hover:text-blue-600 shrink-0 transition-colors">
                {copiado ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              URL do webhook: <code className="bg-gray-100 px-1 rounded">https://seu-dominio.com/api/webhook</code>
            </p>
          </section>

          {/* assinatura digital — apenas Pro e Enterprise */}
          {planoTemContrato(tenant.plano) && (
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-blue-500" /> Assinatura Digital de Contratos
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Configure a integração com ZapSign ou D4Sign para enviar contratos para assinatura diretamente pelo atendimento.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plataforma</label>
                <select value={tenant.assinaturaTipo || ''} onChange={e => set('assinaturaTipo', e.target.value || null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
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
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              )}

              {tenant.assinaturaTipo === 'zapsign' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Token do Modelo de Contrato (ZapSign)</label>
                  <input type="text" value={tenant.assinaturaExtra?.templateToken || ''}
                    onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), templateToken: e.target.value })}
                    placeholder="Token do modelo criado no ZapSign"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <p className="text-[11px] text-gray-500 mt-1">Encontre em ZapSign → Modelos → seu modelo → copie o token da URL.</p>
                </div>
              )}

              {tenant.assinaturaTipo === 'd4sign' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">CryptKey D4Sign</label>
                    <input type="password" value={tenant.assinaturaExtra?.cryptKey || ''}
                      onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), cryptKey: e.target.value })}
                      placeholder="cryptKey da sua conta D4Sign"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">UUID do Cofre D4Sign</label>
                    <input type="text" value={tenant.assinaturaExtra?.cofreUuid || ''}
                      onChange={e => set('assinaturaExtra', { ...(tenant.assinaturaExtra || {}), cofreUuid: e.target.value })}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Pode colar a URL inteira do cofre — o sistema extrai o UUID sozinho.
                    </p>
                  </div>
                </>
              )}

              {/* Modelo do contrato: característica do que o provedor vende, não
                  escolha de quem envia. */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Modelo de contrato</label>
                <select value={tenant.contratoModelo || 'residencial'}
                  onChange={e => set('contratoModelo', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="residencial">Residencial — banda larga</option>
                  <option value="dedicado">Link dedicado — com SLA e permanência</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  O link dedicado sai com Anexo I (SLA), Anexo II (Termo de Contratação) e Anexo III (Permanência de 12 meses).
                </p>
              </div>

              {tenant.assinaturaTipo && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
                  <strong>Webhook de confirmação:</strong><br />
                  Configure esta URL na plataforma para atualizar o status quando o contrato for assinado:<br />
                  <code className="select-all break-all mt-1 block bg-blue-100 rounded px-2 py-1">
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
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-colors">
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
            <p className="text-xs text-gray-500 mb-4">
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
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}
