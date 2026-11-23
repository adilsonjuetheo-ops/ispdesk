import { db } from '../db/index.js';
import { metaCobranca } from '../db/schema.js';
import { sql } from 'drizzle-orm';

// Primeiro exemplar de cada combinação nova de pricing que a Meta manda.
//
// São ~54 mil status por mês: logar todos é lixo, logar nenhum deixa a gente
// adivinhando os valores. Isto mostra o conjunto de valores que realmente
// ocorre nos nossos números, uma linha por combinação, e depois sai.
const combinacoesVistas = new Set();

function logarSeNovo(pricing, status) {
  const chave = [pricing?.category, pricing?.type, pricing?.subtype, pricing?.billable, status].join('|');
  if (combinacoesVistas.has(chave)) return;
  combinacoesVistas.add(chave);
  console.log(`[custoMeta] pricing novo no status '${status}': ${JSON.stringify(pricing)}`);
}

// Grava o que a Meta cobrou por uma mensagem, a partir do webhook de status.
//
// Upsert por wamid de propósito: o `pricing` pode chegar em mais de um status
// da mesma mensagem, e sobrescrever a linha mantém a contagem certa. Um
// contador incremental somaria a mesma mensagem duas vezes.
export async function registrarCobrancaMeta(phoneNumberId, s) {
  if (!phoneNumberId || !s?.id) return;

  const pricing = s.pricing;
  const entregue = s.status === 'delivered';

  // Status que não traz pricing nem entrega (o 'read', por exemplo) não tem o
  // que acrescentar — e gravar linha vazia aqui apagaria o pricing que já veio.
  if (!pricing && !entregue) return;

  if (pricing) logarSeNovo(pricing, s.status);

  const valores = {
    wamid: s.id,
    phoneNumberId,
    entregue,
    // Timestamp da Meta, não o nosso: a cota vira o mês no fuso da conta dela.
    statusEm: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
  };
  if (pricing) {
    valores.categoria = pricing.category ?? null;
    valores.tipo = pricing.type ?? null;
    valores.subtipo = pricing.subtype ?? null;
    valores.cobravel = typeof pricing.billable === 'boolean' ? pricing.billable : null;
  }

  // Só sobrescreve o que este status realmente informa. Sem esse cuidado, o
  // 'delivered' (que pode vir sem pricing) zeraria a categoria vinda no 'sent'.
  const atualizar = { atualizadoEm: new Date() };
  if (pricing) {
    atualizar.categoria = valores.categoria;
    atualizar.tipo = valores.tipo;
    atualizar.subtipo = valores.subtipo;
    atualizar.cobravel = valores.cobravel;
  }
  if (entregue) atualizar.entregue = true;

  await db.insert(metaCobranca).values(valores)
    .onConflictDoUpdate({ target: metaCobranca.wamid, set: atualizar });
}

// Agregado cru, por número e mês, do que a Meta cobrou. Sem interpretação: é a
// matéria-prima para conferir quais valores chegam antes de virar tela.
export async function resumoCustoMeta(mes) {
  const { rows } = await db.execute(sql`
    SELECT phone_number_id,
           to_char(status_em, 'YYYY-MM') AS mes,
           categoria, tipo, subtipo, cobravel,
           count(*)::int AS total
    FROM meta_cobranca
    WHERE to_char(status_em, 'YYYY-MM') = ${mes}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 1, 7 DESC
  `);
  return rows;
}
