import { SgpAdaptador } from './base.js';

// O provedor implementa estes 4 endpoints no sistema dele:
//   POST {sgp_api_url}/consultar    body: { token, whatsapp }
//   POST {sgp_api_url}/desbloquear  body: { token, id_cliente, id_contrato }
//   POST {sgp_api_url}/segunda_via  body: { token, id_cliente }
//   POST {sgp_api_url}/chamado      body: { token, id_contrato, detalhes }
//
// Resposta esperada sempre: { sucesso: true|false, dados: {}, mensagem: "" }

export class GenericoAdaptador extends SgpAdaptador {

  async #chamar(acao, body = {}) {
    const url = `${this.apiUrl.replace(/\/$/, '')}/${acao}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.apiKey, ...body }),
    });
    if (!res.ok) throw new Error(`SGP genérico HTTP ${res.status}`);
    return res.json();
  }

  async buscarContexto(whatsapp) {
    const data = await this.#chamar('consultar', { whatsapp }).catch(() => null);

    if (!data?.sucesso) {
      return 'DADOS DO CLIENTE: Não encontrado no sistema. Peça o CPF.';
    }

    const d = data.dados;

    // Se o sistema já retornar bloco formatado para a IA, usa direto
    if (d.contexto_ia) return d.contexto_ia;

    return [
      '=== DADOS DO CLIENTE ===',
      `Nome: ${d.nome || 'não informado'}`,
      `ID: ${d.id_cliente}`,
      `Status: ${d.status || 'não informado'}`,
      `Plano: ${d.plano || 'não informado'}`,
      `Faturas vencidas: ${d.faturas_vencidas ?? 'não informado'}`,
      '',
      `ID_INTERNO: id_cliente=${d.id_cliente} | id_contrato=${d.id_contrato || ''}`,
      '=== FIM ===',
    ].join('\n');
  }

  async buscarDados(whatsapp) {
    const data = await this.#chamar('consultar', { whatsapp }).catch(() => null);
    if (!data?.sucesso) return null;
    const d = data.dados;

    return {
      nome: d.nome || null,
      contratoId: String(d.id_contrato || d.id_cliente || ''),
      statusContrato: (d.status || 'inativo').toLowerCase(),
      filialNome: d.cidade || d.filial || null,
    };
  }

  async executarTool(toolName, toolInput) {
    const acoes = {
      desbloquear_cliente:   'desbloquear',
      enviar_segunda_via:    'segunda_via',
      abrir_chamado_tecnico: 'chamado',
    };

    const acao = acoes[toolName];
    if (!acao) return `Ação "${toolName}" não suportada.`;

    const data = await this.#chamar(acao, toolInput);
    return data?.mensagem ||
      (data?.sucesso ? 'Ação realizada com sucesso!' : 'Erro ao executar ação.');
  }
}
