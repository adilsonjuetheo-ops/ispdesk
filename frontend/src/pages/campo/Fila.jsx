import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api.js';
import {
  RefreshCw, MapPin, Phone, Navigation, Clock, AlertTriangle, CheckCircle2, Wrench,
  NotebookPen, X, Loader2, Info,
} from 'lucide-react';

const LIMITE_RELATO = 2000;

// "2026-11-04 08:30:00" vem do IXC sem fuso — é o relógio do provedor.
function quando(valor) {
  if (!valor) return null;
  const d = new Date(String(valor).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? `hoje ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// O IXC usa 'U' para urgente e 'A' para alta. Só destacamos o que tira alguém
// da ordem normal — marcar tudo como importante é não marcar nada.
const URGENTE = p => p === 'U' || p === 'A';

function linkMapa(c) {
  if (c.latitude && c.longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`;
  }
  const texto = [c.endereco, c.cidade].filter(Boolean).join(' ');
  return texto ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}` : null;
}

// Folha de registro do atendimento.
//
// O que ela NÃO tem é um botão "Finalizar", e é de propósito: `status` é
// somente-leitura na API do IXC, que ignora o valor enviado e ainda responde
// sucesso. Um botão de finalizar aqui diria "pronto" ao técnico e deixaria a
// O.S. aberta para sempre. Então o texto na tela promete exatamente o que
// acontece — o relato e a hora vão para a O.S., o status fica com o
// escritório. Recurso que falta é contratempo; promessa que o sistema não
// cumpre é perda de confiança no app todo.
// Pega a posição do celular sem travar o registro. Recusa de permissão, GPS
// desligado, dentro de casa de alvenaria sem sinal — qualquer uma delas devolve
// null e o relato vai do mesmo jeito. Teto de 8s: o técnico está esperando.
function posicaoAtual() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

function FolhaRegistro({ chamado, onFechar, onSalvo }) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  // Visível e desmarcável. O escritório vê de onde o atendimento foi
  // registrado, e o técnico tem que saber disso antes de apertar o botão —
  // mandar a posição dele calado seria outra coisa.
  const [enviarLocal, setEnviarLocal] = useState(true);

  const salvar = async e => {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const pos = enviarLocal ? await posicaoAtual() : null;
      const r = await api.post(`/campo/chamados/${chamado.id}/atendimento`, {
        mensagem: texto.trim(),
        ...(pos || {}),
      });
      onSalvo(chamado.id, r.data?.mensagemResposta || '', r.data?.aviso || '');
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível registrar agora. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center">
      <form onSubmit={salvar}
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl border-t sm:border border-gray-200 dark:border-gray-800 max-h-[92dvh] overflow-y-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Registrar atendimento</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              #{chamado.id} · {chamado.clienteNome}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="w-11 h-11 -mt-1.5 -mr-1.5 flex items-center justify-center rounded-lg text-gray-400 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <textarea value={texto} onChange={e => setTexto(e.target.value.slice(0, LIMITE_RELATO))}
            rows={6} autoFocus
            placeholder="O que você encontrou e o que fez. Ex.: troquei o conector no poste, sinal voltou para -18 dBm, cliente navegando."
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y" />
          <p className="text-xs text-gray-400 text-right tabular-nums">{texto.length}/{LIMITE_RELATO}</p>

          <label className="flex items-start gap-2.5 py-1 cursor-pointer">
            <input type="checkbox" checked={enviarLocal} onChange={e => setEnviarLocal(e.target.checked)}
              className="w-5 h-5 mt-0.5 shrink-0 accent-blue-600" />
            <span className="text-sm text-gray-700 dark:text-gray-200">
              Anexar onde eu estou agora
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Fica no histórico da O.S., junto do relato.
              </span>
            </span>
          </label>

          {/* A frase que evita a reclamação de amanhã. */}
          <div className="flex gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 px-3 py-2.5">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
              O relato vai para a O.S. no sistema do provedor com a sua assinatura e a hora.
              O chamado continua como <strong>{chamado.statusRotulo}</strong> — quem finaliza é o escritório.
            </p>
          </div>

          {erro && (
            <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onFechar}
              className="flex-1 min-h-[48px] rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || texto.trim().length < 3}
              className="flex-1 min-h-[48px] rounded-lg bg-blue-600 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Cartao({ c, onRegistrar }) {
  const mapa = linkMapa(c);
  const agenda = quando(c.agendadoPara);

  return (
    <article className={`bg-white dark:bg-gray-900 rounded-xl border p-4 ${
      URGENTE(c.prioridade)
        ? 'border-amber-300 dark:border-amber-800'
        : 'border-gray-200 dark:border-gray-800'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug">
            {c.clienteNome}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {c.assunto || 'Sem assunto'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
            c.finalizado
              ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
          }`}>
            {c.statusRotulo}
          </span>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">#{c.id}</p>
        </div>
      </div>

      {URGENTE(c.prioridade) && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" /> Prioridade alta
        </p>
      )}

      {agenda && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-400">
          <Clock className="w-4 h-4" /> Agendado {agenda}
        </p>
      )}

      {(c.endereco || c.cidade) && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
          <span>
            {c.endereco || c.cidade}
            {c.complemento && <span className="text-gray-500"> · {c.complemento}</span>}
          </span>
        </p>
      )}

      {/* Na zona rural a referência costuma ser a única pista que serve. */}
      {c.referencia && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 pl-[1.375rem]">
          Referência: {c.referencia}
        </p>
      )}

      {c.mensagem && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
          {c.mensagem}
        </p>
      )}

      {/* O que já foi registrado, para ele não repetir o que escreveu de
          manhã nem o que o colega escreveu antes. */}
      {c.mensagemResposta && (
        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Atendimento registrado
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line mt-1">
            {c.mensagemResposta}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {c.clienteWhatsapp && (
          <a href={`tel:${c.clienteWhatsapp.replace(/\D/g, '')}`}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium">
            <Phone className="w-4 h-4" /> Ligar
          </a>
        )}
        {mapa && (
          <a href={mapa} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium">
            <Navigation className="w-4 h-4" /> Como chegar
          </a>
        )}
        {!c.finalizado && (
          <button onClick={() => onRegistrar(c)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium">
            <NotebookPen className="w-4 h-4" />
            {c.mensagemResposta ? 'Registrar mais' : 'Registrar atendimento'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function Fila() {
  const [chamados, setChamados] = useState([]);
  const [estado, setEstado] = useState({ suportado: null, vinculado: null });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [verFinalizados, setVerFinalizados] = useState(false);
  const [registrando, setRegistrando] = useState(null);
  const [aviso, setAviso] = useState('');

  const carregar = () => {
    setCarregando(true);
    setErro('');
    api.get('/campo/chamados')
      .then(r => {
        setEstado({ suportado: r.data.suportado, vinculado: r.data.vinculado });
        setChamados(r.data.chamados || []);
      })
      .catch(err => setErro(err.response?.data?.erro || 'Não foi possível carregar seus chamados.'))
      .finally(() => setCarregando(false));
  };

  useEffect(carregar, []);

  // Atualiza só o cartão que mudou, em vez de recarregar a fila. Recarregar
  // custa uma volta inteira no IXC — 100 O.S. mais o cadastro de cada cliente
  // — e ele está no 4G, na rua, com o celular na mão.
  const aplicarRegistro = (id, mensagemResposta, avisoDoServidor) => {
    setChamados(lista => lista.map(c => (c.id === id ? { ...c, mensagemResposta } : c)));
    setRegistrando(null);
    setAviso(avisoDoServidor || `Atendimento registrado na O.S. #${id}.`);
  };

  // Agendado primeiro, e dentro disso o mais cedo na frente: é a ordem em que
  // ele vai trabalhar. Urgente sobe. O resto fica abaixo, por id.
  const visiveis = useMemo(() => {
    const abertos = chamados.filter(c => (verFinalizados ? c.finalizado : !c.finalizado));
    return abertos.sort((a, b) => {
      if (URGENTE(a.prioridade) !== URGENTE(b.prioridade)) return URGENTE(a.prioridade) ? -1 : 1;
      if (!!a.agendadoPara !== !!b.agendadoPara) return a.agendadoPara ? -1 : 1;
      if (a.agendadoPara && b.agendadoPara) return a.agendadoPara.localeCompare(b.agendadoPara);
      return Number(b.id) - Number(a.id);
    });
  }, [chamados, verFinalizados]);

  const emAberto = chamados.filter(c => !c.finalizado).length;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          <button onClick={() => setVerFinalizados(false)}
            className={`min-h-[40px] px-3.5 rounded-lg text-sm font-medium ${
              !verFinalizados
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
            }`}>
            Em aberto{emAberto ? ` (${emAberto})` : ''}
          </button>
          <button onClick={() => setVerFinalizados(true)}
            className={`min-h-[40px] px-3.5 rounded-lg text-sm font-medium ${
              verFinalizados
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
            }`}>
            Finalizados
          </button>
        </div>
        <button onClick={carregar} disabled={carregando} aria-label="Atualizar"
          className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 disabled:opacity-50 shrink-0">
          <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 px-4 py-3 mb-4">
          <p className="text-sm text-red-700 dark:text-red-300">{erro}</p>
        </div>
      )}

      {aviso && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 px-4 py-3 mb-4 flex items-start justify-between gap-3">
          <p className="text-sm text-emerald-800 dark:text-emerald-300">{aviso}</p>
          <button onClick={() => setAviso('')} aria-label="Fechar aviso"
            className="text-emerald-700 dark:text-emerald-400 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Fila vazia sem explicação faz o técnico achar que o app quebrou. Se
          falta o vínculo com o colaborador do IXC, a tela diz isso. */}
      {estado.vinculado === false && estado.suportado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 px-4 py-4">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Sua conta ainda não está ligada ao colaborador no sistema do provedor.
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
            Enquanto isso não for feito, nenhum chamado aparece aqui. Peça ao administrador
            para vincular na tela de Equipe.
          </p>
        </div>
      )}

      {estado.suportado === false && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          O sistema deste provedor não permite consultar chamados por aqui.
        </p>
      )}

      {carregando && <p className="text-sm text-gray-500">Carregando...</p>}

      {!carregando && estado.vinculado && visiveis.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-10 text-center">
          {verFinalizados
            ? <Wrench className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            : <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />}
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {verFinalizados ? 'Nenhum chamado finalizado por aqui ainda.' : 'Nenhum chamado em aberto. Tudo em dia.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visiveis.map(c => <Cartao key={c.id} c={c} onRegistrar={setRegistrando} />)}
      </div>

      {registrando && (
        <FolhaRegistro chamado={registrando}
          onFechar={() => setRegistrando(null)}
          onSalvo={aplicarRegistro} />
      )}
    </div>
  );
}
