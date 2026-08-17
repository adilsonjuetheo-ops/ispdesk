import { db } from '../db/index.js';
import { conversas, mensagens, filiais, filialWhatsappExtra } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { enviarMensagem } from './whatsapp.js';

export async function realizarHandoff(tenant, conversa, cliente, motivo, wConfigParam = null) {
  // Verifica regras de roteamento para atribuição automática a agente
  let agenteId = null;
  const regrasAgente = (tenant.horarios?.regrasRoteamento || [])
    .filter(r => r.ativo !== false && r.acao === 'agente' && r.tipo === 'keyword');

  if (regrasAgente.length > 0) {
    const [ultimaMsgCliente] = await db.select({ conteudo: mensagens.conteudo })
      .from(mensagens)
      .where(and(eq(mensagens.conversaId, conversa.id), eq(mensagens.origem, 'cliente')))
      .orderBy(desc(mensagens.enviadaEm))
      .limit(1);

    if (ultimaMsgCliente) {
      const textoLower = ultimaMsgCliente.conteudo.toLowerCase();
      for (const regra of regrasAgente) {
        const keywords = (regra.valor || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.some(k => textoLower.includes(k)) && regra.destinoId) {
          agenteId = regra.destinoId;
          break;
        }
      }
    }
  }

  await db.update(conversas)
    .set({ status: agenteId ? 'humano' : 'aguardando', motivoHandoff: motivo, agenteId })
    .where(eq(conversas.id, conversa.id));

  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'bot',
    conteudo: '[Sistema] Conversa transferida para atendente humano.',
  });

  // Resolve config de WhatsApp efetiva pelo número que recebeu a conversa —
  // NÃO por filialId, que é só roteamento de fila e pode não ter relação
  // nenhuma com qual número/WABA recebeu a mensagem (ver resolverWConfig em
  // routes/conversations.js, mesmo problema).
  let wConfig = wConfigParam || tenant;
  const numeroRecebido = conversa.numeroRecebidoId;
  if (!wConfigParam && numeroRecebido && numeroRecebido !== tenant.whatsappNumberId) {
    const [filial] = await db.select({
      whatsappNumberId: filiais.whatsappNumberId,
      whatsappToken: filiais.whatsappToken,
    }).from(filiais).where(eq(filiais.whatsappNumberId, numeroRecebido)).limit(1);
    if (filial?.whatsappToken) {
      wConfig = { ...tenant, whatsappNumberId: filial.whatsappNumberId, whatsappToken: filial.whatsappToken };
    } else {
      const [extra] = await db.select({
        whatsappNumberId: filialWhatsappExtra.whatsappNumberId,
        whatsappToken: filialWhatsappExtra.whatsappToken,
      }).from(filialWhatsappExtra).where(eq(filialWhatsappExtra.whatsappNumberId, numeroRecebido)).limit(1);
      if (extra?.whatsappToken) {
        wConfig = { ...tenant, whatsappNumberId: extra.whatsappNumberId, whatsappToken: extra.whatsappToken };
      }
    }
  }

  try {
    await enviarMensagem(
      wConfig,
      cliente.whatsapp,
      'Estou te transferindo para um atendente. Aguarde um momento.'
    );
  } catch (err) {
    console.error('Erro ao enviar msg de handoff:', err.message);
  }
}
