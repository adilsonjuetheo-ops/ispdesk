import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { and, lte, isNotNull, inArray } from 'drizzle-orm';
import { enviarAlertaVencimento } from '../services/email.js';

export function agendarAlertaVencimento() {
  verificar();
  setInterval(verificar, 24 * 60 * 60 * 1000);
}

async function verificar() {
  try {
    const em7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rows = await db.select({
      id: tenants.id,
      nome: tenants.nome,
      slug: tenants.slug,
      proximoVencimento: tenants.proximoVencimento,
      statusPagamento: tenants.statusPagamento,
    }).from(tenants).where(
      and(
        isNotNull(tenants.proximoVencimento),
        lte(tenants.proximoVencimento, em7dias),
        inArray(tenants.statusPagamento, ['trial', 'ativo']),
      )
    );

    if (rows.length > 0) {
      await enviarAlertaVencimento(rows);
    }
  } catch (err) {
    console.error('[AlertaVencimento] Erro na verificação:', err.message);
  }
}
