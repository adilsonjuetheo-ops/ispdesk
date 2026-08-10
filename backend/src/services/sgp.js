import { AtlazAdaptador }    from './sgp_adaptadores/atlaz.js';
import { IxcAdaptador }      from './sgp_adaptadores/ixc.js';
import { MkAuthAdaptador }   from './sgp_adaptadores/mkauth.js';
import { GenericoAdaptador } from './sgp_adaptadores/generico.js';
import { SgpTsmxAdaptador }  from './sgp_adaptadores/sgpTsmx.js';

const ADAPTADORES = {
  atlaz:    AtlazAdaptador,
  ixc:      IxcAdaptador,
  mkauth:   MkAuthAdaptador,
  generico: GenericoAdaptador,
  tsmx:     SgpTsmxAdaptador,
};

function criarSgp(tenant) {
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

export function getTools(tenant) {
  const sgp = criarSgp(tenant);
  return sgp ? sgp.tools() : [];
}

export async function executarTool(toolName, toolInput, tenant) {
  const sgp = criarSgp(tenant);
  if (!sgp) return 'SGP não configurado para este provedor.';
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
