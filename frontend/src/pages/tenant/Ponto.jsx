import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Loader2, MapPin, Download, Pencil, AlertTriangle } from 'lucide-react';

const ROTULO = {
  entrada:          'Entrada',
  intervalo_inicio: 'Saída p/ intervalo',
  intervalo_fim:    'Volta do intervalo',
  saida:            'Saída',
};

function hora(valor) {
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function duracao(min) {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function diaLegivel(iso) {
  const [a, m, d] = iso.split('-');
  const data = new Date(Number(a), Number(m) - 1, Number(d));
  return data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// Primeiro e último dia do mês corrente, que é o recorte que o dono quer ver
// quando abre a tela.
function periodoPadrao() {
  const hoje = new Date();
  const p = n => String(n).padStart(2, '0');
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const ultimo = new Date(ano, mes, 0).getDate();
  return { de: `${ano}-${p(mes)}-01`, ate: `${ano}-${p(mes)}-${p(ultimo)}` };
}

export default function Ponto() {
  const { user } = useAuth();
  const [tecnicos, setTecnicos] = useState([]);
  const [usuarioId, setUsuarioId] = useState('');
  const [periodo, setPeriodo] = useState(periodoPadrao);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [corrigindo, setCorrigindo] = useState(null);

  useEffect(() => {
    if (!user?.tenantId) return;
    api.get(`/tenants/${user.tenantId}/agents`)
      .then(r => {
        const campo = (r.data || []).filter(u => u.role === 'tecnico' && u.ativo);
        setTecnicos(campo);
        if (campo.length && !usuarioId) setUsuarioId(campo[0].id);
      })
      .catch(() => {});
  }, [user?.tenantId]);

  const carregar = () => {
    if (!usuarioId) return;
    setCarregando(true);
    setErro('');
    api.get('/campo/ponto/espelho', { params: { usuarioId, ...periodo } })
      .then(r => setDados(r.data))
      .catch(err => setErro(err.response?.data?.erro || 'Não foi possível carregar o espelho.'))
      .finally(() => setCarregando(false));
  };

  useEffect(() => { carregar(); }, [usuarioId, periodo.de, periodo.ate]);

  const baixarCsv = () => {
    if (!dados?.dias?.length) return;
    const linhas = [['Dia', 'Tipo', 'Hora', 'Origem', 'Latitude', 'Longitude', 'Motivo']];
    for (const d of dados.dias) {
      for (const r of d.registros) {
        linhas.push([
          d.dia, ROTULO[r.tipo] || r.tipo, hora(r.registradoEm),
          r.lancadoPeloEscritorio ? 'escritório' : 'técnico',
          r.latitude || '', r.longitude || '', (r.motivo || '').replace(/;/g, ','),
        ]);
      }
    }
    const csv = linhas.map(l => l.join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ponto-${dados.tecnico?.nome || 'tecnico'}-${periodo.de}_${periodo.ate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">Ponto dos técnicos</h1>
      <p className="text-xs text-gray-500 mb-5">
        Registro interno de jornada. Não substitui ponto eletrônico legal (REP-P).
      </p>

      {tecnicos.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Nenhum técnico de campo cadastrado. Crie os usuários em Equipe, com o papel "Técnico de campo",
            para que eles possam registrar o ponto pelo celular.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Técnico</label>
              <select value={usuarioId} onChange={e => setUsuarioId(e.target.value)}
                className="border border-gray-200 dark:border-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm">
                {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">De</label>
              <input type="date" value={periodo.de} onChange={e => setPeriodo(p => ({ ...p, de: e.target.value }))}
                className="border border-gray-200 dark:border-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Até</label>
              <input type="date" value={periodo.ate} onChange={e => setPeriodo(p => ({ ...p, ate: e.target.value }))}
                className="border border-gray-200 dark:border-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={baixarCsv} disabled={!dados?.dias?.length}
              className="min-h-[38px] px-3.5 rounded-lg border border-gray-200 dark:border-gray-800 text-sm text-gray-700 dark:text-gray-200 flex items-center gap-1.5 disabled:opacity-40">
              <Download className="w-4 h-4" /> CSV
            </button>
          </div>

          {erro && <p className="text-sm text-red-600 mb-4">{erro}</p>}
          {carregando && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}

          {dados && !carregando && (
            <>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-4 py-3 mb-4">
                <span className="text-sm text-gray-600 dark:text-gray-300">Total no período: </span>
                <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{duracao(dados.totalMinutos)}</span>
              </div>

              {dados.dias.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum registro neste período.</p>
              )}

              <div className="space-y-2">
                {dados.dias.map(d => (
                  <div key={d.dia} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{diaLegivel(d.dia)}</span>
                      <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{duracao(d.resumo.minutos)}</span>
                    </div>

                    {(d.resumo.emAndamento || d.resumo.intervaloAberto) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {d.resumo.emAndamento ? 'Jornada sem registro de saída' : 'Intervalo sem registro de volta'}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {d.registros.map(r => (
                        <button key={r.id} onClick={() => setCorrigindo({ ...r, dia: d.dia })}
                          className="group text-xs rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1 text-gray-600 dark:text-gray-300 hover:border-blue-400">
                          <span className="font-medium">{hora(r.registradoEm)}</span>{' '}
                          {ROTULO[r.tipo] || r.tipo}
                          {r.latitude && r.longitude && (
                            <MapPin className="w-3 h-3 inline ml-1 -mt-0.5 text-emerald-600" />
                          )}
                          {r.lancadoPeloEscritorio && <span className="text-amber-600"> ·esc</span>}
                          <Pencil className="w-3 h-3 inline ml-1 -mt-0.5 opacity-0 group-hover:opacity-60" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {corrigindo && (
        <Correcao registro={corrigindo} usuarioId={usuarioId}
          onFechar={() => setCorrigindo(null)}
          onSalvo={() => { setCorrigindo(null); carregar(); }} />
      )}
    </div>
  );
}

// Correção não edita: cria uma linha nova apontando para a original. O texto
// da janela diz isso, porque quem corrige precisa saber que a batida antiga
// continua registrada.
function Correcao({ registro, usuarioId, onFechar, onSalvo }) {
  const d = new Date(registro.registradoEm);
  const p = n => String(n).padStart(2, '0');
  const [horario, setHorario] = useState(`${p(d.getHours())}:${p(d.getMinutes())}`);
  const [motivo, setMotivo] = useState('');
  const [anular, setAnular] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const salvar = async e => {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const [hh, mm] = horario.split(':').map(Number);
      const quando = new Date(d);
      quando.setHours(hh, mm, 0, 0);
      await api.post('/campo/ponto/ajuste', {
        pontoId: registro.id,
        usuarioId,
        tipo: registro.tipo,
        registradoEm: quando.toISOString(),
        motivo,
        anular,
      });
      onSalvo();
    } catch (err) {
      setErro(err.response?.data?.erro || 'Não foi possível salvar a correção.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onFechar}>
      <form onSubmit={salvar} onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl p-5 w-full max-w-sm">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Corrigir registro</h2>
        <p className="text-xs text-gray-500 mb-4">
          {ROTULO[registro.tipo]} de {hora(registro.registradoEm)}. A batida original continua guardada;
          esta correção entra como lançamento novo, com seu nome.
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-3">
          <input type="checkbox" checked={anular} onChange={e => setAnular(e.target.checked)} />
          Desconsiderar esta batida (duplicada)
        </label>

        {!anular && (
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Horário correto</label>
            <input type="time" value={horario} onChange={e => setHorario(e.target.value)} required
              className="w-full border border-gray-200 dark:border-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Motivo</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} required maxLength={300}
            placeholder="ex: esqueceu de bater na saída"
            className="w-full border border-gray-200 dark:border-gray-800 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm" />
        </div>

        {erro && <p className="text-xs text-red-600 mb-3">{erro}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onFechar}
            className="flex-1 min-h-[40px] rounded-lg border border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-300">
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !motivo.trim()}
            className="flex-1 min-h-[40px] rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar correção'}
          </button>
        </div>
      </form>
    </div>
  );
}
