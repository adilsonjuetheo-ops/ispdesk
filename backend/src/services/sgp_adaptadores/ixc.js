import { SgpAdaptador } from './base.js';

export class IxcAdaptador extends SgpAdaptador {

  #headers() {
    const encoded = Buffer.from(this.apiKey).toString('base64');
    return {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
      ixcsoft: 'listar',
    };
  }

  async #get(recurso, params = {}) {
    const base = await this.validarApiUrl();
    const url = new URL(`webservice/v1/${recurso}`, `${base.toString().replace(/\/$/, '')}/`);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { headers: this.#headers() });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status}`);
    return res.json();
  }

  async #post(recurso, body = {}) {
    const base = await this.validarApiUrl();
    const headers = this.#headers();
    delete headers.ixcsoft;
    const url = new URL(`webservice/v1/${recurso}`, `${base.toString().replace(/\/$/, '')}/`);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status}`);
    return res.json();
  }

  // Monta contexto completo a partir do registro de cliente já buscado
  async #buildContexto(c) {
    const contData = await this.#get('cliente_contrato', {
      qtype: 'cliente_contrato.id_cliente',
      query: c.id,
      oper: '=',
      page: 1,
      rp: 5,
    }).catch(() => ({ registros: [] }));

    const contratoAtivo =
      (contData.registros || []).find(ct => ct.status === 'A') ||
      contData.registros?.[0];

    const fatData = await this.#get('fn_areceber', {
      qtype: 'fn_areceber.id_cliente',
      query: c.id,
      oper: '=',
      page: 1,
      rp: 10,
      grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
    }).catch(() => ({ registros: [] }));

    const faturas = fatData.registros || [];
    const hoje = new Date();
    const vencidas = faturas.filter(f => new Date(f.data_vencimento) < hoje);
    const aVencer  = faturas.filter(f => new Date(f.data_vencimento) >= hoje);

    const linhas = [
      '=== DADOS DO CLIENTE (IXC Soft) ===',
      `Nome: ${c.razao}`,
      `ID: ${c.id} | CPF/CNPJ: ${c.cnpj_cpf}`,
      `Status: ${contratoAtivo?.status === 'A' ? 'Ativo' : 'Bloqueado/Inativo'}`,
      `Plano: ${contratoAtivo?.id_produto || 'não identificado'}`,
      `Cidade: ${c.cidade || 'não informada'}`,
      '',
    ];

    if (vencidas.length > 0) {
      linhas.push(`FATURAS VENCIDAS (${vencidas.length}):`);
      vencidas.forEach(f => {
        const temPix = f.pix_copia_cola || f.pix_qrcode || f.pix;
        linhas.push(
          `  Vencto ${this.formatarData(f.data_vencimento)} | ${this.formatarMoeda(f.valor)}` +
          (f.linha_digitavel ? ' | Boleto disponível' : '') +
          (temPix            ? ' | PIX disponível'   : '')
        );
      });
      linhas.push('');
    }

    if (aVencer.length > 0) {
      const prox = aVencer[0];
      const temPix = prox.pix_copia_cola || prox.pix_qrcode || prox.pix;
      linhas.push(
        `PRÓXIMA FATURA: ${this.formatarData(prox.data_vencimento)} | ${this.formatarMoeda(prox.valor)}` +
        (prox.linha_digitavel ? ' | Boleto disponível' : '') +
        (temPix               ? ' | PIX disponível'   : '')
      );
      linhas.push('');
    }

    if (faturas.length === 0) {
      linhas.push('FINANCEIRO: Sem faturas em aberto.');
      linhas.push('');
    }

    linhas.push('=== REGRA DE DESBLOQUEIO ===');
    if (vencidas.length === 0) {
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
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#get('cliente', {
      qtype: 'cliente.celular',
      query: tel,
      oper: '=',
      page: 1,
      rp: 1,
    }).catch(() => ({ registros: [] }));

    if (!data.registros?.length) {
      return 'DADOS DO CLIENTE: Número não encontrado no IXC. Peça o CPF ou CNPJ para localizar.';
    }
    return this.#buildContexto(data.registros[0]);
  }

  async buscarContextoPorDocumento(doc) {
    const data = await this.#get('cliente', {
      qtype: 'cliente.cnpj_cpf',
      query: doc,
      oper: '=',
      page: 1,
      rp: 1,
    }).catch(() => ({ registros: [] }));

    if (!data.registros?.length) return null;
    return this.#buildContexto(data.registros[0]);
  }

  async buscarDados(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#get('cliente', {
      qtype: 'cliente.celular',
      query: tel,
      oper: '=',
      page: 1,
      rp: 1,
    }).catch(() => null);

    if (!data?.registros?.length) return null;
    const c = data.registros[0];

    const contData = await this.#get('cliente_contrato', {
      qtype: 'cliente_contrato.id_cliente',
      query: c.id,
      oper: '=',
      page: 1,
      rp: 5,
    }).catch(() => ({ registros: [] }));

    const contratoAtivo =
      (contData.registros || []).find(ct => ct.status === 'A') ||
      contData.registros?.[0];

    const statusMap = { A: 'ativo', S: 'suspenso', CA: 'cancelado', CM: 'cancelado' };

    return {
      nome: c.razao || null,
      contratoId: String(contratoAtivo?.id || c.id || ''),
      statusContrato: statusMap[contratoAtivo?.status] || (contratoAtivo?.status || 'inativo').toLowerCase(),
      filialNome: c.cidade || null,
    };
  }

  async executarTool(toolName, toolInput) {
    switch (toolName) {

      case 'desbloquear_cliente': {
        const data = await this.#post('desbloqueio_confianca', {
          id_cliente: toolInput.id_cliente,
          id_contrato: toolInput.id_contrato,
        });
        if (data.type === 'success') return 'Desbloqueio em confiança realizado com sucesso!';
        return `Não foi possível desbloquear: ${data.message || 'erro desconhecido'}`;
      }

      case 'enviar_segunda_via': {
        const data = await this.#get('fn_areceber', {
          qtype: 'fn_areceber.id_cliente',
          query: toolInput.id_cliente,
          oper: '=',
          page: 1,
          rp: 5,
          grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
        });
        const faturas = data.registros || [];
        if (!faturas.length) return 'Nenhuma fatura em aberto.';

        const f = faturas.sort(
          (a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento)
        )[0];

        const pix = f.pix_copia_cola || f.pix_qrcode || f.pix || null;
        const partes = [
          'Mensalidade',
          `Vencimento: ${this.formatarData(f.data_vencimento)}`,
          `Valor: ${this.formatarMoeda(f.valor)}`,
        ];
        if (pix)                  partes.push(`\nPIX copia e cola:\n${pix}`);
        else if (f.linha_digitavel) partes.push(`\nLinha digitável:\n${f.linha_digitavel}`);
        else if (f.url_boleto)    partes.push(`\nLink do boleto: ${f.url_boleto}`);
        return partes.join('\n');
      }

      case 'abrir_chamado_tecnico': {
        const data = await this.#post('su_oss_chamado', {
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
