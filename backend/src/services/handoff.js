import { db } from '../db/index.js';
import { conversas, mensagens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { enviarMensagem } from './whatsapp.js';

export async function realizarHandoff(tenant, conversa, cliente, motivo) {
  await db.update(conversas)
    .set({ status: 'aguardando', motivoHandoff: motivo, agenteId: null })
    .where(eq(conversas.id, conversa.id));

  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'bot',
    conteudo: '[Sistema] Conversa transferida para atendente humano.',
  });

  try {
    await enviarMensagem(
      tenant,
      cliente.whatsapp,
      'Estou te transferindo para um atendente. Aguarde um momento.'
    );
  } catch (err) {
    console.error('Erro ao enviar msg de handoff:', err.message);
  }
}
