import Anthropic from '@anthropic-ai/sdk';
import { buscarContextoSgp, getTools, executarTool } from './sgp.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku atende sozinho a maior parte da conversa (consulta, 2ª via,
// desbloqueio, dúvidas comuns) por uma fração do custo do Sonnet. Quando o
// próprio modelo sinaliza que o caso é incomum (ACTION:ESCALATE), a mesma
// conversa — já com qualquer tool já executada — continua no Sonnet.
const MODELO_RAPIDO = 'claude-haiku-4-5-20251001';
const MODELO_COMPLETO = 'claude-sonnet-4-6';

// clienteWhatsapp: número do remetente vindo direto do payload do webhook
const TAGS_VALIDAS = ['Financeiro','Sem Conexão','Lentidão','Mudança de Endereço','Cancelamento','Nova Contratação','Problema no Roteador','Segunda Via','Outros'];

function extrairIdsAutorizados(contexto) {
  const idsCliente = new Set();
  const idsContrato = new Set();
  const regex = /ID_INTERNO:\s*id_cliente=([^|\s]+)\s*\|\s*id_contrato=([^\s]*)/g;
  let match;
  while ((match = regex.exec(contexto || '')) !== null) {
    if (match[1]) idsCliente.add(String(match[1]));
    if (match[2]) idsContrato.add(String(match[2]));
  }
  return { idsCliente, idsContrato };
}

function toolAutorizada(toolName, input, ids) {
  if (toolName === 'buscar_por_documento') return true;
  if (!input?.id_cliente || !ids.idsCliente.has(String(input.id_cliente))) return false;
  if (input.id_contrato && !ids.idsContrato.has(String(input.id_contrato))) return false;
  return true;
}

// O WhatsApp marca negrito com um asterisco só; o modelo escreve markdown
// padrão, e "**200 MB**" chega ao cliente com os asteriscos à mostra.
function paraFormatacaoWhatsapp(texto) {
  return (texto || '')
    .replace(/\*\*\*(.+?)\*\*\*/gs, '*_$1_*')
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    .replace(/__(.+?)__/gs, '_$1_');
}

const MIMES_IMAGEM_CLAUDE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function buildConteudoMidia(texto, midiaData) {
  const { base64, mimeType } = midiaData;
  const content = [];
  if (MIMES_IMAGEM_CLAUDE.has(mimeType)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
  } else if (mimeType === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
  } else {
    return texto; // tipo não suportado → texto simples
  }
  content.push({ type: 'text', text: texto || 'Cliente enviou este arquivo.' });
  return content;
}

