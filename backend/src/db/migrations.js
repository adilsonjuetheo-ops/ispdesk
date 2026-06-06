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
    console.log('[migrations] OK');
  } catch (err) {
    console.error('[migrations] Erro:', err.message);
  }
}
