import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, clientes, tenants, mensagens } from '../db/schema.js';
import { eq, and, ne, or, isNull } from 'drizzle-orm';
import { planoTemContrato } from '../config/planos.js';
import { autenticar, apenasAdmin } from '../middleware/auth.js';
import { enviarContrato, buscarLinkAssinatura } from '../services/assinatura.js';
import { enviarMensagem } from '../services/whatsapp.js';
import { enviarPushParaUsuario, enviarPushParaTenant } from '../services/pushNotification.js';
import { buscarDadosCliente } from '../services/sgp.js';
import { criarRateLimit } from '../middleware/security.js';

const router = Router();
const limitarWebhookContrato = criarRateLimit({
  janelaMs: 60_000,
  limite: 120,
  prefixo: 'webhook-contrato',
});

function podeAcessarContrato(req, conversa) {
  if (req.user.role === 'superadmin') return true;
  if (conversa.tenantId !== req.user.tenantId) return false;
  if (req.user.filialId && conversa.filialId !== req.user.filialId) return false;
  return true;
}

// Envia contrato para assinatura digital
router.post('/:conversaId/send', autenticar, apenasAdmin, async (req, res) => {
  const { conversaId } = req.params;
  const dados = req.body;

  if (req.user.role !== 'superadmin' && !planoTemContrato(req.user.plano)) {
    return res.status(403).json({ erro: 'O módulo de assinatura digital não está disponível no seu plano.' });
  }

  if (!dados.nome_contratante || !dados.cpf_cnpj || !dados.identificacao_oferta || !dados.mensalidade) {
    return res.status(400).json({ erro: 'Campos obrigatórios: nome_contratante, cpf_cnpj, identificacao_oferta, mensalidade' });
  }

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, conversaId)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (!podeAcessarContrato(req, conversa)) return res.status(403).json({ erro: 'Acesso negado' });

  if (conversa.contratoStatus === 'pendente') {
    return res.status(409).json({ erro: 'Já existe um contrato pendente de assinatura para esta conversa. Aguarde a assinatura do cliente.' });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

  if (!tenant.assinaturaTipo) {
    return res.status(400).json({ erro: 'Plataforma de assinatura não configurada. Acesse Configurações → Assinatura Digital.' });
  }

  try {
    // O modelo sai do cadastro do provedor. A tela pode sobrescrever num caso
    // pontual, mas o padrão é o que o provedor vende — assim a StaNet nunca
    // manda contrato residencial por alguém ter esquecido de trocar.
    const resultado = await enviarContrato(tenant, cliente.whatsapp, {
      ...dados,
      modelo_contrato: dados.modelo_contrato || tenant.contratoModelo || 'residencial',
    });

    await db.update(conversas).set({
      contratoUuid: resultado.uuid,
      contratoStatus: 'pendente',
      contratoEnviadoEm: new Date(),
    }).where(eq(conversas.id, conversaId));

    // Registra no histórico da conversa
    await db.insert(mensagens).values({
      conversaId,
      origem: 'bot',
      conteudo: `[Sistema] Contrato enviado para assinatura digital (${tenant.assinaturaTipo}).`,
    });

    // Avisa o cliente via WhatsApp
    const primeiroNome = (dados.nome_contratante || '').split(' ')[0];
    const msg = resultado.linkAssinatura
      ? `Olá, ${primeiroNome}! Seu contrato de internet está pronto para assinatura digital.\n\nPlano: ${dados.identificacao_oferta}\nMensalidade: R$ ${dados.mensalidade}\n\nClique no link abaixo para assinar pelo celular, sem precisar imprimir nada:\n${resultado.linkAssinatura}\n\nQualquer dúvida, é só chamar aqui!`
      : `Olá, ${primeiroNome}! Seu contrato de internet (${dados.identificacao_oferta} — R$ ${dados.mensalidade}/mês) foi enviado para assinatura digital. Verifique seu e-mail para assinar. Qualquer dúvida, é só chamar!`;

    await enviarMensagem(tenant, cliente.whatsapp, msg).catch(err =>
      console.error('[Contrato] Erro ao avisar cliente:', err.message)
    );

    res.json({ uuid: resultado.uuid, linkAssinatura: resultado.linkAssinatura });
  } catch (err) {
    console.error('[Contrato] Erro ao enviar:', err.message);
    res.status(502).json({ erro: err.message });
  }
});

// Webhook ZapSign — chamado quando documento é assinado
router.post('/webhook/zapsign', limitarWebhookContrato, async (req, res) => {
  res.sendStatus(200); // responde rápido

  const payload = req.body;
  const docToken = payload?.document?.token;
  const status   = payload?.document?.status;

  if (!docToken) return;

  try {
    const [conversa] = await db.select().from(conversas)
      .where(eq(conversas.contratoUuid, docToken)).limit(1);
    if (!conversa) return;
    if (conversa.contratoStatus === 'assinado') return;

    if (status === 'signed' || payload?.event_action === 'all_signed') {
      const [atualizada] = await db.update(conversas)
        .set({ contratoStatus: 'assinado' })
        .where(and(
          eq(conversas.id, conversa.id),
          or(isNull(conversas.contratoStatus), ne(conversas.contratoStatus, 'assinado')),
        ))
        .returning({ id: conversas.id });
      if (!atualizada) return;

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
      const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: '[Sistema] Contrato assinado digitalmente com sucesso!',
      });

      const nomeCliente = cliente?.nome || cliente?.whatsapp || 'Cliente';
      const pushPayload = {
        title: '✅ Contrato assinado!',
        body: `${nomeCliente} assinou o contrato digital.`,
        tag: `contrato-${conversa.id}`,
      };
      if (conversa.agenteId) {
        enviarPushParaUsuario(conversa.agenteId, conversa.tenantId, pushPayload).catch(() => {});
      } else {
        enviarPushParaTenant(conversa.tenantId, pushPayload).catch(() => {});
      }

      if (tenant?.whatsappToken && cliente?.whatsapp) {
        await enviarMensagem(
          tenant, cliente.whatsapp,
          'Seu contrato foi assinado com sucesso! Bem-vindo(a) à nossa rede. Em breve entraremos em contato para agendar a instalação.'
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Webhook ZapSign]', err.message);
  }
});

