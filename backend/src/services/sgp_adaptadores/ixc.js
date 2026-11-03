import { SgpAdaptador } from './base.js';

// O IXC costuma responder em menos de 2s; acima disso a conversa no WhatsApp
// já travou. Sem teto, uma instância lenta seguraria o webhook indefinidamente.
const TIMEOUT_MS = 15000;

// Status de cliente_contrato: A ativo, P pré-contrato, N negativado, I inativo
// (é como o IXC deixa o contrato cancelado), D desistiu. Negativado ainda deve.
const STATUS_CONTRATO_ENCERRADO = new Set(['I', 'D']);

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
  async #inserir(recurso, body = {}) {
    const res = await fetch(await this.#url(recurso), {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status} em ${recurso}`);
    return res.json();
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

  // Encaixa o texto que a IA escreveu no assunto cadastrado pelo provedor.
  // Acentos e caixa saem da comparação porque "CONEXÃO LENTA" no IXC e
  // "conexao lenta" vindo do modelo são a mesma coisa. Sem par razoável,
  // devolve o primeiro da lista: chamado no assunto errado ainda é melhor do
  // que chamado que não abre.
  async #idDoAssunto(texto) {
    const lista = await this.listarAssuntosChamado().catch(() => []);
    if (!lista.length) return '1';

    const limpar = t => String(t || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const alvo = limpar(texto);
    if (!alvo) return lista[0].id;

    const exato = lista.find(a => limpar(a.nome) === alvo);
    if (exato) return exato.id;

    const parcial = lista.find(a => limpar(a.nome).includes(alvo) || alvo.includes(limpar(a.nome)));
    return (parcial || lista[0]).id;
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

    const vezes = new Map();
    for (const t of ativos) vezes.set(t.nome, (vezes.get(t.nome) || 0) + 1);

    return ativos
      .map(t => (vezes.get(t.nome) > 1 ? { ...t, nome: `${t.nome} (${t.id})` } : t))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // Chamados do provedor, para a tela de acompanhamento.
  //
  // O IXC devolve só ids — cliente, assunto, técnico. Os nomes são resolvidos
  // aqui porque uma tela com "id_assunto: 2" não serve a ninguém. O cliente sai
  // um por um, mas passa pelo cache da instância e o teto de 80 mantém isso em
  // alguns segundos; é tela que se abre, não que fica em polling.
  async listarChamados({ status = 'A', limite = 80 } = {}) {
    const data = await this.#listar('su_oss_chamado', {
      qtype: 'su_oss_chamado.status',
      query: status,
      oper: '=',
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
      };
    }));
  }

  // O IXC guarda o assunto em id_assunto (numérico). Mandar o texto num campo
  // "assunto", como o código fazia antes, não grava nada: o chamado cai no
  // padrão e um pedido de troca de roteador vira "Sem Internet".
  async abrirChamado({ whatsapp, documento, idAssunto, idFilial, idTecnico, mensagem, prioridade = 'N' }) {
    const cliente = documento
      ? await this.#buscarClientePorDocumento(documento)
      : await this.#buscarClientePorTelefone(whatsapp);
    if (!cliente) return { erro: 'Cliente não encontrado no IXC.' };

    // O assunto escolhido define setor e origem de endereço. Sem valor
    // cadastrado, cai nos únicos que aparecem nos chamados reais: setor 1 e
    // origem "C" (endereço do cliente).
    const assunto = (await this.listarAssuntosChamado().catch(() => []))
      .find(a => a.id === String(idAssunto));

    const data = await this.#inserir('su_oss_chamado', {
      id_cliente: String(cliente.id),
      id_assunto: String(idAssunto),
      mensagem,
      prioridade: prioridade || assunto?.prioridadePadrao || 'N',
      status: 'A',
      setor: assunto?.setorPadrao && assunto.setorPadrao !== '0' ? assunto.setorPadrao : '1',
      origem_endereco: assunto?.enderecoPadrao || 'C',
      // Só vai quando a tela mandou: sem filial escolhida, deixa o IXC aplicar
      // o padrão dele em vez de a gente chutar a primeira.
      ...(idFilial ? { id_filial: String(idFilial) } : {}),
      // Sem técnico escolhido o IXC deixa em 0, que é o estado normal de
      // chamado ainda não distribuído — não é erro.
      ...(idTecnico ? { id_tecnico: String(idTecnico) } : {}),
    });
    if (data?.type === 'success') return { protocolo: String(data.id) };

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
      const semTecnico = await this.abrirChamado({
        whatsapp, documento, idAssunto, idFilial, mensagem, prioridade,
      });
      if (semTecnico?.protocolo) {
        return {
          ...semTecnico,
          aviso: 'Aberto sem técnico: o colaborador escolhido não está vinculado ao setor desta O.S. no IXC. Atribua por lá.',
        };
      }
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
        const idAssunto = await this.#idDoAssunto(toolInput.assunto);
        const data = await this.#inserir('su_oss_chamado', {
          id_cliente: toolInput.id_cliente,
          id_assunto: idAssunto,
          mensagem: toolInput.detalhes,
          prioridade: 'N',
          status: 'A',
        });
        if (data.type === 'success') {
          return `Chamado aberto! Protocolo: ${data.id}. Nossa equipe entrará em contato.`;
        }
        return `Não foi possível abrir o chamado: ${data.message}`;
      }

      default:
        return `Ação "${toolName}" não suportada pelo IXC.`;
    }
  }
}
