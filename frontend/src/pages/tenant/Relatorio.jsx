import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import api from '../../lib/api.js';
import { Download, Loader2, TrendingUp, Users, MessageSquare, UserCheck, Bot, CalendarDays, Tag, Receipt } from 'lucide-react';

const MESES_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

function mesAtual() {
  return new Date().toISOString().slice(0, 7);
}

function nomeMes(yyyy_mm) {
  const [ano, m] = yyyy_mm.split('-').map(Number);
  return `${MESES_PT[m - 1]} ${ano}`;
}

function formatarDia(diaStr) {
  if (!diaStr) return '—';
  const d = new Date(diaStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

function opcoesMeses() {
  const lista = [];
  const agora = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const val = d.toISOString().slice(0, 7);
    lista.push({ val, label: nomeMes(val) });
  }
  return lista;
}

export default function Relatorio() {
  const { user } = useAuth();
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    api.get('/tenants/me').then(r => setTenant(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/relatorio?mes=${mes}`)
      .then(r => setDados(r.data))
      .finally(() => setLoading(false));
  }, [mes]);

  const baixarCSV = () => {
    if (!dados) return;
    const nome = tenant?.nomeFantasia || tenant?.nome || 'ISPDesk';
    const linhas = [
      [`Relatório ISPDesk — ${nome}`, nomeMes(mes)],
      [],
      ['Métrica', 'Valor'],
      ['Total de Atendimentos', dados.total],
      ['Com Atendimento Humano', dados.comHumano],
      ['Resolvido pelo Bot', dados.botResolvido],
      ['Novos Contatos', dados.novosContatos],
      ['Mensagens Recebidas', dados.totalMensagens],
      ['Principal Motivo de Contato', dados.motivoPrincipal || '—'],
      ['Dia Mais Movimentado',
        dados.diaMaisMovimentado
          ? `${formatarDia(dados.diaMaisMovimentado.dia)} (${dados.diaMaisMovimentado.total} atendimentos)`
          : '—'],
    ];
    const csv = linhas.map(r => r.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-ispdesk-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nome = tenant?.nomeFantasia || tenant?.nome || 'sua empresa';

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-2xl mx-auto">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Resumo mensal
            </p>
            <h1 className="text-2xl font-bold text-gray-800">
              Olá, {nome}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Atividade de atendimento no mês de {dados ? nomeMes(mes).toLowerCase() : '…'}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <select
              value={mes}
              onChange={e => setMes(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {opcoesMeses().map(o => (
                <option key={o.val} value={o.val}>{o.label}</option>
              ))}
            </select>

            <button
              onClick={baixarCSV}
              disabled={!dados || loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar relatório [CSV]
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
          </div>
        ) : dados ? (
          <div className="space-y-4">

            {/* Total destaque */}
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-3">
                Atendimentos realizados
              </p>
              <p className="text-7xl font-black text-gray-900 leading-none mb-2">{dados.total.toLocaleString('pt-BR')}</p>
              <p className="text-sm text-gray-500">no mês de {nomeMes(mes).toLowerCase()}</p>
            </div>

            {/* 3 colunas */}
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                icon={UserCheck}
                label="Com humano"
                value={dados.comHumano.toLocaleString('pt-BR')}
                sub="atendimentos"
                color="blue"
              />
              <StatCard
                icon={Users}
                label="Novos contatos"
                value={dados.novosContatos.toLocaleString('pt-BR')}
                sub="criados"
                color="emerald"
              />
              <StatCard
                icon={MessageSquare}
                label="Mensagens"
                value={dados.totalMensagens.toLocaleString('pt-BR')}
                sub="recebidas"
                color="violet"
              />
            </div>

            {/* 2 colunas secundárias */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                icon={Bot}
                label="Resolvido pelo bot"
                value={dados.botResolvido.toLocaleString('pt-BR')}
                sub={`${dados.total > 0 ? Math.round((dados.botResolvido / dados.total) * 100) : 0}% do total`}
                color="amber"
              />
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="flex items-center gap-1.5 mb-3">
                  <Tag className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Principal motivo</p>
                </div>
                <p className="text-xl font-bold text-gray-800 leading-tight">
                  {dados.motivoPrincipal
                    ? `"${dados.motivoPrincipal}"`
                    : <span className="text-gray-500 text-sm font-normal">Nenhum handoff registrado</span>
                  }
                </p>
                <p className="text-xs text-gray-500 mt-1">O assunto mais frequente nos atendimentos</p>
              </div>
            </div>

            {/* O que a Meta cobrou. Separado dos outros numeros de proposito: os
                de cima sao a nossa contagem, este e o da Meta. */}
            {dados.cobranca && <BlocoCobranca cobranca={dados.cobranca} />}

            {/* Dia destaque */}
            {dados.diaMaisMovimentado && (
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-7 text-white text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-200 mb-3 flex items-center justify-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5" /> Dia com mais atendimentos
                </p>
                <p className="text-4xl font-black mb-1">{formatarDia(dados.diaMaisMovimentado.dia)}</p>
                <p className="text-lg font-semibold text-blue-100">
                  com {dados.diaMaisMovimentado.total} atendimentos
                </p>
                <p className="text-xs text-blue-200 mt-2">Esse foi o dia mais movimentado do mês para sua equipe</p>
              </div>
            )}

          </div>
        ) : (
          <div className="text-center text-gray-500 py-20">Erro ao carregar relatório</div>
        )}
      </div>
    </div>
  );
}

// A cota de 1.000 mensagens de servico e por numero e nao acumula de um mes
// para o outro. Mostrar por numero, e nao somado, porque somar cinco numeros e
// comparar com 1.000 nao quer dizer nada.
const COTA_POR_NUMERO = 1000;

function BlocoCobranca({ cobranca }) {
  const { total, cobradas, naCota, semDado, numeros } = cobranca;
  // Mes sem captura (ela comecou em 23/11/2026) mostraria "0 cobradas", o que e
  // falso. Dizer que nao temos o dado e melhor que afirmar zero.
  const semCaptura = total === 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center gap-1.5 mb-1">
        <Receipt className="w-3.5 h-3.5 text-gray-400" />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Cobrado pela Meta</p>
      </div>

      {semCaptura ? (
        <p className="text-sm text-gray-500 mt-2">
          Sem dado da Meta neste mês. A contagem começou em 23/11/2026 e não alcança o que veio antes.
        </p>
      ) : (
        <>
          <p className="text-3xl font-black text-gray-900 leading-none mt-2">
            {cobradas.toLocaleString('pt-BR')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            mensagens cobradas de {total.toLocaleString('pt-BR')} enviadas
            {naCota > 0 && ` — ${naCota.toLocaleString('pt-BR')} entraram na cota grátis`}
          </p>

          <div className="mt-4 space-y-2.5">
            {numeros.filter(n => n.total > 0).map(n => {
              const usoCota = Math.min(n.naCota, COTA_POR_NUMERO);
              const pct = Math.round((usoCota / COTA_POR_NUMERO) * 100);
              return (
                <div key={n.rotulo}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold text-gray-700 truncate">{n.rotulo}</span>
                    <span className="text-gray-500 shrink-0">
                      {n.cobradas > 0
                        ? `${n.cobradas.toLocaleString('pt-BR')} cobradas`
                        : `cota: ${usoCota.toLocaleString('pt-BR')}/${COTA_POR_NUMERO.toLocaleString('pt-BR')}`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${n.cobradas > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${n.cobradas > 0 ? 100 : pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {semDado > 0 && (
            <p className="text-xs text-gray-400 mt-3">
              {semDado.toLocaleString('pt-BR')} ainda sem resposta de cobrança da Meta.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }) {
  const colors = {
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   val: 'text-blue-700'   },
    emerald:{ bg: 'bg-emerald-50',text: 'text-emerald-600',val: 'text-emerald-700' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600', val: 'text-violet-700'  },
    amber:  { bg: 'bg-amber-50',  text: 'text-amber-600',  val: 'text-amber-700'   },
  };
  const c = colors[color] || colors.blue;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className={`w-8 h-8 ${c.bg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon className={`w-4 h-4 ${c.text}`} />
      </div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-3xl font-black ${c.val} leading-none`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}
