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

// Teto do relato. O campo no IXC é texto longo, mas o que chega daqui é
// digitado no celular em campo: acima disso é colagem acidental, não relato.
const LIMITE_RELATO = 2000;

// Registrar o atendimento na O.S.
//
// Grava o relato do técnico e os horários. NÃO muda o status: `status` e
// `data_final` são somente-leitura pela API do IXC, que ignora o valor
// enviado e ainda responde sucesso. Quem finaliza é o escritório, e a tela do
// técnico diz isso com essas palavras — ver o comentário em
// IxcAdaptador.registrarAtendimento.
router.post('/chamados/:id/atendimento', apenasCampo, async (req, res) => {
  const { sgp } = await sgpDoUsuario(req);
  if (!sgp || typeof sgp.registrarAtendimento !== 'function') {
    return res.status(400).json({ erro: 'O sistema deste provedor não permite registrar atendimento por aqui.' });
  }

  // Sem vínculo não há como saber de quem é a O.S., e escrever "por ninguém"
  // num chamado alheio é pior do que não escrever. Vale para admin também.
  if (!req.user.ixcTecnicoId) {
    return res.status(403).json({
      erro: 'Sua conta não está ligada a um colaborador no sistema do provedor. '
        + 'Peça ao administrador para vincular na tela de Equipe.',
    });
  }

  const mensagem = String(req.body?.mensagem || '').trim();
  if (mensagem.length < 3) return res.status(400).json({ erro: 'Escreva o que foi feito no atendimento.' });
  if (mensagem.length > LIMITE_RELATO) {
    return res.status(400).json({ erro: `O relato passou de ${LIMITE_RELATO} caracteres.` });
  }

  // A coordenada é opcional e vem do celular, então nada aqui depende dela.
  // Valor fora da faixa é descartado em silêncio: GPS de celular na zona
  // rural às vezes devolve lixo, e isso não é motivo para perder o relato.
  const naFaixa = (v, teto) => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= teto && Number(v) !== 0;
  const temCoord = naFaixa(req.body?.latitude, 90) && naFaixa(req.body?.longitude, 180);

  try {
    const r = await sgp.registrarAtendimento({
      idChamado: req.params.id,
      idTecnico: req.user.ixcTecnicoId,
      mensagem,
      autor: req.user.nome || null,
      ...(temCoord ? { latitude: Number(req.body.latitude), longitude: Number(req.body.longitude) } : {}),
    });
    // A recusa do adaptador é de regra — chamado de outro técnico, já
    // encerrado, gravação que não ficou — e não falha de infraestrutura.
    if (r?.erro) return res.status(409).json({ erro: r.erro });
    res.json(r);
  } catch (err) {
    console.error(`[campo] Falha ao registrar atendimento na O.S. ${req.params.id}:`, err.message);
    res.status(502).json({ erro: 'Não foi possível registrar o atendimento no sistema do provedor.' });
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
