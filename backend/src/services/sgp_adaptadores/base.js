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

  tools() {
    return TOOLS_PADRAO;
  }

  async executarTool(toolName, toolInput) {
    throw new Error(`${this.constructor.name}: executarTool não implementado`);
  }

  normalizarTelefone(tel) {
    return tel.replace(/\D/g, '').replace(/^55/, '');
  }

  formatarMoeda(valor) {
    return `R$ ${parseFloat(valor || 0).toFixed(2)}`;
  }

  formatarData(dataStr) {
    if (!dataStr) return 'não informada';
    return new Date(dataStr).toLocaleDateString('pt-BR');
  }
}

export const TOOLS_PADRAO = [
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
        id_contrato: { type: 'string', description: 'ID do contrato do cliente' },
        detalhes:    { type: 'string', description: 'Descrição do problema relatado' },
      },
      required: ['id_contrato', 'detalhes'],
    },
  },
];
