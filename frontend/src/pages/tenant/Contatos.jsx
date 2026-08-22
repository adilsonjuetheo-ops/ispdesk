import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Loader2, Search, Pencil, MessageSquare, Trash2 } from 'lucide-react';
import api from '../../lib/api.js';

function formatarTelefone(numero) {
  const d = String(numero || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero;
}

export default function Contatos() {
  const navigate = useNavigate();
  const [contatos, setContatos] = useState([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nome: '', telefone: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async (termo) => {
    const { data } = await api.get('/contatos', { params: termo ? { busca: termo } : {} });
    setContatos(data);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(''); }, [carregar]);

  // Busca no servidor, com folga para não disparar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => carregar(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca, carregar]);

  const abrirNovo = () => {
    setEditando(null);
    setForm({ nome: '', telefone: '' });
    setErro(''); setAviso(''); setModal(true);
  };

  const abrirEditar = c => {
    setEditando(c);
    setForm({ nome: c.nome || '', telefone: c.whatsapp });
    setErro(''); setAviso(''); setModal(true);
  };

  const salvar = async e => {
    e.preventDefault();
    setSalvando(true); setErro(''); setAviso('');
    try {
      if (editando) {
        await api.patch(`/contatos/${editando.id}`, { nome: form.nome });
        setModal(false);
      } else {
        const { data } = await api.post('/contatos', form);
        if (data.jaExistia) setAviso('Esse número já estava cadastrado — o nome foi atualizado.');
        else setModal(false);
      }
      carregar(busca.trim());
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível salvar.');
    } finally { setSalvando(false); }
  };

  const excluir = async c => {
    if (!confirm(`Excluir ${c.nome || formatarTelefone(c.whatsapp)}?`)) return;
    try {
      await api.delete(`/contatos/${c.id}`);
      carregar(busca.trim());
    } catch (err) {
      alert(err.response?.data?.erro || 'Não foi possível excluir.');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Contatos</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {contatos.length}{contatos.length === 200 ? '+' : ''} cadastrados. Quem escreve entra aqui sozinho.
            </p>
          </div>
          <button onClick={abrirNovo}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Novo contato
          </button>
        </div>

        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 mb-4">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone ou contrato..."
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-0"
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <p className="p-8 text-gray-500 text-sm">Carregando...</p>
          ) : contatos.length === 0 ? (
            <p className="p-8 text-gray-500 text-sm text-center">
              {busca ? 'Nenhum contato encontrado.' : 'Nenhum contato ainda.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-200">
                    <th className="text-left px-5 py-3">Contato</th>
                    <th className="text-left px-5 py-3">Contrato</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {contatos.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-gray-800">{c.nome || 'Sem nome'}</p>
                        <p className="text-xs text-gray-500 tabular-nums">{formatarTelefone(c.whatsapp)}</p>
                      </td>
                      <td className="px-5 py-3">
                        {c.contratoId ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 tabular-nums">{c.contratoId}</span>
                            {c.statusContrato && (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                c.statusContrato === 'ativo'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>{c.statusContrato}</span>
                            )}
                          </div>
                        ) : <span className="text-xs text-gray-300">—</span>}
                        {c.filialNome && <p className="text-xs text-gray-500 mt-0.5">{c.filialNome}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => navigate(`/inbox?novo=${c.whatsapp}`)}
                            title="Iniciar conversa"
                            className="text-gray-500 hover:text-blue-600">
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <button onClick={() => abrirEditar(c)} title="Editar nome"
                            className="text-gray-500 hover:text-blue-600">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => excluir(c)} title="Excluir"
                            className="text-gray-500 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {modal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm border border-gray-200 shadow-xl">
              <div className="flex items-center justify-between p-5 border-b border-gray-200">
                <h2 className="font-semibold text-gray-800">{editando ? 'Editar contato' : 'Novo contato'}</h2>
                <button onClick={() => setModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={salvar} className="p-5 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nome</label>
                  <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome do cliente"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Telefone</label>
                  <input value={form.telefone} disabled={!!editando} inputMode="tel"
                    onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                    placeholder="(33) 99999-9999"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  {!editando && (
                    <p className="text-xs text-gray-500 mt-1">
                      Com DDD. Se o número já for cliente, buscamos nome e contrato no sistema.
                    </p>
                  )}
                </div>
                {aviso && <p className="text-amber-600 text-sm">{aviso}</p>}
                {erro && <p className="text-red-500 text-sm">{erro}</p>}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                    Fechar
                  </button>
                  <button type="submit" disabled={salvando || (!editando && !form.telefone.trim())}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
                    {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
