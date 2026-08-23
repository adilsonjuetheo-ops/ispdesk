import { db } from '../db/index.js';
import { lembretes } from '../db/schema.js';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import { enviarPushParaTenant, enviarPushParaUsuario } from '../services/pushNotification.js';

const INTERVALO_MS = 10 * 60 * 1000;

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

  if (!vencidos.length) return { avisados: 0 };

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
  return { avisados: vencidos.length };
}

export function agendarLembretesVencendo() {
  const tick = () => avisarLembretesVencidos()
    .catch(err => console.error('[lembretes] Erro:', err.message));

  // Espera a subida assentar antes da primeira varredura.
  setTimeout(() => {
    tick();
    setInterval(tick, INTERVALO_MS);
  }, 2 * 60 * 1000);
}
