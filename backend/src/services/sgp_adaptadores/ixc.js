import { SgpAdaptador } from './base.js';

// O IXC costuma responder em menos de 2s; acima disso a conversa no WhatsApp
// já travou. Sem teto, uma instância lenta seguraria o webhook indefinidamente.
const TIMEOUT_MS = 15000;

// Status de cliente_contrato: A ativo, P pré-contrato, N negativado, I inativo
// (é como o IXC deixa o contrato cancelado), D desistiu. Negativado ainda deve.
const STATUS_CONTRATO_ENCERRADO = new Set(['I', 'D']);

// Status de chamado no IXC. O código cru não diz nada para quem atende, e a
// lista é maior do que "aberto ou fechado" — era por isso que o chamado novo
// sumia de uma tela que só mostrava 'A'.
const STATUS_CHAMADO = {
  A: 'Aberto',
  N: 'Novo',
  AN: 'Em análise',
  EN: 'Encaminhado',
  AS: 'Assumido',
  DS: 'Em deslocamento',
  EX: 'Em execução',
  AG: 'Agendado',
  RAG: 'Reagendar',
  F: 'Finalizado',
  C: 'Cancelado',
};

const AVISO_SEM_TECNICO =
  'Aberto sem técnico: o colaborador escolhido não está vinculado ao setor desta O.S. no IXC. Atribua por lá.';

export class IxcAdaptador extends SgpAdaptador {

  #urlValidada = null;

