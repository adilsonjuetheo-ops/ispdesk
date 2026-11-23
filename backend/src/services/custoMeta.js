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

// Quantas mensagens a Meta cobrou de um provedor no período.
//
// Por número, não só somado: a cota de 1.000 mensagens de serviço é por número,
// então um provedor com cinco números tem cinco cotas. Somar primeiro e comparar
// com 1.000 depois daria um número sem significado.
//
// O rótulo de cada número vem de onde ele está cadastrado — matriz, filial ou
// número extra de filial — para o painel não mostrar só o id da Meta.
export async function cobrancaDoTenant(tenantId, inicio, fim) {
  const { rows } = await db.execute(sql`
    WITH numeros AS (
      SELECT t.whatsapp_number_id AS id, 'Principal' AS rotulo
        FROM tenants t
        WHERE t.id = ${tenantId} AND t.whatsapp_number_id IS NOT NULL
      UNION ALL
      SELECT f.whatsapp_number_id, f.nome
        FROM filiais f
        WHERE f.tenant_id = ${tenantId} AND f.whatsapp_number_id IS NOT NULL
      UNION ALL
      SELECT e.whatsapp_number_id, f.nome || ' (' || coalesce(e.rotulo, 'extra') || ')'
        FROM filial_whatsapp_extra e
        JOIN filiais f ON f.id = e.filial_id
        WHERE f.tenant_id = ${tenantId}
    )
    SELECT n.rotulo,
           n.id AS phone_number_id,
           count(c.wamid)::int AS total,
           count(c.wamid) FILTER (WHERE c.cobravel IS TRUE)::int  AS cobradas,
           count(c.wamid) FILTER (WHERE c.cobravel IS FALSE)::int AS na_cota
      FROM numeros n
      LEFT JOIN meta_cobranca c
        ON c.phone_number_id = n.id
       AND c.status_em >= ${inicio} AND c.status_em < ${fim}
     GROUP BY n.rotulo, n.id
     ORDER BY cobradas DESC, n.rotulo
  `);

  const numeros = rows.map(r => ({
    rotulo: r.rotulo,
    total: Number(r.total),
    cobradas: Number(r.cobradas),
    naCota: Number(r.na_cota),
  }));

  return {
    numeros,
    total:    numeros.reduce((s, n) => s + n.total, 0),
    cobradas: numeros.reduce((s, n) => s + n.cobradas, 0),
    naCota:   numeros.reduce((s, n) => s + n.naCota, 0),
    // Quantas mensagens ainda não têm resposta de cobrança da Meta. Serve para
    // o painel não afirmar "zero cobradas" quando o que houve foi falta de dado
    // — a captura começou em 23/11/2026 e nada antes disso existe aqui.
    semDado: numeros.reduce((s, n) => s + (n.total - n.cobradas - n.naCota), 0),
  };
}
