import { useState } from 'react';
import { Phone, Fingerprint, ChevronDown, User, X, Plus, MapPin } from 'lucide-react';
import api from '../lib/api.js';

const WaIcon = () => (
  <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

function Avatar({ nome }) {
  const partes = (nome || '').trim().split(' ').filter(Boolean);
  const isNumero = !nome || /^\d+$/.test(nome.trim());
  if (isNumero || partes.length === 0) {
    return (
      <div className="w-14 h-14 rounded-full bg-amber-400 flex items-center justify-center shrink-0">
        <User className="w-7 h-7 text-white" />
      </div>
    );
  }
  const ini = partes.length >= 2
    ? (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
    : partes[0][0].toUpperCase();
  return (
    <div className="w-14 h-14 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-lg shrink-0">
      {ini}
    </div>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

export default function ClientInfoPanel({ conversa, onAtualizar }) {
  const [tagInput, setTagInput] = useState('');
  const [encerrando, setEncerrando] = useState(false);

  if (!conversa) return null;

  const tags = Array.isArray(conversa.tags) ? conversa.tags : [];
  const isEncerrada = conversa.status === 'encerrada';
  const nomeExibido = conversa.clienteNome && !/^\d+$/.test(conversa.clienteNome)
    ? conversa.clienteNome
    : null;

  async function encerrar() {
    if (!confirm('Encerrar este atendimento?')) return;
    setEncerrando(true);
    try {
      await api.post(`/conversations/${conversa.id}/close`);
      onAtualizar?.();
    } catch (err) {
      alert('Erro ao encerrar: ' + err.message);
    } finally {
      setEncerrando(false);
    }
  }

  async function adicionarTag(e) {
    e.preventDefault();
    const tag = tagInput.trim();
    if (!tag || tags.includes(tag)) { setTagInput(''); return; }
    try {
      await api.patch(`/conversations/${conversa.id}/tags`, { tags: [...tags, tag] });
      setTagInput('');
      onAtualizar?.();
    } catch {}
  }

  async function removerTag(tag) {
    try {
      await api.patch(`/conversations/${conversa.id}/tags`, { tags: tags.filter(t => t !== tag) });
      onAtualizar?.();
    } catch {}
  }

  return (
    <div className="w-64 shrink-0 bg-white border-l border-gray-200 overflow-y-auto flex flex-col">

      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <Avatar nome={conversa.clienteNome} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 text-sm leading-tight truncate">
              {nomeExibido || conversa.clienteWhatsapp}
            </p>
            {nomeExibido && (
              <p className="text-xs text-gray-400 truncate mt-0.5">{conversa.clienteWhatsapp}</p>
            )}
          </div>
        </div>

        {!isEncerrada && (
          <button
            onClick={encerrar}
            disabled={encerrando}
            className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-900 active:bg-black text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            <User className="w-4 h-4" />
            {encerrando ? 'Encerrando...' : 'Encerrar atendimento'}
          </button>
        )}

        {isEncerrada && (
          <span className="w-full flex items-center justify-center text-xs text-gray-400 py-1.5 bg-gray-50 rounded-lg">
            Atendimento encerrado
          </span>
        )}
      </div>

      {/* Identificar cliente */}
      <div className="px-4 py-3 border-b border-gray-100">
        <button className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-400 text-sm py-2 rounded-lg cursor-default">
          <User className="w-4 h-4" />
          Identificar Cliente
        </button>
      </div>

      {/* Operador Responsável */}
      <Section title="Operador Responsável">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <User className="w-3 h-3 text-blue-600" />
            </div>
            <span className="text-sm text-gray-700 truncate">
              {conversa.agenteNome || 'Não atribuído'}
            </span>
          </div>
        </div>
      </Section>

      {/* Caixa de entrada */}
      <Section title="Caixa de Entrada">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">
            {conversa.filialNome || conversa.clienteFilial || 'Geral'}
          </span>
        </div>
      </Section>

      {/* Informações Principais */}
      <Section title="Informações Principais">
        <div className="space-y-2.5">
          {conversa.clienteContratoId && (
            <div className="flex items-center gap-2.5">
              <Fingerprint className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-600 font-mono truncate">{conversa.clienteContratoId}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <WaIcon />
            <span className="text-sm text-gray-600 truncate">
              {conversa.clienteWhatsapp}
            </span>
          </div>
          {conversa.clienteFilial && (
            <div className="flex items-center gap-2.5">
              <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-600 truncate">{conversa.clienteFilial}</span>
            </div>
          )}
          {conversa.clienteStatus && (
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                conversa.clienteStatus === 'ativo' ? 'bg-emerald-500'
                : conversa.clienteStatus === 'bloqueado' ? 'bg-red-500'
                : 'bg-gray-400'
              }`} />
              <span className="text-sm text-gray-600 capitalize">{conversa.clienteStatus}</span>
            </div>
          )}
          {conversa.resumoIa && (
            <div className="mt-1 text-[11px] text-gray-500 leading-relaxed bg-emerald-50 rounded-lg p-2">
              {conversa.resumoIa}
            </div>
          )}
        </div>
      </Section>

      {/* Tags */}
      <Section title="Tags do Atendimento">
        <div className="space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {tag}
                  {!isEncerrada && (
                    <button onClick={() => removerTag(tag)} className="hover:text-blue-900 leading-none">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {!isEncerrada && (
            <form onSubmit={adicionarTag} className="flex items-center gap-1.5 text-gray-400">
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                placeholder="Adicionar Tag..."
                className="text-sm text-gray-600 placeholder-gray-400 bg-transparent outline-none w-full"
              />
            </form>
          )}
        </div>
      </Section>
    </div>
  );
}
