import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, primaryKey } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  slug:               text('slug').notNull().unique(),
  nome:               text('nome').notNull(),
  nomeFantasia:       text('nome_fantasia'),
  logoUrl:            text('logo_url'),
  corPrimaria:        text('cor_primaria').default('#0066CC'),
  cnpj:               text('cnpj'),
  telefone:           text('telefone'),
  whatsappContato:    text('whatsapp_contato'),
  email:              text('email'),
  website:            text('website'),
  endereco:           text('endereco'),
  cidade:             text('cidade'),
  uf:                 text('uf'),
  cep:                text('cep'),
  whatsappNumberId:   text('whatsapp_number_id').unique(),
  whatsappToken:      text('whatsapp_token'),
  whatsappTokenExpiraEm: timestamp('whatsapp_token_expira_em'),
  webhookVerifyToken: text('webhook_verify_token').notNull(),
  systemPrompt:       text('system_prompt').notNull(),
  nomeAssistente:     text('nome_assistente').default('Assistente'),
  sgpTipo:            text('sgp_tipo'),   // 'atlaz' | 'ixc' | 'mkauth' | 'generico'
  sgpApiUrl:          text('sgp_api_url'),
  sgpApiKey:          text('sgp_api_key'),
  plano:              text('plano').default('basic'),
  mpPaymentId:        text('mp_payment_id'),
  statusPagamento:    text('status_pagamento'), // null | 'pendente' | 'ativo' | 'suspenso'
  proximoVencimento:  timestamp('proximo_vencimento'),
  wabaId:             text('waba_id'),
  whatsappConectadoEm: timestamp('whatsapp_conectado_em'),
  ativo:              boolean('ativo').default(true),
  horarios:           jsonb('horarios'),
  criadoEm:           timestamp('criado_em').defaultNow(),
  atualizadoEm:       timestamp('atualizado_em').defaultNow(),
});

export const filiais = pgTable('filiais', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  nome:     text('nome').notNull(),
  cidade:   text('cidade').notNull(),
  uf:       text('uf'),
  ativo:    boolean('ativo').default(true),
  criadoEm: timestamp('criado_em').defaultNow(),
});

export const tenantUsers = pgTable('tenant_users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  filialId:  uuid('filial_id').references(() => filiais.id),
  nome:      text('nome').notNull(),
  email:     text('email').notNull(),
  senhaHash: text('senha_hash').notNull(),
  role:      text('role').default('agente'),
  ativo:     boolean('ativo').default(true),
  criadoEm:  timestamp('criado_em').defaultNow(),
});

export const superAdmins = pgTable('super_admins', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  nome:      text('nome').notNull(),
  criadoEm:  timestamp('criado_em').defaultNow(),
});

export const clientes = pgTable('clientes', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  whatsapp:       text('whatsapp').notNull(),
  nome:           text('nome'),
  contratoId:     text('contrato_id'),
  statusContrato: text('status_contrato'),
  filialNome:     text('filial_nome'),
  ultimoContato:  timestamp('ultimo_contato'),
  criadoEm:       timestamp('criado_em').defaultNow(),
});

export const conversas = pgTable('conversas', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clienteId:       uuid('cliente_id').notNull().references(() => clientes.id),
  filialId:        uuid('filial_id').references(() => filiais.id),
  status:          text('status').default('bot'),
  agenteId:        uuid('agente_id').references(() => tenantUsers.id),
  motivoHandoff:   text('motivo_handoff'),
  resumoIa:        text('resumo_ia'),
  tags:            jsonb('tags').default('[]'),
  ultimaMensagem:  text('ultima_mensagem'),
  ultimaMsgEm:     timestamp('ultima_msg_em'),
  ultimaMsgOrigem: text('ultima_msg_origem'),
  ultimaMsgNome:   text('ultima_msg_nome'),
  iniciadaEm:      timestamp('iniciada_em').defaultNow(),
  encerradaEm:     timestamp('encerrada_em'),
});

export const mensagens = pgTable('mensagens', {
  id:         uuid('id').primaryKey().defaultRandom(),
  conversaId: uuid('conversa_id').notNull().references(() => conversas.id, { onDelete: 'cascade' }),
  origem:     text('origem').notNull(),
  conteudo:   text('conteudo').notNull(),
  wamid:      text('wamid').unique(),
  midiaUrl:   text('midia_url'),
  status:     text('status').default('enviada'), // 'enviada' | 'entregue' | 'lida'
  agenteNome: text('agente_nome'),
  enviadaEm:  timestamp('enviada_em').defaultNow(),
});

export const atalhos = pgTable('atalhos', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  titulo:   text('titulo').notNull(),
  atalho:   text('atalho'),
  conteudo: text('conteudo').notNull(),
  criadoEm: timestamp('criado_em').defaultNow(),
});

export const webhookLog = pgTable('webhook_log', {
  wamid:       text('wamid').primaryKey(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  processado:  boolean('processado').default(false),
  recebidoEm:  timestamp('recebido_em').defaultNow(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => tenantUsers.id, { onDelete: 'cascade' }),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  endpoint:   text('endpoint').notNull().unique(),
  keys:       jsonb('keys').notNull(),
  criadoEm:  timestamp('criado_em').defaultNow(),
});

export const usoIa = pgTable('uso_ia', {
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mes:             text('mes').notNull(), // YYYY-MM
  contagem:        integer('contagem').default(0),
  alertasEnviados: jsonb('alertas_enviados').default('[]'),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.mes] }),
}));
