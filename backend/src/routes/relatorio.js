import { Router } from 'express';
import { db } from '../db/index.js';
import { conversas, mensagens, clientes } from '../db/schema.js';
import { eq, and, gte, lt, isNotNull, count, desc, sql } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';

const router = Router();
router.use(autenticar);

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
      eq(mensagens.origem, 'usuario'),
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

export default router;
