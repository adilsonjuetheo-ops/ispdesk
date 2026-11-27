import { neon } from '@neondatabase/serverless';

export async function runMigrations() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS filiais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        nome text NOT NULL,
        cidade text NOT NULL,
        uf text,
        ativo boolean DEFAULT true,
        criado_em timestamp DEFAULT now()
      )
    `;
    await sql`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filiais(id)`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filiais(id)`;
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS filial_nome text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ultima_mensagem text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ultima_msg_em timestamp`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ultima_msg_origem text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ultima_msg_nome text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS horarios jsonb`;
    // Backfill ultima_mensagem para conversas sem preview (a partir da última mensagem existente)
    await sql`
      UPDATE conversas SET
        ultima_mensagem = subq.conteudo,
        ultima_msg_em   = subq.enviada_em,
        ultima_msg_origem = subq.origem
      FROM (
        SELECT DISTINCT ON (conversa_id)
          conversa_id, conteudo, enviada_em, origem
        FROM mensagens
        ORDER BY conversa_id, enviada_em DESC
      ) subq
      WHERE conversas.id = subq.conversa_id
        AND conversas.ultima_mensagem IS NULL
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        keys jsonb NOT NULL,
        criado_em timestamp DEFAULT now()
      )
    `;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_payment_id text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status_pagamento text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS proximo_vencimento timestamp`;
    await sql`
      CREATE TABLE IF NOT EXISTS uso_ia (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        mes text NOT NULL,
        contagem integer DEFAULT 0,
        alertas_enviados jsonb DEFAULT '[]',
        PRIMARY KEY (tenant_id, mes)
      )
    `;
    await sql`ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS midia_url text`;
    await sql`ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS status text DEFAULT 'enviada'`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_token_expira_em timestamp`;
    await sql`ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS agente_nome text`;
    await sql`
      CREATE TABLE IF NOT EXISTS nps_respostas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversa_id uuid REFERENCES conversas(id),
        cliente_id uuid NOT NULL REFERENCES clientes(id),
        cliente_whatsapp text NOT NULL,
        aguardando boolean DEFAULT true,
        nota integer,
        categoria text,
        enviado_em timestamp DEFAULT now(),
        respondido_em timestamp
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nps_tenant ON nps_respostas(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nps_whatsapp ON nps_respostas(cliente_whatsapp, aguardando)`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS assinatura_tipo text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS assinatura_token text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS assinatura_extra jsonb`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS contrato_uuid text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS contrato_status text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS contrato_enviado_em timestamp`;
    await sql`ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS singleton boolean NOT NULL DEFAULT true`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admin_singleton ON super_admins(singleton)`;
    await sql`
      CREATE TABLE IF NOT EXISTS incidentes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        titulo text NOT NULL,
        descricao text,
        mensagem_bot text,
        status text DEFAULT 'ativo',
        criado_em timestamp DEFAULT now(),
        resolvido_em timestamp
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_incidentes_tenant ON incidentes(tenant_id, status)`;
    await sql`ALTER TABLE filiais ADD COLUMN IF NOT EXISTS whatsapp_number_id text`;
    await sql`ALTER TABLE filiais ADD COLUMN IF NOT EXISTS whatsapp_token text`;
    await sql`ALTER TABLE filiais ADD COLUMN IF NOT EXISTS whatsapp_token_expira_em timestamp`;
    await sql`ALTER TABLE filiais ADD COLUMN IF NOT EXISTS waba_id text`;
    await sql`ALTER TABLE filiais ADD COLUMN IF NOT EXISTS whatsapp_conectado_em timestamp`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_filiais_wpp_number ON filiais(whatsapp_number_id) WHERE whatsapp_number_id IS NOT NULL`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_ativo boolean DEFAULT false`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_template_pre text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_template_pos text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_idioma text DEFAULT 'pt_BR'`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS exigir_documento boolean DEFAULT false`;
    await sql`
      CREATE TABLE IF NOT EXISTS filial_whatsapp_extra (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
        rotulo text,
        whatsapp_number_id text NOT NULL UNIQUE,
        whatsapp_token text NOT NULL,
        whatsapp_token_expira_em timestamp,
        waba_id text,
        whatsapp_conectado_em timestamp DEFAULT now(),
        criado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_filial_wpp_extra_filial ON filial_whatsapp_extra(filial_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS lembrete_fatura_enviados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        titulo_id text NOT NULL,
        tipo text NOT NULL,
        enviado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_lembrete_enviado_unico ON lembrete_fatura_enviados(tenant_id, titulo_id, tipo)`;
    await sql`ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS erro text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chamado_setor_padrao text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mensagem_boas_vindas text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS boas_vindas_quando text DEFAULT 'primeiro_contato'`;
    await sql`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS foto_url text`;
    await sql`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS foto_versao text`;
    await sql`
      CREATE TABLE IF NOT EXISTS uso_tokens_ia (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        dia text NOT NULL,
        modelo text NOT NULL,
        chamadas integer DEFAULT 0,
        entrada integer DEFAULT 0,
        saida integer DEFAULT 0,
        cache_escrito integer DEFAULT 0,
        cache_lido integer DEFAULT 0,
        PRIMARY KEY (tenant_id, dia, modelo)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS acoes_bot (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversa_id uuid REFERENCES conversas(id) ON DELETE SET NULL,
        acao text NOT NULL,
        criado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_acoes_bot_tenant ON acoes_bot(tenant_id, criado_em)`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS numero_recebido_id text`;
    await sql`
      CREATE TABLE IF NOT EXISTS lembretes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversa_id uuid REFERENCES conversas(id) ON DELETE SET NULL,
        cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
        texto text NOT NULL,
        responsavel_id uuid REFERENCES tenant_users(id) ON DELETE SET NULL,
        vence_em timestamp,
        avisado_em timestamp,
        concluido_em timestamp,
        concluido_por uuid REFERENCES tenant_users(id) ON DELETE SET NULL,
        criado_por uuid REFERENCES tenant_users(id) ON DELETE SET NULL,
        criado_em timestamp DEFAULT now()
      )
    `;
    // A lista e o contador da barra lateral só olham os em aberto do provedor.
    await sql`CREATE INDEX IF NOT EXISTS idx_lembretes_abertos ON lembretes(tenant_id, concluido_em, vence_em)`;

    // Abrir uma conversa lê todas as mensagens dela, e o painel repete isso a
    // cada 5 segundos. Sem índice o Postgres varria a tabela inteira toda vez —
    // hoje ainda é rápido porque ela é pequena, mas cresce a cada atendimento.
    await sql`CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id, enviada_em)`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS documento_validado text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contrato_modelo text DEFAULT 'residencial'`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS desbloqueio_prazo text`;

    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_link_assinante text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS encerrar_humano_por_inatividade boolean DEFAULT true`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS encerrar_sem_atendente boolean DEFAULT true`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS horas_inatividade integer DEFAULT 4`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS aceita_pix boolean DEFAULT true`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_dias_pos integer DEFAULT 5`;

    await sql`
      CREATE TABLE IF NOT EXISTS cobranca_envios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        numero text,
        payment_id text,
        valor text,
        origem text,
        sucesso boolean DEFAULT false,
        wamid text,
        erro text,
        enviado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cobranca_envios_tenant ON cobranca_envios(tenant_id, enviado_em DESC)`;

    // Liga o usuário do ISPDesk ao colaborador do IXC. Sem isso o técnico de
    // campo entra e não vê chamado nenhum: as O.S. são atribuídas pelo id do
    // colaborador lá, não pelo e-mail daqui, e os dois cadastros não se
    // conhecem. Fica em texto porque cada SGP numera do seu jeito.
    await sql`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS ixc_tecnico_id text`;

    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lembrete_fatura_botao_url boolean DEFAULT false`;

    // Pagina publica de pagamento: o botao do template de lembrete aponta pra
    // ca. Sem indice unico por titulo, o lembrete pos-vencimento criaria um
    // segundo token pra mesma fatura e o link do D-1 ficaria com o PIX velho.
    await sql`
      CREATE TABLE IF NOT EXISTS fatura_links (
        token text PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        titulo_id text,
        cliente_nome text,
        descricao text,
        valor text,
        vencimento text,
        codigo_pix text,
        link_boleto text,
        aberturas integer DEFAULT 0,
        criado_em timestamp DEFAULT now(),
        expira_em timestamp
      )
    `;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_ativo boolean DEFAULT true`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS numeros_ignorados text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custo_msg_servico text`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custo_msg_utilidade text`;
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS atendida_no_celular boolean DEFAULT false`;
    await sql`
      CREATE TABLE IF NOT EXISTS pontos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES tenant_users(id),
        tipo text NOT NULL,
        registrado_em timestamp NOT NULL DEFAULT now(),
        latitude text,
        longitude text,
        ajuste_de_id uuid,
        anulado boolean DEFAULT false,
        motivo text,
        autor_id uuid REFERENCES tenant_users(id),
        criado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ponto_usuario ON pontos(usuario_id, registrado_em)`;
    // Reconstroi o passado: todo eco da coexistencia grava agente_nome='Celular'
    // na mensagem, entao da para saber quais conversas ja foram atendidas pelo
    // aparelho. Sem isso o conserto so valeria dali para a frente e os meses
    // anteriores continuariam dizendo que o bot resolveu tudo sozinho.
    // Indice parcial: so as mensagens de eco entram nele. E o que faz o UPDATE
    // abaixo custar quase nada em todo deploy seguinte, em vez de varrer as
    // ~150 mil mensagens de novo a cada reinicio.
    await sql`CREATE INDEX IF NOT EXISTS idx_mensagens_celular
                ON mensagens(conversa_id) WHERE agente_nome = 'Celular'`;
    await sql`
      UPDATE conversas c SET atendida_no_celular = true
      FROM (SELECT DISTINCT conversa_id FROM mensagens WHERE agente_nome = 'Celular') m
      WHERE c.id = m.conversa_id AND c.atendida_no_celular IS NOT TRUE
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_fatura_link_titulo ON fatura_links(tenant_id, titulo_id)`;
    // A varredura de expirados roda por data; sem isso ela varre a tabela toda.
    await sql`CREATE INDEX IF NOT EXISTS idx_fatura_link_expira ON fatura_links(expira_em)`;

    // O que a Meta cobrou por mensagem (webhook de status, objeto `pricing`).
    await sql`
      CREATE TABLE IF NOT EXISTS meta_cobranca (
        wamid text PRIMARY KEY,
        phone_number_id text NOT NULL,
        categoria text,
        tipo text,
        subtipo text,
        cobravel boolean,
        entregue boolean DEFAULT false,
        status_em timestamp,
        atualizado_em timestamp DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_meta_cobranca_numero ON meta_cobranca(phone_number_id, status_em)`;

    console.log('[migrations] OK');
  } catch (err) {
    console.error('[migrations] Erro:', err.message);
  }
}
