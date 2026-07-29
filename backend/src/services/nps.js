import { db } from '../db/index.js';
import { npsRespostas, clientes } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { enviarMensagem } from './whatsapp.js';

export function categorizar(nota) {
  if (nota >= 9) return 'promotor';
  if (nota >= 7) return 'neutro';
  return 'detrator';
}

export async function enviarNps(tenant, conversa, clienteId, clienteWhatsapp) {
  // Não reenvia se já existe NPS nos últimos 30 dias para este cliente
  const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [existente] = await db.select({ id: npsRespostas.id })
    .from(npsRespostas)
    .where(and(
      eq(npsRespostas.tenantId, tenant.id),
      eq(npsRespostas.clienteWhatsapp, clienteWhatsapp),
      gt(npsRespostas.enviadoEm, limite),
    ))
    .limit(1);

  if (existente) return;

  const msg =
    `⭐ *Como foi seu atendimento?*\n\n` +
    `De *0 a 10*, quanto você recomendaria nosso suporte para um amigo?\n\n` +
    `Responda apenas com o número.`;

  try {
    await enviarMensagem(tenant, clienteWhatsapp, msg);
  } catch (err) {
    console.error('[NPS] Erro ao enviar:', err.message);
    return;
  }

  await db.insert(npsRespostas).values({
    tenantId: tenant.id,
    conversaId: conversa.id,
    clienteId,
    clienteWhatsapp,
    aguardando: true,
  });

  console.log(`[NPS] Enviado para ${clienteWhatsapp}`);
}

export async function processarRespostaNps(tenant, remetente, texto) {
  const nota = parseInt(texto.trim(), 10);
  if (isNaN(nota) || nota < 0 || nota > 10) return false;

  const [pendente] = await db.select()
    .from(npsRespostas)
    .where(and(
      eq(npsRespostas.tenantId, tenant.id),
      eq(npsRespostas.clienteWhatsapp, remetente),
      eq(npsRespostas.aguardando, true),
    ))
    .limit(1);

  if (!pendente) return false;

  const categoria = categorizar(nota);

  await db.update(npsRespostas)
    .set({ aguardando: false, nota, categoria, respondidoEm: new Date() })
    .where(eq(npsRespostas.id, pendente.id));

  const agradecimentos = {
    promotor: `Que ótimo! 😊 Obrigado pela sua avaliação. Fico feliz em saber que você está satisfeito!`,
    neutro:   `Obrigado pela sua avaliação! Vamos continuar trabalhando para melhorar. 🙏`,
    detrator: `Obrigado pelo feedback. 😔 Lamentamos que a experiência não tenha sido ideal. Vamos nos esforçar para melhorar!`,
  };

  try {
    await enviarMensagem(tenant, remetente, agradecimentos[categoria]);
  } catch {}

  console.log(`[NPS] ${remetente} respondeu ${nota} (${categoria})`);
  return true;
}
