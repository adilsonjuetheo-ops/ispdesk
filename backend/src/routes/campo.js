import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { autenticar, apenasCampo, apenasAdmin } from '../middleware/auth.js';
import { criarSgp } from '../services/sgp.js';

// App do técnico de campo.
//
// É a mesma instalação do ISPDesk — o técnico abre o PWA no celular e, por ser
// do papel `tecnico`, cai aqui em vez do inbox. Não há app separado nem loja.
//
// O que esta rota NÃO faz, de propósito: nada de conversa, cliente ou
// financeiro. Quem está na rua com o celular na mão precisa de uma tela curta
// com os chamados dele e o endereço; tudo que não for isso atrapalha.
const router = Router();
router.use(autenticar);

async function sgpDoUsuario(req) {
  const [tenant] = await db.select().from(tenants)
    .where(eq(tenants.id, req.user.tenantId)).limit(1);
  return { tenant, sgp: tenant ? criarSgp(tenant) : null };
}

// A fila do técnico que está pedindo — nunca a de outro. O id do colaborador
// sai da sessão, não do query string: se viesse por parâmetro, um técnico
// leria a agenda do colega trocando um número na URL.
router.get('/chamados', apenasCampo, async (req, res) => {
  const { sgp } = await sgpDoUsuario(req);
  if (!sgp || typeof sgp.listarChamados !== 'function') {
    return res.json({ suportado: false, vinculado: false, chamados: [] });
  }

  // Sem vínculo o IXC devolveria a fila inteira do provedor, e o técnico veria
  // chamado que não é dele. Melhor dizer que falta configurar: lista vazia
  // sem explicação faz ele achar que o app está quebrado.
  if (!req.user.ixcTecnicoId) {
    return res.json({ suportado: true, vinculado: false, chamados: [] });
  }

  try {
    const chamados = await sgp.listarChamados({ idTecnico: req.user.ixcTecnicoId, limite: 100 });
    res.json({ suportado: true, vinculado: true, chamados });
  } catch (err) {
    console.error('[campo] Falha ao listar chamados:', err.message);
    res.status(502).json({ erro: 'Não foi possível consultar seus chamados no sistema do provedor.' });
  }
});

// Lista de colaboradores do SGP, para o admin escolher na hora de criar o
// usuário do técnico. É a ponte entre os dois cadastros.
router.get('/colaboradores', apenasAdmin, async (req, res) => {
  const { sgp } = await sgpDoUsuario(req);
  if (!sgp || typeof sgp.listarTecnicos !== 'function') {
    return res.json({ suportado: false, colaboradores: [] });
  }
  try {
    res.json({ suportado: true, colaboradores: await sgp.listarTecnicos() });
  } catch (err) {
    console.error('[campo] Falha ao listar colaboradores:', err.message);
    res.status(502).json({ erro: 'Não foi possível listar os colaboradores do sistema do provedor.' });
  }
});

export default router;