export async function processarMensagem(tenant, conversa, historico, novaMensagem, clienteWhatsapp, midiaData = null, atendimento = {}) {
  // Classifica até ter uma tag específica (não "Outros" e não vazia)
  const tagAtual = Array.isArray(conversa.tags) ? conversa.tags[0] : null;
  const precisaClassificar = !tagAtual || tagAtual === 'Outros';

  // 1. Busca dados do cliente no SGP em tempo real
  const contextoSgp = await buscarContextoSgp(tenant, clienteWhatsapp);

  // 2. System prompt com contexto SGP injetado
  const temSgp = !!(tenant.sgpTipo && tenant.sgpApiKey);
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
  // Fora do horário de atendimento humano o assistente segue atendendo, mas não
  // pode prometer que alguém da equipe assume a conversa agora.
  const semAtendente = atendimento.humanoDisponivel === false;
  const instrucaoForaHorario = (
    tenant.horarios?.instrucaoForaHorario || tenant.horarios?.msgForaHorario || ''
  ).trim();
  const blocoForaHorario = semAtendente ? `
ATENDIMENTO HUMANO INDISPONÍVEL AGORA:
- Neste momento não há nenhum atendente humano de plantão — só você.
- Resolva normalmente tudo que estiver ao seu alcance (consultas, 2ª via, desbloqueio, chamados).
- Se precisar transferir, transfira mesmo assim: a conversa fica registrada na fila da equipe.
- Ao transferir, avise que um atendente responde ${atendimento.proximoRetorno || 'no próximo horário de atendimento'}.
- Nunca diga que vai chamar alguém "agora" nem prometa retorno imediato.${instrucaoForaHorario ? `
- Orientação do provedor para este período: ${instrucaoForaHorario}` : ''}
` : '';

  const systemPrompt = `${tenant.systemPrompt || ''}

DATA E HORA ATUAL: ${agora} (horário de Brasília). Use isso para saudar o cliente corretamente (bom dia até 12h, boa tarde até 18h, boa noite após 18h) e para contextualizar qualquer referência a datas.

${contextoSgp}
${blocoForaHorario}
INSTRUÇÕES IMPORTANTES:
- Se o cliente pedir para falar com humano: diga que vai transferir e escreva ACTION:HANDOFF:solicitado pelo cliente
- Se não conseguir resolver o problema: escreva ACTION:HANDOFF:motivo detalhado
- Se a situação for incomum e exigir julgamento mais cuidadoso (reclamação grave, negociação fora do script, ambiguidade real) e você não estiver seguro de como agir: não adivinhe nem transfira ainda — escreva sozinho, sem mais nada, ACTION:ESCALATE. Isso pede uma segunda opinião antes de responder ao cliente, não é o mesmo que transferir para um humano. Não use para o dia a dia — consulta, 2ª via, desbloqueio e dúvidas comuns você resolve normalmente.
${temSgp ? `- Use apenas os dados fornecidos pelo SGP acima. Nunca invente informações.
- Nunca diga que vai "verificar" — você já tem os dados, use-os diretamente.
- Ao enviar 2ª via, cole o PIX ou linha digitável completo na mensagem. Só prometa o PDF do boleto se o resultado da ferramenta disser que ele será enviado — nunca anuncie um arquivo que não vai chegar.
${tenant.exigirDocumento
  ? `- Este provedor NÃO identifica clientes pelo número de WhatsApp. Na primeira demanda que exija dados do cliente, peça o CPF ou CNPJ do titular — mesmo que o cliente já tenha conversado antes.
- Só prossiga com consultas, 2ª via ou desbloqueio depois de validar o cliente pelo CPF/CNPJ.`
  : '- Se o cliente NÃO for encontrado pelo número de WhatsApp: peça APENAS o CPF ou CNPJ para localizá-lo no sistema.'}
- Ao receber o CPF ou CNPJ: use a ferramenta buscar_por_documento imediatamente.
- Se o cliente NÃO for encontrado mesmo com CPF/CNPJ (cliente novo): informe que vai transferir para um atendente realizar o cadastro e escreva ACTION:HANDOFF:cliente novo — encaminhar para cadastro
- NUNCA envie formulários de cadastro — isso é responsabilidade exclusiva do atendente humano.` : ''}

IMAGENS E DOCUMENTOS:
- Quando o cliente enviar uma imagem ou PDF, você consegue visualizar o conteúdo diretamente.
- Se for um comprovante de pagamento: descreva brevemente o que está visível (data, valor, destinatário, tipo de pagamento) e informe que o pagamento será confirmado pelo provedor em breve.
- Se não conseguir identificar o conteúdo, peça que o cliente descreva o que enviou.

FLUXO DE NOVA ADESÃO (contrato):
- Quando o cliente demonstrar interesse em assinar um plano ou contratar internet, colete as seguintes informações em ordem natural na conversa: nome do plano/velocidade desejada, valor mensal combinado e e-mail do cliente (para receber o contrato digital).
- Quando tiver coletado nome do plano, valor E e-mail, confirme com o cliente: "Perfeito! Vou transferir para um atendente que enviará o contrato digital para [e-mail]. Pode confirmar?"
- Após confirmação do cliente, diga "Estou transferindo agora!" e escreva na última linha: ACTION:HANDOFF:CONTRATO|plano:[nome do plano]|valor:[valor sem R$]|email:[email]|download:[velocidade download em Mbps]|upload:[velocidade upload em Mbps]
- Exemplo: ACTION:HANDOFF:CONTRATO|plano:FIBRA 300MB|valor:89,90|email:cliente@email.com|download:300|upload:150
- Se não souber a velocidade de upload, use metade do download como estimativa.
${precisaClassificar ? `- Identifique o assunto principal desta conversa e inclua ao final da sua resposta (linha separada): TAG:categoria — onde categoria é exatamente uma de: ${TAGS_VALIDAS.join(', ')}.` : ''}

PROVEDOR: ${tenant.nome}
ASSISTENTE: ${tenant.nomeAssistente || 'Assistente'}`;

  // 3. Histórico das últimas 10 mensagens (exclui mensagens de sistema)
  const msgs = historico
    .filter(m => !m.conteudo.startsWith('[Sistema]'))
    .slice(-10)
    .map(m => ({
      role: m.origem === 'cliente' ? 'user' : 'assistant',
      content: m.conteudo,
    }));

  // 4. Tools disponíveis para este tenant (dependem do SGP configurado)
  const tools = getTools(tenant);
  const idsAutorizados = extrairIdsAutorizados(contextoSgp);

  // 5. Conversa acumulada — mescla mensagens consecutivas do mesmo role
  // (Anthropic rejeita roles não alternados, o que pode ocorrer quando o bot
  // enviou múltiplas mensagens seguidas, ex: menus repetidos)
  const conversaAcumulada = msgs.reduce((acc, msg) => {
    const last = acc[acc.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n' + msg.content;
    } else {
      acc.push({ ...msg });
    }
    return acc;
  }, []);

  // Se a última mensagem do usuário tem mídia (imagem/PDF), converte para bloco de visão
  if (midiaData) {
    const ultima = conversaAcumulada[conversaAcumulada.length - 1];
    if (ultima?.role === 'user') {
      ultima.content = buildConteudoMidia(ultima.content, midiaData);
    }
  }

  // Garante que a primeira mensagem sempre seja do usuário
  while (conversaAcumulada.length > 0 && conversaAcumulada[0].role !== 'user') {
    conversaAcumulada.shift();
  }

  // 6. Loop: chama Claude → executa tools → chama novamente até parar. Começa
  // no Haiku; se ele pedir ACTION:ESCALATE, a mesma conversa acumulada (com
  // qualquer tool já executada) continua no Sonnet — sem refazer nada.
  let modelo = MODELO_RAPIDO;
  let jaEscalou = false;
  const chamarModelo = () => anthropic.messages.create({
    model: modelo,
    max_tokens: 1024,
    system: systemPrompt,
    ...(tools.length > 0 && { tools }),
    messages: conversaAcumulada,
  });

  let response = await chamarModelo();

  const midiasParaEnviar = [];
  // Tools podem exigir transferência (ex: desbloqueio já utilizado). Guardamos o
  // motivo para garantir o handoff mesmo que o modelo não repita a marcação.
  let handoffForcado = null;

  while (true) {
    if (response.stop_reason === 'tool_use') {
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');
      if (!toolBlocks.length) break;

      const toolResults = [];
      for (const toolBlock of toolBlocks) {
        let resultado;
        if (!toolAutorizada(toolBlock.name, toolBlock.input, idsAutorizados)) {
          console.warn(`[IA] Tool bloqueada por vínculo inválido: ${toolBlock.name}`);
          resultado = 'Ação bloqueada: os identificadores informados não pertencem ao cliente validado nesta conversa.';
        } else {
          console.log(`[IA] Executando tool autorizada: ${toolBlock.name}`);
          resultado = await executarTool(toolBlock.name, toolBlock.input, tenant);
          if (toolBlock.name === 'buscar_por_documento') {
            const novosIds = extrairIdsAutorizados(typeof resultado === 'object' ? resultado.texto : resultado);
            novosIds.idsCliente.forEach(id => idsAutorizados.idsCliente.add(id));
            novosIds.idsContrato.forEach(id => idsAutorizados.idsContrato.add(id));
          }
        }
        // Tools podem retornar { texto, midia } quando há um arquivo a enviar
        // (ex: boleto em PDF) além do texto que vai pro contexto do Claude.
        let conteudoTool = resultado;
        if (resultado && typeof resultado === 'object') {
          conteudoTool = resultado.texto;
          if (resultado.midia) midiasParaEnviar.push(resultado.midia);
        }
        if (typeof conteudoTool === 'string' && conteudoTool.includes('ACTION:HANDOFF:')) {
          handoffForcado = conteudoTool.split('ACTION:HANDOFF:')[1].split('\n')[0].trim();
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: conteudoTool,
        });
      }

      conversaAcumulada.push({ role: 'assistant', content: response.content });
      conversaAcumulada.push({ role: 'user', content: toolResults });
      response = await chamarModelo();
      continue;
    }

    const textoBruto = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!jaEscalou && textoBruto.includes('ACTION:ESCALATE')) {
      console.log('[IA] Escalando de Haiku para Sonnet');
      jaEscalou = true;
      modelo = MODELO_COMPLETO;
      response = await chamarModelo();
      continue;
    }
    break;
  }

  // 7. Extrai texto final (ignora blocos de tool_use residuais)
  const texto = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // 8. Extrai TAG automática (só presente na primeira mensagem)
  let tag = null;
  let textoLimpo = paraFormatacaoWhatsapp(texto);
  // Defesa: só o Haiku deveria escrever isso, mas se escapar (ex: o Sonnet
  // ecoou a instrução) não pode vazar pro cliente.
  textoLimpo = textoLimpo.replace(/\s*ACTION:ESCALATE\s*/g, ' ').trim();
  const tagMatch = textoLimpo.match(/\nTAG:(.+)$/m);
  if (tagMatch) {
    const candidata = tagMatch[1].trim();
    if (TAGS_VALIDAS.includes(candidata)) tag = candidata;
    textoLimpo = textoLimpo.replace(tagMatch[0], '').trim();
  }

  // 9. Detecta handoff
  if (textoLimpo.includes('ACTION:HANDOFF:')) {
    const motivo = textoLimpo.split('ACTION:HANDOFF:')[1].split('\n')[0].trim();
    return {
      resposta: textoLimpo.split('ACTION:HANDOFF:')[0].trim(),
      devePelearHumano: true,
      motivo,
      tag,
      midias: midiasParaEnviar,
    };
  }

  if (handoffForcado) {
    return {
      resposta: textoLimpo,
      devePelearHumano: true,
      motivo: handoffForcado,
      tag,
      midias: midiasParaEnviar,
    };
  }

  return { resposta: textoLimpo, devePelearHumano: false, tag, midias: midiasParaEnviar };
}

