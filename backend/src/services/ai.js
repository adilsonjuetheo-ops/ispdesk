import Anthropic from '@anthropic-ai/sdk';
import { buscarContextoSgp, buscarContextoPorDocumentoSgp, getTools, executarTool } from './sgp.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku atende sozinho a maior parte da conversa (consulta, 2ª via,
// desbloqueio, dúvidas comuns) por uma fração do custo do Sonnet. Quando o
// próprio modelo sinaliza que o caso é incomum (ACTION:ESCALATE), a mesma
// conversa — já com qualquer tool já executada — continua no Sonnet.
const MODELO_RAPIDO = 'claude-haiku-4-5-20251001';
const MODELO_COMPLETO = 'claude-sonnet-4-6';

// clienteWhatsapp: número do remetente vindo direto do payload do webhook
const TAGS_VALIDAS = ['Financeiro','Sem Conexão','Lentidão','Mudança de Endereço','Cancelamento','Nova Contratação','Problema no Roteador','Segunda Via','Outros'];

// Calcula a saudação certa em código em vez de pedir pro modelo somar hora —
// pedir pra ele ler "09:09" num texto de data por extenso e decidir "bom dia"
// é fácil de errar (o Haiku já mandou "boa noite" às 9h da manhã). hourCycle
// h23 evita a meia-noite virar "24" que hour12:false às vezes produz.
function saudacaoAtual() {
  const hora = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23',
  }).format(new Date()));
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

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

  // 1. Busca dados do cliente no SGP em tempo real.
  //
  // Se o cliente já provou quem é com CPF/CNPJ antes nesta conversa, a consulta
  // sai por esse documento, não pelo telefone. Sem isso, cada mensagem
  // recomeçava do zero: para quem tem o WhatsApp não vinculado no SGP, o
  // telefone não acha nada, o contexto vem sem ID_INTERNO, toda tool fica
  // bloqueada — e o bot, sem entender o bloqueio, pedia o documento de novo e
  // depois o "ID do cliente", que o cliente não tem como saber.
  let documentoValidado = conversa.documentoValidado || null;
  const contextoSgp = documentoValidado
    ? await buscarContextoPorDocumentoSgp(tenant, documentoValidado)
    : await buscarContextoSgp(tenant, clienteWhatsapp);

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

DATA E HORA ATUAL: ${agora} (horário de Brasília). Use isso para contextualizar qualquer referência a datas. Se for cumprimentar o cliente, use exatamente "${saudacaoAtual()}" — não calcule por conta própria a partir da hora acima.

${contextoSgp}
${blocoForaHorario}
ABERTURA DA CONVERSA:
- Boa parte dos clientes abre a conversa só com uma saudação, um emoji ou algo sem pedido nenhum — "oi", "boa noite", "👍". Nesses casos não responda apenas "como posso ajudar?": quem escreve assim quase sempre não sabe o que dá para resolver por aqui.
- Cumprimente (pelo nome, se você souber), diga numa frase curta o que você resolve na hora e termine perguntando o que a pessoa precisa. Cite apenas o que você realmente consegue fazer com as ferramentas que tem — nunca prometa nada fora do seu alcance.
- Escreva em texto corrido, como gente. Nada de lista numerada, menu ou "digite 1": isso é conversa, não formulário.
- Vale só para a abertura. Se o cliente já disse o que quer, vá direto ao ponto sem se apresentar.

INSTRUÇÕES IMPORTANTES:
- Se o cliente pedir para falar com humano: diga que vai transferir e escreva ACTION:HANDOFF:solicitado pelo cliente
- Se não conseguir resolver o problema: escreva ACTION:HANDOFF:motivo detalhado
- Se a situação for incomum e exigir julgamento mais cuidadoso (reclamação grave, negociação fora do script, ambiguidade real) e você não estiver seguro de como agir: não adivinhe nem transfira ainda — escreva sozinho, sem mais nada, ACTION:ESCALATE. Isso pede uma segunda opinião antes de responder ao cliente, não é o mesmo que transferir para um humano. Não use para o dia a dia — consulta, 2ª via, desbloqueio e dúvidas comuns você resolve normalmente.
${temSgp ? `- Use apenas os dados fornecidos pelo SGP acima. Nunca invente informações.
- Nunca diga que vai "verificar" — você já tem os dados, use-os diretamente.
- Ao enviar 2ª via, cole o PIX ou linha digitável completo na mensagem. Só prometa o PDF do boleto se o resultado da ferramenta disser que ele será enviado — nunca anuncie um arquivo que não vai chegar.
- Se não houver fatura vencida mas o contexto do SGP mostrar uma "PRÓXIMA FATURA" (ainda não vencida) e o cliente quiser pagar, adiantar ou pedir o código de pagamento mesmo assim: use enviar_segunda_via normalmente — a ferramenta traz a fatura em aberto mais próxima, vencida ou não. Só diga que "não há nada a pagar" quando o SGP não mostrar nenhuma fatura, nem vencida nem próxima.
${tenant.exigirDocumento
  ? `- Este provedor NÃO identifica clientes pelo número de WhatsApp. Na primeira demanda que exija dados do cliente, peça o CPF ou CNPJ do titular — mesmo que o cliente já tenha conversado antes.
- Só prossiga com consultas, 2ª via ou desbloqueio depois de validar o cliente pelo CPF/CNPJ.`
  : '- Se o cliente NÃO for encontrado pelo número de WhatsApp: peça APENAS o CPF ou CNPJ para localizá-lo no sistema.'}
- Ao receber o CPF ou CNPJ: use a ferramenta buscar_por_documento imediatamente.
- Se o cliente NÃO for encontrado mesmo com CPF/CNPJ (cliente novo): informe que vai transferir para um atendente realizar o cadastro e escreva ACTION:HANDOFF:cliente novo — encaminhar para cadastro
- NUNCA envie formulários de cadastro — isso é responsabilidade exclusiva do atendente humano.` : ''}

