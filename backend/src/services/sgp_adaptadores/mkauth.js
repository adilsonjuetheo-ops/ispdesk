import { SgpAdaptador } from './base.js';

export class MkAuthAdaptador extends SgpAdaptador {

  async #get(endpoint, params = {}) {
    const base = await this.validarApiUrl();
    const url = new URL(endpoint.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
    url.searchParams.set('authtoken', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`MK-Auth HTTP ${res.status}`);
    return res.json();
  }

  async #post(endpoint, body = {}) {
    const base = await this.validarApiUrl();
    const url = new URL(endpoint.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MK-Auth HTTP ${res.status}`);
    return res.json();
  }

  async #buildContexto(data) {
    const fatData = await this.#get('/api/financeiro/aberto', {
      id_cliente: data.id,
    }).catch(() => ({ faturas: [] }));

    const faturas = fatData.faturas || [];
    const vencidas = faturas.filter(f => new Date(f.vencimento) < new Date());

    const linhas = [
      '=== DADOS DO CLIENTE (MK-Auth) ===',
      `Nome: ${data.nome}`,
      `ID: ${data.id} | CPF: ${data.cpf || 'não informado'}`,
      `Status: ${data.status || 'não informado'}`,
      `Plano: ${data.plano || 'não informado'}`,
      `Cidade: ${data.cidade || 'não informada'}`,
      '',
    ];

    if (vencidas.length > 0) {
      linhas.push(`FATURAS VENCIDAS (${vencidas.length}):`);
      vencidas.forEach(f => {
        linhas.push(`  Vencto ${this.formatarData(f.vencimento)} | ${this.formatarMoeda(f.valor)}`);
      });
      linhas.push('');
    }

    linhas.push('=== REGRA DE DESBLOQUEIO ===');
    if (vencidas.length === 0) {
      linhas.push('Sem faturas vencidas. Pode oferecer desbloqueio.');
    } else if (vencidas.length === 1) {
      linhas.push('1 fatura vencida. Ofereça 2ª via + desbloqueio.');
    } else {
      linhas.push(`${vencidas.length} faturas vencidas. Transfira para humano.`);
    }

    linhas.push('');
    linhas.push(`ID_INTERNO: id_cliente=${data.id} | id_contrato=${data.id_contrato || data.id}`);
    linhas.push('=== FIM ===');

    return linhas.join('\n');
  }

  async buscarContexto(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#get('/api/cliente/buscar', { celular: tel }).catch(() => null);

    if (!data?.id) {
      return 'DADOS DO CLIENTE: Número não encontrado no MK-Auth. Peça o CPF ou CNPJ para localizar.';
    }
    return this.#buildContexto(data);
  }

  async buscarContextoPorDocumento(doc) {
    const data = await this.#get('/api/cliente/buscar', { cpf: doc }).catch(() => null);
    if (!data?.id) return null;
    return this.#buildContexto(data);
  }

  async buscarDados(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#get('/api/cliente/buscar', { celular: tel }).catch(() => null);
    if (!data?.id) return null;

    return {
      nome: data.nome || null,
      contratoId: String(data.id_contrato || data.id || ''),
      statusContrato: (data.status || 'inativo').toLowerCase(),
      filialNome: data.cidade || null,
    };
  }

  async executarTool(toolName, toolInput) {
    switch (toolName) {

      case 'desbloquear_cliente': {
        const data = await this.#post('/api/cliente/desbloquear', {
          id_cliente: toolInput.id_cliente,
        });
        if (data.success) return `Desbloqueio realizado com sucesso!${this.avisoPrazoDesbloqueio()}`;
        return `Não foi possível desbloquear: ${data.message || 'erro'}`;
      }

      case 'enviar_segunda_via': {
        const data = await this.#get('/api/financeiro/aberto', {
          id_cliente: toolInput.id_cliente,
        });
        const faturas = data.faturas || [];
        if (!faturas.length) return 'Nenhuma fatura em aberto.';
        const f = faturas[0];
        return [
          'Mensalidade',
          `Vencimento: ${this.formatarData(f.vencimento)}`,
          `Valor: ${this.formatarMoeda(f.valor)}`,
          f.linha_digitavel ? `\nLinha digitável:\n${f.linha_digitavel}` : '',
          f.pix && this.aceitaPix() ? `\nPIX:\n${f.pix}` : '',
        ].filter(Boolean).join('\n');
      }

      case 'abrir_chamado_tecnico': {
        const data = await this.#post('/api/chamado/criar', {
          id_cliente: toolInput.id_cliente,
          descricao: toolInput.detalhes,
        });
        if (data.protocolo) {
          return `Chamado aberto! Protocolo: ${data.protocolo}.`;
        }
        return 'Não foi possível abrir o chamado.';
      }

      default:
        return `Ação "${toolName}" não suportada pelo MK-Auth.`;
    }
  }
}
