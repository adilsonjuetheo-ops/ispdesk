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
    console.log('[migrations] OK');
  } catch (err) {
    console.error('[migrations] Erro:', err.message);
  }
}
