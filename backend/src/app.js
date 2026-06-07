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
import { agendarLimpeza } from './jobs/limpezaMensagens.js';
import { agendarEncerramentoInativo } from './jobs/encerramentoInativo.js';
import { agendarCobrancaRecorrente } from './jobs/cobrancaRecorrente.js';
import { runMigrations } from './db/migrations.js';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

// webhook precisa do body cru para validação de assinatura futura
app.use('/api/webhook', express.json());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/tenants/:tenantId/agents', agentsRouter);
app.use('/api/tenants/:tenantId/filiais', filiaisRouter);
app.use('/api/tenants/:tenantId/atalhos', atalhoRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/relatorio', relatorioRouter);
app.use('/api/push', pushRouter);
app.use('/api/presence', presenceRouter);
app.use('/api', cobrancaRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
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
});
