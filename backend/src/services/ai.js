import Anthropic from '@anthropic-ai/sdk';
import { buscarContextoSgp, getTools, executarTool } from './sgp.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// clienteWhatsapp: número do remetente vindo direto do payload do webhook
const TAGS_VALIDAS = ['Suporte Técnico','Cobrança','Cancelamento','Instalação','Velocidade','Sem Sinal','Mudança de Plano','Outros'];

export async function processarMensagem(tenant, conversa, historico, novaMensagem, clienteWhatsapp) {
  const primeiraMsg = historico.filter(m => m.origem === 'cliente').length <= 1;

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
${primeiraMsg ? `- Na PRIMEIRA mensagem do cliente, identifique o assunto principal e inclua ao final da resposta (linha separada): TAG:categoria — onde categoria é exatamente uma de: ${TAGS_VALIDAS.join(', ')}.` : ''}

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
    const toolBlock = response.content.find(b => b.type === 'tool_use');
    if (!toolBlock) break;

    console.log(`[IA] Tool: ${toolBlock.name}`, toolBlock.input);
    const resultado = await executarTool(toolBlock.name, toolBlock.input, tenant);
    console.log(`[IA] Resultado: ${resultado}`);

    conversaAcumulada.push({ role: 'assistant', content: response.content });
    conversaAcumulada.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: resultado,
      }],
    });

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