// Sugere uma resposta para o atendente revisar antes de enviar. Diferente de
// processarMensagem: não usa ferramentas, não classifica, não transfere e nada
// é enviado ao cliente — devolve só o texto, que o atendente edita à vontade.
export async function sugerirResposta(tenant, conversa, historico, clienteWhatsapp) {
  const contextoSgp = await buscarContextoSgp(tenant, clienteWhatsapp);
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
  });

  const systemPrompt = `${tenant.systemPrompt || ''}

DATA E HORA ATUAL: ${agora} (horário de Brasília).

${contextoSgp}

VOCÊ ESTÁ SUGERINDO UMA RESPOSTA PARA UM ATENDENTE HUMANO:
- Escreva a mensagem pronta para ser enviada ao cliente, na primeira pessoa do provedor.
- Devolva SOMENTE o texto da mensagem: sem saudação de sistema, sem aspas, sem explicação, sem "sugestão:".
- Nunca escreva ACTION:HANDOFF nem TAG: — quem decide transferir é o atendente.
- Use apenas os dados do sistema acima; não invente valor, prazo, data nem código de pagamento.
- Se faltar informação para responder com segurança, escreva uma resposta que peça o dado que falta.
- Tom cordial e direto, no máximo 3 parágrafos curtos.
- Negrito do WhatsApp é com um asterisco só: *assim*.

PROVEDOR: ${tenant.nome}`;

  // Só o histórico recente, e mensagens de sistema fora — elas confundem quem
  // está falando com quem.
  const msgs = historico
    .filter(m => !m.conteudo.startsWith('[Sistema]') && m.origem !== 'nota')
    .slice(-12)
    .map(m => ({
      role: m.origem === 'cliente' ? 'user' : 'assistant',
      content: m.conteudo,
    }));

  // A Anthropic exige alternância de papéis e início pelo usuário
  const conversaAcumulada = msgs.reduce((acc, msg) => {
    const ultimo = acc[acc.length - 1];
    if (ultimo && ultimo.role === msg.role) ultimo.content += '\n' + msg.content;
    else acc.push({ ...msg });
    return acc;
  }, []);
  while (conversaAcumulada.length && conversaAcumulada[0].role !== 'user') conversaAcumulada.shift();

  if (!conversaAcumulada.length) {
    throw new Error('Não há mensagem do cliente para basear a sugestão.');
  }

  const resposta = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: systemPrompt,
    messages: conversaAcumulada,
  });

  const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

  // Cinto e suspensório: se o modelo escorregar e devolver as marcações, elas
  // não podem chegar ao campo de texto do atendente.
  return paraFormatacaoWhatsapp(
    texto.split('ACTION:HANDOFF:')[0].replace(/\nTAG:.+$/m, '').trim()
  );
}
