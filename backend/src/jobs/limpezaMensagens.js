import { db } from '../db/index.js';
import { mensagens, conversas } from '../db/schema.js';
import { and, lt, isNotNull, inArray } from 'drizzle-orm';

const DIAS_RETENCAO = 90;
const LOTE = 200;

export async function executarLimpeza() {
  const corte = new Date();
  corte.setDate(corte.getDate() - DIAS_RETENCAO);

  const antigas = await db
    .select({ id: conversas.id })
    .from(conversas)
    .where(and(isNotNull(conversas.encerradaEm), lt(conversas.encerradaEm, corte)));

  if (!antigas.length) {
    console.log('[Limpeza] Nenhuma conversa encerrada há mais de 90 dias');
    return { conversas: 0 };
  }

  const ids = antigas.map(c => c.id);
  for (let i = 0; i < ids.length; i += LOTE) {
    await db.delete(mensagens).where(inArray(mensagens.conversaId, ids.slice(i, i + LOTE)));
  }

  console.log(`[Limpeza] Mensagens purgadas de ${ids.length} conversa(s) com +${DIAS_RETENCAO} dias`);
  return { conversas: ids.length };
}

export function agendarLimpeza() {
  const INTERVALO = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    executarLimpeza().catch(e => console.error('[Limpeza] Erro:', e.message));
    setInterval(() => {
      executarLimpeza().catch(e => console.error('[Limpeza] Erro:', e.message));
    }, INTERVALO);
  }, 2 * 60 * 1000); // 2 min após startup
  console.log('[Limpeza] Job agendado (executa 2min após startup, depois a cada 24h)');
}
