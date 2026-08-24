import { useState, useEffect, useRef } from 'react';
import api from '../lib/api.js';
import { useMidiaBlob } from '../hooks/useMidiaBlob.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePolling } from '../hooks/usePolling.js';
import { useNotificationSound } from '../hooks/useNotificationSound.js';
import {
  Send, UserCheck, Bot, X, Loader2, Paperclip, FileText,
  ImageIcon, Mic, Search, StickyNote, ArrowRightLeft, Tag,
  Check, CheckCheck, Bold, Italic, Strikethrough, Code,
  List, ListOrdered, Plus, ArrowLeft, Video, Sparkles, Maximize2, Clock,
  MoreHorizontal, PanelRight, Play, Pause, BellRing,
} from 'lucide-react';
import { format, subDays, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';

function groupMsgsByDate(msgs) {
  const result = [];
  let lastDate = null;
  for (const msg of msgs) {
    const d = new Date(msg.enviadaEm);
    const dateStr = format(d, 'yyyy-MM-dd');
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      result.push({ type: 'separator', date: d, key: `sep-${dateStr}` });
    }
    result.push({ type: 'msg', msg, key: msg.id });
  }
  return result;
}

function DateSeparator({ date }) {
  const label = isToday(date) ? 'Hoje'
    : isYesterday(date) ? 'Ontem'
    : format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  return (
    <div className="flex items-center gap-3 my-4 px-2">
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      <span className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

// Um contexto de áudio para o app inteiro: o navegador limita quantos podem
// existir ao mesmo tempo, e uma conversa longa tem dezenas de áudios.
let ctxAudio = null;
function contextoAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctxAudio) ctxAudio = new AC();
  return ctxAudio;
}

const BARRAS = 40;

// Reduz a onda a poucas barras pegando o PICO de cada fatia. Média deixaria
// tudo achatado e parecido; o pico preserva o desenho da fala. Amostra de 8 em
// 8 porque o traço não muda e o custo cai junto.
function extrairPicos(buffer) {
  const dados = buffer.getChannelData(0);
  const porBarra = Math.floor(dados.length / BARRAS) || 1;
  const picos = [];
  for (let i = 0; i < BARRAS; i++) {
    const inicio = i * porBarra;
    let pico = 0;
    for (let j = 0; j < porBarra; j += 8) {
      const v = Math.abs(dados[inicio + j] || 0);
      if (v > pico) pico = v;
    }
    picos.push(pico);
  }
  const maior = Math.max(...picos, 0.01);
  return picos.map(p => p / maior);
}

