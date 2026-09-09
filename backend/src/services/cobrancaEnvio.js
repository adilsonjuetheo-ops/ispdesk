import { db } from '../db/index.js';
import { cobrancaEnvios } from '../db/schema.js';
import { enviarMensagem } from './whatsapp.js';

// Envia a fatura ao responsável pelo provedor e GRAVA a tentativa.
//
// Antes esse envio não deixava rastro nenhum: a mensagem saía (ou não) e uma
// semana depois não havia como saber se foi enviada, quando, nem para qual
// número. Pior no job automático, que fazia `.catch(() => {})` — falha
// silenciosa, rodando de madrugada, sem ninguém olhando.
//
// Grava sucesso e fracasso: um envio que falhou é justamente o que se precisa
// enxergar, e é o que sumia.
export async function enviarCobranca(tenant, { mensagem, paymentId, valor, origem }) {
  let motivo = null;
  if (!tenant.whatsappContato)       motivo = 'WhatsApp do responsável não cadastrado';
  else if (!tenant.whatsappNumberId) motivo = 'provedor sem número de WhatsApp conectado';
  else if (!tenant.whatsappToken)    motivo = 'provedor sem token do WhatsApp';

  const numero = (tenant.whatsappContato || '').replace(/\D/g, '') || null;
  let sucesso = false;
  let wamid = null;

  if (!motivo) {
    try {
      const res = await enviarMensagem(tenant, numero, mensagem);
      wamid = res?.messages?.[0]?.id || null;
      sucesso = true;
    } catch (err) {
      motivo = `a Meta recusou o envio: ${err.message}`;
    }
  }

  // O registro não pode derrubar a cobrança: o PIX já foi criado no Mercado
  // Pago a esta altura, e perder isso por causa do histórico seria pior.
  await db.insert(cobrancaEnvios).values({
    tenantId: tenant.id,
    numero,
    paymentId: paymentId ? String(paymentId) : null,
    valor: valor ? String(valor) : null,
    origem,
    sucesso,
    wamid,
    erro: motivo,
  }).catch(err => console.error('[cobrança] Falha ao registrar envio:', err.message));

  return { sucesso, wamid, motivo };
}
