import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { enviarPushParaTenant } from './pushNotification.js';

// Quando a Meta para de aceitar envio — cartão caiu, token venceu, conta
// suspensa — o ISPDesk seguia atendendo no vazio. Aconteceu com o Mataverde em
// outubro: dias sem entregar nada, descoberto porque um cliente reclamou.
//
// O estado é por número (phone_number_id) e não por provedor de propósito: é o
// que o webhook de status entrega de graça, sem consulta ao banco. O provedor só
// é buscado na transição, que é rara.
//
// Em memória mesmo. Reiniciar o processo zera a contagem, e isso é aceitável:
// se a falha persistir, as próximas mensagens reconstroem o estado em segundos.
const porNumero = new Map();

// Uma falha isolada é caso do destinatário — número inválido, janela fechada.
// Três seguidas, sem nenhuma entrega no meio, é problema da conta.
const FALHAS_PARA_ALERTAR = 3;

function estado(phoneNumberId) {
  let e = porNumero.get(phoneNumberId);
  if (!e) {
    e = { falhas: 0, alertado: false };
    porNumero.set(phoneNumberId, e);
  }
  return e;
}

async function provedorDoNumero(phoneNumberId) {
  const [t] = await db.select({ id: tenants.id, nome: tenants.nome })
    .from(tenants).where(eq(tenants.whatsappNumberId, phoneNumberId)).limit(1);
  return t || null;
}

// Chamado quando a Meta recusa uma entrega.
export async function registrarFalhaEnvio(phoneNumberId, motivo) {
  if (!phoneNumberId) return;
  const e = estado(phoneNumberId);
  e.falhas += 1;
  e.ultimoMotivo = motivo || e.ultimoMotivo;

  if (e.falhas < FALHAS_PARA_ALERTAR || e.alertado) return;
  e.alertado = true;

  const provedor = await provedorDoNumero(phoneNumberId);
  console.error(
    `[envio] ${e.falhas} falhas seguidas em ${provedor?.nome || phoneNumberId}: ${e.ultimoMotivo || 'sem motivo'}`
  );
  if (!provedor) return;

  // Push e não WhatsApp: o aviso por WhatsApp sairia pelo mesmo número que está
  // bloqueado, então nunca chegaria. Foi o que já aconteceu com o alerta de
  // franquia de IA, que ia como mensagem livre e morria na janela de 24h.
  await enviarPushParaTenant(provedor.id, {
    title: 'ISPDesk — mensagens não estão sendo entregues',
    body: `O WhatsApp recusou os últimos envios. ${e.ultimoMotivo || ''}`.trim(),
    tag: 'envio-bloqueado',
  }).catch(err => console.error('[envio] Falha no push de alerta:', err.message));
}

// Chamado quando a Meta confirma uma entrega. Confirmação de envio (HTTP 200)
// não serve aqui: no bloqueio por pagamento a Meta aceitava e só depois
// avisava que não entregou — contar o 200 como sucesso zeraria o alerta para
// sempre, justamente no caso que ele existe para pegar.
export async function registrarEntrega(phoneNumberId) {
  if (!phoneNumberId) return;
  const e = porNumero.get(phoneNumberId);
  if (!e || (!e.falhas && !e.alertado)) return;

  const estavaAlertado = e.alertado;
  e.falhas = 0;
  e.alertado = false;
  e.ultimoMotivo = null;
  if (!estavaAlertado) return;

  const provedor = await provedorDoNumero(phoneNumberId);
  console.log(`[envio] Entregas normalizadas em ${provedor?.nome || phoneNumberId}`);
  if (!provedor) return;

  await enviarPushParaTenant(provedor.id, {
    title: 'ISPDesk — entregas normalizadas',
    body: 'O WhatsApp voltou a entregar as mensagens.',
    tag: 'envio-bloqueado',
  }).catch(() => {});
}