IMAGENS E DOCUMENTOS:
- Quando o cliente enviar uma imagem ou PDF, você consegue visualizar o conteúdo diretamente.
- COMPROVANTE DE PAGAMENTO — o tratamento depende de COMO o cliente pagou:
  - Pelo PIX copia e cola ou boleto que o provedor enviou: o sistema concilia sozinho. Agradeça normalmente e diga que a baixa aparece em instantes. NÃO transfira.
  - Por PIX na chave, transferência ou depósito avulso: isso não entra sozinho no sistema. Agradeça, avise que a equipe vai localizar e dar baixa, e TRANSFIRA escrevendo ACTION:HANDOFF:comprovante de pagamento avulso — dar baixa manual.
  - ANTES de transferir por comprovante, olhe os dados do SGP acima: se o contrato está ativo, o acesso não está bloqueado e NÃO há fatura vencida em aberto, não há o que a equipe resolver. Nesse caso agradeça, confirme que está tudo em dia e a próxima fatura, e NÃO transfira. Só transfira quando houver de fato uma pendência que o pagamento resolva — fatura vencida em aberto ou acesso bloqueado.
  - Na dúvida sobre a forma de pagamento, havendo pendência em aberto, trate como avulso e transfira.
- Você NUNCA declara dívida quitada nem dá baixa. Não diga que o pagamento "já cobre", "regulariza" ou "resolve" a pendência — quem confirma é o sistema ou a equipe.
- NUNCA some, subtraia ou compare valores para concluir algo sobre a situação financeira, e NUNCA diga que o cliente ficará com crédito, sobra ou troco com o provedor.
- Sobre faturas, repita apenas o que está nos dados acima: vencimento, valor e código de pagamento. Não invente quantidade de títulos nem saldo consolidado.

BOTÃO DE SIM/NÃO:
- Quando terminar a mensagem perguntando se o cliente quer que você desbloqueie/reative a internet dele, escreva na última linha: ACTION:SIMNAO
- Só nesse caso. Em qualquer outra pergunta, não escreva isso — o cliente responde escrevendo, como sempre.
- Escreva a pergunta normalmente antes do marcador; ele só acrescenta os botões, não substitui o texto.
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
      // A identificação vem primeiro. O modelo às vezes pede o documento e a 2ª
      // via no mesmo turno, e nessa ordem o enviar_segunda_via era avaliado
      // antes de o documento autorizar os IDs — bloqueado por engano. Os
      // resultados voltam reordenados para o modelo, o que a API aceita: cada um
      // é casado pelo tool_use_id, não pela posição.
      const ordenados = [...toolBlocks].sort((a, b) =>
        (a.name === 'buscar_por_documento' ? 0 : 1) - (b.name === 'buscar_por_documento' ? 0 : 1));
      for (const toolBlock of ordenados) {
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
            // Só vale como validado se o SGP devolveu ID_INTERNO. "Cliente não
            // encontrado" não pode gravar documento nenhum, senão a conversa
            // ficaria presa a um CPF errado até o fim.
            if (novosIds.idsCliente.size) {
              const doc = String(toolBlock.input?.documento || '').replace(/\D/g, '');
              if (doc) documentoValidado = doc;
            }
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

  // 9. Botões de sim/não no fechamento. Tirado do texto antes de qualquer
  // outra coisa: se escapasse, o cliente leria "ACTION:SIMNAO" na conversa.
  let botoes = null;
  if (textoLimpo.includes('ACTION:SIMNAO')) {
    textoLimpo = textoLimpo.replace(/\s*ACTION:SIMNAO\s*/g, ' ').trim();
    botoes = [
      { id: 'sim_reativar', titulo: 'Sim, reativar' },
      { id: 'nao_obrigado', titulo: 'Não, obrigado' },
    ];
  }

  // 10. Detecta handoff
  if (textoLimpo.includes('ACTION:HANDOFF:')) {
    const motivo = textoLimpo.split('ACTION:HANDOFF:')[1].split('\n')[0].trim();
    return {
      resposta: textoLimpo.split('ACTION:HANDOFF:')[0].trim(),
      devePelearHumano: true,
      motivo,
      tag,
      documentoValidado,
      midias: midiasParaEnviar,
    };
  }

  if (handoffForcado) {
    return {
      resposta: textoLimpo,
      devePelearHumano: true,
      motivo: handoffForcado,
      tag,
      documentoValidado,
      midias: midiasParaEnviar,
    };
  }

  return { resposta: textoLimpo, devePelearHumano: false, tag, midias: midiasParaEnviar, botoes, documentoValidado };
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

DATA E HORA ATUAL: ${agora} (horário de Brasília). Se a sugestão abrir com cumprimento, use exatamente "${saudacaoAtual()}" — não calcule por conta própria a partir da hora acima.

${contextoSgp}

VOCÊ ESTÁ SUGERINDO UMA RESPOSTA PARA UM ATENDENTE HUMANO:
- Escreva a mensagem pronta para ser enviada ao cliente, na primeira pessoa do provedor.
- Devolva SOMENTE o texto da mensagem: sem saudação de sistema, sem aspas, sem explicação, sem "sugestão:".
- Nunca escreva ACTION:HANDOFF nem TAG: — quem decide transferir é o atendente.
- Use apenas os dados do sistema acima; não invente valor, prazo, data nem código de pagamento.
- Nunca confirme pagamento, nunca declare dívida quitada e nunca mencione crédito, sobra ou troco: quem confere e dá baixa é o atendente.
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