  #headers(ixcsoft) {
    const encoded = Buffer.from(this.apiKey).toString('base64');
    const h = {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
    };
    if (ixcsoft) h.ixcsoft = ixcsoft;
    return h;
  }

  // A validação faz resolução de DNS; uma busca chega a disparar várias
  // consultas, então guardamos o resultado por instância.
  async #url(recurso) {
    this.#urlValidada ||= await this.validarApiUrl();
    const base = this.#urlValidada.toString().replace(/\/$/, '');
    return new URL(`webservice/v1/${recurso}`, `${base}/`).toString();
  }

  // Consulta: o IXC exige POST com header ixcsoft:listar e todos os valores como
  // string. Query params em GET são ignorados pelo webservice.
  async #listar(recurso, params = {}) {
    const body = {
      page: '1',
      rp: '20',
      sortname: `${recurso}.id`,
      sortorder: 'asc',
      ...params,
    };
    for (const [k, v] of Object.entries(body)) {
      if (v == null) delete body[k];
      else body[k] = String(v);
    }

    const res = await fetch(await this.#url(recurso), {
      method: 'POST',
      headers: this.#headers('listar'),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status} em ${recurso}`);

    const data = await res.json();
    if (data?.type === 'error') throw new Error(`IXC ${recurso}: ${data.message}`);
    return data;
  }

  // Gravação: POST sem o header ixcsoft.
  // Gravação vai em formulário, não em JSON.
  //
  // Esta linha custou uma tarde. A listagem aceita JSON, então o insert parecia
  // aceitar também — e aceitava: respondia "Registro inserido com sucesso" com
  // um id, sem gravar nada. O corpo JSON simplesmente não era lido, e o IXC
  // inseria um registro vazio que a própria validação dele descartava depois.
  // Com form-urlencoded os campos chegam e os erros viram específicos.
  async #inserir(recurso, body = {}) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) form.append(k, String(v));
    }

    const corpo = form.toString();
    const res = await fetch(await this.#url(recurso), {
      method: 'POST',
      headers: { ...this.#headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status} em ${recurso}`);

    const json = await res.json();
    // O corpo enviado volta junto para o chamador poder registrar quando o
    // IXC disser que gravou e não tiver gravado. Sem isso, a diferença entre
    // o que funciona no curl e o que o app manda fica invisível.
    Object.defineProperty(json, '__corpoEnviado', { value: corpo, enumerable: false });
    return json;
  }

  // O boleto em PDF sai por POST autenticado — não há URL pública que sirva de
  // anexo (o gateway_link da fatura devolve a página de pagamento em HTML).
  // Sem tipo_boleto=arquivo o IXC responde 200 com corpo vazio.
  async #baixarBoleto(idFatura) {
    const res = await fetch(await this.#url('get_boleto'), {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        boletos: String(idFatura),
        juro: 'N',
        multa: 'N',
        atualiza_boleto: 'N',
        tipo_boleto: 'arquivo',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Fatura inexistente ou sem boleto gerado devolve corpo vazio/HTML.
    if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') return null;
    return buffer;
  }

  // O PIX copia-e-cola não vem no registro da fatura: exige chamada dedicada.
  async #buscarPix(idAreceber) {
    const res = await fetch(await this.#url('get_pix'), {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ id_areceber: String(idAreceber) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.pix?.dadosPix?.pixCopiaECola || data?.pix?.qrCode?.qrcode || null;
  }

  // O IXC grava telefone formatado — "(33) 99952-8928". Como o WhatsApp entrega
  // só dígitos e o 9º dígito varia, geramos as duas grafias possíveis.
  #variantesTelefone(whatsapp) {
    const digitos = this.normalizarTelefone(whatsapp);
    if (digitos.length < 10) return [];

    const ddd = digitos.slice(0, 2);
    const numero = digitos.slice(2);
    const formatar = n => n.length === 9
      ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`
      : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;

    const variantes = new Set([formatar(numero)]);
    if (numero.length === 8) variantes.add(formatar(`9${numero}`));
    if (numero.length === 9 && numero.startsWith('9')) variantes.add(formatar(numero.slice(1)));
    return [...variantes];
  }

  // Erros de rede NÃO viram "não encontrado": se a consulta falhar, propagamos
  // para o chamador avisar que o sistema está indisponível. Dizer ao cliente
  // que ele não tem cadastro quando a API caiu é pior do que não responder.
  async #buscarClientePorTelefone(whatsapp) {
    for (const campo of ['cliente.telefone_celular', 'cliente.whatsapp']) {
      for (const tel of this.#variantesTelefone(whatsapp)) {
        const data = await this.#listar('cliente', {
          qtype: campo,
          query: tel,
          oper: '=',
          rp: '1',
        });
        if (data?.registros?.length) return data.registros[0];
      }
    }
    return null;
  }

  // O cadastro guarda a cidade como ID; a IA precisa do nome.
  async #nomeCidade(id) {
    if (!id || !/^\d+$/.test(String(id))) return id || null;
    const data = await this.#listar('cidade', {
      qtype: 'cidade.id',
      query: id,
      oper: '=',
      rp: '1',
    }).catch(() => null);
    return data?.registros?.[0]?.nome || null;
  }

  // A sigla do estado, que entra na linha de endereço da O.S.
  async #siglaUf(id) {
    if (!id || !/^\d+$/.test(String(id))) return null;
    const data = await this.#listar('uf', {
      qtype: 'uf.id', query: String(id), oper: '=', rp: '1',
    }).catch(() => null);
    const r = data?.registros?.[0];
    return r?.uf || r?.sigla || null;
  }

  // O endereço da visita, montado como o IXC monta na tela dele.
  //
  // A API não compõe esse campo: gravando por aqui com origem no contrato, a
  // O.S. nasce com contrato e login preenchidos e o endereço em branco — o
  // técnico recebe a ordem sem saber para onde ir. Foi o que aconteceu com os
  // chamados 6331, 6332, 6336 e 6337.
  //
  // O formato sai de uma O.S. que o próprio IXC gerou (a 6324):
  //   "MG Araçuaí 39600-000 CANOEIRO - RUA FRANKLIN FULGENCIO, 529"
  //   ou seja: UF cidade CEP bairro - logradouro, número
  // Os contratos daqui têm `endereco_padrao_cliente = 'S'` e os próprios
  // campos vazios, então a fonte é o cadastro do cliente, não o do contrato.
  //
  // Cada pedaço entra só se existir: cliente sem complemento não deve virar
  // "RUA X, 10 - " com sobra de pontuação.
  async #enderecoDaOs(cliente) {
    const [cidade, uf] = await Promise.all([
      this.#nomeCidade(cliente.cidade).catch(() => null),
      this.#siglaUf(cliente.uf).catch(() => null),
    ]);

    const regiao = [uf, cidade, cliente.cep, cliente.bairro].filter(Boolean).join(' ');
    const rua = [cliente.endereco, cliente.numero].filter(Boolean).join(', ');
    const linha = [regiao, rua].filter(Boolean).join(' - ');

    const campos = {
      endereco: linha,
      bairro: cliente.bairro,
      complemento: cliente.complemento,
      // O ponto de referência costuma ser a única pista em zona rural, onde
      // rua e número não levam ninguém a lugar nenhum.
      referencia: cliente.referencia,
      latitude: cliente.latitude,
      longitude: cliente.longitude,
    };
    return Object.fromEntries(
      Object.entries(campos).filter(([, v]) => String(v || '').trim())
    );
  }

  // Monta contexto completo a partir do registro de cliente já buscado
  async #buildContexto(c) {
    const contratos = (await this.#contratosDoCliente(c.id)) || [];

    const contratoAtivo =
      contratos.find(ct => ct.status === 'A') ||
      contratos[0];

    // faturas === null significa que a consulta falhou. Não dá para tratar isso
    // como "sem débito": o bot afirmaria que um inadimplente está em dia e ainda
    // ofereceria desbloqueio.
    //
    // rp maior que o necessário de propósito: o filtro de contrato encerrado
    // roda depois, e com 10 as faturas do contrato atual podiam ficar de fora
    // da página atrás das do cancelado.
    let faturas = null;
    try {
      const fatData = await this.#listar('fn_areceber', {
        qtype: 'fn_areceber.id_cliente',
        query: c.id,
        oper: '=',
        rp: '50',
        sortname: 'fn_areceber.data_vencimento',
        sortorder: 'asc',
        grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
      });
      faturas = await this.#semContratoEncerrado(fatData.registros || []);
    } catch (err) {
      console.error(`[IXC] Falha ao consultar faturas do cliente ${c.id}:`, err.message);
    }

    const hoje = new Date();
    const vencidas = (faturas || []).filter(f => new Date(f.data_vencimento) < hoje);
    const aVencer  = (faturas || []).filter(f => new Date(f.data_vencimento) >= hoje);

    const cidade = await this.#nomeCidade(c.cidade).catch(() => null);
    const internetAtiva = contratoAtivo?.status_internet === 'A';

    const linhas = [
      '=== DADOS DO CLIENTE (IXC Soft) ===',
      `Nome: ${c.razao}`,
      `ID: ${c.id} | CPF/CNPJ: ${c.cnpj_cpf}`,
      `Status do contrato: ${contratoAtivo?.status === 'A' ? 'Ativo' : 'Inativo/Cancelado'}`,
      `Internet: ${internetAtiva ? 'Liberada' : 'Bloqueada'}`,
      `Plano: ${contratoAtivo?.contrato || 'não identificado'}`,
      `Cidade: ${cidade || 'não informada'}`,
      '',
    ];

    if (vencidas.length > 0) {
      linhas.push(`FATURAS VENCIDAS (${vencidas.length}):`);
      vencidas.forEach(f => {
        linhas.push(
          `  Vencto ${this.formatarData(f.data_vencimento)} | ${this.formatarMoeda(f.valor)}` +
          (f.linha_digitavel ? ' | Boleto disponível' : '')
        );
      });
      linhas.push('');
    }

    if (aVencer.length > 0) {
      const prox = aVencer[0];
      linhas.push(
        `PRÓXIMA FATURA: ${this.formatarData(prox.data_vencimento)} | ${this.formatarMoeda(prox.valor)}` +
        (prox.linha_digitavel ? ' | Boleto disponível' : '')
      );
      linhas.push('');
    }

    if (faturas === null) {
      linhas.push('FINANCEIRO: não foi possível consultar as faturas agora (falha no sistema do provedor).');
      linhas.push('');
    } else if (faturas.length === 0) {
      linhas.push('FINANCEIRO: Sem faturas em aberto.');
      linhas.push('');
    }

    linhas.push('=== REGRA DE DESBLOQUEIO ===');
    if (faturas === null) {
      linhas.push(
        'Situação financeira desconhecida — a consulta falhou. NÃO afirme que o cliente está em dia, ' +
        'NÃO ofereça 2ª via e NÃO ofereça desbloqueio. Se o assunto for financeiro ou bloqueio, ' +
        'escreva ACTION:HANDOFF:consulta financeira indisponível no IXC'
      );
    } else if (vencidas.length === 0) {
      linhas.push('Sem faturas vencidas. Pode oferecer desbloqueio.');
    } else if (vencidas.length === 1) {
      linhas.push('1 fatura vencida. Ofereça 2ª via + desbloqueio após promessa de pagamento.');
    } else {
      linhas.push(`${vencidas.length} faturas vencidas. Transfira para humano.`);
    }

    linhas.push('');
    linhas.push(`ID_INTERNO: id_cliente=${c.id} | id_contrato=${contratoAtivo?.id || ''}`);
    linhas.push('=== FIM ===');

    return linhas.join('\n');
  }

  // --- Chamado técnico --------------------------------------------------

  // Os assuntos são cadastrados por provedor — no Mataverde são quatro, noutro
  // IXC serão outros. Por isso a lista vem da API em vez de ficar fixa no
  // código: formulário com opção que não existe lá abre chamado no lugar errado.
  async listarAssuntosChamado() {
    const data = await this.#listar('su_oss_assunto', { rp: '100' });
    return (data?.registros || [])
      .filter(r => r.ativo !== 'N')
      .map(r => ({
        id: String(r.id),
        nome: r.assunto || r.descricao || `Assunto ${r.id}`,
        // Cada assunto traz o setor e a origem de endereço que o IXC espera.
        // Alguns provedores exigem os dois no cadastro do chamado — a
        // Microdata recusou com "Preencha Setor / Preencha Origem do
        // endereço" — e não há tabela de setores exposta pela API para
        // oferecer ao atendente. Então sai daqui, que é a fonte do IXC.
        setorPadrao: String(r.setor_su_oss_chamado || ''),
        enderecoPadrao: String(r.endereco_padrao || ''),
        prioridadePadrao: String(r.prioridade_padrao || 'N'),
      }))
      .filter(a => a.nome);
  }

  // Vocabulário de cada família de assunto: à esquerda como o provedor batiza
  // o assunto no IXC, à direita como o cliente descreve o problema. Os nomes
  // cadastrados variam muito entre provedores ("Manutenção", "Suporte",
  // "Visita técnica", "Corretiva"), então a ponte é por família, não por
  // nome exato.
  static #FAMILIAS = [
    {
      familia: 'suporte',
      nomes: ['manutencao', 'suporte', 'reparo', 'defeito', 'corretiva',
        'assistencia', 'visita tecnica', 'conserto', 'reclamacao', 'tecnico'],
      sintomas: ['sem internet', 'sem conexao', 'sem acesso', 'sem sinal', 'sem link',
        'nao navega', 'nao conecta', 'nao funciona', 'caiu', 'caindo', 'queda', 'quedas',
        'oscila', 'instavel', 'lento', 'lentidao', 'travando', 'intermitente',
        'roteador', 'modem', 'onu', 'equipamento', 'aparelho', 'cabo', 'fibra',
        'rompimento', 'rompida', 'wifi', 'wi-fi', 'sinal', 'troca', 'trocar'],
    },
    {
      familia: 'instalacao',
      nomes: ['instalacao', 'ativacao', 'habilitacao', 'nova instalacao'],
      sintomas: ['instalacao', 'instalar', 'ativacao', 'ativar', 'novo ponto',
        'ponto adicional', 'habilitar', 'primeiro acesso', 'cliente novo'],
    },
    {
      familia: 'mudanca',
      nomes: ['mudanca', 'transferencia', 'mudanca de endereco'],
      sintomas: ['mudanca', 'mudar de endereco', 'mudei', 'transferencia',
        'transferir', 'outro endereco', 'nova casa'],
    },
  ];

  // Encaixa o texto que a IA escreveu no assunto cadastrado pelo provedor.
  // Acentos e caixa saem da comparação porque "CONEXÃO LENTA" no IXC e
  // "conexao lenta" vindo do modelo são a mesma coisa.
  //
  // O que não pode voltar é o primeiro da lista quando nada casa. Era o que
  // acontecia: na Microdata os assuntos são Instalação, Manutenção e Mudança
  // de endereço, nessa ordem, e o modelo escreve o sintoma ("sem internet"),
  // que não é substring de nenhum deles. Resultado: todo chamado do bot nascia
  // como INSTALAÇÃO. Foi assim que o 6331, um cliente sem conexão, virou ordem
  // de instalação e seguiu para a fila errada.
  //
  // Então: nome exato, depois substring, depois a família do sintoma, e só
  // então um padrão — que é suporte, nunca instalação. Abrir manutenção
  // indevida gera uma visita a mais; abrir instalação indevida manda o técnico
  // montar um ponto que já existe.
  async #idDoAssunto(texto) {
    const lista = await this.listarAssuntosChamado().catch(() => []);
    if (!lista.length) return '1';

    const limpar = t => String(t || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const alvo = limpar(texto);

    const daFamilia = familia => {
      const { nomes } = IxcAdaptador.#FAMILIAS.find(f => f.familia === familia);
      return lista.find(a => nomes.some(n => limpar(a.nome).includes(n)));
    };
    // Sem texto nenhum o problema é de suporte: a IA só abre chamado quando o
    // cliente relata algo que não funciona.
    const padrao = () => daFamilia('suporte') || lista[0];

    if (!alvo) return padrao().id;

    const exato = lista.find(a => limpar(a.nome) === alvo);
    if (exato) return exato.id;

    const parcial = lista.find(a => limpar(a.nome).includes(alvo) || alvo.includes(limpar(a.nome)));
    if (parcial) return parcial.id;

    // O sintoma que o cliente descreveu aponta a família; a família aponta o
    // assunto que este provedor cadastrou para ela.
    for (const f of IxcAdaptador.#FAMILIAS) {
      if (!f.sintomas.some(s => alvo.includes(s))) continue;
      const achado = daFamilia(f.familia);
      if (achado) return achado.id;
    }

    return padrao().id;
  }

  // Filiais ativas, com a cidade ao lado — "MICRODATA ITINGA · Itinga" diz mais
  // do que o nome sozinho quando o provedor tem quatro delas em cidades
  // diferentes. Provedor de uma filial só não precisa escolher nada, e a tela
  // esconde o campo nesse caso.
  async listarFiliaisChamado() {
    const data = await this.#listar('filial', { rp: '50' });
    const ativas = (data?.registros || []).filter(f => f.ativo !== 'N');

    return Promise.all(ativas.map(async f => ({
      id: String(f.id),
      nome: f.fantasia || f.razao || `Filial ${f.id}`,
      cidade: await this.#nomeCidade(f.cidade).catch(() => null),
    })));
  }

  // Técnicos para atribuir o chamado.
  //
  // id_tecnico aponta para "Colaboradores" (Sistema > Folha de Pagamento), que
  // na API é `funcionarios` — os campos de CTPS e dependentes não deixam
  // dúvida. Não é `usuarios`, que são os logins do sistema.
  //
  // O IXC só habilita alguém como técnico quando o colaborador recebe um setor,
  // mas essa relação não é exposta pela API (funcionarios_setor e companhia
  // respondem "recurso não disponível"). id_setor_padrao não serve de atalho:
  // no Mataverde só uma pessoa tem, e os chamados já foram atribuídos a cinco.
  //
  // Então vai a lista inteira de ativos e quem escolhe é o atendente, que
  // conhece a equipe. Nome repetido ganha o id ao lado — o cadastro tem
  // duplicatas, e dois itens idênticos num seletor não dão para escolher.
  async listarTecnicos() {
    const data = await this.#listar('funcionarios', { rp: '200' });
    const ativos = await Promise.all((data?.registros || [])
      .filter(f => f.ativo !== 'N')
      .map(async f => ({
        id: String(f.id),
        nome: (f.funcionario || f.nome || `Colaborador ${f.id}`).trim(),
        // A cidade vem junto para a tela separar quem atende a região do
        // cliente. Num provedor que cobre quatro cidades, mandar técnico de
        // Araçuaí para um chamado em Itinga é erro caro.
        cidade: await this.#nomeCidade(f.cidade).catch(() => null),
      })));

    // Quem o IXC aceita como técnico não é quem está no cadastro de
    // colaboradores: é quem está vinculado a um setor. Essa relação a API não
    // expõe — funcionarios_setor e companhia respondem "recurso não
    // disponível" — e escolher alguém de fora faz o IXC descartar a gravação
    // do chamado em silêncio, respondendo sucesso.
    //
    // O histórico responde o que a API esconde: na Microdata, dos 4
    // colaboradores cadastrados só um já recebeu O.S. em toda a base. Os
    // outros três são escolhas que sempre vão falhar, e o atendente não tem
    // como saber disso olhando a lista.
    const historico = await this.#listar('su_oss_chamado', {
      rp: '300', qtype: 'su_oss_chamado.id', query: '0', oper: '>',
    }).catch(() => null);

    const atribuidas = new Map();
    for (const c of historico?.registros || []) {
      const id = String(c.id_tecnico || '0');
      if (id !== '0') atribuidas.set(id, (atribuidas.get(id) || 0) + 1);
    }

    const vezes = new Map();
    for (const t of ativos) vezes.set(t.nome, (vezes.get(t.nome) || 0) + 1);

    return ativos
      .map(t => ({
        ...t,
        nome: vezes.get(t.nome) > 1 ? `${t.nome} (${t.id})` : t.nome,
        osAtribuidas: atribuidas.get(t.id) || 0,
      }))
      // Quem já atende vem primeiro, do mais atuante para o menos. Sem
      // histórico nenhum — provedor novo, base recém-migrada — a ordem
      // alfabética volta a valer sozinha, porque aí todos empatam em zero.
      .sort((a, b) => b.osAtribuidas - a.osAtribuidas
        || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // O protocolo de atendimento, no formato que o IXC gera na tela dele:
  // 14 dígitos de data e hora mais 6 de desempate — "20261103175943512770".
  // A API não gera nenhum, e a O.S. aberta por aqui ficava com a coluna
  // Protocolo vazia na grade e nas impressões, única entre as 191 da base.
  //
  // A hora é a de Brasília, que é o relógio gravado nos registros do IXC;
  // usar UTC deixaria o protocolo três horas à frente da data de abertura ao
  // lado dele.
  #protocoloNovo() {
    const agora = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date()).replace(/\D/g, '');

    const desempate = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    return `${agora}${desempate}`;
  }

  // O login PPPoE do contrato. A O.S. guarda o id dele em `id_login`, e é por
  // esse campo que a grade do IXC mostra as colunas Login e Senha MD5 — o que
  // o técnico usa para testar a conexão em campo. Sem ele a O.S. chega sem
  // nada disso.
  async #loginDoContrato(idContrato) {
    if (!idContrato) return null;
    const data = await this.#listar('radusuarios', {
      qtype: 'radusuarios.id_contrato', query: String(idContrato), oper: '=', rp: '10',
    }).catch(() => null);

    const logins = data?.registros || [];
    const escolhido = logins.find(l => l.ativo === 'S') || logins[0];
    return escolhido?.id ? String(escolhido.id) : null;
  }

  // O IXC exige filial na criação do chamado. Provedor com uma só — que é o
  // caso de todos até agora — não deve ter que configurar isso à mão.
  async #primeiraFilial() {
    const filiais = await this.listarFiliaisChamado().catch(() => []);
    return filiais[0]?.id || null;
  }

  // Chamados do provedor, para a tela de acompanhamento.
  //
  // O IXC devolve só ids — cliente, assunto, técnico. Os nomes são resolvidos
  // aqui porque uma tela com "id_assunto: 2" não serve a ninguém. O cliente sai
  // um por um, mas passa pelo cache da instância e o teto de 80 mantém isso em
  // alguns segundos; é tela que se abre, não que fica em polling.
  // idTecnico filtra no IXC, não aqui: o técnico de campo puxa isso pelo
  // celular e não faz sentido baixar as 184 O.S. do provedor para mostrar as
  // seis dele.
  async listarChamados({ limite = 80, idTecnico = null } = {}) {
    // Sem filtro de status na consulta: o IXC usa vários — aberto, análise,
    // encaminhado, assumido, deslocamento, execução, agendado, finalizado — e
    // filtrar por 'A' escondia chamado recém-criado que nasceu noutro estado.
    // Foi o que aconteceu com o 6325. Traz os mais recentes e quem separa é a
    // tela, que mostra o status de cada um.
    const filtro = idTecnico
      ? { qtype: 'su_oss_chamado.id_tecnico', query: String(idTecnico), oper: '=' }
      : { qtype: 'su_oss_chamado.id', query: '0', oper: '>' };

    const data = await this.#listar('su_oss_chamado', {
      ...filtro,
      rp: String(limite),
      sortname: 'su_oss_chamado.id',
      sortorder: 'desc',
    });

    const [assuntos, tecnicos] = await Promise.all([
      this.listarAssuntosChamado().catch(() => []),
      this.listarTecnicos().catch(() => []),
    ]);
    const nomeAssunto = new Map(assuntos.map(a => [a.id, a.nome]));
    const nomeTecnico = new Map(tecnicos.map(t => [t.id, t.nome]));

    return Promise.all((data?.registros || []).map(async c => {
      const cliente = await this.#clientePorId(c.id_cliente).catch(() => null);
      return {
        id: String(c.id),
        status: String(c.status || ''),
        statusRotulo: STATUS_CHAMADO[String(c.status || '')] || String(c.status || '—'),
        finalizado: String(c.status || '') === 'F',
        clienteNome: cliente?.razao || `Cliente ${c.id_cliente}`,
        clienteWhatsapp: this.#formatarTelefoneWhatsapp(cliente?.telefone_celular || cliente?.fone),
        cidade: cliente ? await this.#nomeCidade(cliente.cidade).catch(() => null) : null,
        assunto: nomeAssunto.get(String(c.id_assunto)) || null,
        // id_tecnico 0 é o estado normal de chamado ainda não distribuído.
        tecnico: c.id_tecnico && c.id_tecnico !== '0'
          ? (nomeTecnico.get(String(c.id_tecnico)) || `Colaborador ${c.id_tecnico}`)
          : null,
        prioridade: c.prioridade || null,
        abertoEm: c.data_abertura && !c.data_abertura.startsWith('0000') ? c.data_abertura : null,
        agendadoPara: c.data_agenda && !c.data_agenda.startsWith('0000') ? c.data_agenda : null,
        mensagem: c.mensagem || '',
        // Daqui para baixo é o que só o técnico de campo usa: ele precisa
        // chegar no lugar. Latitude e longitude vêm do cadastro do cliente e
        // muitas vezes são a única pista útil na zona rural, onde "rua e
        // número" não leva ninguém a lugar nenhum.
        protocolo: c.protocolo || null,
        endereco: c.endereco || null,
        complemento: c.complemento || null,
        referencia: c.referencia || null,
        latitude: c.latitude || null,
        longitude: c.longitude || null,
      };
    }));
  }

  // O IXC guarda o assunto em id_assunto (numérico). Mandar o texto num campo
  // "assunto", como o código fazia antes, não grava nada: o chamado cai no
  // padrão e um pedido de troca de roteador vira "Sem Internet".
  // Repete a abertura sem o técnico. Recebe os argumentos originais inteiros:
  // a versão anterior remontava a chamada à mão e esquecia o idCliente, então
  // toda retentativa vinda do bot — que identifica o cliente por id, não por
  // telefone — morria em "Cliente não encontrado no IXC".
  async #reabrirSemTecnico(argumentos) {
    return this.abrirChamado({ ...argumentos, idTecnico: null });
  }

  async abrirChamado(argumentos) {
    const {
      idCliente, whatsapp, documento, idAssunto, idFilial, idTecnico,
      setorPadrao, mensagem, prioridade = 'N',
    } = argumentos;
    // idCliente vem da ferramenta da IA, que já tem o id interno do contexto do
    // SGP; o painel manda telefone ou documento e a busca acontece aqui.
    const cliente = idCliente
      ? await this.#clientePorId(idCliente)
      : documento
        ? await this.#buscarClientePorDocumento(documento)
        : await this.#buscarClientePorTelefone(whatsapp);
    if (!cliente) return { erro: 'Cliente não encontrado no IXC.' };

    // O assunto escolhido define setor e origem de endereço. Sem valor
    // cadastrado, cai nos únicos que aparecem nos chamados reais: setor 1 e
    // origem "C" (endereço do cliente).
    const assunto = (await this.listarAssuntosChamado().catch(() => []))
      .find(a => a.id === String(idAssunto));

    // Precedência: o setor do assunto, depois o configurado no provedor.
    // Nenhum dos dois? Não manda nada. Chutar um id — era '1' aqui — e esse id
    // não existir faz o IXC recusar o técnico dizendo que ele "não está
    // vinculado ao setor", quando o problema é o setor inexistente. Na
    // Microdata os setores são 2 e 4; o 1 que eu mandava não existe.
    const setorEscolhido = (assunto?.setorPadrao && assunto.setorPadrao !== '0')
      ? assunto.setorPadrao
      : (setorPadrao || this.tenant?.chamadoSetorPadrao
          ? String(setorPadrao || this.tenant.chamadoSetorPadrao)
          : null);

    // Sem setor, o IXC aplica um padrão próprio — e o chamado pode cair num
    // setor que ninguém da equipe enxerga. Os usuários do IXC têm
    // `filtra_setor`, que esconde do próprio operador os chamados de setores
    // fora do alcance dele: foi o que aconteceu com o 6325 na Microdata, que a
    // API respondeu ter criado e não aparece nem na grade do ERP.
    //
    // Chamado invisível é pior do que chamado que não abre: ninguém atende e
    // ninguém sabe que existe. Então recusa, dizendo onde configurar.
    if (!setorEscolhido) {
      return {
        erro: 'Falta configurar o setor dos chamados deste provedor. '
          + 'Informe o ID do setor em Configurações → Chamado técnico, ou no super admin, '
          + 'na ficha do provedor abaixo da credencial do SGP. '
          + 'O número está no IXC em Suporte → Setores, coluna "ID setor". '
          + 'Sem ele o chamado cai num setor que a equipe não enxerga.',
      };
    }

    // Os campos abaixo o IXC exige na criação e não deduz sozinho — descobertos
    // testando contra a base da Microdata, porque a documentação pública da API
    // não cobre su_oss_chamado.
    //
    // De onde sai o endereço da visita, conforme o assunto manda:
    //   'C'  endereço do cliente
    //   'CC' endereço do contrato — e aí o IXC exige id_contrato junto
    //   'L'  endereço do login
    // Respeitar isso importa: é o provedor dizendo onde o técnico deve ir.
    // Sem contrato ativo para acompanhar o 'CC', cai no endereço do cliente em
    // vez de recusar — endereço aproximado é melhor que chamado não aberto.
    const origemAssunto = assunto?.enderecoPadrao || 'C';

    // 'M' quer dizer endereço digitado à mão na tela do IXC. Nem o painel nem
    // o bot coletam endereço, então 'M' vindo daqui garante O.S. sem endereço
    // nenhum — foi o que aconteceu com os chamados 6331, 6332 e 6336, que
    // chegaram ao técnico sem dizer para onde ir.
    //
    // Na base da Microdata 188 das 191 O.S. usam 'CC', e em 187 delas o
    // próprio IXC compôs o endereço a partir do contrato. Sem ninguém para
    // digitar, o contrato é a melhor fonte que existe: 'M' vira 'CC' quando o
    // cliente tem contrato, e 'C' quando não tem. Quem precisar de um endereço
    // diferente — instalação em imóvel novo, por exemplo — corrige na O.S.,
    // que é melhor do que partir do vazio.
    const dependeDoEndereco = origemAssunto === 'CC' || origemAssunto === 'M';
    const contratos = dependeDoEndereco
      ? (await this.#contratosDoCliente(cliente.id).catch(() => null)) || []
      : [];
    const contrato = contratos.find(c => c.status === 'A') || contratos[0] || null;
    const origemEndereco = dependeDoEndereco
      ? (contrato ? 'CC' : 'C')
      : origemAssunto;

    // A cidade da O.S. Sem ela o chamado nasce fora de qualquer cidade: não
    // entra no filtro por cidade do IXC nem no daqui, e quem distribui não
    // sabe para onde mandar o técnico. Dos 191 chamados da Microdata só 3
    // estão com id_cidade 0, e um deles era justamente o que o bot abriu.
    //
    // No cadastro do cliente o campo se chama `cidade` e já guarda o id; na
    // O.S. ele se chama `id_cidade`. Era essa a troca de nome que faltava.
    //
    // UM CAMPO POR VEZ, e sempre testado contra um IXC de verdade. Numa
    // tentativa anterior acrescentei endereco/bairro/complemento/id_cidade/
    // latitude/longitude de uma vez, sem testar, e a criação voltou a
    // responder sucesso sem gravar — o IXC não reclama, só engole. Com seis
    // campos novos juntos não havia como saber qual deles quebrou.
    const idCidade = /^[1-9][0-9]*$/.test(String(cliente.cidade || ''))
      ? String(cliente.cidade)
      : null;
    const idLogin = contrato ? await this.#loginDoContrato(contrato.id) : null;
    const endereco = await this.#enderecoDaOs(cliente).catch(() => ({}));
    const data = await this.#inserir('su_oss_chamado', {
      id_cliente: String(cliente.id),
      id_assunto: String(idAssunto),
      mensagem,
      prioridade: prioridade || assunto?.prioridadePadrao || 'N',
      status: 'A',
      tipo: 'C',
      liberado: '1',
      origem_endereco: origemEndereco,
      // id_contrato_kit, e não id_contrato: o IXC recusa o segundo dizendo que
      // o contrato é obrigatório, mesmo recebendo-o.
      ...(origemEndereco === 'CC' && contrato ? { id_contrato_kit: String(contrato.id) } : {}),
      ...(idLogin ? { id_login: idLogin } : {}),
      ...endereco,
      protocolo: this.#protocoloNovo(),
      ...(idCidade ? { id_cidade: idCidade } : {}),
      origem_os_aberta: 'M',
      melhor_horario_agenda: 'Q',
      id_filial: String(idFilial || (await this.#primeiraFilial()) || '1'),
      ...(setorEscolhido ? { setor: setorEscolhido } : {}),
      // Sem técnico escolhido o IXC deixa em 0, que é o estado normal de
      // chamado ainda não distribuído — não é erro.
      ...(idTecnico ? { id_tecnico: String(idTecnico) } : {}),
    });
    if (data?.type === 'success') {
      // O IXC responde "Registro inserido com sucesso" com um id mesmo quando
      // não grava nada — foi assim que os chamados 6325 a 6329 viraram
      // protocolos que não existiam, e o atendente avisou o cliente de uma
      // visita que ninguém ia fazer. Ler de volta custa uma consulta e é a
      // única forma de saber que o registro ficou.
      const confere = await this.#listar('su_oss_chamado', {
        qtype: 'su_oss_chamado.id', query: String(data.id), oper: '=', rp: '1',
      }).catch(() => null);

      if (confere?.registros?.length) return { protocolo: String(data.id) };

      console.error(
        `[IXC] Chamado ${data.id} veio como sucesso mas não está na base.
`
        + `       corpo enviado: ${data.__corpoEnviado || '(indisponível)'}
`
        + `       resposta: ${JSON.stringify(data).slice(0, 400)}`
      );

      // Colaborador fora do setor da O.S. nem sempre vira recusa com mensagem:
      // às vezes o IXC responde sucesso, devolve um id e descarta a gravação
      // inteira, calado. O técnico é o único campo opcional do payload, então
      // é ele o suspeito óbvio de uma gravação que some. Tentar de novo sem
      // ele entrega o mesmo desfecho que a tela já promete — "se não estiver
      // vinculado, o chamado abre sem técnico" — e chamado sem técnico é
      // muito melhor do que chamado que não existe.
      if (idTecnico) {
        const semTecnico = await this.#reabrirSemTecnico(argumentos);
        if (semTecnico?.protocolo) return { ...semTecnico, aviso: AVISO_SEM_TECNICO };
      }

      return {
        erro: 'O sistema do provedor respondeu que criou o chamado, mas ele não aparece na base. '
          + 'Nada foi registrado — abra pelo IXC desta vez e avise o suporte do ISPDesk.',
      };
    }

    // O IXC devolve a recusa com HTML dentro — "Preencha Setor<br />Preencha
    // Origem do endereço". Na tela isso aparecia cru, com as tags à mostra.
    const limpo = String(data?.message || '')
      .replace(/<br\s*\/?>/gi, ' · ')
      .replace(/<[^>]+>/g, '')
      .replace(/clique para saber mais!?/gi, '')   // link que não existe aqui
      .trim();

    // O IXC só aceita como técnico quem está vinculado ao setor daquela O.S., e
    // essa relação não é exposta pela API — não dá para filtrar o seletor antes.
    // Derrubar o chamado inteiro por causa de um campo opcional é o pior
    // desfecho: o atendente queria abrir o chamado, não escolher o técnico.
    // Então abre sem técnico e avisa, para alguém atribuir no IXC.
    const eRecusaDeTecnico = idTecnico && /colaborador|setor dessa|vinculado/i.test(limpo);
    if (eRecusaDeTecnico) {
      const semTecnico = await this.#reabrirSemTecnico(argumentos);
      if (semTecnico?.protocolo) return { ...semTecnico, aviso: AVISO_SEM_TECNICO };
    }

    return { erro: limpo || 'O IXC recusou a abertura do chamado.' };
  }

  async buscarContexto(whatsapp) {
    const cliente = await this.#buscarClientePorTelefone(whatsapp);
    if (!cliente) {
      return 'DADOS DO CLIENTE: Número não encontrado no IXC. Peça o CPF ou CNPJ para localizar.';
    }
    return this.#buildContexto(cliente);
  }

  async buscarContextoPorDocumento(doc) {
    const cliente = await this.#buscarClientePorDocumento(doc);
    if (!cliente) return null;
    return this.#buildContexto(cliente);
  }

  // O CPF/CNPJ também é gravado formatado no IXC.
  async #buscarClientePorDocumento(doc) {
    const digitos = String(doc).replace(/\D/g, '');
    const variantes = new Set([String(doc), digitos]);
    if (digitos.length === 11) {
      variantes.add(`${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`);
    } else if (digitos.length === 14) {
      variantes.add(`${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`);
    }

    for (const v of variantes) {
      const data = await this.#listar('cliente', {
        qtype: 'cliente.cnpj_cpf',
        query: v,
        oper: '=',
        rp: '1',
      });
      if (data?.registros?.length) return data.registros[0];
    }
    return null;
  }

  async buscarDados(whatsapp) {
    const c = await this.#buscarClientePorTelefone(whatsapp);
    if (!c) return null;

    const contData = await this.#listar('cliente_contrato', {
      qtype: 'cliente_contrato.id_cliente',
      query: c.id,
      oper: '=',
      rp: '5',
    }).catch(() => ({ registros: [] }));

    const contratoAtivo =
      (contData.registros || []).find(ct => ct.status === 'A') ||
      contData.registros?.[0];

    const statusMap = {
      A: 'ativo', S: 'suspenso', I: 'inativo', N: 'pré-contrato',
      D: 'cancelado', CA: 'cancelado', CM: 'cancelado', FA: 'suspenso',
    };

    return {
      nome: c.razao || null,
      contratoId: String(contratoAtivo?.id || c.id || ''),
      statusContrato: statusMap[contratoAtivo?.status] || 'inativo',
      filialNome: await this.#nomeCidade(c.cidade).catch(() => null),
    };
  }

  // --- Lembretes automáticos de fatura ---------------------------------
  //
  // O robô de lembretes foi escrito em cima do SGP TSMX e espera títulos num
  // formato próprio (camelCase, com nome e CPF do cliente embutidos). O IXC
  // guarda a fatura em fn_areceber com só o id_cliente, então a conversão
  // acontece aqui: sem estes três métodos o adaptador herda os vazios da base
  // e o provedor fica sem lembrete nenhum, em silêncio.

  #clientesCache = new Map(); // id_cliente -> registro do cliente
  #contratosCache = new Map(); // id_cliente -> registros de cliente_contrato
  #avisouSemContrato = false;

  // Falha devolve null (e não entra no cache): sem a lista de contratos, o
  // filtro abaixo deixa tudo passar em vez de esconder dívida por engano.
  async #contratosDoCliente(idCliente) {
    const chave = String(idCliente);
    if (this.#contratosCache.has(chave)) return this.#contratosCache.get(chave);
    try {
      const data = await this.#listar('cliente_contrato', {
        qtype: 'cliente_contrato.id_cliente', query: chave, oper: '=', rp: '50',
      });
      const contratos = data?.registros || [];
      this.#contratosCache.set(chave, contratos);
      return contratos;
    } catch (err) {
      console.error(`[IXC] Falha ao listar contratos do cliente ${chave}:`, err.message);
      return null;
    }
  }

  // Cancelar um contrato no IXC o deixa Inativo (I) ou Desistiu (D), mas as
  // faturas abertas dele continuam "A" em fn_areceber. Como toda busca de
  // fatura era por cliente, quem já teve um contrato cancelado recebia na 2ª
  // via, no contexto do bot e nos lembretes as faturas do contrato morto
  // misturadas às do atual — caso real na Mataverde.
  //
  // Fatura sem contrato (avulsa) continua aparecendo: não há como saber a que
  // ela pertence, e esconder dívida é pior do que mostrar uma a mais.
  async #semContratoEncerrado(faturas) {
    if (faturas.length && faturas.every(f => !('id_contrato' in f)) && !this.#avisouSemContrato) {
      this.#avisouSemContrato = true;
      console.warn('[IXC] fn_areceber veio sem id_contrato — faturas de contrato cancelado não serão filtradas.');
    }

    const resultado = [];
    for (const f of faturas) {
      const idContrato = String(f.id_contrato ?? '');
      if (!idContrato || idContrato === '0') { resultado.push(f); continue; }

      const contratos = await this.#contratosDoCliente(f.id_cliente);
      const contrato = contratos?.find(ct => String(ct.id) === idContrato);
      if (contrato && STATUS_CONTRATO_ENCERRADO.has(contrato.status)) continue;
      resultado.push(f);
    }
    return resultado;
  }

  async #clientePorId(id) {
    const chave = String(id);
    if (this.#clientesCache.has(chave)) return this.#clientesCache.get(chave);

    const data = await this.#listar('cliente', {
      qtype: 'cliente.id', query: chave, oper: '=', rp: '1',
    }).catch(() => null);

    const cliente = data?.registros?.[0] || null;
    this.#clientesCache.set(chave, cliente);
    return cliente;
  }

  #formatarTelefoneWhatsapp(tel) {
    let d = (tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    return d;
  }

  // O código PIX exige uma chamada dedicada por fatura. Numa varredura diária
  // isso multiplica por todos os títulos do dia, então só vale buscar quando o
  // PIX realmente vai parar na mensagem.
  #lembreteUsaPix() {
    return this.tenant?.aceitaPix !== false && !this.tenant?.lembreteFaturaLinkAssinante;
  }

  async #titulosParaLembrete(faturas) {
    const titulos = [];
    for (const f of faturas) {
      const cliente = await this.#clientePorId(f.id_cliente);
      if (!cliente) continue;

      titulos.push({
        id: f.id,
        clienteNome: cliente.razao || null,
        clienteCpfcnpj: cliente.cnpj_cpf || null,
        valor: f.valor,
        // O IXC às vezes devolve a data com hora junto; o robô monta
        // `${data}T00:00:00` e uma hora extra viraria Invalid Date.
        dataVencimento: String(f.data_vencimento || '').slice(0, 10),
        codigoPix: this.#lembreteUsaPix()
          ? await this.#buscarPix(f.id).catch(() => null)
          : null,
        link: f.gateway_link || null,
      });
    }
    return titulos;
  }

  async listarTitulosPorVencimento(dataInicio, dataFim = dataInicio) {
    const rp = 200;
    let page = 1;
    let faturas = [];

    while (true) {
      const data = await this.#listar('fn_areceber', {
        qtype: 'fn_areceber.status',
        query: 'A',
        oper: '=',
        page: String(page),
        rp: String(rp),
        sortname: 'fn_areceber.data_vencimento',
        sortorder: 'asc',
        grid_param: JSON.stringify([
          { TB: 'fn_areceber.data_vencimento', OP: '>=', P: dataInicio },
          { TB: 'fn_areceber.data_vencimento', OP: '<=', P: dataFim },
        ]),
      });

      const pagina = data?.registros || [];
      faturas = faturas.concat(pagina);

      const total = Number(data?.total ?? faturas.length);
      if (pagina.length === 0 || faturas.length >= total) break;
      page++;
    }

    return this.#titulosParaLembrete(await this.#semContratoEncerrado(faturas));
  }

  async buscarTelefonePorDocumento(doc) {
    // A varredura já carregou o cliente para montar o título; reaproveita em
    // vez de consultar o IXC de novo pelo mesmo cadastro.
    const digitos = String(doc).replace(/\D/g, '');
    for (const c of this.#clientesCache.values()) {
      if (c && String(c.cnpj_cpf || '').replace(/\D/g, '') === digitos) {
        return this.#formatarTelefoneWhatsapp(c.telefone_celular || c.whatsapp);
      }
    }

    const cliente = await this.#buscarClientePorDocumento(doc).catch(() => null);
    if (!cliente) return null;
    return this.#formatarTelefoneWhatsapp(cliente.telefone_celular || cliente.whatsapp);
  }

  async buscarTituloAbertoPorDocumento(doc) {
    const cliente = await this.#buscarClientePorDocumento(doc).catch(() => null);
    if (!cliente) return null;

    const data = await this.#listar('fn_areceber', {
      qtype: 'fn_areceber.id_cliente',
      query: cliente.id,
      oper: '=',
      rp: '50',
      sortname: 'fn_areceber.data_vencimento',
      sortorder: 'asc',
      grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
    }).catch(() => null);

    const [fatura] = await this.#semContratoEncerrado(data?.registros || []);
    if (!fatura) return null;

    this.#clientesCache.set(String(cliente.id), cliente);
    const [titulo] = await this.#titulosParaLembrete([fatura]);
    return titulo || null;
  }

  async executarTool(toolName, toolInput) {
    switch (toolName) {

      case 'desbloquear_cliente': {
        if (!toolInput.id_contrato) {
          return 'Não foi possível desbloquear: contrato não identificado. Transfira para um atendente. ACTION:HANDOFF:desbloqueio de confiança — contrato não identificado';
        }
        // O IXC espera exclusivamente { id: <id_contrato> } neste recurso.
        const data = await this.#inserir('desbloqueio_confianca', {
          id: String(toolInput.id_contrato),
        });
        if (data.type === 'success') return `Desbloqueio em confiança realizado com sucesso!${this.avisoPrazoDesbloqueio()}`;

        // Qualquer recusa do IXC (direito já utilizado, contrato inelegível etc.)
        // vira transferência para o atendente resolver manualmente.
        const motivo = (data.message || 'motivo não informado pelo IXC')
          .replace(/\\'/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
        return `Não foi possível fazer o desbloqueio automático. Motivo do sistema: ${motivo}. ` +
          'Informe ao cliente que um atendente vai avaliar o desbloqueio manualmente e NÃO prometa prazo. ' +
          `ACTION:HANDOFF:desbloqueio de confiança indisponível — ${motivo}`;
      }

      case 'enviar_segunda_via': {
        const data = await this.#listar('fn_areceber', {
          qtype: 'fn_areceber.id_cliente',
          query: toolInput.id_cliente,
          oper: '=',
          rp: '50',
          sortname: 'fn_areceber.data_vencimento',
          sortorder: 'asc',
          grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
        });
        const faturas = await this.#semContratoEncerrado(data.registros || []);
        if (!faturas.length) return 'Nenhuma fatura em aberto.';

        const f = faturas.sort(
          (a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento)
        )[0];

        const [pix, boleto] = await Promise.all([
          this.aceitaPix() ? this.#buscarPix(f.id).catch(() => null) : Promise.resolve(null),
          this.#baixarBoleto(f.id).catch(err => {
            console.error(`[IXC] Falha ao gerar boleto da fatura ${f.id}:`, err.message);
            return null;
          }),
        ]);

        const partes = [
          'Mensalidade',
          `Vencimento: ${this.formatarData(f.data_vencimento)}`,
          `Valor: ${this.formatarMoeda(f.valor)}`,
        ];
        if (pix) partes.push(`\nPIX copia e cola:\n${pix}`);
        if (f.linha_digitavel) partes.push(`\nLinha digitável:\n${f.linha_digitavel}`);
        else if (!pix && f.gateway_link) partes.push(`\nLink do boleto: ${f.gateway_link}`);
        if (!pix && !f.linha_digitavel && !f.gateway_link) partes.push('\nNenhum código de pagamento disponível no momento.');

        // Avisa o modelo se pode ou não prometer o anexo.
        partes.push(boleto
          ? '\n(O PDF do boleto será enviado automaticamente logo após sua mensagem — pode avisar o cliente.)'
          : '\n(PDF do boleto indisponível — NÃO prometa envio de arquivo.)');

        return {
          texto: partes.join('\n'),
          midia: boleto
            ? { buffer: boleto, mimeType: 'application/pdf', nome: `boleto-${f.id}.pdf` }
            : null,
        };
      }

      case 'abrir_chamado_tecnico': {
        // O IXC guarda o assunto em id_assunto, numérico. O código antigo
        // mandava um texto fixo num campo "assunto" que não existe no
        // registro: nada era gravado e todo chamado caía no assunto padrão,
        // fosse sem internet ou troca de roteador.
        // Mesmo caminho do painel: um payload só, testado contra o IXC de
        // verdade, com a conferência de que o registro ficou. Antes a IA tinha
        // uma inserção própria e enxuta, que respondia sucesso sem gravar.
        const r = await this.abrirChamado({
          idCliente: toolInput.id_cliente,
          idAssunto: await this.#idDoAssunto(toolInput.assunto),
          mensagem: toolInput.detalhes,
        });
        if (r.protocolo) {
          return `Chamado aberto! Protocolo: ${r.protocolo}. Nossa equipe entrará em contato.`;
        }
        return `Não foi possível abrir o chamado: ${r.erro}`;
      }

      default:
        return `Ação "${toolName}" não suportada pelo IXC.`;
    }
  }
}
