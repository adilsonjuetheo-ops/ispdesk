import { SgpAdaptador } from './base.js';

// O IXC costuma responder em menos de 2s; acima disso a conversa no WhatsApp
// já travou. Sem teto, uma instância lenta seguraria o webhook indefinidamente.
const TIMEOUT_MS = 15000;

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
    const contData = await this.#listar('cliente_contrato', {
      qtype: 'cliente_contrato.id_cliente',
      query: c.id,
      oper: '=',
      rp: '5',
    }).catch(() => ({ registros: [] }));

    const contratoAtivo =
      (contData.registros || []).find(ct => ct.status === 'A') ||
      contData.registros?.[0];

    // faturas === null significa que a consulta falhou. Não dá para tratar isso
    // como "sem débito": o bot afirmaria que um inadimplente está em dia e ainda
    // ofereceria desbloqueio.
    let faturas = null;
    try {
      const fatData = await this.#listar('fn_areceber', {
        qtype: 'fn_areceber.id_cliente',
        query: c.id,
        oper: '=',
        rp: '10',
        sortname: 'fn_areceber.data_vencimento',
        sortorder: 'asc',
        grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
      });
      faturas = fatData.registros || [];
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
        if (data.type === 'success') return 'Desbloqueio em confiança realizado com sucesso!';

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
          rp: '5',
          sortname: 'fn_areceber.data_vencimento',
          sortorder: 'asc',
          grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
        });
        const faturas = data.registros || [];
        if (!faturas.length) return 'Nenhuma fatura em aberto.';

        const f = faturas.sort(
          (a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento)
        )[0];

        const [pix, boleto] = await Promise.all([
          this.#buscarPix(f.id).catch(() => null),
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
        const data = await this.#inserir('su_oss_chamado', {
          id_cliente: toolInput.id_cliente,
          mensagem: toolInput.detalhes,
          assunto: 'Solicitação via WhatsApp',
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
