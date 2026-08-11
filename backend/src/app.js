import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth.js';
import tenantsRouter from './routes/tenants.js';
import agentsRouter from './routes/agents.js';
import filiaisRouter from './routes/filiais.js';
import conversationsRouter from './routes/conversations.js';
import webhookRouter from './routes/webhook.js';
import relatorioRouter from './routes/relatorio.js';
import atalhoRouter from './routes/atalhos.js';
import pushRouter from './routes/push.js';
import presenceRouter from './routes/presence.js';
import cobrancaRouter from './routes/cobranca.js';
import npsRouter from './routes/nps.js';
import whatsappRouter from './routes/whatsapp.js';
import contractsRouter from './routes/contracts.js';
import incidentesRouter from './routes/incidentes.js';
import { agendarLimpeza } from './jobs/limpezaMensagens.js';
import { agendarEncerramentoInativo } from './jobs/encerramentoInativo.js';
import { agendarCobrancaRecorrente } from './jobs/cobrancaRecorrente.js';
import { agendarRenovacaoTokenMeta } from './jobs/renovarTokenMeta.js';
import { agendarLembretesFatura } from './jobs/lembreteFaturas.js';
import { agendarAlertaVencimento } from './jobs/alertaVencimento.js';
import { runMigrations } from './db/migrations.js';
import { criarRateLimit, headersSeguranca } from './middleware/security.js';

const app = express();
const origensFrontend = (process.env.FRONTEND_URL || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const corsAberto = origensFrontend.includes('*');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(headersSeguranca);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsAberto || origensFrontend.includes(origin)) return callback(null, true);
    const erro = new Error('Origem não permitida');
    erro.status = 403;
    callback(erro);
  },
  credentials: true,
}));

app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    if (req.originalUrl.startsWith('/api/webhook')) req.rawBody = Buffer.from(buffer);
  },
}));

app.use('/api/auth', criarRateLimit({
  janelaMs: 15 * 60_000,
  limite: 100,
  prefixo: 'auth',
  mensagem: 'Muitas tentativas de autenticação. Aguarde antes de tentar novamente.',
}), authRouter);
app.use('/api/tenants/:tenantId/agents', agentsRouter);
app.use('/api/tenants/:tenantId/filiais', filiaisRouter);
app.use('/api/tenants/:tenantId/atalhos', atalhoRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/webhook', criarRateLimit({
  janelaMs: 60_000,
  limite: 3000,
  prefixo: 'webhook-meta',
}), webhookRouter);
app.use('/api/relatorio', relatorioRouter);
app.use('/api/push', pushRouter);
app.use('/api/presence', presenceRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api', cobrancaRouter);
app.use('/api/nps', npsRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/incidentes', incidentesRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  if (err?.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ erro: 'Arquivo inválido ou fora dos limites permitidos' });
  }
  if (err?.status === 403) {
    return res.status(403).json({ erro: 'Origem não permitida' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`ISPDesk backend rodando na porta ${PORT}`);
  await runMigrations();
  agendarLimpeza();
  agendarEncerramentoInativo();
  agendarCobrancaRecorrente();
  agendarRenovacaoTokenMeta();
  agendarLembretesFatura();
  agendarAlertaVencimento();
});
