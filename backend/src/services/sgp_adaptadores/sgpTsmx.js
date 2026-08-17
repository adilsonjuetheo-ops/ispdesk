import { SgpAdaptador } from './base.js';

// Cada provedor roda sua própria instância do SGP TSMX no próprio domínio
// (ex: https://<provedor>.sgp.tsmx.com.br) — não existe API compartilhada única.
// Credenciais (app + token) são geradas em:
//   Administração -> Sistema -> Ferramentas -> Painel Admin -> Tokens
export class SgpTsmxAdaptador extends SgpAdaptador {

  // sgpApiKey armazenado como "app:token" (mesmo padrão usado pelo adapter IXC)
  // "app" é o valor do campo "Aplicações" vinculado ao token (ex: "Bia"), NÃO a descrição do token.
  #credenciais() {
    const [app, ...resto] = (this.apiKey || '').split(':');
    return { app: app || '', token: resto.join(':') || '' };
  }

  // Retry com timeout — só para chamadas de LEITURA (idempotentes, seguras de repetir).
  // A API do SGP TSMX vem apresentando timeouts intermitentes em consultas sem
  // filtro de contrato (ex: listar títulos por data em toda a base).
  async #fetchComRetry(url, options, tentativas = 3) {
    let ultimoErro;
    for (let i = 0; i < tentativas; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
      } catch (err) {
        clearTimeout(timeoutId);
        ultimoErro = err;
        if (i < tentativas - 1) {
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
    }
    throw new Error(`SGP indisponível após ${tentativas} tentativas: ${ultimoErro?.message}`);
  }

  async #chamar(endpoint, filtro) {
    const base = await this.validarApiUrl();
    const { app, token } = this.#credenciais();
    const form = new FormData();
    form.append('app', app);
    form.append('token', token);
    for (const [k, v] of Object.entries(filtro)) {
      if (v != null) form.append(k, String(v));
    }
    const url = new URL(`api/ura/${endpoint}/`, `${base.toString().replace(/\/$/, '')}/`);
    const res = await this.#fetchComRetry(url, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`SGP HTTP ${res.status}`);
    return res.json();
  }

  async #chamarJson(endpoint, corpo) {
    const base = await this.validarApiUrl();
    const { app, token } = this.#credenciais();
    const url = new URL(`api/ura/${endpoint}/`, `${base.toString().replace(/\/$/, '')}/`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app, token, ...corpo }),
    });
    if (!res.ok) throw new Error(`SGP HTTP ${res.status}`);
    return res.json();
  }

  #consultarCliente(filtro) {
    return this.#chamar('consultacliente', filtro);
  }

  #consultarTitulos(filtro) {
    return this.#chamar('titulos', filtro);
  }

  // A API espera CPF/CNPJ formatado (ex: 999.999.999-99 ou 99.999.999/0001-99)
  #formatarDocumento(doc) {
    const d = (doc || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return doc;
  }

  #contratoAtivo(contratos) {
    return contratos.find(c => c.contratoStatus === 1) || contratos[0];
  }

  // Converte "(38) 99733-8693" -> "5538997338693" (formato aceito pela API do WhatsApp)
  #formatarTelefoneWhatsapp(tel) {
    let d = (tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    return d;
  }

  #formatarContexto(c) {
    const nome = c.razaoSocial || c.nome || 'não informado';
    const status = (c.contratoStatusDisplay || '').trim() || 'não informado';
    const valorAberto = Number(c.contratoValorAberto || 0);
    const titulos = Number(c.contratoTitulosAReceber || 0);

    const linhas = [
      '=== DADOS DO CLIENTE (SGP) ===',
      `Nome: ${nome}`,
      `ID: ${c.contratoId} | CPF/CNPJ: ${c.cpfCnpj || 'não informado'}`,
      `Plano: ${c.planointernet || c.servico_plano || 'não identificado'}`,
      `Status: ${status}`,
      `Cidade: ${c.endereco_cidade || 'não informada'}`,
      '',
    ];

    if (valorAberto > 0) {
      linhas.push(`FINANCEIRO: Valor em aberto ${this.formatarMoeda(valorAberto)} (${titulos} título(s) no total).`);
    } else {
      linhas.push('FINANCEIRO: Sem valores em aberto.');
    }
    linhas.push('');

    linhas.push('=== AÇÕES AUTOMÁTICAS ===');
    linhas.push('Chamado técnico ainda não está automatizado para este SGP — transfira para atendente humano quando o cliente precisar. Desbloqueio (liberação por confiança) e 2ª via/PIX já funcionam normalmente.');

    linhas.push('');
    // id_cliente aqui carrega o ID do contrato (é o identificador usado pelas
    // ações deste SGP, ex: listar títulos), não um id de cliente separado.
    linhas.push(`ID_INTERNO: id_cliente=${c.contratoId} | id_contrato=${c.contratoId || ''}`);
    linhas.push('=== FIM ===');

    return linhas.join('\n');
  }

  async buscarContexto(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#consultarCliente({ telefone: tel }).catch(() => null);
    if (!data?.contratos?.length) {
      return 'DADOS DO CLIENTE: Número não encontrado no SGP. Peça o CPF ou CNPJ para localizar.';
    }
    return this.#formatarContexto(this.#contratoAtivo(data.contratos));
  }

  async buscarContextoPorDocumento(doc) {
    const data = await this.#consultarCliente({ cpfcnpj: this.#formatarDocumento(doc) }).catch(() => null);
    if (!data?.contratos?.length) return null;
    return this.#formatarContexto(this.#contratoAtivo(data.contratos));
  }

  async buscarDados(whatsapp) {
    const tel = this.normalizarTelefone(whatsapp);
    const data = await this.#consultarCliente({ telefone: tel }).catch(() => null);
    if (!data?.contratos?.length) return null;
    const c = this.#contratoAtivo(data.contratos);

    return {
      nome: c.razaoSocial || null,
      contratoId: String(c.contratoId || ''),
      statusContrato: (c.contratoStatusDisplay || '').trim().toLowerCase() || 'inativo',
      filialNome: c.endereco_cidade || null,
    };
  }

  // Lista títulos (todos os clientes) vencendo entre duas datas ("AAAA-MM-DD",
  // inclusive — passe só dataInicio pra uma data exata), já filtrados por
  // status "aberto". Usado pelos lembretes automáticos de fatura.
  async listarTitulosPorVencimento(dataInicio, dataFim = dataInicio) {
    const limit = 250;
    let offset = 0;
    let todos = [];

    while (true) {
      const resp = await this.#consultarTitulos({
        data_vencimento_inicio: dataInicio,
        data_vencimento_fim: dataFim,
        offset,
        limit,
      });
      const pagina = resp?.titulos || [];
      todos = todos.concat(pagina);

      const total = resp?.paginacao?.total ?? todos.length;
      if (pagina.length === 0 || todos.length >= total) break;
      offset += limit;
    }

    return todos.filter(t => t.status === 'aberto');
  }

  async buscarTelefonePorDocumento(doc) {
    const data = await this.#consultarCliente({ cpfcnpj: this.#formatarDocumento(doc) }).catch(() => null);
    if (!data?.contratos?.length) return null;
    const c = this.#contratoAtivo(data.contratos);
    return this.#formatarTelefoneWhatsapp(c?.telefones?.[0]?.contato);
  }

  // Busca o título em aberto mais próximo do vencimento para um cliente
  // específico, independente de data — usado no teste manual por CPF.
  async buscarTituloAbertoPorDocumento(doc) {
    const data = await this.#consultarCliente({ cpfcnpj: this.#formatarDocumento(doc) }).catch(() => null);
    if (!data?.contratos?.length) return null;
    const c = this.#contratoAtivo(data.contratos);

    const tituloResp = await this.#consultarTitulos({ contrato: c.contratoId }).catch(() => null);
    const abertos = (tituloResp?.titulos || []).filter(t => t.status === 'aberto');
    if (!abertos.length) return null;

    return abertos.sort((a, b) => new Date(a.dataVencimento) - new Date(b.dataVencimento))[0];
  }

  async executarTool(toolName, toolInput) {
    if (toolName === 'desbloquear_cliente') {
      const contrato = toolInput.id_cliente || toolInput.id_contrato;
      if (!contrato) return 'ID do contrato não informado.';

      // Prazo de confiança padrão: 2 dias para o cliente regularizar o pagamento.
      const dataPromessa = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const data = await this.#chamarJson('liberacaopromessa', {
        contrato,
        data_promessa: dataPromessa,
        enviar_sms: 1,
      }).catch(err => ({ liberado: false, msg: err.message }));

      if (data.liberado) {
        return `Desbloqueio realizado com sucesso! Válido até ${this.formatarData(dataPromessa)} — combine com o cliente o pagamento até essa data.`;
      }
      return `Não foi possível liberar automaticamente: ${data.msg || 'motivo não informado'}. Transfira para um atendente humano.`;
    }

    if (toolName === 'enviar_segunda_via') {
      const contrato = toolInput.id_cliente || toolInput.id_contrato;
      if (!contrato) return 'ID do contrato não informado.';

      const data = await this.#consultarTitulos({ contrato }).catch(() => null);
      const abertos = (data?.titulos || []).filter(t => t.status === 'aberto');
      if (!abertos.length) return 'Nenhuma fatura em aberto encontrada.';

      const f = abertos.sort(
        (a, b) => new Date(a.dataVencimento) - new Date(b.dataVencimento)
      )[0];

      const partes = [
        f.demonstrativo || 'Mensalidade',
        `Vencimento: ${this.formatarData(f.dataVencimento)}`,
        `Valor: ${this.formatarMoeda(f.valorCorrigido || f.valor)}`,
      ];
      if (f.codigoPix)      partes.push(`\nPIX copia e cola:\n${f.codigoPix}`);
      if (f.linhaDigitavel) partes.push(`\nLinha digitável:\n${f.linhaDigitavel}`);
      else if (!f.codigoPix && f.link) partes.push(`\nLink do boleto: ${f.link}`);

      return {
        texto: partes.join('\n'),
        midia: f.link ? { url: f.link, nome: `boleto-${f.id}.pdf` } : null,
      };
    }

    return 'Esta ação ainda não está disponível para este SGP. Transfira para um atendente humano.';
  }
}
