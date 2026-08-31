import { db } from '../db/index.js';
import { tenants, filiais, clientes, mensagens, conversas } from '../db/schema.js';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';
import { buscarDadosCliente } from './sgp.js';

const GRAPH = 'https://graph.facebook.com/v19.0';
const TIMEOUT_MS = 12000;

// Cada verificação devolve sempre o mesmo formato e nunca lança. Um diagnóstico
// que quebra no meio é pior que não ter diagnóstico: some justamente a
// informação de que algo está errado.
const ok = (titulo, detalhe) => ({ titulo, estado: 'ok', detalhe });
const alerta = (titulo, detalhe, comoResolver) => ({ titulo, estado: 'alerta', detalhe, comoResolver });
const falha = (titulo, detalhe, comoResolver) => ({ titulo, estado: 'falha', detalhe, comoResolver });

// Leitura na Graph API não é cobrada — a Meta fatura mensagem, não consulta.
async function checarNumero(rotulo, numberId, token) {
  if (!numberId || !token) {
    return alerta(rotulo, 'Nenhum número do WhatsApp conectado.',
      'Conecte em Configurações › WhatsApp.');
  }
  try {
    const res = await fetch(
      `${GRAPH}/${numberId}?fields=display_phone_number,verified_name,quality_rating,status&access_token=${token}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const data = await res.json();
    if (data.error) {
      return falha(rotulo, `A Meta recusou a consulta: ${data.error.message}`,
        'Normalmente é o token expirado ou revogado. Reconecte o número em Configurações.');
    }
    const numero = data.display_phone_number || numberId;
    const qualidade = data.quality_rating;

    // Todo app da Meta nasce com um número de teste americano. Enquanto ele
    // estiver ali, tudo "funciona" e nenhum cliente consegue falar com o
    // provedor — foi o caso real de um provedor que nunca entrou no ar.
    const ehTeste = /^\+1\s*555/.test(numero) || /test\s*number/i.test(data.verified_name || '');
    if (ehTeste) {
      return falha(rotulo, `${numero} é o número de TESTE da Meta, não um número real.`,
        'Nenhum cliente consegue falar com o provedor por aqui. Conecte o número verdadeiro em Configurações › WhatsApp.');
    }
    // Conectar o número no Embedded Signup não basta: ele ainda precisa ser
    // REGISTRADO na Cloud API. Enquanto o status for PENDING, a consulta à Meta
    // responde bonito — nome, telefone, qualidade — e o número não envia nem
    // recebe nada. Este check dizia "conectado e respondendo" nesse estado.
    const situacao = data.status;
    if (situacao && situacao !== 'CONNECTED') {
      const explicacao = {
        PENDING: 'o número foi conectado mas ainda não foi registrado na Cloud API — ele não envia nem recebe mensagens.',
        DISCONNECTED: 'o número foi desconectado da Cloud API.',
        BANNED: 'a Meta baniu este número.',
        RESTRICTED: 'a Meta restringiu este número.',
        FLAGGED: 'a Meta sinalizou este número por qualidade baixa.',
        RATE_LIMITED: 'o número atingiu o limite de envio.',
        UNVERIFIED: 'o número ainda não foi verificado.',
        MIGRATED: 'o número foi migrado para outra conta.',
        DELETED: 'o número foi excluído.',
      }[situacao];
      const comoResolver = situacao === 'PENDING'
        ? 'No Gerenciador do WhatsApp da Meta, abra o número e conclua o registro definindo o PIN de verificação em duas etapas.'
        : 'Verifique a situação do número no Gerenciador do WhatsApp da Meta.';
      return falha(rotulo, `${numero} está com status ${situacao}: ${explicacao || 'o número não está operacional.'}`, comoResolver);
    }
    if (qualidade && qualidade !== 'GREEN' && qualidade !== 'UNKNOWN') {
      return alerta(rotulo, `${numero} conectado, mas a Meta classificou a qualidade como ${qualidade}.`,
        'Qualidade baixa reduz o limite diário de mensagens. Costuma vir de bloqueios feitos por clientes.');
    }
    return ok(rotulo, `${numero} conectado e respondendo.`);
  } catch (err) {
    return falha(rotulo, `Não foi possível falar com a Meta: ${err.message}`,
      'Pode ser instabilidade momentânea. Tente de novo em alguns minutos.');
  }
}

async function checarSgp(tenant) {
  const rotulo = 'Integração com o sistema do provedor';
  if (!tenant.sgpTipo || !tenant.sgpApiKey) {
    return alerta(rotulo, 'Nenhum sistema (IXC, SGP, Atlaz, MKAuth) configurado.',
      'Sem ele o assistente não consulta fatura nem desbloqueia.');
  }
  // Testa com alguém que já foi localizado no sistema alguma vez (tem contrato
  // gravado). Com um número qualquer, "não encontrado" não provaria nada — a
  // pessoa pode simplesmente não ser cliente.
  const [cliente] = await db.select({ whatsapp: clientes.whatsapp })
    .from(clientes)
    .where(and(eq(clientes.tenantId, tenant.id), isNotNull(clientes.contratoId)))
    .orderBy(desc(clientes.ultimoContato))
    .limit(1);

  if (!cliente) {
    return alerta(rotulo, `${tenant.sgpTipo.toUpperCase()} configurado, mas ainda não há cliente para testar.`,
      'O teste roda sozinho assim que o primeiro cliente escrever.');
  }
  try {
    const dados = await buscarDadosCliente(tenant, cliente.whatsapp);
    return dados
      ? ok(rotulo, `${tenant.sgpTipo.toUpperCase()} respondendo e localizando clientes.`)
      : alerta(rotulo, `${tenant.sgpTipo.toUpperCase()} respondeu, mas não localizou um cliente que já tinha contrato registrado.`,
        'O sistema está no ar. Pode ser cadastro alterado lá, ou o número do cliente ter mudado.');
  } catch (err) {
    const msg = String(err.message || '');
    const ehIp = /IP.*liberad|not allowed|n[ãa]o est[áa] liberado/i.test(msg);
    return falha(rotulo, `${tenant.sgpTipo.toUpperCase()} recusou a consulta: ${msg}`,
      ehIp
        ? 'O servidor do ISPDesk precisa ser liberado no firewall do seu sistema. Peça ao suporte dele para liberar o IP.'
        : 'Confira a URL e o token em Configurações › Integração.');
  }
}

async function checarRecebimento(tenantId) {
  const rotulo = 'Recebimento de mensagens';
  const [linha] = await db
    .select({ ultima: sql`max(${mensagens.enviadaEm})` })
    .from(mensagens)
    .innerJoin(conversas, eq(conversas.id, mensagens.conversaId))
    .where(and(eq(conversas.tenantId, tenantId), eq(mensagens.origem, 'cliente')));

  if (!linha?.ultima) {
    return alerta(rotulo, 'Nenhuma mensagem de cliente recebida até agora.',
      'Se o número já foi divulgado, vale conferir o webhook no painel da Meta.');
  }
  const horas = Math.floor((Date.now() - new Date(linha.ultima).getTime()) / 3600000);
  if (horas >= 48) {
    return alerta(rotulo, `A última mensagem de cliente chegou há ${Math.floor(horas / 24)} dia(s).`,
      'Silêncio longo pode ser normal, mas também pode ser o webhook desconectado.');
  }
  return ok(rotulo, horas < 1
    ? 'Mensagens chegando normalmente (a última há menos de 1 hora).'
    : `Mensagens chegando normalmente (a última há ${horas}h).`);
}

// Assinatura digital: o que quebra aqui quebra em silêncio. O contrato é
// assinado no D4Sign e o painel nunca fica sabendo, então a conversa dorme como
// "pendente" e ninguém percebe até alguém cobrar.
function checarAssinatura(tenant) {
  const titulo = 'Assinatura digital de contratos';
  if (!tenant.assinaturaTipo) {
    return ok(titulo, 'Não configurada — o envio de contrato está desativado para este provedor.');
  }
  if (!tenant.assinaturaToken) {
    return falha(titulo, `Plataforma ${tenant.assinaturaTipo} escolhida, mas sem token de API.`,
      'Configurações → Assinatura Digital: preencha o token da plataforma.');
  }
  if (tenant.assinaturaTipo === 'd4sign' && !tenant.assinaturaExtra?.cofreUuid) {
    return falha(titulo, 'D4Sign configurado sem o UUID do cofre — o upload do contrato não tem destino.',
      'Configurações → Assinatura Digital: cole a URL do cofre no D4Sign.');
  }
  if (tenant.assinaturaTipo === 'd4sign' && !process.env.API_PUBLIC_URL) {
    return alerta(titulo, 'D4Sign pronto, mas o servidor não sabe o próprio endereço público: o webhook de confirmação não é registrado. O cliente assina e a conversa continua marcada como pendente.',
      'Definir a variável API_PUBLIC_URL no servidor (ex.: https://api.seudominio.com.br) e reiniciar.');
  }
  return ok(titulo, `${tenant.assinaturaTipo} configurado, modelo de contrato: ${tenant.contratoModelo || 'residencial'}.`);
}

export async function diagnosticar(tenantId) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Provedor não encontrado');

  const listaFiliais = await db.select().from(filiais)
    .where(and(eq(filiais.tenantId, tenantId), eq(filiais.ativo, true)));

  const comNumeroProprio = listaFiliais.filter(f => f.whatsappNumberId && f.whatsappToken);

  // Em paralelo: são consultas independentes e o atendente está esperando.
  const itens = await Promise.all([
    checarNumero('Número principal do WhatsApp', tenant.whatsappNumberId, tenant.whatsappToken),
    checarSgp(tenant),
    checarRecebimento(tenantId),
    checarAssinatura(tenant),
    ...comNumeroProprio.map(f =>
      checarNumero(`Número da filial ${f.nome}`, f.whatsappNumberId, f.whatsappToken)),
  ]);

  const falhas = itens.filter(i => i.estado === 'falha').length;
  const alertas = itens.filter(i => i.estado === 'alerta').length;

  return {
    verificadoEm: new Date().toISOString(),
    resumo: falhas > 0 ? 'falha' : alertas > 0 ? 'alerta' : 'ok',
    falhas,
    alertas,
    itens,
  };
}
