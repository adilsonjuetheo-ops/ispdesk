import { AtlazAdaptador }    from './sgp_adaptadores/atlaz.js';
import { IxcAdaptador }      from './sgp_adaptadores/ixc.js';
import { MkAuthAdaptador }   from './sgp_adaptadores/mkauth.js';
import { GenericoAdaptador } from './sgp_adaptadores/generico.js';
import { SgpTsmxAdaptador }  from './sgp_adaptadores/sgpTsmx.js';
import { planoTemChamado }   from '../config/planos.js';

const ADAPTADORES = {
  atlaz:    AtlazAdaptador,
  ixc:      IxcAdaptador,
  mkauth:   MkAuthAdaptador,
  generico: GenericoAdaptador,
  tsmx:     SgpTsmxAdaptador,
};

export function criarSgp(tenant) {
  // tenant.sgpTipo e tenant.sgpApiKey — camelCase conforme schema Drizzle
  if (!tenant.sgpTipo || !tenant.sgpApiKey) return null;
  const Adaptador = ADAPTADORES[tenant.sgpTipo] ?? GenericoAdaptador;
  return new Adaptador(tenant);
}

export async function buscarDadosCliente(tenant, whatsapp) {
  const sgp = criarSgp(tenant);
  if (!sgp) return null;
  try {
    return await sgp.buscarDados(whatsapp);
  } catch (err) {
    console.error(`[SGP:${tenant.sgpTipo}] Erro buscarDados:`, err.message);
    return null;
  }
}

export async function buscarContextoSgp(tenant, whatsapp) {
  const sgp = criarSgp(tenant);
  if (!sgp) return '(Integração com SGP não configurada para este provedor)';
  // Provedores que exigem validação por documento: o número de WhatsApp não
  // prova quem é o titular, então nem consultamos por telefone. Sem ID_INTERNO
  // no contexto, nenhuma tool fica autorizada até o CPF/CNPJ ser confirmado.
  if (tenant.exigirDocumento) {
    return 'DADOS DO CLIENTE: Não identificado. Este provedor NÃO aceita o número de WhatsApp como identificação — solicite o CPF ou CNPJ do titular antes de qualquer consulta ou ação.';
  }
  try {
    return await sgp.buscarContexto(whatsapp);
  } catch (err) {
    console.error(`[SGP:${tenant.sgpTipo}] Erro buscarContexto:`, err.message);
    return '(Erro ao consultar SGP. Atenda normalmente e consulte manualmente.)';
  }
}

export async function buscarContextoPorDocumentoSgp(tenant, documento) {
  const sgp = criarSgp(tenant);
  if (!sgp) return '(Integração com SGP não configurada para este provedor)';
  const doc = (documento || '').replace(/\D/g, '');
  if (!doc) return '(Documento inválido)';
  try {
    const contexto = await sgp.buscarContextoPorDocumento(doc);
    return contexto || '(Cliente não encontrado com este CPF/CNPJ)';
  } catch (err) {
    console.error(`[SGP:${tenant.sgpTipo}] Erro buscarContextoPorDocumento:`, err.message);
    return `(Erro ao consultar SGP: ${err.message})`;
  }
}

// Ferramentas que não são de todo plano.
//
// O corte é feito tirando a ferramenta da lista, não pedindo no prompt que o
// modelo não a use: o que ele não enxerga ele não chama, e isso vale mais que
// qualquer instrução. A checagem em executarTool é a segunda tranca — uma
// conversa antiga pode trazer a chamada no histórico depois de o plano mudar.
const TOOLS_POR_PLANO = {
  abrir_chamado_tecnico: tenant => planoTemChamado(tenant.plano),
};

export function toolLiberada(tenant, nome) {
  const exige = TOOLS_POR_PLANO[nome];
  return !exige || exige(tenant);
}

export function getTools(tenant) {
  const sgp = criarSgp(tenant);
  if (!sgp) return [];
  return sgp.tools().filter(t => toolLiberada(tenant, t.name));
}

export async function executarTool(toolName, toolInput, tenant) {
  const sgp = criarSgp(tenant);
  if (!sgp) return 'SGP não configurado para este provedor.';
  // Importa que a recusa não soe como pane: o cliente que ouve "falha no
  // sistema" volta amanhã cobrando o chamado que ninguém abriu.
  if (!toolLiberada(tenant, toolName)) {
    return 'Esta ação não está habilitada para este provedor. NÃO é falha técnica e não adianta tentar de novo: '
      + 'quem abre o chamado é a equipe. Diga ao cliente que vai passar o caso para um atendente, sem mencionar '
      + 'erro ou sistema fora do ar, e escreva ACTION:HANDOFF:problema técnico — abertura de chamado é com a equipe';
  }
  try {
    if (toolName === 'buscar_por_documento') {
      const doc = (toolInput.documento || '').replace(/\D/g, '');
      if (!doc) return 'Documento inválido. Solicite o CPF ou CNPJ novamente.';
      const contexto = await sgp.buscarContextoPorDocumento(doc);
      if (!contexto) {
        return 'Cliente não encontrado com este CPF/CNPJ. Trata-se de um cliente novo — transfira para atendente humano realizar o cadastro. ACTION:HANDOFF:cliente novo — encaminhar para cadastro';
      }
      return contexto;
    }
    return await sgp.executarTool(toolName, toolInput);
  } catch (err) {
    console.error(`[SGP:${tenant.sgpTipo}] Erro tool ${toolName}:`, err.message);
    return `Erro ao executar ação no sistema do provedor: ${err.message}`;
  }
}
