import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { criarSgp } from '../services/sgp.js';
import { enviarTemplate } from '../services/whatsapp.js';

function formatarData(dataStr) {
  return new Date(`${dataStr}T00:00:00`).toLocaleDateString('pt-BR');
}

function paraDataISO(diasOffset) {
  const d = new Date();
  d.setDate(d.getDate() + diasOffset);
  return d.toISOString().slice(0, 10);
}

async function registrarMensagemBot(tenant, telefone, texto) {
  let [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.tenantId, tenant.id), eq(clientes.whatsapp, telefone)))
    .limit(1);

  if (!cliente) {
    [cliente] = await db.insert(clientes).values({
      tenantId: tenant.id,
      whatsapp: telefone,
      nome: telefone,
    }).returning();
  }

  let [conversa] = await db.select().from(conversas)
    .where(and(
      eq(conversas.tenantId, tenant.id),
      eq(conversas.clienteId, cliente.id),
      ne(conversas.status, 'encerrada')
    ))
    .limit(1);

  if (!conversa) {
    [conversa] = await db.insert(conversas).values({
      tenantId: tenant.id,
      clienteId: cliente.id,
      status: 'bot',
    }).returning();
  }

  await db.insert(mensagens).values({
    conversaId: conversa.id,
    origem: 'bot',
    conteudo: texto,
  });

  await db.update(conversas).set({
    ultimaMensagem: texto.slice(0, 200),
    ultimaMsgEm: new Date(),
    ultimaMsgOrigem: 'bot',
  }).where(eq(conversas.id, conversa.id));
}

async function enviarLembrete(tenant, sgp, titulo, nomeTemplate, rotulo) {
  if (!nomeTemplate) return { enviado: false, motivo: 'Template não configurado' };

  try {
    const telefone = await sgp.buscarTelefonePorDocumento(titulo.clienteCpfcnpj);
    if (!telefone) {
      console.warn(`[lembretes] Sem telefone para ${titulo.clienteNome} (fatura ${titulo.id})`);
      return { enviado: false, motivo: 'Telefone não encontrado no SGP' };
    }

    const valor = Number(titulo.valorCorrigido || titulo.valor || 0).toFixed(2).replace('.', ',');
    const parametros = [
      titulo.clienteNome || 'Cliente',
      titulo.demonstrativo || 'Mensalidade',
      `R$ ${valor}`,
      formatarData(titulo.dataVencimento),
      titulo.codigoPix || titulo.link || '',
    ];

    await enviarTemplate(tenant, telefone, nomeTemplate, tenant.lembreteFaturaIdioma || 'pt_BR', parametros);

    const resumo = `[Sistema] Lembrete de fatura (${rotulo}) enviado — ${titulo.demonstrativo || 'Mensalidade'}, vencimento ${formatarData(titulo.dataVencimento)}, ${`R$ ${valor}`}.`;
    await registrarMensagemBot(tenant, telefone, resumo);

    console.log(`[lembretes] ${rotulo} enviado: ${titulo.clienteNome} (fatura ${titulo.id})`);
    return { enviado: true };
  } catch (err) {
    console.error(`[lembretes] Falha ao enviar ${rotulo} (fatura ${titulo.id}):`, err.message);
    return { enviado: false, motivo: err.message };
  }
}

// Envia (de verdade) o template pra um cliente específico, independente da
// data de vencimento — usado pra validar o envio manualmente durante testes.
export async function testarClienteEspecifico(tenant, documento, tipo) {
  const sgp = criarSgp(tenant);
  if (!sgp || typeof sgp.buscarTituloAbertoPorDocumento !== 'function') {
    return { erro: 'Este SGP não tem suporte a lembretes automáticos.' };
  }

  const doc = (documento || '').replace(/\D/g, '');
  const titulo = await sgp.buscarTituloAbertoPorDocumento(doc);
  if (!titulo) return { erro: 'Cliente não encontrado ou sem fatura em aberto.' };

  const nomeTemplate = tipo === 'pos' ? tenant.lembreteFaturaTemplatePos : tenant.lembreteFaturaTemplatePre;
  const rotulo = tipo === 'pos' ? 'pós-vencimento' : 'pré-vencimento';

  const r = await enviarLembrete(tenant, sgp, titulo, nomeTemplate, rotulo);
  return {
    ...r,
    cliente: titulo.clienteNome,
    valor: titulo.valor,
    vencimento: titulo.dataVencimento,
  };
}

export async function processarProvedor(tenant) {
  const sgp = criarSgp(tenant);
  if (!sgp || typeof sgp.listarTitulosPorVencimento !== 'function') {
    return { erro: 'Este SGP não tem suporte a lembretes automáticos.' };
  }

  const amanha = paraDataISO(1);
  const ha5dias = paraDataISO(-5);

  const [venceAmanha, venceu5dias] = await Promise.all([
    sgp.listarTitulosPorVencimento(amanha).catch(err => {
      console.error(`[lembretes] Erro ao listar títulos (D-1) de ${tenant.nome}:`, err.message);
      return [];
    }),
    sgp.listarTitulosPorVencimento(ha5dias).catch(err => {
      console.error(`[lembretes] Erro ao listar títulos (D+5) de ${tenant.nome}:`, err.message);
      return [];
    }),
  ]);

  const resultado = {
    preEncontradas: venceAmanha.length,
    preEnviadas: 0,
    posEncontradas: venceu5dias.length,
    posEnviadas: 0,
    falhas: [],
  };

  for (const titulo of venceAmanha) {
    const r = await enviarLembrete(tenant, sgp, titulo, tenant.lembreteFaturaTemplatePre, 'pré-vencimento');
    if (r.enviado) resultado.preEnviadas++;
    else resultado.falhas.push(`${titulo.clienteNome} (pré-vencimento): ${r.motivo}`);
  }
  for (const titulo of venceu5dias) {
    const r = await enviarLembrete(tenant, sgp, titulo, tenant.lembreteFaturaTemplatePos, 'pós-vencimento');
    if (r.enviado) resultado.posEnviadas++;
    else resultado.falhas.push(`${titulo.clienteNome} (pós-vencimento): ${r.motivo}`);
  }

  return resultado;
}

async function processarLembretes() {
  const provedores = await db.select().from(tenants)
    .where(and(eq(tenants.ativo, true), eq(tenants.lembreteFaturaAtivo, true)));

  for (const tenant of provedores) {
    try {
      await processarProvedor(tenant);
    } catch (err) {
      console.error(`[lembretes] Erro no provedor ${tenant.nome}:`, err.message);
    }
  }
}

export function agendarLembretesFatura() {
  let ultimaExecucao = null; // 'AAAA-MM-DD' da última execução, evita disparo duplicado

  setInterval(() => {
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    // 12:00 UTC ~= 09:00 horário de Brasília (UTC-3)
    if (agora.getUTCHours() === 12 && ultimaExecucao !== hoje) {
      ultimaExecucao = hoje;
      processarLembretes().catch(err => console.error('[lembretes] Erro geral:', err.message));
    }
  }, 15 * 60 * 1000);

  console.log('[lembretes] Cron de lembretes de fatura agendado (diário ~9h horário de Brasília)');
}
