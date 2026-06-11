import { db } from '../db/index.js';
import { conversas, mensagens } from '../db/schema.js';
import { and, ne, inArray, sql } from 'drizzle-orm';

const INATIVIDADE_MS = 60 * 60 * 1000; // 1 hora

// Controle de atividade em memória: evita varrer o banco quando não há nada
// que possa expirar, permitindo o autosuspend do Neon em períodos ociosos.
// Inicia como "ativo" no boot porque podem existir conversas abertas de antes
// do restart que precisam ser varridas pelo menos uma vez.
let ultimaAtividade = Date.now();
let ultimaVarredura = 0;

export function registrarAtividade() {
  ultimaAtividade = Date.now();
}

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
  const INTERVALO = 30 * 60 * 1000; // verifica a cada 30 minutos

  const tick = () => {
    // Se a última varredura aconteceu depois de tudo que poderia expirar,
    // não há conversa para encerrar — pula sem acordar o banco.
    if (ultimaVarredura > ultimaAtividade + INATIVIDADE_MS) return;

    const inicio = Date.now();
    encerramentoInativo()
      .then(() => { ultimaVarredura = inicio; })
      .catch(e => console.error('[EncerramentoInativo] Erro:', e.message));
  };

  setTimeout(() => {
    tick();
    setInterval(tick, INTERVALO);
  }, 3 * 60 * 1000); // aguarda 3 min após o start
}
