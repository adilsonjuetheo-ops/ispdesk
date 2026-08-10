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

  async #consultarCliente(filtro) {
    const base = await this.validarApiUrl();
    const { app, token } = this.#credenciais();
    const form = new FormData();
    form.append('app', app);
    form.append('token', token);
    for (const [k, v] of Object.entries(filtro)) {
      if (v != null) form.append(k, String(v));
    }
    const url = new URL('api/ura/consultacliente/', `${base.toString().replace(/\/$/, '')}/`);
    const res = await fetch(url, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`SGP HTTP ${res.status}`);
    return res.json();
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

  #formatarContexto(c) {
    const nome = c.razaoSocial || c.nome || 'não informado';
    const status = (c.contratoStatusDisplay || '').trim() || 'não informado';
    const valorAberto = Number(c.contratoValorAberto || 0);
    const titulos = Number(c.contratoTitulosAReceber || 0);

    const linhas = [
      '=== DADOS DO CLIENTE (SGP) ===',
      `Nome: ${nome}`,
      `ID: ${c.clienteId} | CPF/CNPJ: ${c.cpfCnpj || 'não informado'}`,
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
    linhas.push('Desbloqueio, 2ª via e chamado técnico ainda não estão automatizados para este SGP. Transfira para atendente humano quando o cliente precisar de alguma dessas ações.');

    linhas.push('');
    linhas.push(`ID_INTERNO: id_cliente=${c.clienteId} | id_contrato=${c.contratoId || ''}`);
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
      contratoId: String(c.contratoId || c.clienteId || ''),
      statusContrato: (c.contratoStatusDisplay || '').trim().toLowerCase() || 'inativo',
      filialNome: c.endereco_cidade || null,
    };
  }

  async executarTool(toolName, toolInput) {
    return 'Esta ação ainda não está disponível para este SGP. Transfira para um atendente humano.';
  }
}
