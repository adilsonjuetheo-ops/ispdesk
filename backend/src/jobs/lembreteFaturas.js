import { db } from '../db/index.js';
import { tenants, clientes, conversas, mensagens, lembreteFaturaEnviados } from '../db/schema.js';
import { eq, and, ne, inArray, sql } from 'drizzle-orm';
import { variantesTelefoneBR } from '../services/telefone.js';
import { criarSgp } from '../services/sgp.js';
import { enviarTemplate } from '../services/whatsapp.js';
import { criarLinkFatura } from '../services/faturaLink.js';
import { detectarFormatoPorTemplate } from '../services/metaTemplates.js';

// Quantos dias pra trás da marca de vencido a busca ainda cobre — dá uma folga
// pra pegar quem ficou de fora se o cron falhar num dia (SGP fora do ar, deploy
// no meio da execução, etc.), sem arrastar dívida antiga pra dentro de um
// lembrete que soa como "acabou de vencer".
const FOLGA_POS_VENCIMENTO_DIAS = 10;

// Prazo padrão de cobrança, quando o provedor não configurou o dele.
const DIAS_POS_PADRAO = 5;

function formatarData(dataStr) {
  return new Date(`${dataStr}T00:00:00`).toLocaleDateString('pt-BR');
}

function paraDataISO(diasOffset) {
  const d = new Date();
  d.setDate(d.getDate() + diasOffset);
  return d.toISOString().slice(0, 10);
}

async function registrarMensagemBot(tenant, telefone, texto) {
  // Procura nas duas grafias (com e sem o nono dígito) e prefere o contato que
  // já escreveu: é nele que a resposta do cliente vai cair.
  let [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.tenantId, tenant.id), inArray(clientes.whatsapp, variantesTelefoneBR(telefone))))
    .orderBy(sql`${clientes.ultimoContato} desc nulls last`)
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

