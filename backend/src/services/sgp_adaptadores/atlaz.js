import { SgpAdaptador } from './base.js';

const BASE_URL = 'https://app.atlaz.com.br/api/v2';

export class AtlazAdaptador extends SgpAdaptador {

  async #get(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('token', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Atlaz HTTP ${res.status}`);
    return res.json();
  }

  async #post(endpoint, body = {}) {
    const params = new URLSearchParams({ token: this.apiKey, ...body });
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`Atlaz HTTP ${res.status}`);
    return res.json();
  }

  // Monta contexto completo (com faturas) a partir do retorno de /consultacliente
  async #buildContexto(clienteData) {
    const a = clienteData.assinante;
    const pontos = clienteData.pontos_de_acesso || [];
    const pontoAtivo = pontos.find(p => p.status === 'Ativo') || pontos[0];

    const fatData = await this.#get('/faturas', {
      id_assinante: a.id_assinante,
      apenas_nao_pagas: 1,
      retornar_pix: 1,
    }).catch(() => ({ faturas: [] }));

    const faturas = fatData.faturas || [];
    const hoje = new Date();
    const vencidas = faturas.filter(f => !f.data_pagamento && new Date(f.data_vencimento) < hoje);
    const aVencer  = faturas.filter(f => !f.data_pagamento && new Date(f.data_vencimento) >= hoje);

    const linhas = [
      '=== DADOS DO CLIENTE (Atlaz) ===',
      `Nome: ${a.nome}`,
      `ID: ${a.id_assinante} | CPF/CNPJ: ${a.cpf_cnpj}`,
      `Plano: ${pontoAtivo?.plano || 'não identificado'}`,
      `Status: ${pontoAtivo?.status || 'sem contrato'}`,
      `Cidade: ${pontoAtivo?.cidade || 'não informada'}`,
      `Dia de vencimento mensal: ${a.dia_de_vencimento}`,
      `ID do contrato (id_ponto): ${pontoAtivo?.id_ponto || 'N/A'}`,
      '',
    ];

    if (vencidas.length > 0) {
      linhas.push(`FATURAS VENCIDAS (${vencidas.length}):`);
      vencidas.forEach(f => {
        linhas.push(
          `  Vencto ${this.formatarData(f.data_vencimento)} | ` +
          `${this.formatarMoeda(f.valor_com_juros || f.valor)}` +
          (f.linha_digitavel ? ' | Boleto disponível' : '') +
          (f.pix_brcode       ? ' | PIX disponível'   : '')
        );
      });
      linhas.push('');
    }

    if (aVencer.length > 0) {
      const prox = aVencer[0];
      linhas.push(`PRÓXIMA FATURA: ${this.formatarData(prox.data_vencimento)} | ${this.formatarMoeda(prox.valor)}`);
      linhas.push('');
    }

    if (faturas.length === 0) {
      linhas.push('FINANCEIRO: Sem faturas em aberto.');
      linhas.push('');
    }

    linhas.push('=== REGRA DE DESBLOQUEIO ===');
    if (vencidas.length === 0) {
      linhas.push('Sem faturas vencidas. Pode oferecer desbloqueio imediato se necessário.');
    } else if (vencidas.length === 1) {
      linhas.push('1 fatura vencida. Atlaz PERMITE desbloqueio automático. Ofereça 2ª via + desbloqueio.');
    } else {
      linhas.push(`${vencidas.length} faturas vencidas. Atlaz NÃO permite desbloqueio automático. Transfira para humano.`);
    }

    linhas.push('');
    linhas.push(`ID_INTERNO: id_cliente=${a.id_assinante} | id_contrato=${pontoAtivo?.id_ponto || ''}`);
    linhas.push('=== FIM ===');

    return linhas.join('\n');
  }

  async buscarContexto(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const clienteData = await this.#get('/consultacliente', {
      telefone: tel,
      testar_com_e_sem_nono_digito: 'true',
      ocultar_contratos_desativados: 1,
    });
    if (clienteData.success !== 'true') {
      return 'DADOS DO CLIENTE: Número não encontrado no Atlaz. Peça o CPF ou CNPJ para localizar.';
    }
    return this.#buildContexto(clienteData);
  }

  async buscarContextoPorDocumento(doc) {
    const clienteData = await this.#get('/consultacliente', {
      cpf_cnpj: doc,
    }).catch(() => ({ success: 'false' }));
    console.log('[Atlaz] buscarPorDocumento resposta:', JSON.stringify(clienteData).slice(0, 300));
    if (clienteData.success !== 'true') return null;
    return this.#buildContexto(clienteData);
  }

  async buscarDados(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const clienteData = await this.#get('/consultacliente', {
      telefone: tel,
      testar_com_e_sem_nono_digito: 'true',
      ocultar_contratos_desativados: 1,
    }).catch(() => null);

    if (clienteData?.success !== 'true') return null;

    const a = clienteData.assinante;
    const pontos = clienteData.pontos_de_acesso || [];
    const pontoAtivo = pontos.find(p => p.status === 'Ativo') || pontos[0];

    return {
      nome: a.nome || null,
      contratoId: String(pontoAtivo?.id_ponto || a.id_assinante || ''),
      statusContrato: (pontoAtivo?.status || 'inativo').toLowerCase(),
      filialNome: pontoAtivo?.cidade || null,
    };
  }

  async executarTool(toolName, toolInput) {
    switch (toolName) {

      case 'desbloquear_cliente': {
        const body = { id_assinante: toolInput.id_cliente };
        if (toolInput.id_contrato) body.id_ponto = toolInput.id_contrato;

        const data = await this.#post('/desbloquear', body);

        if (data.success === 'true' && data.liberado === 'true') {
          if (toolInput.id_contrato) {
            await this.#post('/derrubarponto', { id_ponto: toolInput.id_contrato }).catch(() => {});
          }
          return `Desbloqueio realizado! ${data.nome_completo} liberado até ${data.liberado_ate}.`;
        }
        return `Não foi possível desbloquear: ${data.msg}`;
      }

      case 'enviar_segunda_via': {
        const data = await this.#get('/faturas', {
          id_assinante: toolInput.id_cliente,
          apenas_nao_pagas: 1,
          retornar_pix: 1,
        });

        const faturas = (data.faturas || []).filter(f => !f.data_pagamento);
        if (!faturas.length) return 'Nenhuma fatura em aberto encontrada.';

        const f = faturas.sort(
          (a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento)
        )[0];

        const partes = [
          `${f.descricao || 'Mensalidade'}`,
          `Vencimento: ${this.formatarData(f.data_vencimento)}`,
          `Valor: ${this.formatarMoeda(f.valor_com_juros || f.valor)}`,
        ];
        if (f.pix_brcode)       partes.push(`\nPIX copia e cola:\n${f.pix_brcode}`);
        else if (f.linha_digitavel) partes.push(`\nLinha digitável:\n${f.linha_digitavel}`);
        else if (f.link)        partes.push(`\nLink do boleto: ${f.link}`);

        return partes.join('\n');
      }

      case 'abrir_chamado_tecnico': {
        const data = await this.#post('/criarchamado', {
          id_ponto: toolInput.id_contrato,
          detalhes: toolInput.detalhes,
          limite_de_horas: 8,
        });
        if (data.success === 'true') {
          return `Chamado aberto! Protocolo: ${data.protocolo}. Nossa equipe entrará em contato em breve.`;
        }
        return `Não foi possível abrir o chamado: ${data.msg}`;
      }

      default:
        return `Ação "${toolName}" não suportada pelo Atlaz.`;
    }
  }
}
