import { db } from '../db/index.js';
import { conversas, mensagens, filiais } from '../db/schema.js';
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

  // Resolve config de WhatsApp efetiva — filial própria tem prioridade
  let wConfig = wConfigParam || tenant;
  if (!wConfigParam && conversa.filialId) {
    const [filial] = await db.select({
      whatsappNumberId: filiais.whatsappNumberId,
      whatsappToken: filiais.whatsappToken,
    }).from(filiais).where(eq(filiais.id, conversa.filialId)).limit(1);
    if (filial?.whatsappToken && filial?.whatsappNumberId) {
      wConfig = { ...tenant, whatsappNumberId: filial.whatsappNumberId, whatsappToken: filial.whatsappToken };
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