const mmss = seg => {
  if (!Number.isFinite(seg) || seg < 0) return '--:--';
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Player próprio no lugar do <audio controls>: o controle nativo muda de cara em
// cada navegador e não cabe no balão. As barras usam currentColor, então herdam
// a cor do texto do balão e nada de cor nova entra no painel.
function PlayerAudio({ src, aoFalhar }) {
  const ref = useRef(null);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [picos, setPicos] = useState(null);

  // Desenha a onda a partir do próprio arquivo já baixado — sem ida extra à
  // rede. Se a decodificação falhar, cai para barras planas: perde o desenho,
  // mas o áudio continua tocando.
  useEffect(() => {
    let cancelado = false;
    if (!src) return undefined;
    (async () => {
      try {
        const ctx = contextoAudio();
        if (!ctx) return;
        const dados = await (await fetch(src)).arrayBuffer();
        const buffer = await ctx.decodeAudioData(dados);
        if (cancelado) return;
        setPicos(extrairPicos(buffer));
        setDur(d => (d > 0 ? d : buffer.duration));
      } catch {
        if (!cancelado) setPicos(Array(BARRAS).fill(0.35));
      }
    })();
    return () => { cancelado = true; };
  }, [src]);

  const alternar = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const buscar = e => {
    const el = ref.current;
    if (!el || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fracao = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    el.currentTime = fracao * dur;
    setPos(fracao * dur);
  };

  const progresso = dur > 0 ? pos / dur : 0;
  const barras = picos || Array(BARRAS).fill(0.3);

  return (
    <div className="flex items-center gap-2.5">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onError={aoFalhar}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setPos(0); }}
        onTimeUpdate={e => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          // MP3 servido em stream às vezes reporta Infinity; nesse caso vale a
          // duração que veio da decodificação.
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        className="hidden"
      />

      <button type="button" onClick={alternar}
        aria-label={tocando ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="group relative shrink-0 w-9 h-9 rounded-full flex items-center justify-center">
        <span aria-hidden="true"
          className="absolute inset-0 rounded-full bg-current opacity-10 group-hover:opacity-20 transition-opacity" />
        {tocando
          ? <Pause className="relative w-4 h-4 fill-current" />
          : <Play className="relative w-4 h-4 fill-current translate-x-[1px]" />}
      </button>

      <div role="slider" tabIndex={0} aria-label="Posição do áudio"
        aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}
        onClick={buscar}
        className="flex-1 flex items-center gap-[2px] h-8 cursor-pointer">
        {barras.map((p, i) => (
          <span key={i}
            className={`flex-1 rounded-full bg-current transition-opacity ${
              i / BARRAS <= progresso ? 'opacity-90' : 'opacity-25'
            }`}
            style={{ height: `${Math.max(3, p * 26)}px` }}
          />
        ))}
      </div>

      <span className="shrink-0 text-[11px] tabular-nums opacity-60 w-9 text-right">
        {mmss(pos > 0 ? dur - pos : dur)}
      </span>
    </div>
  );
}

// Lembrete não é nota: nota é contexto daquela conversa, lembrete é tarefa que
// alguém precisa resolver e que some de vista se ficar só no meio do papo.
function FormLembrete({ conversa, onCriado }) {
  const { user } = useAuth();
  // Busca a equipe aqui dentro: o componente só monta quando a aba é aberta,
  // então a lista não é carregada em toda conversa que ninguém vai usar.
  const [agentes, setAgentes] = useState([]);
  useEffect(() => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/agents`)
      .then(r => setAgentes(r.data.filter(a => a.ativo !== false)))
      .catch(() => {});
  }, [user?.tenantId]);

  const [texto, setTexto] = useState('');
  const [venceEm, setVenceEm] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Atalhos de prazo: quase todo lembrete daqui é "hoje mais tarde" ou "amanhã
  // cedo", e digitar data completa para isso é atrito à toa.
  const emHoras = h => {
    const d = new Date(Date.now() + h * 3600e3);
    d.setSeconds(0, 0);
    // datetime-local espera hora local, e toISOString devolve UTC.
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setVenceEm(local.toISOString().slice(0, 16));
  };

  const salvar = async e => {
    e.preventDefault();
    if (!texto.trim() || salvando) return;
    setSalvando(true); setErro('');
    try {
      await api.post('/lembretes', {
        texto,
        conversaId: conversa.id,
        responsavelId: responsavelId || null,
        venceEm: venceEm ? new Date(venceEm).toISOString() : null,
      });
      setTexto(''); setVenceEm(''); setResponsavelId('');
      onCriado?.();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível salvar o lembrete.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={salvar} className="p-3 space-y-2">
      <textarea
        value={texto}
        onChange={e => setTexto(e.target.value)}
        rows={2}
        placeholder="O que precisa ser feito? Ex: ligar para negociar as parcelas em atraso"
        className="w-full text-[15px] leading-relaxed border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <input type="datetime-local" value={venceEm} onChange={e => setVenceEm(e.target.value)}
          aria-label="Prazo do lembrete"
          className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <button type="button" onClick={() => emHoras(3)}
          className="text-xs text-gray-600 hover:text-blue-700 bg-gray-100 hover:bg-blue-50 dark:text-gray-300 dark:hover:text-blue-300 dark:bg-gray-800 dark:hover:bg-blue-950 px-2 py-1.5 rounded-lg transition-colors">
          Em 3h
        </button>
        <button type="button" onClick={() => emHoras(24)}
          className="text-xs text-gray-600 hover:text-blue-700 bg-gray-100 hover:bg-blue-50 dark:text-gray-300 dark:hover:text-blue-300 dark:bg-gray-800 dark:hover:bg-blue-950 px-2 py-1.5 rounded-lg transition-colors">
          Amanhã
        </button>

        <select value={responsavelId} onChange={e => setResponsavelId(e.target.value)}
          aria-label="Responsável pelo lembrete"
          className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="">Equipe toda</option>
          {agentes.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>

        <button type="submit" disabled={!texto.trim() || salvando}
          className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
          Criar lembrete
        </button>
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Aparece em <strong>Lembretes</strong> no menu, para toda a equipe. Sem prazo, fica na lista sem cobrar hora.
      </p>
    </form>
  );
}

function Lightbox({ src, onFechar }) {
  useEffect(() => {
    const aoTeclar = e => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      onClick={onFechar} role="dialog" aria-modal="true">
      <img src={src} alt="Imagem ampliada" onClick={e => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
      <button onClick={onFechar} aria-label="Fechar"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function MidiaBolao({ msg, isCliente }) {
  const { conteudo, midiaUrl, conversaId } = msg;
  const { src: midiaSrc, erro: midiaErro } = useMidiaBlob(conversaId, midiaUrl);
  const [falhaPlayer, setFalhaPlayer] = useState(null);
  const [ampliada, setAmpliada] = useState(false);

  // O <audio> falha em silêncio: sem isso, um codec não suportado fica
  // indistinguível de um download que não veio.
  const aoFalhar = e => {
    const c = e.currentTarget?.error?.code;
    setFalhaPlayer(
      c === 4 ? 'formato não suportado por este navegador'
      : c === 3 ? 'falha ao decodificar o arquivo'
      : c === 2 ? 'falha de rede ao carregar'
      : 'não foi possível reproduzir'
    );
  };
  const isImagem = conteudo.startsWith('[Imagem]');
  const isAudio  = conteudo.startsWith('[Áudio]');
  const isVideo  = conteudo.startsWith('[Vídeo]');
  const nome = conteudo.replace(/^\[(Imagem|Arquivo|Áudio|Vídeo)\] /, '');
  const cor = isCliente
    ? 'bg-white border border-gray-200 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200'
    : 'bg-blue-50 border border-blue-100 text-blue-800 dark:bg-blue-950 dark:border-blue-900 dark:text-blue-200';

  if (isImagem && midiaUrl) {
    // Comprovante é imagem alta e estreita. Sem teto de altura ela vira uma tira
    // que empurra a conversa inteira para fora da tela — quem precisar do
    // detalhe abre em tamanho cheio no lightbox.
    return (
      <>
        <button type="button" disabled={!midiaSrc} onClick={() => setAmpliada(true)}
          className="group relative block rounded-2xl overflow-hidden max-w-[20rem] enabled:cursor-zoom-in">
          <img
            src={midiaSrc || undefined}
            alt="Imagem"
            className="w-full max-h-80 object-cover object-top rounded-2xl"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
          <span className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/45 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <Maximize2 className="w-3.5 h-3.5" />
          </span>
          <div style={{ display: 'none' }} className={`items-start gap-2 rounded-2xl px-3 py-2.5 text-sm ${cor}`}>
            <ImageIcon className="w-5 h-5 shrink-0 opacity-60 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs opacity-60 mb-0.5 font-medium">Imagem</p>
              <p className="text-xs leading-relaxed">{nome}</p>
            </div>
          </div>
        </button>
        {ampliada && midiaSrc && <Lightbox src={midiaSrc} onFechar={() => setAmpliada(false)} />}
      </>
    );
  }

  if (isVideo && midiaUrl) {
    return (
      <div className="rounded-2xl overflow-hidden max-w-[20rem]">
        {midiaErro ? (
          <p className="text-xs text-red-500 p-3">Não foi possível carregar o vídeo.</p>
        ) : !midiaSrc ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 p-3 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Carregando vídeo...
          </p>
        ) : (
          <>
            <video src={midiaSrc} controls preload="metadata" onError={aoFalhar} className="w-full rounded-2xl" />
            {falhaPlayer && <p className="text-xs text-red-500 p-2">Vídeo: {falhaPlayer}.</p>}
          </>
        )}
      </div>
    );
  }

  if (isAudio && midiaUrl) {
    return (
      <div className={`rounded-2xl px-3 py-2.5 text-sm max-w-[20rem] ${cor}`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Mic className="w-4 h-4 opacity-60 shrink-0" />
          <p className="text-xs opacity-60 font-medium">Áudio</p>
        </div>
        {/* Player só depois do arquivo em mãos: montá-lo sem fonte deixa um
            controle morto na tela, sem dizer o que houve. */}
        {midiaErro ? (
          <p className="text-xs text-red-500 py-1">Não foi possível carregar o áudio.</p>
        ) : !midiaSrc ? (
          <p className="text-xs opacity-50 py-1 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Carregando áudio...
          </p>
        ) : (
          <>
            <PlayerAudio src={midiaSrc} aoFalhar={aoFalhar} />
            {falhaPlayer && <p className="text-xs text-red-500 mt-1">Áudio: {falhaPlayer}.</p>}
          </>
        )}
        {nome && <p className="text-xs leading-relaxed mt-1.5 opacity-80">{nome}</p>}
      </div>
    );
  }

  const Icon = isImagem ? ImageIcon : isAudio ? Mic : isVideo ? Video : FileText;
  const label = isImagem ? 'Imagem enviada'
    : isAudio  ? (isCliente ? 'Áudio transcrito' : 'Áudio enviado')
    : isVideo  ? 'Vídeo enviado'
    : 'Documento enviado';
  return (
    <div className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm max-w-[20rem] ${cor}`}>
      <Icon className="w-5 h-5 shrink-0 opacity-60 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs opacity-60 mb-0.5 font-medium">{label}</p>
        <p className="text-xs leading-relaxed">{nome}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  // "enviando" é estado só da tela: o balão aparece antes de a API do WhatsApp
  // confirmar, para o atendente não ficar olhando o campo parado.
  if (status === 'enviando')  return <Clock className="w-3.5 h-3.5 text-gray-300 shrink-0" />;
  if (status === 'lida')     return <CheckCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
  if (status === 'entregue') return <CheckCheck className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
  return <Check className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
}

function BolaoMsg({ msg, agenteNome, nomeAssistente }) {
  const isCliente = msg.origem === 'cliente';
  const isBot = msg.origem === 'bot';
  const isNota = msg.origem === 'nota';
  const isSistema = msg.conteudo.startsWith('[Sistema]');
  const isMidia = msg.conteudo.startsWith('[Arquivo]') || msg.conteudo.startsWith('[Imagem]') || msg.conteudo.startsWith('[Áudio]') || msg.conteudo.startsWith('[Vídeo]');

  if (isSistema) {
    return (
      <div className="flex justify-center my-2">
        <span className="bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400 text-xs px-3 py-1 rounded-full">
          {msg.conteudo.replace('[Sistema] ', '')}
        </span>
      </div>
    );
  }

  if (isNota) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-900 rounded-xl px-4 py-2 max-w-[80%]">
          <div className="flex items-center gap-1.5 mb-1">
            <StickyNote className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
            <span className="text-[10px] font-semibold text-yellow-700 dark:text-yellow-300 uppercase tracking-wide">Nota interna</span>
          </div>
          <p className="text-sm leading-relaxed text-yellow-900 dark:text-yellow-100 whitespace-pre-wrap">{msg.conteudo}</p>
          <p className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-1">
            {format(new Date(msg.enviadaEm), 'HH:mm', { locale: ptBR })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex mb-3', isCliente ? 'justify-start' : 'justify-end')}>
      <div className="max-w-[85%] md:max-w-balao">
        {!isCliente && (
          <p className="text-xs mb-1 text-right">
            {isBot
              ? <span className="text-gray-500 dark:text-gray-400">{nomeAssistente || 'Bot'}</span>
              : <span className="font-bold text-gray-700 dark:text-gray-300">{agenteNome || 'Agente'}</span>
            }
          </p>
        )}
        {isMidia ? (
          <MidiaBolao msg={{ ...msg, conversaId: msg.conversaId }} isCliente={isCliente} />
        ) : (
          <div className={clsx('rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap', {
            'bg-white border border-gray-200 text-gray-800 rounded-tl-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100': isCliente,
            'bg-emerald-50 text-emerald-900 rounded-tr-sm border border-emerald-100 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-900': isBot,
            'bg-blue-50 text-blue-900 rounded-tr-sm border border-blue-100 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-900': !isCliente && !isBot,
          })}>
            {msg.conteudo}
          </div>
        )}
        <div className={clsx('flex items-center gap-1 mt-1', isCliente ? 'justify-start' : 'justify-end')}>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {format(new Date(msg.enviadaEm), 'HH:mm', { locale: ptBR })}
          </span>
          {!isCliente && !isNota && !isSistema && <StatusIcon status={msg.status} />}
        </div>
      </div>
    </div>
  );
}

function applyVars(texto, conversa, empresa = '') {
  return texto
    .replace(/\{\{nome\}\}|\{nome\}/gi, conversa.clienteNome || '')
    .replace(/\{\{empresa\}\}|\{empresa\}/gi, empresa)
    .replace(/\{\{contrato\}\}|\{contrato\}/gi, conversa.clienteContratoId || '')
    .replace(/\{\{filial\}\}|\{filial\}/gi, conversa.clienteFilial || conversa.filialNome || '');
}

function TagsBar({ conversa, onUpdate, catalog = [], podeEditar = false }) {
  const tags = Array.isArray(conversa.tags) ? conversa.tags : [];
  const [aberto, setAberto] = useState(false);

  const removerTag = async (tag) => {
    const novo = tags.filter(t => t !== tag);
    await api.patch(`/conversations/${conversa.id}/tags`, { tags: novo });
    onUpdate();
  };

  const adicionarTag = async (nome) => {
    if (tags.includes(nome)) { setAberto(false); return; }
    await api.patch(`/conversations/${conversa.id}/tags`, { tags: [...tags, nome] });
    setAberto(false);
    onUpdate();
  };

  const disponiveis = catalog.filter(t => !tags.includes(t.nome));

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map(t => {
        const catalogTag = catalog.find(c => c.nome === t);
        return (
          <span key={t}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
            style={catalogTag ? {
              backgroundColor: catalogTag.cor + '20',
              color: catalogTag.cor,
              borderColor: catalogTag.cor + '50',
            } : { backgroundColor: '#e0e7ff', color: '#4338ca', borderColor: '#c7d2fe' }}>
            {t}
            {podeEditar && (
              <button onClick={() => removerTag(t)} className="opacity-60 hover:opacity-100 transition-opacity">
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        );
      })}

      {podeEditar && disponiveis.length > 0 && (
        <div className="relative">
          <button onClick={() => setAberto(v => !v)}
            className="inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 px-1.5 py-0.5 rounded-full hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors">
            <Plus className="w-3 h-3" /> Tag
          </button>
          {aberto && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 min-w-44 py-1">
                {disponiveis.map(t => (
                  <button key={t.nome} onClick={() => adicionarTag(t.nome)}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-200">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                    {t.nome}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TransferModal({ conversa, onClose, onTransferred }) {
  const [agentes, setAgentes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const naFila = conversa.status !== 'humano';

  useEffect(() => {
    // Rota própria das conversas: a de equipe é restrita a admin.
    api.get('/conversations/agentes')
      .then(r => setAgentes(r.data.filter(a => a.id !== conversa.agenteId)))
      .catch(() => setErro('Não foi possível carregar a equipe.'));
  }, [conversa.agenteId]);

  const transferir = async (agenteId) => {
    setLoading(true);
    setErro('');
    try {
      await api.post(`/conversations/${conversa.id}/transfer`, { agenteId });
      onTransferred();
      onClose();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível transferir.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-80 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
            {naFila ? 'Atribuir conversa' : 'Transferir conversa'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {naFila
            ? 'O colega escolhido já fica como responsável, sem precisar assumir.'
            : 'A conversa passa para o colega escolhido.'}
        </p>
        {erro && <p className="text-xs text-red-500 mb-2">{erro}</p>}
        {agentes.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Nenhum agente disponível</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {agentes.map(a => (
              <button key={a.id} onClick={() => transferir(a.id)} disabled={loading}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 rounded-xl transition-colors text-left">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-sm shrink-0">
                  {(a.nome || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{a.nome}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    <span className="capitalize">{a.role}</span>
                    {a.filialNome ? ` · ${a.filialNome}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatWindow({ conversa, onAtualizar, onVoltar, painelAberto, onTogglePainel }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState('');
  const [pendentes, setPendentes] = useState([]);
  const [menuAberto, setMenuAberto] = useState(false);
  const filaEnvioRef = useRef(Promise.resolve());
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);
  const [audioPreview, setAudioPreview] = useState(null);
  const [acao, setAcao] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const tempoRef = useRef(null);
  const audioBlobRef = useRef(null);
  const [aba, setAba] = useState('resposta');
  const [atalhosList, setAtalhosList] = useState([]);
  const [buscaAtalho, setBuscaAtalho] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [tagsCatalog, setTagsCatalog] = useState([]);
  const [tenantNome, setTenantNome] = useState('');
  const bottomRef = useRef(null);
  const msgAreaRef = useRef(null);
  const conteudoRef = useRef(null);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const msgIdsRef = useRef(new Set());
  const inicialRef = useRef(false);
  const atBottomRef = useRef(true);
  // true até a primeira leva de mensagens da conversa aberta — evita rolar
  // suavemente (e visivelmente) por todo o histórico só pra abrir no fim.
  const scrollInstantaneoRef = useRef(true);
  const tocarNotificacao = useNotificationSound();

  const checkAtBottom = () => {
    const el = msgAreaRef.current;
    atBottomRef.current = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const carregarMsgs = () => {
    checkAtBottom();
    return api.get(`/conversations/${conversa.id}/messages`).then(r => {
      if (inicialRef.current) {
        const temNovaCliente = r.data.some(
          m => m.origem === 'cliente' && !msgIdsRef.current.has(m.id)
        );
        if (temNovaCliente) {
          tocarNotificacao();
          atBottomRef.current = true;
        }
      }
      msgIdsRef.current = new Set(r.data.map(m => m.id));
      inicialRef.current = true;
      setMsgs(r.data);
    });
  };

  useEffect(() => {
    setMsgs([]);
    inicialRef.current = false;
    msgIdsRef.current = new Set();
    atBottomRef.current = true;
    scrollInstantaneoRef.current = true;
    carregarMsgs();
    setAba('resposta');
  }, [conversa.id]);

  usePolling(carregarMsgs, 5000);

  const rolarSeNoFim = () => {
    if (!atBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: scrollInstantaneoRef.current ? 'auto' : 'smooth' });
    scrollInstantaneoRef.current = false;
  };

  useEffect(() => {
    // A troca de conversa esvazia msgs antes do fetch responder — esse
    // estado vazio também disparava este efeito e consumia a rolagem
    // instantânea nele, sobrando 'smooth' pra quando as mensagens de
    // verdade chegassem. Sem nada pra rolar, não há o que consumir.
    if (!msgs.length && !pendentes.length) return;
    rolarSeNoFim();
  }, [msgs, pendentes]);

  // Áudio, imagem e vídeo carregam depois do texto e mudam a altura da
  // conversa sem tocar em msgs/pendentes (o próprio MidiaBolao busca e
  // decodifica por conta própria) — sem isso, uma conversa com mídia no
  // fim ficava pra trás assim que ela terminava de carregar, mesmo o
  // efeito acima já tendo rolado pro que parecia ser o fim.
  useEffect(() => {
    const el = conteudoRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => rolarSeNoFim());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Antes atBottomRef só era recalculado a cada busca (até 5s de atraso) —
  // rolar pra cima pra ler o histórico e ficar parado ali não bastava pra
  // impedir um "puxão" de volta pro fim vindo de uma mídia carregando.
  useEffect(() => {
    const el = msgAreaRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkAtBottom, { passive: true });
    return () => el.removeEventListener('scroll', checkAtBottom);
  }, []);

  useEffect(() => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/atalhos`).then(r => setAtalhosList(r.data)).catch(() => {});
    api.get('/tenants/me').then(r => setTenantNome(r.data?.nomeFantasia || r.data?.nome || '')).catch(() => {});
    api.get('/tenants/me/horarios').then(r => setTagsCatalog(r.data?.tagsCatalog || [])).catch(() => {});
  }, [user?.tenantId]);

  // Encerrada também pode ser respondida — enviar mensagem reabre a conversa.
  const podeAtuar = true;
  const eHumano = conversa.status === 'humano';

  const handleAsumir = async () => {
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/assume`); onAtualizar(); carregarMsgs(); }
    catch (err) { alert(err.response?.data?.erro || 'Não foi possível assumir a conversa.'); }
    finally { setAcao(false); }
  };

  const handleLiberar = async () => {
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/release`); onAtualizar(); carregarMsgs(); }
    catch (err) { alert(err.response?.data?.erro || 'Não foi possível liberar a conversa.'); }
    finally { setAcao(false); }
  };

  const handleEncerrar = async () => {
    // Encerrar dispara a pesquisa de satisfação para o cliente. Reabrir a
    // conversa depois não desfaz a mensagem que já saiu — daí a confirmação.
    if (!confirm('Encerrar este atendimento? O cliente receberá a pesquisa de satisfação.')) return;
    setMenuAberto(false);
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/close`); onAtualizar(); carregarMsgs(); }
    catch (err) { alert(err.response?.data?.erro || 'Não foi possível encerrar a conversa.'); }
    finally { setAcao(false); }
  };

  // O envio atravessa a API do WhatsApp, o que leva um par de segundos. Antes o
  // campo só limpava no fim e nada aparecia até lá, então parecia travado. Agora
  // o balão entra na hora marcado como enviando; se falhar, ele some e o texto
  // volta para o campo em vez de se perder.
  const handleEnviar = e => {
    e.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo) return;

    const ehNota = aba === 'nota';
    const pendente = {
      id: `pendente-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      origem: ehNota ? 'nota' : 'agente',
      conteudo,
      enviadaEm: new Date().toISOString(),
      status: 'enviando',
      agenteNome: user?.nome,
    };

    setTexto('');
    setPendentes(p => [...p, pendente]);

    // Serializa os envios: com o campo limpando na hora dá tempo de digitar a
    // próxima antes de a anterior voltar, e duas requisições em paralelo podem
    // chegar fora de ordem no WhatsApp.
    filaEnvioRef.current = filaEnvioRef.current.then(async () => {
      try {
        const { data } = await api.post(
          `/conversations/${conversa.id}/${ehNota ? 'note' : 'send'}`,
          { texto: conteudo },
        );
        // A mensagem gravada volta na resposta — recarregar a conversa inteira
        // só para vê-la era uma segunda ida ao servidor por mensagem enviada.
        setMsgs(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]));
        // Enviar pode ter assumido a conversa — atualiza cabeçalho, fila e contadores.
        if (!eHumano) onAtualizar();
      } catch (err) {
        setTexto(t => t || conteudo);
        alert(err.response?.data?.erro || 'Erro ao enviar mensagem. Verifique o token do WhatsApp.');
      } finally {
        setPendentes(p => p.filter(m => m.id !== pendente.id));
      }
    });
  };

  // Preenche o campo com uma sugestão da IA. Não envia nada: o atendente lê,
  // edita e decide. Se já houver texto digitado, confirma antes de substituir.
  const handleSugerir = async () => {
    if (sugerindo) return;
    if (texto.trim() && !confirm('Substituir o que você já escreveu pela sugestão?')) return;
    setSugerindo(true);
    try {
      const { data } = await api.post(`/conversations/${conversa.id}/sugerir`);
      setTexto(data.sugestao);
      textareaRef.current?.focus();
    } catch (err) {
      alert(err.response?.data?.erro || 'Não foi possível gerar a sugestão.');
    } finally {
      setSugerindo(false);
    }
  };

  const handleEnviarArquivo = async e => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setEnviandoArquivo(true);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      await api.post(`/conversations/${conversa.id}/send-media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      carregarMsgs();
      if (!eHumano) onAtualizar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao enviar arquivo');
    } finally {
      setEnviandoArquivo(false);
      e.target.value = '';
    }
  };

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Em ordem de preferência: Ogg (Firefox) e mp4 (Safari) já servem ao
      // WhatsApp; WebM (Chrome) o backend converte. O tipo real precisa ser
      // preservado — rotular tudo como Ogg fazia o áudio chegar mudo.
      const mimeType = [
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
      ].find(f => MediaRecorder.isTypeSupported?.(f)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const tipoReal = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: tipoReal });
        audioBlobRef.current = blob;
        setAudioPreview(URL.createObjectURL(blob));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setGravando(true);
      setTempoGravacao(0);
      tempoRef.current = setInterval(() => setTempoGravacao(t => t + 1), 1000);
    } catch {
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const pararGravacao = () => {
    clearInterval(tempoRef.current);
    mediaRecorderRef.current?.stop();
    setGravando(false);
    setTempoGravacao(0);
  };

  const descartarAudio = () => {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setAudioPreview(null);
    audioBlobRef.current = null;
  };

  const confirmarAudio = async () => {
    if (!audioBlobRef.current) return;
    setEnviandoArquivo(true);
    try {
      const blob = audioBlobRef.current;
      const base = (blob.type || '').split(';')[0].trim();
      const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('arquivo', blob, `audio.${ext}`);
      await api.post(`/conversations/${conversa.id}/send-media`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      descartarAudio();
      carregarMsgs();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao enviar áudio');
    } finally {
      setEnviandoArquivo(false);
    }
  };

  const aplicarFormato = (prefixo, sufixo = prefixo) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = texto.slice(start, end);
    const novo = texto.slice(0, start) + prefixo + (sel || 'texto') + sufixo + texto.slice(end);
    setTexto(novo);
    setTimeout(() => {
      el.focus();
      const novoStart = start + prefixo.length;
      const novoEnd = novoStart + (sel || 'texto').length;
      el.setSelectionRange(novoStart, novoEnd);
    }, 0);
  };

  const aplicarLista = (tipo) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const linhas = texto.slice(start, end || start).split('\n');
    const prefixadas = linhas.map((l, i) =>
      l ? `${tipo === 'ol' ? `${i + 1}. ` : '• '}${l}` : l
    ).join('\n');
    const novo = texto.slice(0, start) + prefixadas + texto.slice(end || start);
    setTexto(novo);
    setTimeout(() => el.focus(), 0);
  };

  const selecionarAtalho = (atalho) => {
    setTexto(applyVars(atalho.conteudo, conversa, tenantNome));
    setAba('resposta');
    setBuscaAtalho('');
  };

  const atalhosFiltrados = atalhosList.filter(a =>
    a.titulo.toLowerCase().includes(buscaAtalho.toLowerCase()) ||
    (a.atalho || '').toLowerCase().includes(buscaAtalho.toLowerCase())
  );

  const tabClass = (t) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      aba === t
        ? 'border-blue-600 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
    }`;

  const isNota = aba === 'nota';

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 md:rounded-2xl md:border md:border-gray-200 dark:md:border-gray-800 md:shadow-sm overflow-hidden">
      {/* header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {onVoltar && (
              <button onClick={onVoltar}
                className="md:hidden shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{conversa.clienteNome || conversa.clienteWhatsapp}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{conversa.clienteWhatsapp}{conversa.clienteFilial ? ` · ${conversa.clienteFilial}` : ''}</p>
            </div>
          </div>
          {/* Uma ação primária por estado; as raras vão para o menu. Antes eram
              quatro botões de peso parecido disputando o mesmo canto. */}
          <div className="flex gap-2 items-center shrink-0">
            {podeAtuar && !eHumano && (
              <button onClick={handleAsumir} disabled={acao}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition-colors disabled:opacity-60">
                <UserCheck className="w-3.5 h-3.5" /> Assumir
              </button>
            )}
            {eHumano && (
              <button onClick={handleEncerrar} disabled={acao}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-700 hover:bg-red-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-red-800 dark:hover:text-red-400 dark:hover:bg-red-950 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
                <X className="w-3.5 h-3.5" /> Encerrar
              </button>
            )}

            {podeAtuar && (
              <div className="relative">
                <button onClick={() => setMenuAberto(v => !v)} title="Mais ações"
                  aria-label="Mais ações" aria-expanded={menuAberto}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuAberto && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuAberto(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1">
                      <button onClick={() => { setMenuAberto(false); setShowTransfer(true); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <ArrowRightLeft className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        {eHumano ? 'Transferir conversa' : 'Atribuir a alguém'}
                      </button>
                      {eHumano && (
                        <button onClick={() => { setMenuAberto(false); handleLiberar(); }} disabled={acao}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
                          <Bot className="w-4 h-4 text-gray-400 dark:text-gray-500" /> Liberar para o bot
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {onTogglePainel && (
              <button onClick={onTogglePainel}
                title={painelAberto ? 'Ocultar dados do cliente' : 'Mostrar dados do cliente'}
                aria-label={painelAberto ? 'Ocultar dados do cliente' : 'Mostrar dados do cliente'}
                className={`hidden md:block p-1.5 rounded-lg transition-colors ${
                  painelAberto
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
                }`}>
                <PanelRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tags */}
        {((Array.isArray(conversa.tags) && conversa.tags.length > 0) || (eHumano && tagsCatalog.length > 0)) && (
          <div className="flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" />
            <TagsBar
              conversa={conversa}
              onUpdate={onAtualizar}
              catalog={tagsCatalog}
              podeEditar={eHumano}
            />
          </div>
        )}
      </div>

      {/* Status banner */}
      {conversa.status === 'aguardando' || conversa.status === 'aguardando_filial' ? (
        <div className="bg-amber-500 text-white text-xs font-semibold text-center py-1.5 px-4 shrink-0">
          Aguardando atendimento
        </div>
      ) : conversa.status === 'humano' ? (
        <div className="bg-emerald-500 text-white text-xs font-semibold text-center py-1.5 px-4 shrink-0">
          Em atendimento{conversa.agenteNome ? ` · ${conversa.agenteNome}` : ''}
        </div>
      ) : conversa.status === 'bot' ? (
        <div className="bg-blue-500 text-white text-xs font-semibold text-center py-1.5 px-4 shrink-0">
          Bot está respondendo
        </div>
      ) : conversa.status === 'encerrada' ? (
        <div className="bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-xs font-semibold text-center py-1.5 px-4 shrink-0">
          Atendimento encerrado
        </div>
      ) : null}

      {/* mensagens */}
      <div ref={msgAreaRef} className="flex-1 overflow-y-auto p-4">
        <div ref={conteudoRef}>
          {groupMsgsByDate(pendentes.length ? [...msgs, ...pendentes] : msgs).map(item =>
            item.type === 'separator'
              ? <DateSeparator key={item.key} date={item.date} />
              : <BolaoMsg key={item.key} msg={item.msg} agenteNome={item.msg.agenteNome || user?.nome} nomeAssistente={user?.nomeAssistente} />
          )}
          {(() => {
            const ultima = msgs[msgs.length - 1];
            const aguardando = ultima?.origem === 'cliente'
              && conversa.status !== 'encerrada'
              && (Date.now() - new Date(ultima.enviadaEm).getTime()) < 30000;
            return aguardando ? <TypingIndicator /> : null;
          })()}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* área de input com tabs */}
      <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        {/* Tabs */}
        {podeAtuar && (
          <div className="flex border-b border-gray-100 dark:border-gray-800 px-3">
            <button className={tabClass('resposta')} onClick={() => setAba('resposta')}>Resposta</button>
            <button className={tabClass('nota')} onClick={() => setAba('nota')}>
              <span className="flex items-center gap-1"><StickyNote className="w-3 h-3" /> Nota</span>
            </button>
            <button className={tabClass('lembrete')} onClick={() => setAba('lembrete')}>
              <span className="flex items-center gap-1"><BellRing className="w-3 h-3" /> Lembrete</span>
            </button>
            <button className={tabClass('atalhos')} onClick={() => setAba('atalhos')}>Atalhos</button>
          </div>
        )}

        {/* painel Atalhos */}
        {podeAtuar && aba === 'atalhos' && (
          <div className="max-h-56 flex flex-col">
            <div className="px-3 pt-2 pb-1">
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Pesquisar atalhos..."
                  value={buscaAtalho}
                  onChange={e => setBuscaAtalho(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {atalhosFiltrados.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                  {atalhosList.length === 0 ? 'Nenhum atalho configurado' : 'Nenhum resultado'}
                </p>
              ) : (
                atalhosFiltrados.map(a => (
                  <button key={a.id} onClick={() => selecionarAtalho(a)}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <div className="flex items-center gap-2">
                      {a.atalho && (
                        <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 dark:text-blue-300 dark:bg-blue-950 px-1.5 py-0.5 rounded shrink-0">
                          {a.atalho}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{a.titulo}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{a.conteudo}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* input Resposta / Lembrete */}
        {aba === 'lembrete' && (
          <FormLembrete
            conversa={conversa}
            onCriado={() => {
              setAba('resposta');
              // A barra lateral recalcula o contador sem esperar o ciclo.
              window.dispatchEvent(new CustomEvent('ispdesk:lembretes-updated'));
            }}
          />
        )}

        {(aba === 'resposta' || aba === 'nota') && (
          <form onSubmit={handleEnviar}>
            <input ref={fileRef} type="file" className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleEnviarArquivo}
              disabled={!podeAtuar}
            />

            {/* Preview áudio gravado */}
            {!isNota && audioPreview ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 flex items-center gap-2 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-xl px-3 py-1.5">
                  <Mic className="w-4 h-4 text-blue-500 shrink-0" />
                  <audio src={audioPreview} controls className="h-8 flex-1 min-w-0" style={{ colorScheme: 'light' }} />
                </div>
                <button type="button" onClick={descartarAudio} title="Descartar"
                  className="text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 p-1.5 transition-colors shrink-0">
                  <X className="w-5 h-5" />
                </button>
                <button type="button" onClick={confirmarAudio} disabled={enviandoArquivo}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl px-4 py-2 transition-colors shrink-0">
                  {enviandoArquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            ) : !isNota && gravando ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 flex items-center gap-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl px-4 py-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-sm text-red-600 font-medium">
                    Gravando {String(Math.floor(tempoGravacao / 60)).padStart(2, '0')}:{String(tempoGravacao % 60).padStart(2, '0')}
                  </span>
                </div>
                <button type="button" onClick={pararGravacao}
                  className="bg-red-500 hover:bg-red-600 text-white rounded-xl px-4 py-2 transition-colors shrink-0">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                {/* Textarea */}
                <div className={clsx('mx-3 mt-2.5 mb-1 rounded-xl border focus-within:ring-2 transition-all', isNota
                  ? 'bg-yellow-50 border-yellow-200 focus-within:ring-yellow-300 dark:bg-yellow-950 dark:border-yellow-900'
                  : 'bg-white border-gray-200 focus-within:ring-blue-300 focus-within:border-blue-300 dark:bg-gray-800 dark:border-gray-700'
                )}>
                  <textarea
                    ref={textareaRef}
                    rows={3}
                    value={texto}
                    onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(e); }
                    }}
                    disabled={!podeAtuar && !isNota}
                    placeholder={
                      isNota
                        ? 'Lembrete interno (só a equipe vê)...'
                        : eHumano
                          ? 'Digite uma mensagem e pressione enter para enviar...'
                          : conversa.status === 'encerrada'
                            ? 'Digite para reabrir e responder...'
                            : 'Digite para assumir e responder...'
                    }
                    className={clsx(
                      'w-full px-3 pt-2.5 pb-1 text-[15px] leading-relaxed bg-transparent resize-none focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 rounded-t-xl',
                      isNota ? 'text-yellow-900 dark:text-yellow-100' : 'text-gray-800 dark:text-gray-100'
                    )}
                  />

                  {/* Barra de formatação + ações */}
                  <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    {/* Botões de formatação (só na aba Resposta) */}
                    {!isNota ? (
                      <div className="flex items-center gap-0.5">
                        {[
                          { icon: Bold,          title: 'Negrito (*)',       action: () => aplicarFormato('*') },
                          { icon: Italic,        title: 'Itálico (_)',       action: () => aplicarFormato('_') },
                          { icon: Strikethrough, title: 'Tachado (~)',       action: () => aplicarFormato('~') },
                          { icon: Code,          title: 'Código (`)',        action: () => aplicarFormato('`') },
                          { icon: ListOrdered,   title: 'Lista numerada',    action: () => aplicarLista('ol') },
                          { icon: List,          title: 'Lista com marcador',action: () => aplicarLista('ul') },
                        ].map(({ icon: Icon, title, action }) => (
                          <button key={title} type="button" onClick={action}
                            disabled={!podeAtuar}
                            title={title}
                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors">
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        ))}
                        {texto.length > 0 && (
                          <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono">{texto.length}</span>
                        )}
                      </div>
                    ) : (
                      <div />
                    )}

                    {/* Ações direita */}
                    <div className="flex items-center gap-1">
                      {!isNota && (
                        <>
                          <button type="button"
                            onClick={handleSugerir}
                            disabled={!podeAtuar || sugerindo}
                            title="Gerar resposta com IA"
                            className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-30 text-blue-600 dark:text-blue-400 transition-colors">
                            {sugerindo
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Sparkles className="w-4 h-4" />}
                            <span className="text-xs font-medium hidden sm:inline">
                              {sugerindo ? 'Gerando...' : 'Gerar resposta'}
                            </span>
                          </button>
                          <button type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={!podeAtuar || enviandoArquivo || gravando}
                            title="Enviar arquivo"
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors">
                            {enviandoArquivo
                              ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                              : <Paperclip className="w-4 h-4" />}
                          </button>
                          {!texto.trim() && podeAtuar && (
                            <button type="button" onClick={iniciarGravacao}
                              disabled={enviandoArquivo}
                              title="Gravar áudio"
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 transition-colors">
                              <Mic className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      <button type="submit"
                        disabled={(!podeAtuar && !isNota) || !texto.trim()}
                        className={clsx(
                          'ml-1 rounded-lg px-3 py-1.5 disabled:opacity-40 text-white transition-colors shrink-0',
                          isNota ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'
                        )}>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 px-4 pb-2">
                  {isNota ? 'Shift+Enter para nova linha' : 'Enter para enviar · Shift+Enter para nova linha'}
                </p>
              </>
            )}
          </form>
        )}
      </div>

      {showTransfer && (
        <TransferModal
          conversa={conversa}
          onClose={() => setShowTransfer(false)}
          onTransferred={() => { onAtualizar(); carregarMsgs(); }}
        />
      )}
    </div>
  );
}
