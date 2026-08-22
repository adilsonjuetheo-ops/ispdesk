import { neon } from '@neondatabase/serverless';
import { enviarMensagem } from './whatsapp.js';
import { enviarPushParaTenant } from './pushNotification.js';

const LIMITES = { basic: 3000, pro: 10000 };

export function getLimite(plano) {
  return LIMITES[plano] || LIMITES.basic;
}

export function getMes() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function getUso(tenantId) {
  const sql = neon(process.env.DATABASE_URL);
  const mes = getMes();
  const [row] = await sql`
    SELECT contagem FROM uso_ia
    WHERE tenant_id = ${tenantId} AND mes = ${mes}
  `;
  return row?.contagem || 0;
}

// Incrementa o contador atomicamente e dispara alertas se necessário.
// Retorna { contagem, limite, percentual, bloqueado }
export async function incrementarUso(tenant) {
  const sql = neon(process.env.DATABASE_URL);
  const mes = getMes();

  const [row] = await sql`
    INSERT INTO uso_ia (tenant_id, mes, contagem, alertas_enviados)
    VALUES (${tenant.id}, ${mes}, 1, '[]'::jsonb)
    ON CONFLICT (tenant_id, mes) DO UPDATE
      SET contagem = uso_ia.contagem + 1
    RETURNING contagem, alertas_enviados
  `;

  const contagem = row.contagem;
  const limite = getLimite(tenant.plano);
  const percentual = Math.floor((contagem / limite) * 100);
  const alertasEnviados = Array.isArray(row.alertas_enviados) ? row.alertas_enviados : [];

  // Verifica thresholds em ordem; envia apenas o primeiro novo que for atingido
  for (const threshold of [80, 90, 100]) {
    if (percentual >= threshold && !alertasEnviados.includes(threshold)) {
      await avisarProvedor(tenant, threshold, contagem, limite, mes);
      alertasEnviados.push(threshold);
      await sql`
        UPDATE uso_ia
        SET alertas_enviados = ${JSON.stringify(alertasEnviados)}::jsonb
        WHERE tenant_id = ${tenant.id} AND mes = ${mes}
      `;
      break;
    }
  }

  return { contagem, limite, percentual, bloqueado: contagem > limite };
}

async function avisarProvedor(tenant, threshold, contagem, limite, mes) {
  const contagemBruta = contagem.toLocaleString('pt-BR');
  const limiteBruto = limite.toLocaleString('pt-BR');

  // Push primeiro, e sem depender de nada estar configurado. O aviso por
  // WhatsApp abaixo vai como mensagem livre, e mensagem livre só é entregue
  // dentro da janela de 24h contada a partir de uma mensagem que a PESSOA tenha
  // mandado para o número do provedor — o dono não conversa com o próprio
  // número comercial, então na prática ele nunca chegava. O push não tem essa
  // restrição e não custa nada.
  enviarPushParaTenant(tenant.id, {
    title: threshold >= 100 ? 'ISPDesk — limite de IA atingido' : 'ISPDesk — uso de IA',
    body: threshold >= 100
      ? `Franquia do mês esgotada (${contagemBruta}/${limiteBruto}). O bot está pausado.`
      : `Franquia do mês em ${threshold}% (${contagemBruta}/${limiteBruto}).`,
    tag: `uso-ia-${mes}`,
  }).catch(err => console.error('[limites] Falha no push de uso:', err.message));

  if (!tenant.whatsappContato || !tenant.whatsappNumberId || !tenant.whatsappToken) return;

  // Normaliza número (remove tudo que não for dígito)
  const numero = tenant.whatsappContato.replace(/\D/g, '');
  if (!numero) return;

  const [ano, mesNum] = mes.split('-');
  const nomeMes = new Date(Number(ano), Number(mesNum) - 1)
    .toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  const contagemFmt = contagem.toLocaleString('pt-BR');
  const limiteFmt = limite.toLocaleString('pt-BR');

  let msg;
  if (threshold === 80) {
    msg =
      `⚠️ *Aviso ISPDesk — Uso de IA*\n\n` +
      `Sua franquia mensal está em *80% de utilização* (${contagemFmt}/${limiteFmt} atendimentos em ${nomeMes}).\n\n` +
      `Para evitar interrupções, considere fazer upgrade:\n` +
      `📦 *Plano Pro:* 10.000 atendimentos por R$249,90/mês\n` +
      `💰 *Excedente:* R$0,03 por atendimento adicional\n\n` +
      `Entre em contato com o suporte ISPDesk para fazer o upgrade.`;
  } else if (threshold === 90) {
    msg =
      `🚨 *Atenção ISPDesk — Uso de IA*\n\n` +
      `Sua franquia mensal está em *90% de utilização* (${contagemFmt}/${limiteFmt} atendimentos em ${nomeMes}).\n\n` +
      `Faça upgrade agora para continuar atendendo seus clientes sem interrupção:\n` +
      `📦 *Plano Pro:* 10.000 atendimentos por R$249,90/mês\n` +
      `💰 *Excedente:* R$0,03 por atendimento adicional\n\n` +
      `Entre em contato com o suporte ISPDesk para fazer o upgrade.`;
  } else {
    msg =
      `🔴 *ISPDesk — Limite de IA atingido!*\n\n` +
      `Sua franquia mensal foi *totalmente utilizada* (${contagemFmt}/${limiteFmt} atendimentos em ${nomeMes}).\n\n` +
      `⛔ O bot de IA está *pausado* até o próximo mês.\n\n` +
      `Para continuar atendendo seus clientes automaticamente:\n` +
      `📦 *Plano Pro:* 10.000 atendimentos por R$249,90/mês\n` +
      `💰 *Excedente:* R$0,03 por atendimento adicional\n\n` +
      `Entre em contato com o suporte ISPDesk para reativar o bot.`;
  }

  try {
    await enviarMensagem(tenant, numero, msg);
  } catch (err) {
    console.error('[limites] Falha ao enviar alerta por WhatsApp:', err.message);
  }
}
