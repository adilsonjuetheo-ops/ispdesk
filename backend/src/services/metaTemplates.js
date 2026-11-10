const GRAPH = 'https://graph.facebook.com/v19.0';

// Leitura e edição dos templates aprovados, direto na API de gerenciamento da
// Meta. Editar não é criar: um template aprovado aceita edição (até 10 por mês,
// uma a cada 24h) e volta pra análise mantendo o mesmo nome — quem já usa o
// nome no código não precisa saber de nada.
//
// Isso existe pra não depender do WhatsApp Manager a cada provedor novo: a
// conversão do lembrete pro formato com botão de pagamento é a mesma edição
// repetida em todo mundo.

async function graph(url, tenant, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenant.whatsappToken}`,
      ...init.headers,
    },
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.error) {
    const msg = dados?.error?.error_user_msg || dados?.error?.message || `HTTP ${res.status}`;
    const erro = new Error(msg);
    erro.codigoMeta = dados?.error?.code ?? null;
    throw erro;
  }
  return dados;
}

export async function listarTemplates(tenant) {
  if (!tenant?.wabaId)        throw new Error('Provedor sem WABA conectada.');
  if (!tenant?.whatsappToken) throw new Error('Provedor sem token do WhatsApp.');

  const campos = 'id,name,status,category,language,components,rejected_reason';
  const url = `${GRAPH}/${tenant.wabaId}/message_templates?fields=${campos}&limit=100`;
  const dados = await graph(url, tenant);
  return dados.data || [];
}

// A Meta identifica a edição pelo id do template, e cada idioma é um id
// diferente — o nome sozinho não basta.
export async function editarTemplate(tenant, templateId, componentes) {
  if (!tenant?.whatsappToken) throw new Error('Provedor sem token do WhatsApp.');

  return graph(`${GRAPH}/${templateId}`, tenant, {
    method: 'POST',
    body: JSON.stringify({ components: componentes }),
  });
}

// Monta os componentes do lembrete no formato com botão de pagamento.
//
// O corpo perde a variável do código de pagamento e passa a terminar na {{4}};
// o link da página vai no botão, com a variável no fim da URL (a Meta só
// aceita sufixo dinâmico, não um pedaço no meio).
export function componentesComBotaoPagamento(componentesAtuais, { corpo, baseUrl, textoBotao = 'Pagar agora' }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new Error('A URL da página de pagamento precisa começar com https://');
  }

  const preservados = (componentesAtuais || []).filter(
    c => c.type === 'HEADER' || c.type === 'FOOTER'
  );

  return [
    ...preservados,
    { type: 'BODY', text: corpo, example: { body_text: [['Maria Silva', 'Mensalidade', '89,90', '25/09/2026']] } },
    {
      type: 'BUTTONS',
      buttons: [{
        type: 'URL',
        text: textoBotao,
        url: `${base}/p/{{1}}`,
        example: [`${base}/p/a1b2c3d4e5f6g7h8`],
      }],
    },
  ];
}

// Tira do corpo a linha que carregava o código de pagamento, pra ele caber no
// formato de 4 variáveis. Mexe só no que tem {{5}}: o resto do texto é do
// provedor e já passou por aprovação, não é nosso pra reescrever.
export function corpoSemVariavelPagamento(texto) {
  const linhas = String(texto || '').split('\n');
  const limpas = linhas.filter(l => !l.includes('{{5}}'));

  // Tirar a linha costuma deixar duas quebras seguidas no lugar dela.
  return limpas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Descobre, na Meta, se os templates de lembrete do provedor já estão no
// formato com botão de pagamento.
//
// Existe porque a aprovação é assíncrona e fora do nosso controle: no instante
// em que a Meta aprova, o template passa a ter 4 variáveis e um botão, e um
// envio no formato antigo quebra com "number of parameters does not match" —
// de madrugada, no cron, sem ninguém olhando. Perguntar uma vez por varredura
// é uma chamada por provedor por dia, e tira a quebra da mesa.
//
// Devolve null quando não deu pra saber (sem WABA, sem token, Meta fora do
// ar). Null não é "não": quem chama continua com o que estava gravado.
export async function detectarFormatoBotao(tenant, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const nomes = [tenant?.lembreteFaturaTemplatePre, tenant?.lembreteFaturaTemplatePos].filter(Boolean);
  if (!base || !nomes.length || !tenant?.wabaId || !tenant?.whatsappToken) return null;

  try {
    const lista = await listarTemplates(tenant);
    const usados = nomes.map(n => lista.find(t => t.name === n)).filter(Boolean);
    if (usados.length !== nomes.length) return null;

    // Só vale como "formato novo" se TODOS estiverem aprovados e com o botão.
    // Com um só convertido, o outro ainda espera 5 variáveis.
    return usados.every(t => {
      if (t.status !== 'APPROVED') return false;
      const botoes = (t.components || []).find(c => c.type === 'BUTTONS')?.buttons || [];
      return botoes.some(b => b.type === 'URL' && String(b.url || '').startsWith(`${base}/p/`));
    });
  } catch (err) {
    console.warn('[templates] Não deu pra conferir o formato na Meta:', err.message);
    return null;
  }
}
