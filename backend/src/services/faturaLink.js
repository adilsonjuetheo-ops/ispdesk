import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { faturaLinks } from '../db/schema.js';
import { eq, lt } from 'drizzle-orm';

// Quanto tempo a pagina de pagamento continua de pe depois de criada.
//
// Nao e seguranca, e higiene: o PIX dinamico do gateway vence antes disso, e
// uma fatura de tres meses atras aberta pelo historico do WhatsApp mostraria
// um codigo que o banco recusa — o cliente acharia que o provedor errou.
const VALIDADE_DIAS = 90;

// 12 bytes = 16 caracteres em base64url. O token cabe num link curto e ainda
// assim nao e adivinhavel: a pagina mostra nome, valor e codigo de pagamento
// de uma pessoa, entao varrer tokens nao pode ser viavel.
function novoToken() {
  return crypto.randomBytes(12).toString('base64url');
}

// Cria (ou atualiza) a pagina publica de pagamento de um titulo e devolve o
// token. Reaproveita o token do mesmo titulo: o lembrete pre e o pos falam da
// mesma fatura, e o cliente que guardou o primeiro link precisa continuar
// caindo num PIX valido, com o valor ja corrigido.
export async function criarLinkFatura(tenant, titulo, { codigoPix, link }) {
  const expiraEm = new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);
  const dados = {
    tenantId: tenant.id,
    tituloId: titulo.id != null ? String(titulo.id) : null,
    clienteNome: titulo.clienteNome || null,
    descricao: titulo.demonstrativo || 'Mensalidade',
    valor: titulo.valorCorrigido || titulo.valor || null,
    vencimento: titulo.dataVencimento || null,
    codigoPix: codigoPix || null,
    linkBoleto: link || null,
    expiraEm,
  };

  const [criado] = await db.insert(faturaLinks)
    .values({ token: novoToken(), ...dados })
    .onConflictDoUpdate({
      target: [faturaLinks.tenantId, faturaLinks.tituloId],
      set: {
        valor: dados.valor,
        codigoPix: dados.codigoPix,
        linkBoleto: dados.linkBoleto,
        descricao: dados.descricao,
        vencimento: dados.vencimento,
        expiraEm,
      },
    })
    .returning({ token: faturaLinks.token });

  return criado?.token || null;
}

export async function buscarLinkFatura(token) {
  const [registro] = await db.select().from(faturaLinks)
    .where(eq(faturaLinks.token, token))
    .limit(1);
  return registro || null;
}

// Conta a abertura sem derrubar a pagina se o banco reclamar: o cliente esta
// tentando pagar, e a estatistica nao vale uma tela de erro.
export async function registrarAbertura(token, aberturasAtuais) {
  await db.update(faturaLinks)
    .set({ aberturas: (aberturasAtuais || 0) + 1 })
    .where(eq(faturaLinks.token, token))
    .catch(err => console.error('[faturaLink] Falha ao contar abertura:', err.message));
}

// Limpeza dos vencidos. Guardar codigo PIX e nome de cliente para sempre nao
// serve a ninguem — a pagina ja nao abre depois da validade.
export async function limparLinksExpirados() {
  await db.delete(faturaLinks)
    .where(lt(faturaLinks.expiraEm, new Date()))
    .catch(err => console.error('[faturaLink] Falha na limpeza:', err.message));
}
