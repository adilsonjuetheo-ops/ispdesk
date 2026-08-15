import { validarUrlSgp } from '../urlSegura.js';

export class SgpAdaptador {
  constructor(tenant) {
    this.tenant = tenant;
    // Drizzle retorna camelCase conforme definido no schema
    this.apiKey = tenant.sgpApiKey;
    this.apiUrl = tenant.sgpApiUrl;
  }

  async buscarContexto(whatsapp) {
    throw new Error(`${this.constructor.name}: buscarContexto não implementado`);
  }

  // Retorna { nome, contratoId, statusContrato, filialNome } ou null se não encontrado
  async buscarDados(whatsapp) {
    return null;
  }

  // Retorna contexto completo (texto para a IA) buscando por CPF/CNPJ, ou null se não encontrado
  async buscarContextoPorDocumento(doc) {
    return null;
  }

  tools() {
    return TOOLS_PADRAO;
  }

  // Lista títulos (de todos os clientes) com vencimento numa data "AAAA-MM-DD".
  // Usado pelos lembretes automáticos de fatura. Retorna [] se o SGP não suportar.
  async listarTitulosPorVencimento(data) {
    return [];
  }

  // Retorna o telefone (formato apto a WhatsApp) do cliente pelo CPF/CNPJ, ou null.
  async buscarTelefonePorDocumento(doc) {
    return null;
  }

  // Retorna o título em aberto mais próximo do vencimento de um cliente pelo
  // CPF/CNPJ, independente de data. Usado no teste manual de lembretes.
  async buscarTituloAbertoPorDocumento(doc) {
    return null;
  }

  async executarTool(toolName, toolInput) {
    throw new Error(`${this.constructor.name}: executarTool não implementado`);
  }

  async validarApiUrl() {
    return validarUrlSgp(this.apiUrl);
  }

  normalizarTelefone(tel) {
    return tel.replace(/\D/g, '').replace(/^55/, '');
  }

  formatarMoeda(valor) {
    return `R$ ${parseFloat(valor || 0).toFixed(2)}`;
  }

  formatarData(dataStr) {
    if (!dataStr) return 'não informada';
    // "2026-07-25" é data pura, sem hora. new Date() a interpreta como UTC e,
    // em fuso negativo, toLocaleDateString devolve o dia anterior — vencimento
    // errado para o cliente. Formatamos direto quando o formato é esse.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataStr).trim());
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return new Date(dataStr).toLocaleDateString('pt-BR');
  }
}

export const TOOLS_PADRAO = [
  {
    name: 'buscar_por_documento',
    description:
      'Busca dados completos do cliente no sistema usando CPF ou CNPJ. ' +
      'Use quando o cliente não foi encontrado pelo número de WhatsApp e forneceu o documento.',
    input_schema: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'CPF ou CNPJ do cliente (com ou sem formatação)' },
      },
      required: ['documento'],
    },
  },
  {
    name: 'desbloquear_cliente',
    description:
      'Solicita desbloqueio automático da internet do cliente. ' +
      'Só use quando o cliente tiver no máximo 1 fatura vencida.',
    input_schema: {
      type: 'object',
      properties: {
        id_cliente:  { type: 'string', description: 'ID interno do cliente no SGP' },
        id_contrato: { type: 'string', description: 'ID do contrato (opcional)' },
      },
      required: ['id_cliente'],
    },
  },
  {
    name: 'enviar_segunda_via',
    description: 'Busca e retorna a 2ª via do boleto ou PIX da fatura mais recente em aberto.',
    input_schema: {
      type: 'object',
      properties: {
        id_cliente: { type: 'string', description: 'ID interno do cliente no SGP' },
      },
      required: ['id_cliente'],
    },
  },
  {
    name: 'abrir_chamado_tecnico',
    description: 'Abre chamado técnico para problemas de conexão que não são por inadimplência.',
    input_schema: {
      type: 'object',
      properties: {
        id_cliente:  { type: 'string', description: 'ID interno do cliente no SGP' },
        id_contrato: { type: 'string', description: 'ID do contrato do cliente' },
        detalhes:    { type: 'string', description: 'Descrição do problema relatado' },
      },
      required: ['id_cliente', 'id_contrato', 'detalhes'],
    },
  },
];
