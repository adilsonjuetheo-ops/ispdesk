import { Router } from 'express';
import { db } from '../db/index.js';
import { tenants, pontos, tenantUsers } from '../db/schema.js';
import { eq, and, sql as sqlRaw } from 'drizzle-orm';
import { TIPOS, efetivos, proximosTipos, tipoPermitido, resumoDoDia } from '../services/ponto.js';
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

// ---------------------------------------------------------------------------
// Registro de jornada (ponto)
//
// Controle interno, NÃO ponto eletrônico legal — ver o comentário da tabela
// `pontos` no schema. A tela do técnico diz isso em texto.
// ---------------------------------------------------------------------------

// O dia do ponto é o dia em Brasília, não em UTC. Sem converter, uma batida às
// 22h vira registro do dia seguinte e o espelho mostra jornada no dia errado.
const DIA_BRT = sqlRaw`((${pontos.registradoEm} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date)`;

async function registrosDoDia(usuarioId, dia) {
  return db.select().from(pontos)
    .where(and(
      eq(pontos.usuarioId, usuarioId),
      sqlRaw`${DIA_BRT} = ${dia}::date`,
    ));
}

function hojeBrt() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// O que o técnico vê ao abrir a tela: as batidas de hoje e o que o botão pode
// oferecer agora.
router.get('/ponto/hoje', apenasCampo, async (req, res) => {
  const dia = hojeBrt();
  const todos = await registrosDoDia(req.user.id, dia);
  const lista = efetivos(todos);
  res.json({
    dia,
    registros: lista.map(r => ({
      id: r.id, tipo: r.tipo, registradoEm: r.registradoEm,
      temLocal: !!(r.latitude && r.longitude),
      lancadoPeloEscritorio: !!r.autorId,
    })),
    proximos: proximosTipos(lista),
    resumo: resumoDoDia(lista),
  });
});

// Bater o ponto.
//
// A hora é a do servidor, sempre: o relógio do celular é do funcionário, e
// aceitar um horário vindo do corpo da requisição transformaria o registro em
// declaração. A posição é opcional e falha calada — recusa de permissão ou
// falta de sinal não pode impedir alguém de registrar que começou a trabalhar.
router.post('/ponto', apenasCampo, async (req, res) => {
  const { tipo, latitude, longitude } = req.body || {};
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo de registro inválido.' });

  const dia = hojeBrt();
  const lista = efetivos(await registrosDoDia(req.user.id, dia));
  if (!tipoPermitido(lista, tipo)) {
    return res.status(409).json({
      erro: 'Esse registro não é o próximo da sequência. Atualize a tela.',
      proximos: proximosTipos(lista),
    });
  }

  const [criado] = await db.insert(pontos).values({
    tenantId: req.user.tenantId,
    usuarioId: req.user.id,
    tipo,
    latitude:  latitude  != null ? String(latitude)  : null,
    longitude: longitude != null ? String(longitude) : null,
  }).returning();

  const atualizados = efetivos(await registrosDoDia(req.user.id, dia));
  res.json({
    ok: true,
    registro: { id: criado.id, tipo: criado.tipo, registradoEm: criado.registradoEm },
    proximos: proximosTipos(atualizados),
    resumo: resumoDoDia(atualizados),
  });
});

// Espelho de ponto para o dono: um técnico, um período.
router.get('/ponto/espelho', apenasAdmin, async (req, res) => {
  const { usuarioId } = req.query;
  const de  = String(req.query.de  || '').slice(0, 10);
  const ate = String(req.query.ate || '').slice(0, 10);
  if (!usuarioId || !/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ erro: 'Informe o técnico e o período.' });
  }

  // O técnico tem que ser do mesmo provedor: sem isto, trocar o id na URL
  // mostraria a jornada de funcionário de outro cliente.
  const [usuario] = await db.select({ id: tenantUsers.id, nome: tenantUsers.nome })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.id, usuarioId), eq(tenantUsers.tenantId, req.user.tenantId)))
    .limit(1);
  if (!usuario) return res.status(404).json({ erro: 'Técnico não encontrado.' });

  const linhas = await db.select({
    id: pontos.id, tipo: pontos.tipo, registradoEm: pontos.registradoEm,
    latitude: pontos.latitude, longitude: pontos.longitude,
    ajusteDeId: pontos.ajusteDeId, anulado: pontos.anulado,
    motivo: pontos.motivo, autorId: pontos.autorId,
    dia: DIA_BRT,
  }).from(pontos)
    .where(and(
      eq(pontos.usuarioId, usuarioId),
      sqlRaw`${DIA_BRT} >= ${de}::date`,
      sqlRaw`${DIA_BRT} <= ${ate}::date`,
    ));

  const porDia = new Map();
  for (const l of linhas) {
    const chave = l.dia instanceof Date ? l.dia.toISOString().slice(0, 10) : String(l.dia).slice(0, 10);
    if (!porDia.has(chave)) porDia.set(chave, []);
    porDia.get(chave).push(l);
  }

  const dias = [...porDia.entries()]
    .map(([dia, todos]) => {
      const lista = efetivos(todos);
      return {
        dia,
        registros: lista.map(r => ({
          id: r.id, tipo: r.tipo, registradoEm: r.registradoEm,
          latitude: r.latitude, longitude: r.longitude,
          lancadoPeloEscritorio: !!r.autorId, motivo: r.motivo,
        })),
        resumo: resumoDoDia(lista),
      };
    })
    .sort((a, b) => a.dia.localeCompare(b.dia));

  res.json({
    tecnico: usuario,
    de, ate,
    dias,
    totalMinutos: dias.reduce((s, d) => s + d.resumo.minutos, 0),
  });
});

// Correção do escritório.
//
// Nunca altera a linha original: grava uma nova apontando para ela. `anular`
// descarta a batida sem pôr nada no lugar (duplicada); sem `anular`, a nova
// hora substitui a antiga. Lançar uma batida que faltou é o mesmo caminho,
// sem `pontoId`.
router.post('/ponto/ajuste', apenasAdmin, async (req, res) => {
  const { pontoId, usuarioId, tipo, registradoEm, motivo, anular } = req.body || {};
  if (!String(motivo || '').trim()) {
    return res.status(400).json({ erro: 'A correção precisa de um motivo.' });
  }

  let alvo = null;
  if (pontoId) {
    [alvo] = await db.select().from(pontos)
      .where(and(eq(pontos.id, pontoId), eq(pontos.tenantId, req.user.tenantId)))
      .limit(1);
    if (!alvo) return res.status(404).json({ erro: 'Registro não encontrado.' });
  }

  const dono = alvo?.usuarioId || usuarioId;
  if (!dono) return res.status(400).json({ erro: 'Informe o técnico.' });
  if (!anular && !TIPOS.includes(tipo || alvo?.tipo)) {
    return res.status(400).json({ erro: 'Tipo de registro inválido.' });
  }

  const quando = anular ? (alvo?.registradoEm || new Date()) : new Date(registradoEm || alvo?.registradoEm);
  if (Number.isNaN(new Date(quando).getTime())) {
    return res.status(400).json({ erro: 'Horário inválido.' });
  }

  const [criado] = await db.insert(pontos).values({
    tenantId: req.user.tenantId,
    usuarioId: dono,
    tipo: anular ? (alvo?.tipo || 'entrada') : (tipo || alvo.tipo),
    registradoEm: new Date(quando),
    ajusteDeId: alvo?.id || null,
    anulado: !!anular,
    motivo: String(motivo).trim().slice(0, 300),
    autorId: req.user.id,
  }).returning();

  res.json({ ok: true, id: criado.id });
});

export default router;
