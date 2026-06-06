import { db } from '../db/index.js';
import { conversas, mensagens } from '../db/schema.js';
import { and, ne, inArray, sql } from 'drizzle-orm';

const INATIVIDADE_MS = 60 * 60 * 1000; // 1 hora

export async function encerramentoInativo() {
  const corte = new Date(Date.now() - INATIVIDADE_MS);

  const parEncerrar = await db
    .select({ id: conversas.id })
    .from(conversas)
    .where(
      and(
        ne(conversas.status, 'encerrada'),
        sql`COALESCE(
          (SELECT MAX(m.enviada_em) FROM mensagens m WHERE m.conversa_id = conversas.id),
          conversas.iniciada_em
        ) < ${corte}`
      )
    );

  if (!parEncerrar.length) return { encerradas: 0 };

  const ids = parEncerrar.map(c => c.id);

  await db.update(conversas)
    .set({ status: 'encerrada', encerradaEm: new Date() })
    .where(inArray(conversas.id, ids));

  for (const c of parEncerrar) {
    await db.insert(mensagens).values({
      conversaId: c.id,
      origem: 'bot',
      conteudo: '[Sistema] Conversa encerrada automaticamente por inatividade (1 hora).',
    });
  }

  console.log(`[EncerramentoInativo] ${ids.length} conversa(s) encerrada(s)`);
  return { encerradas: ids.length };
}

export function agendarEncerramentoInativo() {
  const INTERVALO = 5 * 60 * 1000; // verifica a cada 5 minutos
  setTimeout(() => {
    encerramentoInativo().catch(e => console.error('[EncerramentoInativo] Erro:', e.message));
    setInterval(() => {
      encerramentoInativo().catch(e => console.error('[EncerramentoInativo] Erro:', e.message));
    }, INTERVALO);
  }, 3 * 60 * 1000); // aguarda 3 min após o start
}
