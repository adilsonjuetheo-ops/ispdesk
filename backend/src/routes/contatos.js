import { Router } from 'express';
import { db } from '../db/index.js';
import { clientes, conversas, tenants } from '../db/schema.js';
import { eq, and, or, ilike, desc, sql as sqlRaw } from 'drizzle-orm';
import { autenticar } from '../middleware/auth.js';
import { normalizarTelefoneBR } from '../services/telefone.js';
import { buscarDadosCliente } from '../services/sgp.js';

const router = Router();
router.use(autenticar);

// Agenda do provedor. Reaproveita a tabela de clientes: quem escreve já entra
// aqui sozinho, e esta tela permite cadastrar quem ainda não escreveu.
router.get('/', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.json([]);

  const busca = String(req.query.busca || '').trim();
  const filtros = [eq(clientes.tenantId, tenantId)];
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    filtros.push(or(
      ilike(clientes.nome, `%${busca}%`),
      ilike(clientes.whatsapp, `%${digitos || busca}%`),
      ilike(clientes.contratoId, `%${busca}%`),
    ));
  }

  const linhas = await db.select({
    id: clientes.id,
    whatsapp: clientes.whatsapp,
    nome: clientes.nome,
    contratoId: clientes.contratoId,
    statusContrato: clientes.statusContrato,
    filialNome: clientes.filialNome,
    ultimoContato: clientes.ultimoContato,
  })
    .from(clientes)
    .where(and(...filtros))
    .orderBy(sqlRaw`lower(coalesce(${clientes.nome}, ${clientes.whatsapp}))`)
    .limit(200);

  res.json(linhas);
});

router.post('/', async (req, res) => {
  const tenantId = req.user.tenantId;
  if (!tenantId) return res.status(403).json({ erro: 'Sem provedor' });

  const { nome, telefone } = req.body;
  const numero = normalizarTelefoneBR(telefone);
  if (!numero) return res.status(400).json({ erro: 'Telefone inválido. Informe DDD + número.' });

  // Número repetido não vira cadastro novo: completa o que já existe, senão a
  // agenda encheria de duplicata de quem já tinha escrito.
  const [existente] = await db.select().from(clientes)
    .where(and(eq(clientes.tenantId, tenantId), eq(clientes.whatsapp, numero)))
    .limit(1);
  if (existente) {
    if (nome?.trim() && nome.trim() !== existente.nome) {
      const [att] = await db.update(clientes)
        .set({ nome: nome.trim() })
        .where(eq(clientes.id, existente.id))
        .returning();
      return res.json({ ...att, jaExistia: true });
    }
    return res.json({ ...existente, jaExistia: true });
  }

  // Puxa nome e contrato do SGP quando o número já for cliente do provedor
  let dados = null;
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (tenant) dados = await buscarDadosCliente(tenant, numero);
  } catch (err) {
    console.error('[contatos] Falha ao consultar o SGP:', err.message);
  }

  const [novo] = await db.insert(clientes).values({
    tenantId,
    whatsapp: numero,
    nome: nome?.trim() || dados?.nome || null,
    contratoId: dados?.contratoId || null,
    statusContrato: dados?.statusContrato || null,
    filialNome: dados?.filialNome || null,
  }).returning();

  res.status(201).json(novo);
});

router.patch('/:id', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome obrigatório' });

  const [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.id, req.params.id), eq(clientes.tenantId, req.user.tenantId)))
    .limit(1);
  if (!cliente) return res.status(404).json({ erro: 'Contato não encontrado' });

  const [att] = await db.update(clientes)
    .set({ nome: nome.trim() })
    .where(eq(clientes.id, cliente.id))
    .returning();
  res.json(att);
});

router.delete('/:id', async (req, res) => {
  const [cliente] = await db.select().from(clientes)
    .where(and(eq(clientes.id, req.params.id), eq(clientes.tenantId, req.user.tenantId)))
    .limit(1);
  if (!cliente) return res.status(404).json({ erro: 'Contato não encontrado' });

  // Apagar quem tem histórico quebraria as conversas — o cadastro é a âncora
  // delas. Nesse caso só um admin decide, e ainda assim não removemos.
  const [{ n }] = await db.select({ n: sqlRaw`count(*)::int` })
    .from(conversas).where(eq(conversas.clienteId, cliente.id));
  if (n > 0) {
    return res.status(409).json({ erro: 'Este contato tem conversas registradas e não pode ser excluído.' });
  }

  await db.delete(clientes).where(eq(clientes.id, cliente.id));
  res.json({ ok: true });
});

export default router;
