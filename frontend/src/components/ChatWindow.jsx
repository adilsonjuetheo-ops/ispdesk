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
  List, ListOrdered, Plus, ArrowLeft, Video, Sparkles,
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
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-[11px] text-gray-400 bg-gray-100 px-3 py-1 rounded-full whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function MidiaBolao({ msg, isCliente }) {
  const { conteudo, midiaUrl, conversaId } = msg;
  const { src: midiaSrc, erro: midiaErro } = useMidiaBlob(conversaId, midiaUrl);
  const [falhaPlayer, setFalhaPlayer] = useState(null);

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
    ? 'bg-white border border-gray-200 text-gray-700'
    : 'bg-brand-50 border border-brand-100 text-brand-800';

  if (isImagem && midiaUrl) {
    return (
      <div className="rounded-2xl overflow-hidden max-w-[280px]">
        <img
          src={midiaSrc || undefined}
          alt="Imagem"
          className="w-full object-cover rounded-2xl"
          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
        />
        <div style={{ display: 'none' }} className={`items-start gap-2 rounded-2xl px-3 py-2.5 text-sm ${cor}`}>
          <ImageIcon className="w-5 h-5 shrink-0 opacity-60 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs opacity-60 mb-0.5 font-medium">Imagem</p>
            <p className="text-xs leading-relaxed">{nome}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isVideo && midiaUrl) {
    return (
      <div className="rounded-2xl overflow-hidden max-w-[280px]">
        {midiaErro ? (
          <p className="text-xs text-red-500 p-3">Não foi possível carregar o vídeo.</p>
        ) : !midiaSrc ? (
          <p className="text-xs text-gray-400 p-3 flex items-center gap-1.5">
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
      <div className={`rounded-2xl px-3 py-2.5 text-sm max-w-[280px] ${cor}`}>
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
            <audio
              src={midiaSrc}
              controls
              onError={aoFalhar}
              className="w-full h-8"
              style={{ colorScheme: 'light' }}
            />
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
    <div className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm max-w-[280px] ${cor}`}>
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
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'lida')     return <CheckCheck className="w-3.5 h-3.5 text-brand-600 shrink-0" />;
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
        <span className="bg-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full">
          {msg.conteudo.replace('[Sistema] ', '')}
        </span>
      </div>
    );
  }

  if (isNota) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-atencao-50 border border-atencao-200 rounded-xl px-4 py-2 max-w-[80%]">
          <div className="flex items-center gap-1.5 mb-1">
            <StickyNote className="w-3 h-3 text-atencao-600" />
            <span className="text-[10px] font-semibold text-atencao-700 uppercase tracking-wide">Nota interna</span>
          </div>
          <p className="text-xs text-atencao-900 whitespace-pre-wrap">{msg.conteudo}</p>
          <p className="text-[10px] text-atencao-700 mt-1">
            {format(new Date(msg.enviadaEm), 'HH:mm', { locale: ptBR })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex mb-3', isCliente ? 'justify-start' : 'justify-end')}>
      <div className="max-w-[70%]">
        {!isCliente && (
          <p className="text-xs mb-1 text-right">
            {isBot
              ? <span className="text-gray-400">{nomeAssistente || 'Bot'}</span>
              : <span className="font-bold text-gray-700">{agenteNome || 'Agente'}</span>
            }
          </p>
        )}
        {isMidia ? (
          <MidiaBolao msg={{ ...msg, conversaId: msg.conversaId }} isCliente={isCliente} />
        ) : (
          <div className={clsx('rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap', {
            'bg-white border border-gray-200 text-gray-800 rounded-tl-sm': isCliente,
            'bg-gray-100 text-gray-700 rounded-tr-sm border border-gray-200': isBot,
            'bg-brand-50 text-brand-900 rounded-tr-sm border border-brand-100': !isCliente && !isBot,
          })}>
            {msg.conteudo}
          </div>
        )}
        <div className={clsx('flex items-center gap-1 mt-1', isCliente ? 'justify-start' : 'justify-end')}>
          <span className="text-xs text-gray-400">
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
            className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-brand-600 px-1.5 py-0.5 rounded-full hover:bg-brand-50 transition-colors">
            <Plus className="w-3 h-3" /> Tag
          </button>
          {aberto && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-44 py-1">
                {disponiveis.map(t => (
                  <button key={t.nome} onClick={() => adicionarTag(t.nome)}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-sm text-gray-700">
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
      <div className="bg-white rounded-2xl shadow-xl w-80 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-800">
            {naFila ? 'Atribuir conversa' : 'Transferir conversa'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          {naFila
            ? 'O colega escolhido já fica como responsável, sem precisar assumir.'
            : 'A conversa passa para o colega escolhido.'}
        </p>
        {erro && <p className="text-xs text-red-500 mb-2">{erro}</p>}
        {agentes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhum agente disponível</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {agentes.map(a => (
              <button key={a.id} onClick={() => transferir(a.id)} disabled={loading}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50 disabled:opacity-50 rounded-xl transition-colors text-left">
                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                  {(a.nome || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.nome}</p>
                  <p className="text-xs text-gray-400 truncate">
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

export default function ChatWindow({ conversa, onAtualizar, onVoltar }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
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
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const msgIdsRef = useRef(new Set());
  const inicialRef = useRef(false);
  const atBottomRef = useRef(true);
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
    carregarMsgs();
    setAba('resposta');
  }, [conversa.id]);

  usePolling(carregarMsgs, 5000);

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs]);

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
    setAcao(true);
    try { await api.post(`/conversations/${conversa.id}/close`); onAtualizar(); carregarMsgs(); }
    catch (err) { alert(err.response?.data?.erro || 'Não foi possível encerrar a conversa.'); }
    finally { setAcao(false); }
  };

  const handleEnviar = async e => {
    e.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      if (aba === 'nota') {
        await api.post(`/conversations/${conversa.id}/note`, { texto });
      } else {
        await api.post(`/conversations/${conversa.id}/send`, { texto });
      }
      setTexto('');
      carregarMsgs();
      // Enviar pode ter assumido a conversa — atualiza cabeçalho, fila e contadores.
      if (!eHumano) onAtualizar();
    } catch (err) {
      alert(err.response?.data?.erro || 'Erro ao enviar mensagem. Verifique o token do WhatsApp.');
    } finally { setEnviando(false); }
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
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

  const isNota = aba === 'nota';

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {onVoltar && (
              <button onClick={onVoltar}
                className="md:hidden shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-gray-800 truncate">{conversa.clienteNome || conversa.clienteWhatsapp}</p>
              <p className="text-xs text-gray-400 truncate">{conversa.clienteWhatsapp}{conversa.clienteFilial ? ` · ${conversa.clienteFilial}` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {podeAtuar && (
              <button onClick={() => setShowTransfer(true)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <ArrowRightLeft className="w-3.5 h-3.5" /> {eHumano ? 'Transferir' : 'Atribuir'}
              </button>
            )}
            {podeAtuar && !eHumano && (
              <button onClick={handleAsumir} disabled={acao}
                className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-brand-contraste text-xs font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition-colors disabled:opacity-60">
                <UserCheck className="w-3.5 h-3.5" /> Assumir
              </button>
            )}
            {eHumano && (
              <>
                <button onClick={handleLiberar} disabled={acao}
                  className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
                  <Bot className="w-3.5 h-3.5" /> Liberar para bot
                </button>
                <button onClick={handleEncerrar} disabled={acao}
                  className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:border-critico-300 hover:text-critico-700 hover:bg-critico-50 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
                  <X className="w-3.5 h-3.5" /> Encerrar
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tags */}
        {((Array.isArray(conversa.tags) && conversa.tags.length > 0) || (eHumano && tagsCatalog.length > 0)) && (
          <div className="flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-gray-300 shrink-0" />
            <TagsBar
              conversa={conversa}
              onUpdate={onAtualizar}
              catalog={tagsCatalog}
              podeEditar={eHumano}
            />
          </div>
        )}
      </div>

      {/* Faixa de status — discreta de propósito. Antes era um bloco sólido
          atravessando a largura toda, o elemento mais forte da tela para o dado
          menos acionável dela. Agora informa sem competir com a conversa. */}
      {(() => {
        const espera = ['bg-atencao-50 text-atencao-800 border-atencao-200', 'bg-atencao-500', 'Aguardando atendimento'];
        const faixa = {
          aguardando: espera,
          aguardando_filial: espera,
          humano: ['bg-ok-50 text-ok-800 border-ok-200', 'bg-ok-500',
            `Em atendimento${conversa.agenteNome ? ` · ${conversa.agenteNome}` : ''}`],
          bot: ['bg-gray-50 text-gray-600 border-gray-200', 'bg-gray-400',
            `${user?.nomeAssistente || 'Bot'} está respondendo`],
          encerrada: ['bg-gray-50 text-gray-500 border-gray-200', 'bg-gray-300', 'Atendimento encerrado'],
        }[conversa.status];
        if (!faixa) return null;
        const [tom, ponto, texto] = faixa;
        return (
          <div className={`flex items-center justify-center gap-2 border-b text-xs font-medium py-1.5 px-4 shrink-0 ${tom}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ponto}`} />
            {texto}
          </div>
        );
      })()}

      {/* mensagens */}
      <div ref={msgAreaRef} className="flex-1 overflow-y-auto p-4">
        {groupMsgsByDate(msgs).map(item =>
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
        <div ref={bottomRef} />
      </div>

      {/* área de input com tabs */}
      <div className="bg-white border-t border-gray-200">
        {/* Tabs */}
        {podeAtuar && (
          <div className="flex border-b border-gray-100 px-3">
            <button className={tabClass('resposta')} onClick={() => setAba('resposta')}>Resposta</button>
            <button className={tabClass('nota')} onClick={() => setAba('nota')}>
              <span className="flex items-center gap-1"><StickyNote className="w-3 h-3" /> Lembrete</span>
            </button>
            <button className={tabClass('atalhos')} onClick={() => setAba('atalhos')}>Atalhos</button>
          </div>
        )}

        {/* painel Atalhos */}
        {podeAtuar && aba === 'atalhos' && (
          <div className="max-h-56 flex flex-col">
            <div className="px-3 pt-2 pb-1">
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Pesquisar atalhos..."
                  value={buscaAtalho}
                  onChange={e => setBuscaAtalho(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {atalhosFiltrados.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  {atalhosList.length === 0 ? 'Nenhum atalho configurado' : 'Nenhum resultado'}
                </p>
              ) : (
                atalhosFiltrados.map(a => (
                  <button key={a.id} onClick={() => selecionarAtalho(a)}
                    className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      {a.atalho && (
                        <span className="text-xs font-mono font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded shrink-0">
                          {a.atalho}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-700 truncate">{a.titulo}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{a.conteudo}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* input Resposta / Lembrete */}
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
                <div className="flex-1 flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-xl px-3 py-1.5">
                  <Mic className="w-4 h-4 text-brand-600 shrink-0" />
                  <audio src={audioPreview} controls className="h-8 flex-1 min-w-0" style={{ colorScheme: 'light' }} />
                </div>
                <button type="button" onClick={descartarAudio} title="Descartar"
                  className="text-gray-400 hover:text-critico-600 p-1.5 transition-colors shrink-0">
                  <X className="w-5 h-5" />
                </button>
                <button type="button" onClick={confirmarAudio} disabled={enviandoArquivo}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-brand-contraste rounded-xl px-4 py-2 transition-colors shrink-0">
                  {enviandoArquivo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            ) : !isNota && gravando ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 flex items-center gap-2 bg-critico-50 border border-critico-200 rounded-xl px-4 py-2">
                  <span className="w-2 h-2 rounded-full bg-critico-500 animate-pulse shrink-0" />
                  <span className="text-sm text-critico-700 font-medium">
                    Gravando {String(Math.floor(tempoGravacao / 60)).padStart(2, '0')}:{String(tempoGravacao % 60).padStart(2, '0')}
                  </span>
                </div>
                <button type="button" onClick={pararGravacao}
                  className="bg-critico-600 hover:bg-critico-700 text-white rounded-xl px-4 py-2 transition-colors shrink-0">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                {/* Textarea */}
                <div className={clsx('mx-3 mt-2.5 mb-1 rounded-xl border focus-within:ring-2 transition-all', isNota
                  ? 'bg-atencao-50 border-atencao-200 focus-within:ring-atencao-300'
                  : 'bg-white border-gray-200 focus-within:ring-brand-300 focus-within:border-brand-300'
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
                      'w-full px-3 pt-2.5 pb-1 text-sm bg-transparent resize-none focus:outline-none placeholder-gray-400 rounded-t-xl',
                      isNota ? 'text-atencao-900' : 'text-gray-800'
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
                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-500 hover:text-gray-800 transition-colors">
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        ))}
                        {texto.length > 0 && (
                          <span className="ml-2 text-[10px] text-gray-400 font-mono">{texto.length}</span>
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
                            className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-brand-50 disabled:opacity-30 text-brand-700 transition-colors">
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
                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-400 hover:text-brand-600 transition-colors">
                            {enviandoArquivo
                              ? <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
                              : <Paperclip className="w-4 h-4" />}
                          </button>
                          {!texto.trim() && podeAtuar && (
                            <button type="button" onClick={iniciarGravacao}
                              disabled={enviandoArquivo}
                              title="Gravar áudio"
                              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 text-gray-400 hover:text-critico-600 transition-colors">
                              <Mic className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      <button type="submit"
                        disabled={(!podeAtuar && !isNota) || !texto.trim() || enviando}
                        className={clsx(
                          'ml-1 rounded-lg px-3 py-1.5 disabled:opacity-40 text-white transition-colors shrink-0',
                          isNota ? 'bg-atencao-500 hover:bg-atencao-600' : 'bg-brand-600 hover:bg-brand-700'
                        )}>
                        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 px-4 pb-2">
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