// simular: faz tudo menos mandar a mensagem — consulta o SGP, resolve telefone
// e monta as variáveis. É o único jeito de conferir se a busca de faturas por
// vencimento está devolvendo o que deveria sem usar cliente real como teste.
async function enviarLembrete(tenant, sgp, titulo, nomeTemplate, rotulo, { simular = false, usaBotao = false } = {}) {
  if (!nomeTemplate) return { enviado: false, motivo: 'Template não configurado' };

  try {
    const telefone = await sgp.buscarTelefonePorDocumento(titulo.clienteCpfcnpj);
    if (!telefone) {
      console.warn(`[lembretes] Sem telefone para ${titulo.clienteNome} (fatura ${titulo.id})`);
      return { enviado: false, motivo: 'Telefone não encontrado no SGP' };
    }

    const valor = Number(titulo.valorCorrigido || titulo.valor || 0).toFixed(2).replace('.', ',');
    // Com link da central configurado, o provedor pediu pra parar de mandar
    // o PIX ali e mandar o link em vez disso — mesma posição de variável,
    // template não muda.
    //
    // Provedor que não trabalha com PIX não pode ter o código do SGP caindo
    // aqui: o lembrete mandaria justamente o que a 2ª via já deixou de mandar.
    const codigoPix = tenant.aceitaPix === false ? null : titulo.codigoPix;

    // {{3}} vai sem "R$": os templates aprovados escrevem "no valor de R$ {{3}}",
    // com o cifrão no corpo. Mandar "R$ 89,90" aqui faria o cliente ler
    // "no valor de R$ R$ 89,90".
    const parametros = [
      titulo.clienteNome || 'Cliente',
      titulo.demonstrativo || 'Mensalidade',
      valor,
      formatarData(titulo.dataVencimento),
    ];

    // Formato novo: o template tem botão de URL e o corpo acaba em {{4}}. O
    // código de pagamento sai da mensagem e vai pra /p/<token>, onde o cliente
    // copia só ele — no WhatsApp, pressionar o balão copia a mensagem inteira,
    // e era isso que impedia o cliente de colar o PIX no banco.
    if (usaBotao) {
      if (!codigoPix && !titulo.link) {
        return { enviado: false, motivo: 'Fatura sem forma de pagamento (nem PIX, nem boleto) — a página do botão ficaria vazia' };
      }

      if (simular) {
        return {
          enviado: false,
          simulado: true,
          cliente: titulo.clienteNome,
          telefone,
          valor,
          vencimento: formatarData(titulo.dataVencimento),
          pagamento: codigoPix ? 'botão → página com PIX' : 'botão → página com boleto',
        };
      }

      const token = await criarLinkFatura(tenant, titulo, { codigoPix, link: titulo.link });
      if (!token) return { enviado: false, motivo: 'Não foi possível gerar o link da página de pagamento' };

      await enviarTemplate(
        tenant, telefone, nomeTemplate, tenant.lembreteFaturaIdioma || 'pt_BR', parametros,
        { sufixoBotaoUrl: token },
      );
    } else {
      // Formato antigo: o código de pagamento é a {{5}} do corpo. Continua
      // valendo pra quem ainda não teve a edição do template aprovada.
      const linkOuPix = tenant.lembreteFaturaLinkAssinante || codigoPix || titulo.link || '';
      // A Meta recusa parâmetro de texto vazio, e o erro que ela devolve não diz
      // qual variável faltou. Melhor falhar aqui, com motivo que aparece no painel.
      if (!linkOuPix) {
        return { enviado: false, motivo: 'Fatura sem forma de pagamento (nem link da central, nem PIX, nem boleto)' };
      }

      if (simular) {
        return {
          enviado: false,
          simulado: true,
          cliente: titulo.clienteNome,
          telefone,
          valor,
          vencimento: formatarData(titulo.dataVencimento),
          // Só o começo: o PIX copia e cola tem 200 caracteres e o que importa
          // aqui é ver que veio algo, e se é PIX ou link.
          pagamento: String(linkOuPix).slice(0, 40),
        };
      }

      await enviarTemplate(
        tenant, telefone, nomeTemplate, tenant.lembreteFaturaIdioma || 'pt_BR',
        [...parametros, linkOuPix],
      );
    }

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

  // Mesmo motivo da varredura: o teste manual é o primeiro lugar onde se nota
  // que a Meta aprovou a edição, e não pode falhar justamente aí.
  const formatos = await detectarFormatoPorTemplate(tenant, String(process.env.API_PUBLIC_URL || ''));
  const usaBotao = formatos?.[nomeTemplate] ?? !!tenant.lembreteFaturaBotaoUrl;

  const r = await enviarLembrete(tenant, sgp, titulo, nomeTemplate, rotulo, { usaBotao });
  return {
    ...r,
    cliente: titulo.clienteNome,
    valor: titulo.valor,
    vencimento: titulo.dataVencimento,
  };
}

export async function processarProvedor(tenant, { simular = false } = {}) {
  const sgp = criarSgp(tenant);
  if (!sgp || typeof sgp.listarTitulosPorVencimento !== 'function') {
    return { erro: 'Este SGP não tem suporte a lembretes automáticos.' };
  }

  // A Meta aprova a edição do template quando quer, e no segundo seguinte o
  // template passa a ter 4 variáveis e um botão. Conferir aqui, uma vez por
  // varredura, evita que a varredura inteira falhe esperando alguém lembrar de
  // virar a chave no painel — e grava o que achou, pra o painel não mentir.
  const formatos = await detectarFormatoPorTemplate(tenant, String(process.env.API_PUBLIC_URL || ''));
  const formatoDe = nome => formatos?.[nome] ?? !!tenant.lembreteFaturaBotaoUrl;

  // A flag gravada só vale como "os dois já viraram" — é o que o painel mostra
  // e o que vale de reserva quando a Meta não responde. A decisão de cada envio
  // é por template, logo abaixo, porque durante a janela de 24h entre uma
  // edição e outra os dois formatos convivem.
  if (formatos) {
    const todos = [tenant.lembreteFaturaTemplatePre, tenant.lembreteFaturaTemplatePos]
      .filter(Boolean).every(nome => formatos[nome] === true);
    if (todos !== !!tenant.lembreteFaturaBotaoUrl) {
      console.log(`[lembretes] ${tenant.nome}: templates ${todos ? 'todos convertidos' : 'ainda em conversão'}`);
      tenant = { ...tenant, lembreteFaturaBotaoUrl: todos };
      await db.update(tenants)
        .set({ lembreteFaturaBotaoUrl: todos })
        .where(eq(tenants.id, tenant.id))
        .catch(err => console.error('[lembretes] Falha ao gravar o formato do template:', err.message));
    }
  }

  const diasPos = Number(tenant.lembreteFaturaDiasPos) || DIAS_POS_PADRAO;
  const amanha = paraDataISO(1);
  const marcaPos = paraDataISO(-diasPos);
  const inicioJanelaPos = paraDataISO(-(diasPos + FOLGA_POS_VENCIMENTO_DIAS));

  const falhasConsulta = [];
  const [venceAmanha, venceu5diasOuMais] = await Promise.all([
    sgp.listarTitulosPorVencimento(amanha).catch(err => {
      console.error(`[lembretes] Erro ao listar títulos (D-1) de ${tenant.nome}:`, err.message);
      falhasConsulta.push(`Consulta D-1 falhou: ${err.message}`);
      return null;
    }),
    sgp.listarTitulosPorVencimento(inicioJanelaPos, marcaPos).catch(err => {
      console.error(`[lembretes] Erro ao listar títulos (D+${diasPos}) de ${tenant.nome}:`, err.message);
      falhasConsulta.push(`Consulta D+${diasPos} falhou: ${err.message}`);
      return null;
    }),
  ]);

  const resultado = {
    simulacao: simular,
    preEncontradas: venceAmanha?.length ?? null, // null = a consulta falhou, não "achou zero"
    preEnviadas: 0,
    posEncontradas: venceu5diasOuMais?.length ?? null,
    posEnviadas: 0,
    previa: simular ? [] : undefined,
    falhas: [...falhasConsulta],
  };

  const listaVenceAmanha = venceAmanha || [];
  const listaVenceu5diasOuMais = venceu5diasOuMais || [];

  // A janela pega a mesma fatura em aberto em vários dias seguidos — filtra
  // quem já recebeu o pós-vencimento antes pra não mandar de novo.
  const idsCandidatos = listaVenceu5diasOuMais.map(t => String(t.id));
  const jaEnviados = idsCandidatos.length
    ? new Set((await db.select({ tituloId: lembreteFaturaEnviados.tituloId })
        .from(lembreteFaturaEnviados)
        .where(and(
          eq(lembreteFaturaEnviados.tenantId, tenant.id),
          eq(lembreteFaturaEnviados.tipo, 'pos'),
          inArray(lembreteFaturaEnviados.tituloId, idsCandidatos),
        ))).map(r => r.tituloId))
    : new Set();
  const listaVenceu5diasNovas = listaVenceu5diasOuMais.filter(t => !jaEnviados.has(String(t.id)));

  for (const titulo of listaVenceAmanha) {
    const r = await enviarLembrete(tenant, sgp, titulo, tenant.lembreteFaturaTemplatePre, 'pré-vencimento', { simular, usaBotao: formatoDe(tenant.lembreteFaturaTemplatePre) });
    if (r.simulado) resultado.previa.push({ tipo: 'pré-vencimento', ...r });
    else if (r.enviado) resultado.preEnviadas++;
    else resultado.falhas.push(`${titulo.clienteNome} (pré-vencimento): ${r.motivo}`);
  }
  for (const titulo of listaVenceu5diasNovas) {
    const r = await enviarLembrete(tenant, sgp, titulo, tenant.lembreteFaturaTemplatePos, 'pós-vencimento', { simular, usaBotao: formatoDe(tenant.lembreteFaturaTemplatePos) });
    if (r.simulado) {
      resultado.previa.push({ tipo: 'pós-vencimento', ...r });
    } else if (r.enviado) {
      resultado.posEnviadas++;
      // Só marca como enviado quando enviou de verdade: na simulação isso
      // faria o cliente nunca mais receber o lembrete de verdade.
      await db.insert(lembreteFaturaEnviados)
        .values({ tenantId: tenant.id, tituloId: String(titulo.id), tipo: 'pos' })
        .onConflictDoNothing();
    } else {
      resultado.falhas.push(`${titulo.clienteNome} (pós-vencimento): ${r.motivo}`);
    }
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
