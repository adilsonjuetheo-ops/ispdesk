# ISPDesk — Setup

## Pré-requisitos
- Node.js 20+
- Banco PostgreSQL (Neon recomendado: neon.tech)

---

## 1. Backend

```bash
cd backend
cp .env.example .env
# Edite .env com suas credenciais reais
npm install
npm run db:push    # cria as tabelas no Neon
npm run dev        # inicia em http://localhost:3001
```

### Criar primeiro super admin
```bash
curl -X POST http://localhost:3001/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"nome":"Admin","email":"admin@ispdesk.com","senha":"senha123"}'
```
Esta rota só funciona uma vez (enquanto não houver nenhum super admin).

---

## 2. Frontend

```bash
cd frontend
cp .env.example .env
# Se o backend estiver em porta diferente, edite VITE_API_URL
npm install
npm run dev        # inicia em http://localhost:5173
```

---

## 3. Configurar WhatsApp (Meta)

1. No painel do provedor (super admin → Gerenciar), preencha:
   - **WhatsApp Number ID**: ID do número no Meta Business
   - **WhatsApp Token**: Token de acesso permanente
   - Copie o **Webhook Verify Token** gerado automaticamente

2. No Meta for Developers → WhatsApp → Configuração:
   - URL do webhook: `https://seu-dominio.com/api/webhook`
   - Token de verificação: o token copiado acima
   - Eventos: `messages`

3. No `.env` do backend, configure `META_VERIFY_TOKEN` com o mesmo valor do `webhookVerifyToken` do tenant ou deixe como token global para o webhook de entrada.

---

## Estrutura resumida

```
backend/
  src/
    db/schema.js         — Drizzle schema (7 tabelas)
    db/index.js          — conexão Neon
    routes/
      auth.js            — POST /auth/login, POST /auth/setup
      tenants.js         — CRUD provedores + /me para auto-consulta
      agents.js          — CRUD funcionários por tenant
      conversations.js   — listar, assumir, liberar, encerrar, enviar
      webhook.js         — recebe msgs Meta + aciona IA
    services/
      ai.js              — Claude API (claude-sonnet-4-20250514)
      whatsapp.js        — envio de msgs Meta Cloud API
      handoff.js         — lógica de transferência bot→humano
    middleware/
      auth.js            — JWT + controle de papel
      tenant.js          — injeta req.tenant

frontend/
  src/
    pages/
      Login.jsx
      superadmin/        — Dashboard, Tenants, TenantDetail
      tenant/            — Inbox (3 colunas), Agents, Settings
    components/
      ConversationList.jsx
      ChatWindow.jsx
      ClientInfoPanel.jsx
      layout/            — SuperAdminLayout, TenantLayout
    hooks/
      useAuth.js         — gerencia token/user no localStorage
      usePolling.js      — polling 5s com pausa quando aba invisível
    lib/api.js           — axios com interceptor JWT
```
