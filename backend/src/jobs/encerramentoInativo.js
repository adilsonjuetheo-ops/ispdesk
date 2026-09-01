import { db } from '../db/index.js';
import { conversas, mensagens, tenants, clientes } from '../db/schema.js';
import { and, ne, or, eq, inArray, sql } from 'drizzle-orm';
import { enviarNps } from '../services/nps.js';

const INATIVIDADE_MS = 4 * 60 * 60 * 1000; // 4 horas

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
    .select({ id: conversas.id, tenantId: conversas.tenantId, clienteId: conversas.clienteId })
    .from(conversas)
    .innerJoin(tenants, eq(conversas.tenantId, tenants.id))
    .where(
      and(
        ne(conversas.status, 'encerrada'),
        // Atendimento humano só entra na varredura se o provedor não tiver
        // pedido pra ficar aberto até um atendente resolver e fechar na mão.
        or(ne(conversas.status, 'humano'), eq(tenants.encerrarHumanoPorInatividade, true)),
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
      conteudo: '[Sistema] Conversa encerrada automaticamente por inatividade (4 horas).',
    });
  }

  // A conversa terminou do mesmo jeito, ninguém só esqueceu de clicar em
  // Encerrar — o cliente merece a mesma chance de avaliar que teria se um
  // atendente tivesse fechado na mão. enviarNps já tem dedup de 30 dias.
  for (const c of parEncerrar) {
    try {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, c.tenantId)).limit(1);
      const [cliente] = await db.select().from(clientes).where(eq(clientes.id, c.clienteId)).limit(1);
      if (tenant && cliente) {
        await enviarNps(tenant, { id: c.id }, cliente.id, cliente.whatsapp);
      }
    } catch (err) {
      console.error('[EncerramentoInativo] Falha ao disparar NPS:', err.message);
    }
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
