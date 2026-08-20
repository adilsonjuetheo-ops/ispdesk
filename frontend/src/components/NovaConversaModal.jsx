import { useState, useEffect } from 'react';
import { X, Loader2, Send, AlertTriangle, Search } from 'lucide-react';
import api from '../lib/api.js';

// O WhatsApp só aceita texto livre até 24h depois da última mensagem do cliente.
// Fora disso é template aprovado — a tela descobre em qual caso está pelo 409
// que a rota devolve, para o atendente não precisar conhecer a regra.
export default function NovaConversaModal({ onClose, onCriada, telefoneInicial = '' }) {
  const [telefone, setTelefone] = useState(telefoneInicial);
  const [buscaContato, setBuscaContato] = useState('');
  const [achados, setAchados] = useState([]);
  const [texto, setTexto] = useState('');
  const [remetentes, setRemetentes] = useState([]);
  const [remetenteSel, setRemetenteSel] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateSel, setTemplateSel] = useState(null);
  const [params, setParams] = useState([]);
  const [precisaTemplate, setPrecisaTemplate] = useState(false);
  const [dadosCliente, setDadosCliente] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get('/conversations/remetentes').then(r => setRemetentes(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const termo = buscaContato.trim();
    if (termo.length < 2) { setAchados([]); return; }
    const t = setTimeout(() => {
      api.get('/contatos', { params: { busca: termo } })
        .then(r => setAchados((r.data || []).slice(0, 6)))
        .catch(() => setAchados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscaContato]);

  const carregarTemplates = async (dados) => {
    try {
      const { data } = await api.get('/conversations/templates');
      const lista = data || [];
      setTemplates(lista);
      // Com um só, não há escolha a fazer: deixar o atendente clicar num card
      // que parece informativo só trava o envio.
      if (lista.length === 1) escolherTemplate(lista[0], dados);
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível carregar os templates.');
    }
  };

  // A amostra que a Meta guardou diz o que cada posição espera: exemplo só de
  // dígitos indica contrato, o resto indica nome. Assim o preenchimento vem do
  // próprio template, não de um palpite sobre a ordem das variáveis.
  const preencher = (t, dados) => Array.from({ length: t.variaveis }, (_, i) => {
    if (!dados) return '';
    const exemplo = String(t.exemplos?.[i] || '');
    if (/^\d+$/.test(exemplo)) return dados.contratoId || '';
    return dados.nome || '';
  });

  const escolherTemplate = (t, dados = dadosCliente) => {
    setTemplateSel(t);
    setParams(preencher(t, dados));
  };

  const enviar = async e => {
    e.preventDefault();
    if (enviando) return;
    setErro('');
    setEnviando(true);
    try {
      const escolhido = remetentes.find(r => r.id === remetenteSel);
      const corpo = {
        telefone,
        filialId: escolhido?.filialId || null,
        numeroId: escolhido?.numeroId || null,
      };
      if (precisaTemplate) {
        if (!templateSel) { setErro('Escolha um template'); setEnviando(false); return; }
        corpo.template = templateSel.name;
        corpo.idioma = templateSel.language;
        corpo.parametros = params;
      } else {
        corpo.texto = texto;
      }
      const { data } = await api.post('/conversations/iniciar', corpo);
      onCriada(data.conversaId);
      onClose();
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.precisaTemplate) {
        // Primeiro contato ou janela vencida: troca o formulário para templates
        setPrecisaTemplate(true);
        setErro('');
        setDadosCliente(resp.cliente || null);
        await carregarTemplates(resp.cliente || null);
      } else {
        setErro(resp?.erro || 'Não foi possível iniciar a conversa.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3 className="font-semibold text-gray-800">Nova conversa</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={enviar} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Buscar contato salvo</label>
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={buscaContato}
                onChange={e => setBuscaContato(e.target.value)}
                placeholder="Nome, telefone ou contrato..."
                className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-0"
              />
            </div>
            {achados.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                {achados.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setTelefone(c.whatsapp);
                      setBuscaContato('');
                      setAchados([]);
                      setPrecisaTemplate(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-brand-50 transition-colors"
                  >
                    <p className="text-sm text-gray-800">{c.nome || 'Sem nome'}</p>
                    <p className="text-xs text-gray-400 tabular-nums">{c.whatsapp}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Telefone do cliente</label>
            <input
              value={telefone}
              onChange={e => { setTelefone(e.target.value); setPrecisaTemplate(false); setTemplateSel(null); }}
              placeholder="(33) 99999-9999"
              inputMode="tel"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <p className="text-xs text-gray-400 mt-1">Com DDD. O 55 do Brasil é adicionado sozinho.</p>
          </div>

          {remetentes.length > 1 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Enviar pelo número</label>
              <select
                value={remetenteSel}
                onChange={e => setRemetenteSel(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                {remetentes.map(r => (
                  <option key={r.id} value={r.id}>{r.rotulo}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">É o número que aparece para o cliente.</p>
            </div>
          )}

          {!precisaTemplate ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mensagem</label>
              <textarea
                value={texto}
                onChange={e => setTexto(e.target.value)}
                rows={4}
                placeholder="Escreva a mensagem..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Esse cliente não escreve há mais de 24 horas. O WhatsApp só permite iniciar
                  com um template aprovado. Assim que ele responder, a conversa segue normal.
                </p>
              </div>

              {templates.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Nenhum template aprovado neste provedor. É preciso criar um no Gerenciador
                  do WhatsApp e aguardar a aprovação da Meta.
                </p>
              ) : (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {templates.length > 1 ? 'Escolha o template' : 'Template'}
                  </label>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {templates.map(t => {
                      const ativo = templateSel?.name === t.name;
                      return (
                        <button
                          key={`${t.name}-${t.language}`}
                          type="button"
                          onClick={() => escolherTemplate(t)}
                          className={`w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg border transition-colors ${
                            ativo ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                            ativo ? 'border-brand-500' : 'border-gray-300'
                          }`}>
                            {ativo && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-800">{t.name}</span>
                            {t.texto && <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{t.texto}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {templateSel?.variaveis > 0 && (
                <div className="space-y-2">
                  {params.map((v, i) => (
                    <div key={i}>
                      <label className="block text-xs text-gray-500 mb-1">
                        {`Variável {{${i + 1}}}`}
                        {templateSel.exemplos?.[i] && (
                          <span className="text-gray-400"> — ex: {templateSel.exemplos[i]}</span>
                        )}
                      </label>
                      <input
                        value={v}
                        onChange={e => setParams(p => p.map((x, j) => (j === i ? e.target.value : x)))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {erro && <p className="text-sm text-red-500">{erro}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={enviando || !telefone.trim()}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-brand-contraste rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
