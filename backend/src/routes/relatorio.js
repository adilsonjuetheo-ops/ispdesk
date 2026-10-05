import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes, tenants, npsRespostas, acoesBot } from '../db/schema.js';
import { eq, and, gte, lt, isNotNull, count, desc, sql } from 'drizzle-orm';
import { autenticar, apenasAdmin } from '../middleware/auth.js';
import { dentroDoHorario } from '../services/horarios.js';

const router = Router();
router.use(autenticar, apenasAdmin);

router.get('/', async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const tenantId = req.user.role === 'superadmin'
    ? req.query.tenantId
    : req.user.tenantId;

  if (!tenantId) return res.status(400).json({ erro: 'tenantId obrigatório' });

  const [ano, m] = mes.split('-').map(Number);
  const inicio = new Date(ano, m - 1, 1);
  const fim    = new Date(ano, m, 1);

  const baseConv = and(
    eq(conversas.tenantId, tenantId),
    gte(conversas.iniciadaEm, inicio),
    lt(conversas.iniciadaEm, fim),
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(conversas)
    .where(baseConv);

  const [{ comHumano }] = await db
    .select({ comHumano: count() })
    .from(conversas)
    .where(and(baseConv, isNotNull(conversas.agenteId)));

  const [{ novosContatos }] = await db
    .select({ novosContatos: count() })
    .from(clientes)
    .where(and(
      eq(clientes.tenantId, tenantId),
      gte(clientes.criadoEm, inicio),
      lt(clientes.criadoEm, fim),
    ));

  const [{ totalMensagens }] = await db
    .select({ totalMensagens: count() })
    .from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(and(
      eq(conversas.tenantId, tenantId),
      gte(mensagens.enviadaEm, inicio),
      lt(mensagens.enviadaEm, fim),
      eq(mensagens.origem, 'cliente'),
    ));

  const motivosRows = await db
    .select({ motivo: conversas.motivoHandoff, qt: count() })
    .from(conversas)
    .where(and(baseConv, isNotNull(conversas.motivoHandoff)))
    .groupBy(conversas.motivoHandoff)
    .orderBy(desc(count()))
    .limit(1);

  const diasRows = await db
    .select({
      dia: sql`DATE(${conversas.iniciadaEm} AT TIME ZONE 'America/Sao_Paulo')`.as('dia'),
      qt: count(),
    })
    .from(conversas)
    .where(baseConv)
    .groupBy(sql`DATE(${conversas.iniciadaEm} AT TIME ZONE 'America/Sao_Paulo')`)
    .orderBy(desc(count()))
    .limit(1);

  res.json({
    mes,
    total:           Number(total),
    comHumano:       Number(comHumano),
    botResolvido:    Number(total) - Number(comHumano),
    novosContatos:   Number(novosContatos),
    totalMensagens:  Number(totalMensagens),
    motivoPrincipal: motivosRows[0]?.motivo ?? null,
    diaMaisMovimentado: diasRows[0]
      ? { dia: diasRows[0].dia, total: Number(diasRows[0].qt) }
      : null,
  });
});

// O que o ISPDesk entregou ao provedor no período, em resultado e não em
// volume. É a tela que o dono olha para saber se a mensalidade se paga.
//
// "Resolvido pelo assistente" é estrito de propósito: conversa encerrada, sem
// transferência pedida e sem atendente ter assumido. O Relatório conta como
// resolvida qualquer conversa que nenhum atendente pegou — inclusive as que o
// bot transferiu e ficaram esperando — e aqui o número precisa resistir a
// quem duvidar dele.
const MINUTOS_POR_ATENDIMENTO = 8;

router.get('/resultados', async (req, res) => {
  const tenantId = req.user.role === 'superadmin' ? req.query.tenantId : req.user.tenantId;
  if (!tenantId) return res.status(400).json({ erro: 'tenantId obrigatório' });

  const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const [tenant] = await db.select({ horarios: tenants.horarios })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  let horarios = tenant?.horarios || null;
  if (typeof horarios === 'string') { try { horarios = JSON.parse(horarios); } catch { horarios = null; } }

  const convs = await db.select({
    iniciadaEm: conversas.iniciadaEm,
    status: conversas.status,
    agenteId: conversas.agenteId,
    motivoHandoff: conversas.motivoHandoff,
  }).from(conversas)
    .where(and(eq(conversas.tenantId, tenantId), gte(conversas.iniciadaEm, desde)));

  const encerradas = convs.filter(c => c.status === 'encerrada');
  const resolvidasBot = encerradas.filter(c => !c.agenteId && !c.motivoHandoff).length;
  // Só faz sentido com expediente configurado; sem ele tudo é "dentro".
  const foraDoHorario = horarios?.dias
    ? convs.filter(c => c.iniciadaEm && !dentroDoHorario(horarios, new Date(c.iniciadaEm))).length
    : null;

  const daConversa = and(eq(conversas.tenantId, tenantId), gte(mensagens.enviadaEm, desde), eq(mensagens.origem, 'bot'));
  const [msgs] = await db.select({
    respondidas: sql`count(*) filter (where ${mensagens.conteudo} not like '[Sistema]%')`,
    lembretes: sql`count(*) filter (where ${mensagens.conteudo} like '[Sistema] Lembrete de fatura%')`,
  }).from(mensagens)
    .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
    .where(daConversa);

  const [{ contratos }] = await db.select({ contratos: count() }).from(conversas)
    .where(and(
      eq(conversas.tenantId, tenantId),
      eq(conversas.contratoStatus, 'assinado'),
      gte(conversas.contratoEnviadoEm, desde),
    ));

  const notas = await db.select({ categoria: npsRespostas.categoria }).from(npsRespostas)
    .where(and(
      eq(npsRespostas.tenantId, tenantId),
      gte(npsRespostas.respondidoEm, desde),
      isNotNull(npsRespostas.nota),
    ));
  const promotores = notas.filter(n => n.categoria === 'promotor').length;
  const detratores = notas.filter(n => n.categoria === 'detrator').length;

  const acoes = await db.select({ acao: acoesBot.acao, qt: count() }).from(acoesBot)
    .where(and(eq(acoesBot.tenantId, tenantId), gte(acoesBot.criadoEm, desde)))
    .groupBy(acoesBot.acao);
  const qtAcao = a => Number(acoes.find(x => x.acao === a)?.qt || 0);
  // Segunda via e desbloqueio só passaram a ser registrados agora; a tela
  // precisa dizer desde quando, senão "3 desbloqueios em 90 dias" engana.
  const [{ primeira }] = await db.select({ primeira: sql`min(${acoesBot.criadoEm})` })
    .from(acoesBot).where(eq(acoesBot.tenantId, tenantId));

  res.json({
    dias,
    atendimentos: convs.length,
    encerrados: encerradas.length,
    resolvidosBot: resolvidasBot,
    horasPoupadas: Math.round((resolvidasBot * MINUTOS_POR_ATENDIMENTO) / 60),
    minutosPorAtendimento: MINUTOS_POR_ATENDIMENTO,
    foraDoHorario,
    mensagensRespondidas: Number(msgs?.respondidas || 0),
    lembretesFatura: Number(msgs?.lembretes || 0),
    contratosAssinados: Number(contratos),
    segundasVias: qtAcao('segunda_via'),
    desbloqueios: qtAcao('desbloqueio'),
    acoesRegistradasDesde: primeira || null,
    nps: notas.length
      ? { score: Math.round(((promotores - detratores) / notas.length) * 100), respostas: notas.length }
      : null,
  });
});

export default router;