// Webhook D4Sign — chamado quando documento é assinado
router.post('/webhook/d4sign', limitarWebhookContrato, async (req, res) => {
  res.sendStatus(200);

  const payload = req.body;
  const docUuid = payload?.uuid;
  const type    = payload?.type_post; // '1' = assinado

  if (!docUuid) return;

  try {
    const [conversa] = await db.select().from(conversas)
      .where(eq(conversas.contratoUuid, docUuid)).limit(1);
    if (!conversa) return;
    if (conversa.contratoStatus === 'assinado') return;

    if (type === '1' || payload?.type === '1') {
      const [atualizada] = await db.update(conversas)
        .set({ contratoStatus: 'assinado' })
        .where(and(
          eq(conversas.id, conversa.id),
          or(isNull(conversas.contratoStatus), ne(conversas.contratoStatus, 'assinado')),
        ))
        .returning({ id: conversas.id });
      if (!atualizada) return;

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
      const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

      await db.insert(mensagens).values({
        conversaId: conversa.id,
        origem: 'bot',
        conteudo: '[Sistema] Contrato assinado digitalmente com sucesso!',
      });

      // Push para o agente responsável (ou broadcast para o tenant)
      const nomeCliente = cliente?.nome || cliente?.whatsapp || 'Cliente';
      const pushPayload = {
        title: '✅ Contrato assinado!',
        body: `${nomeCliente} assinou o contrato digital.`,
        tag: `contrato-${conversa.id}`,
      };
      if (conversa.agenteId) {
        enviarPushParaUsuario(conversa.agenteId, conversa.tenantId, pushPayload).catch(() => {});
      } else {
        enviarPushParaTenant(conversa.tenantId, pushPayload).catch(() => {});
      }

      if (tenant?.whatsappToken && cliente?.whatsapp) {
        await enviarMensagem(
          tenant, cliente.whatsapp,
          'Seu contrato foi assinado com sucesso! Bem-vindo(a) à nossa rede. Em breve entraremos em contato para agendar a instalação.'
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Webhook D4Sign]', err.message);
  }
});

// Reenviar link do contrato pendente via WhatsApp
router.post('/:conversaId/resend-link', autenticar, apenasAdmin, async (req, res) => {
  const { conversaId } = req.params;

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, conversaId)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (!podeAcessarContrato(req, conversa)) return res.status(403).json({ erro: 'Acesso negado' });
  if (conversa.contratoStatus !== 'pendente') return res.status(400).json({ erro: 'Não há contrato pendente para esta conversa.' });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);

  const linkAssinatura = await buscarLinkAssinatura(tenant, conversa.contratoUuid);
  if (!linkAssinatura) return res.status(502).json({ erro: 'Não foi possível obter o link de assinatura. Tente novamente.' });

  const primeiroNome = (cliente?.nome || '').split(' ')[0] || 'Cliente';
  const msg = `Olá, ${primeiroNome}! Seu contrato ainda está aguardando assinatura.\n\nClique no link abaixo para assinar pelo celular:\n${linkAssinatura}\n\nQualquer dúvida, é só chamar!`;
  await enviarMensagem(tenant, cliente.whatsapp, msg).catch(err =>
    console.error('[Contrato] Erro ao reenviar link:', err.message)
  );

  res.json({ linkAssinatura });
});

// Prefill: retorna dados disponíveis do cliente para pré-preencher o modal de contrato
router.get('/:conversaId/prefill', autenticar, apenasAdmin, async (req, res) => {
  const { conversaId } = req.params;

  const [conversa] = await db.select().from(conversas).where(eq(conversas.id, conversaId)).limit(1);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada' });
  if (!podeAcessarContrato(req, conversa)) return res.status(403).json({ erro: 'Acesso negado' });

  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, conversa.clienteId)).limit(1);
  const [tenant]  = await db.select().from(tenants).where(eq(tenants.id, conversa.tenantId)).limit(1);

  const prefill = {
    nome_contratante: cliente?.nome || '',
    telefone:         cliente?.whatsapp || '',
    email:            '',
    identificacao_oferta: '',
    mensalidade:          '',
    velocidade_download:  '',
    velocidade_upload:    '',
  };

  // Dados adicionais do SGP
  try {
    const dadosSgp = await buscarDadosCliente(tenant, cliente?.whatsapp);
    if (dadosSgp?.nome) prefill.nome_contratante = dadosSgp.nome;
  } catch {}

  // Dados do plano coletados pelo bot no handoff
  if (conversa.motivoHandoff?.startsWith('CONTRATO|')) {
    for (const part of conversa.motivoHandoff.split('|').slice(1)) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const k = part.slice(0, idx);
      const v = part.slice(idx + 1);
      if (k === 'plano')    prefill.identificacao_oferta = v;
      if (k === 'valor')    prefill.mensalidade = v;
      if (k === 'email')    prefill.email = v;
      if (k === 'download') prefill.velocidade_download = v;
      if (k === 'upload')   prefill.velocidade_upload = v;
    }
  }

  res.json(prefill);
});

export default router;
