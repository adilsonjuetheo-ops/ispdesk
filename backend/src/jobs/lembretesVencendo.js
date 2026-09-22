import { db } from '../db/index.js';
import { lembretes } from '../db/schema.js';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import { enviarPushParaTenant, enviarPushParaUsuario } from '../services/pushNotification.js';

const INTERVALO_MS = 10 * 60 * 1000;

// Sem nenhum lembrete pendente, a varredura consultava o banco de 10 em 10
// minutos para sempre — e no Neon o que se paga é o banco estar acordado, não
// o custo da consulta. Guardamos em memória quando vence o próximo lembrete
// pendente e só acordamos o banco a partir daí. Mesmo raciocínio do
// encerramentoInativo.
//
// Começa em 0 (desconhecido) para a primeira varredura após o boot descobrir
// o horizonte real. Uma varredura de segurança de 6 em 6 horas cobre um
// lembrete que tenha entrado por fora do POST — perder o aviso seria pior do
// que quatro consultas por dia.
const VARREDURA_SEGURANCA_MS = 6 * 60 * 60 * 1000;
let proximoVence = 0;
let ultimaVarredura = 0;

// Chamado ao criar lembrete: adianta o horizonte se este vence antes.
export function registrarLembrete(venceEm) {
  if (!venceEm) return;
  const t = new Date(venceEm).getTime();
  if (Number.isNaN(t)) return;
  if (!proximoVence || t < proximoVence) proximoVence = t;
}

export async function avisarLembretesVencidos() {
  // O corte sai do `now()` do banco, não de um `new Date()` daqui. Comparar
  // Date do Node com timestamp do Postgres já causou erro de um dia inteiro
  // neste projeto quando o servidor não estava em UTC.
  const vencidos = await db.select({
    id: lembretes.id,
    tenantId: lembretes.tenantId,
    texto: lembretes.texto,
    responsavelId: lembretes.responsavelId,
  })
    .from(lembretes)
    .where(and(
      isNull(lembretes.concluidoEm),
      isNull(lembretes.avisadoEm),
      isNotNull(lembretes.venceEm),
      sql`${lembretes.venceEm} <= now()`,
    ))
    .limit(50);

  if (!vencidos.length) {
    await atualizarHorizonte();
    return { avisados: 0 };
  }

  for (const l of vencidos) {
    const payload = {
      title: 'Lembrete no prazo',
      body: l.texto.slice(0, 120),
      tag: `lembrete-${l.id}`,
    };
    try {
      // Sem responsável, o lembrete é da equipe — todo mundo recebe.
      if (l.responsavelId) await enviarPushParaUsuario(l.responsavelId, l.tenantId, payload);
      else await enviarPushParaTenant(l.tenantId, payload);
    } catch (err) {
      console.error(`[lembretes] Falha no push do lembrete ${l.id}:`, err.message);
    }
    // Marca mesmo se o push falhar: sem isso o lembrete vencido seria
    // reprocessado a cada 10 minutos, para sempre.
    await db.update(lembretes)
      .set({ avisadoEm: new Date() })
      .where(eq(lembretes.id, l.id));
  }

  console.log(`[lembretes] ${vencidos.length} lembrete(s) avisado(s)`);
  await atualizarHorizonte();
  return { avisados: vencidos.length };
}

// Quando vence o próximo lembrete ainda não avisado. Sem nenhum, o horizonte
// vira Infinity e a varredura só volta pelo registrarLembrete ou pela
// varredura de segurança.
async function atualizarHorizonte() {
  const [prox] = await db.select({ venceEm: sql`min(${lembretes.venceEm})` })
    .from(lembretes)
    .where(and(
      isNull(lembretes.concluidoEm),
      isNull(lembretes.avisadoEm),
      isNotNull(lembretes.venceEm),
    ));

  const t = prox?.venceEm ? new Date(prox.venceEm).getTime() : NaN;
  proximoVence = Number.isNaN(t) ? Infinity : t;
}

export function agendarLembretesVencendo() {
  const tick = () => {
    const agora = Date.now();
    // Nada vencido no horizonte conhecido e a varredura de segurança ainda não
    // venceu: não acorda o banco.
    if (agora < proximoVence && agora - ultimaVarredura < VARREDURA_SEGURANCA_MS) return;

    ultimaVarredura = agora;
    avisarLembretesVencidos()
      .catch(err => console.error('[lembretes] Erro:', err.message));
  };

  // Espera a subida assentar antes da primeira varredura.
  setTimeout(() => {
    tick();
    setInterval(tick, INTERVALO_MS);
  }, 2 * 60 * 1000);
}
