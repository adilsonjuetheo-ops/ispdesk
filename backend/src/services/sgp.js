import { AtlazAdaptador }    from './sgp_adaptadores/atlaz.js';
import { IxcAdaptador }      from './sgp_adaptadores/ixc.js';
import { MkAuthAdaptador }   from './sgp_adaptadores/mkauth.js';
import { GenericoAdaptador } from './sgp_adaptadores/generico.js';

const ADAPTADORES = {
  atlaz:    AtlazAdaptador,
  ixc:      IxcAdaptador,
  mkauth:   MkAuthAdaptador,
  generico: GenericoAdaptador,
};

function criarSgp(tenant) {
  // tenant.sgpTipo e tenant.sgpApiKey — camelCase conforme schema Drizzle
  if (!tenant.sgpTipo || !tenant.sgpApiKey) return null;
  const Adaptador = ADAPTADORES[tenant.sgpTipo] ?? GenericoAdaptador;
  return new Adaptador(tenant);
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

export function getTools(tenant) {
  const sgp = criarSgp(tenant);
  return sgp ? sgp.tools() : [];
}

export async function executarTool(toolName, toolInput, tenant) {
  const sgp = criarSgp(tenant);
  if (!sgp) return 'SGP não configurado para este provedor.';
  try {
    return await sgp.executarTool(toolName, toolInput);
  } catch (err) {
    console.error(`[SGP:${tenant.sgpTipo}] Erro tool ${toolName}:`, err.message);
    return `Erro ao executar ação no sistema do provedor: ${err.message}`;
  }
}
