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
    const base = this.apiUrl.replace(/\/$/, '');
    const url = new URL(`${base}/webservice/v1/${recurso}`);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { headers: this.#headers() });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status}`);
    return res.json();
  }

  async #post(recurso, body = {}) {
    const base = this.apiUrl.replace(/\/$/, '');
    const headers = this.#headers();
    delete headers.ixcsoft;
    const res = await fetch(`${base}/webservice/v1/${recurso}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`IXC HTTP ${res.status}`);
    return res.json();
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
      return 'DADOS DO CLIENTE: Número não encontrado no IXC. Peça o CPF.';
    }

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

    const fatData = await this.#get('fn_areceber', {
      qtype: 'fn_areceber.id_cliente',
      query: c.id,
      oper: '=',
      page: 1,
      rp: 10,
      grid_param: JSON.stringify([{ TB: 'fn_areceber.status', OP: '=', P: 'A' }]),
    }).catch(() => ({ registros: [] }));

    const faturas = fatData.registros || [];
    const vencidas = faturas.filter(f => new Date(f.data_vencimento) < new Date());

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
        linhas.push(`  Vencto ${this.formatarData(f.data_vencimento)} | ${this.formatarMoeda(f.valor)}`);
      });
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

  async executarTool(toolName, toolInput) {
    switch (toolName) {

      case 'desbloquear_cliente': {
        const data = await this.#post(`cliente_contrato/${toolInput.id_contrato}`, {
          status: 'A',
        });
        if (data.type === 'success') return 'Desbloqueio realizado com sucesso!';
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
        const f = faturas[0];
        return [
          'Mensalidade',
          `Vencimento: ${this.formatarData(f.data_vencimento)}`,
          `Valor: ${this.formatarMoeda(f.valor)}`,
          f.linha_digitavel ? `\nLinha digitável:\n${f.linha_digitavel}` : '',
        ].filter(Boolean).join('\n');
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
