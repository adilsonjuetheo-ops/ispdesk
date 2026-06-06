import Anthropic from '@anthropic-ai/sdk';
import { buscarContextoSgp, getTools, executarTool } from './sgp.js';
import { FORMULARIO_CADASTRO } from '../constants/formularios.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// clienteWhatsapp: número do remetente vindo direto do payload do webhook
export async function processarMensagem(tenant, conversa, historico, novaMensagem, clienteWhatsapp) {

  // 1. Busca dados do cliente no SGP em tempo real
  const contextoSgp = await buscarContextoSgp(tenant, clienteWhatsapp);

  // 2. System prompt com contexto SGP injetado
  const systemPrompt = `${tenant.systemPrompt}

${contextoSgp}

INSTRUÇÕES IMPORTANTES:
- Use apenas os dados fornecidos acima. Nunca invente informações.
- Se o cliente pedir para falar com humano: diga que vai transferir e escreva ACTION:HANDOFF:solicitado pelo cliente
- Se não conseguir resolver após usar as ferramentas: escreva ACTION:HANDOFF:motivo detalhado
- Nunca diga que vai "verificar" — você já tem os dados, use-os diretamente.
- Ao enviar 2ª via, cole o PIX ou linha digitável completo na mensagem.
- Se o cliente solicitar instalação ou contratar um plano e NÃO houver dados cadastrais dele (cliente sem contrato no sistema), envie exatamente o formulário abaixo e aguarde o preenchimento:

${FORMULARIO_CADASTRO}

PROVEDOR: ${tenant.nome}
ASSISTENTE: ${tenant.nomeAssistente}`;

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

  // 5. Conversa acumulada para o loop de tool_use
  const conversaAcumulada = [
    ...msgs,
    { role: 'user', content: novaMensagem },
  ];

  // 6. Loop: chama Claude → executa tools → chama novamente até parar
  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
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

  // 8. Detecta handoff
  if (texto.includes('ACTION:HANDOFF:')) {
    const motivo = texto.split('ACTION:HANDOFF:')[1].split('\n')[0].trim();
    return {
      resposta: texto.split('ACTION:HANDOFF:')[0].trim(),
      devePelearHumano: true,
      motivo,
    };
  }

  return { resposta: texto, devePelearHumano: false };
}
