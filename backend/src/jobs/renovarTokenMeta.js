import { db } from '../db/index.js';
import { tenants, filiais, filialWhatsappExtra } from '../db/schema.js';
import { eq, and, isNotNull, lte } from 'drizzle-orm';
import { renovarTokenLongoPrazo } from '../services/whatsapp.js';

const DIAS_ANTECEDENCIA = 10;

async function renovarTokens() {
  const limite = new Date(Date.now() + DIAS_ANTECEDENCIA * 24 * 60 * 60 * 1000);

  const paraRenovar = await db.select().from(tenants)
    .where(and(
      isNotNull(tenants.whatsappToken),
      isNotNull(tenants.whatsappTokenExpiraEm),
      lte(tenants.whatsappTokenExpiraEm, limite),
    ));

  for (const tenant of paraRenovar) {
    try {
      const { accessToken, expiraEm } = await renovarTokenLongoPrazo(tenant);
      await db.update(tenants)
        .set({ whatsappToken: accessToken, whatsappTokenExpiraEm: expiraEm, atualizadoEm: new Date() })
        .where(eq(tenants.id, tenant.id));
      console.log(`[whatsapp-token] Renovado (tenant): ${tenant.nome}`);
    } catch (err) {
      console.error(`[whatsapp-token] Falha ao renovar (tenant) ${tenant.nome}:`, err.message);
    }
  }

  const filiaisParaRenovar = await db.select().from(filiais)
    .where(and(
      isNotNull(filiais.whatsappToken),
      isNotNull(filiais.whatsappTokenExpiraEm),
      lte(filiais.whatsappTokenExpiraEm, limite),
    ));

  for (const filial of filiaisParaRenovar) {
    try {
      const { accessToken, expiraEm } = await renovarTokenLongoPrazo(filial);
      await db.update(filiais)
        .set({ whatsappToken: accessToken, whatsappTokenExpiraEm: expiraEm })
        .where(eq(filiais.id, filial.id));
      console.log(`[whatsapp-token] Renovado (filial): ${filial.nome}`);
    } catch (err) {
      console.error(`[whatsapp-token] Falha ao renovar (filial) ${filial.nome}:`, err.message);
    }
  }

  const extrasParaRenovar = await db.select().from(filialWhatsappExtra)
    .where(and(
      isNotNull(filialWhatsappExtra.whatsappToken),
      isNotNull(filialWhatsappExtra.whatsappTokenExpiraEm),
      lte(filialWhatsappExtra.whatsappTokenExpiraEm, limite),
    ));

  for (const extra of extrasParaRenovar) {
    try {
      const { accessToken, expiraEm } = await renovarTokenLongoPrazo(extra);
      await db.update(filialWhatsappExtra)
        .set({ whatsappToken: accessToken, whatsappTokenExpiraEm: expiraEm })
        .where(eq(filialWhatsappExtra.id, extra.id));
      console.log(`[whatsapp-token] Renovado (número extra): ${extra.rotulo || extra.whatsappNumberId}`);
    } catch (err) {
      console.error(`[whatsapp-token] Falha ao renovar (número extra) ${extra.rotulo || extra.whatsappNumberId}:`, err.message);
    }
  }
}

export function agendarRenovacaoTokenMeta() {
  renovarTokens().catch(err => console.error('[whatsapp-token] Erro inicial:', err.message));
  setInterval(() => {
    renovarTokens().catch(err => console.error('[whatsapp-token] Erro no cron:', err.message));
  }, 24 * 60 * 60 * 1000);

  console.log('[whatsapp-token] Cron de renovação agendado (24h)');
}
