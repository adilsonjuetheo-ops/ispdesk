import { neon } from '@neondatabase/serverless';

export async function runMigrations() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`ALTER TABLE conversas ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'`;
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
