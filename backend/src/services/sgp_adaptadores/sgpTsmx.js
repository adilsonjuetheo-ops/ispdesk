import { SgpAdaptador } from './base.js';

// API pública e compartilhada do SGP TSMX (https://www.tsmx.net.br/developers)
// Credenciais (app + token) são geradas por provedor em:
//   Sistema -> Ferramentas -> Painel Admin -> Tokens
const BASE_URL = 'https://api.sgp.net.br';

export class SgpTsmxAdaptador extends SgpAdaptador {

  // sgpApiKey armazenado como "app:token" (mesmo padrão usado pelo adapter IXC)
  #credenciais() {
    const [app, ...resto] = (this.apiKey || '').split(':');
    return { app: app || '', token: resto.join(':') || '' };
  }

  async #consultarCliente(filtro) {
    const { app, token } = this.#credenciais();
    const form = new FormData();
    form.append('app', app);
    form.append('token', token);
    for (const [k, v] of Object.entries(filtro)) {
      if (v != null) form.append(k, String(v));
    }
    const res = await fetch(`${BASE_URL}/api/ura/consultacliente/`, {
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

    if (titulos > 0 || valorAberto > 0) {
      linhas.push(`FINANCEIRO: ${titulos} título(s) em aberto, valor total ${this.formatarMoeda(valorAberto)}.`);
    } else {
      linhas.push('FINANCEIRO: Sem faturas em aberto.');
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
