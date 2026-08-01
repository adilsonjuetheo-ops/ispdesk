import Anthropic from '@anthropic-ai/sdk';
import { buscarContextoSgp, getTools, executarTool } from './sgp.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

export async function processarMensagem(tenant, conversa, historico, novaMensagem, clienteWhatsapp, midiaData = null) {
  // Classifica até ter uma tag específica (não "Outros" e não vazia)
  const tagAtual = Array.isArray(conversa.tags) ? conversa.tags[0] : null;
  const precisaClassificar = !tagAtual || tagAtual === 'Outros';

  // 1. Busca dados do cliente no SGP em tempo real
  const contextoSgp = await buscarContextoSgp(tenant, clienteWhatsapp);

  // 2. System prompt com contexto SGP injetado
  const temSgp = !!(tenant.sgpTipo && tenant.sgpApiKey);
  const systemPrompt = `${tenant.systemPrompt || ''}

${contextoSgp}

INSTRUÇÕES IMPORTANTES:
- Se o cliente pedir para falar com humano: diga que vai transferir e escreva ACTION:HANDOFF:solicitado pelo cliente
- Se não conseguir resolver o problema: escreva ACTION:HANDOFF:motivo detalhado
${temSgp ? `- Use apenas os dados fornecidos pelo SGP acima. Nunca invente informações.
- Nunca diga que vai "verificar" — você já tem os dados, use-os diretamente.
- Ao enviar 2ª via, cole o PIX ou linha digitável completo na mensagem.
- Se o cliente NÃO for encontrado pelo número de WhatsApp: peça APENAS o CPF ou CNPJ para localizá-lo no sistema.
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

  // 6. Loop: chama Claude → executa tools → chama novamente até parar
  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    ...(tools.length > 0 && { tools }),
    messages: conversaAcumulada,
  });

  while (response.stop_reason === 'tool_use') {
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
          const novosIds = extrairIdsAutorizados(resultado);
          novosIds.idsCliente.forEach(id => idsAutorizados.idsCliente.add(id));
          novosIds.idsContrato.forEach(id => idsAutorizados.idsContrato.add(id));
        }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: resultado,
      });
    }

    conversaAcumulada.push({ role: 'assistant', content: response.content });
    conversaAcumulada.push({ role: 'user', content: toolResults });

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      ...(tools.length > 0 && { tools }),
      messages: conversaAcumulada,
    });
  }

  // 7. Extrai texto final (ignora blocos de tool_use residuais)
  const texto = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // 8. Extrai TAG automática (só presente na primeira mensagem)
  let tag = null;
  let textoLimpo = texto;
  const tagMatch = texto.match(/\nTAG:(.+)$/m);
  if (tagMatch) {
    const candidata = tagMatch[1].trim();
    if (TAGS_VALIDAS.includes(candidata)) tag = candidata;
    textoLimpo = texto.replace(tagMatch[0], '').trim();
  }

  // 9. Detecta handoff
  if (textoLimpo.includes('ACTION:HANDOFF:')) {
    const motivo = textoLimpo.split('ACTION:HANDOFF:')[1].split('\n')[0].trim();
    return {
      resposta: textoLimpo.split('ACTION:HANDOFF:')[0].trim(),
      devePelearHumano: true,
      motivo,
      tag,
    };
  }

  return { resposta: textoLimpo, devePelearHumano: false, tag };
}
