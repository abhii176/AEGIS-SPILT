# Deploy Aegis-Split (hackathon judges)

**Goal:** public HTTPS URL serving the demo UI + API + Postgres.

This repo ships:

| File | Host |
|------|------|
| `Dockerfile` + `scripts/docker-entrypoint.sh` | Any Docker host (runs `prisma migrate deploy` then `node`) |
| `render.yaml` | [Render Blueprint](https://render.com/docs/infrastructure-as-code) |
| `railway.toml` | [Railway](https://railway.app) |
| `fly.toml` | [Fly.io](https://fly.io) |

No host API tokens are committed. Secrets stay in the host dashboard / CLI secrets.

---

## Recommended: Render Blueprint + Neon (free)

### A. Postgres (Neon free)

1. Open [https://console.neon.tech](https://console.neon.tech) → sign in → **New project** (`aegis-split`).
2. Copy the connection string (`DATABASE_URL`, include `?sslmode=require` if shown).

### B. Web service (Render)

**Option 1 — Blueprint (preferred)**

1. Push / merge this branch to GitHub (`abhii176/AEGIS-SPILT`).
2. Open: [https://dashboard.render.com/blueprints/new](https://dashboard.render.com/blueprints/new)
3. Connect the GitHub repo → select `render.yaml`.
4. When prompted for `DATABASE_URL`, paste the Neon URL.
5. Leave `PAYPAL_MOCK=true` (Blueprint default) for a reliable judge demo.
6. Create Blueprint → wait for the first deploy (Docker build + migrate).
7. Copy the service URL (`https://aegis-split-xxxx.onrender.com`).
8. In **Environment**, set (then **Manual Deploy**):
   - `APP_BASE_URL` = that HTTPS origin (no trailing slash)
   - `PAYPAL_RETURN_URL` = `{APP_BASE_URL}/api/vault/paypal/return`
   - `PAYPAL_CANCEL_URL` = `{APP_BASE_URL}/api/vault/paypal/cancel`  
   *(If you skip these, the app falls back to `https://$RENDER_EXTERNAL_HOSTNAME`.)*

**Option 2 — New Web Service UI**

1. Render → **New** → **Web Service** → this repo → **Docker**.
2. Add env vars from the table below.
3. Health check path: `/health`.

### C. Env vars (Render / Railway / Fly)

| Key | Judge demo value | Notes |
|-----|------------------|-------|
| `DATABASE_URL` | *(Neon / host Postgres)* | Required |
| `APP_BASE_URL` | `https://YOUR-HOST` | Required for correct PayPal return links |
| `PAYPAL_RETURN_URL` | `{APP_BASE_URL}/api/vault/paypal/return` | Or omit (derived) |
| `PAYPAL_CANCEL_URL` | `{APP_BASE_URL}/api/vault/paypal/cancel` | Or omit (derived) |
| `PAYPAL_MOCK` | `true` | **Default for judges** — no live PayPal needed |
| `PAYPAL_AUTO_CAPTURE` | `true` | Skip browser approve when mocking |
| `PAYPAL_MODE` | `sandbox` | |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | *(omit when mock)* | Set only if `PAYPAL_MOCK=false` |
| `DEMO_ADMIN_KEY` | `hackathon-demo-key` | Header `X-Demo-Admin-Key` |
| `AI_AUDITOR_PROVIDER` | `deterministic` | Demo-safe without LLM keys |

**PayPal mode used for the Blueprint defaults:** `PAYPAL_MOCK=true` (mock Orders/Payouts). Live sandbox credentials may exist in Cursor Cloud Agent secrets (`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE=sandbox`, `PAYPAL_MOCK=false`) — paste those into the host dashboard only if you want a real sandbox approve flow; keep mock for reliability.

Migrations run automatically on container start (`npx prisma migrate deploy`).

---

## Railway (alternative one-click)

1. [https://railway.app/new](https://railway.app/new) → **Deploy from GitHub repo** → `AEGIS-SPILT`.
2. **Add Postgres** (or set `DATABASE_URL` from Neon).
3. Railway detects `Dockerfile` / `railway.toml`.
4. Variables → paste the table above (`PAYPAL_MOCK=true`, `DEMO_ADMIN_KEY=hackathon-demo-key`).
5. **Settings → Networking → Generate domain**.
6. Set `APP_BASE_URL` to `https://YOUR.up.railway.app` → redeploy.

---

## Fly.io (needs CLI token)

```bash
fly auth login
fly launch --no-deploy   # uses fly.toml
# Attach Postgres or: fly secrets set DATABASE_URL='postgresql://...'
fly secrets set DEMO_ADMIN_KEY=hackathon-demo-key PAYPAL_MOCK=true PAYPAL_AUTO_CAPTURE=true
fly deploy
fly secrets set APP_BASE_URL=https://aegis-split.fly.dev
```

**Blocker without token:** add `FLY_API_TOKEN` (or `RENDER_API_KEY` / `RAILWAY_TOKEN` + `NEON_API_KEY`) to Cursor Cloud Agent secrets to allow fully automated deploy from agents.

---

## Smoke check after deploy

```bash
curl -sS https://YOUR-HOST/health
# → {"ok":true,"service":"aegis-split"}
```

Open `https://YOUR-HOST/` → **Seed Sarah & Rohan** → follow the project judge demo script (`docs/judge-demo-script.md` in the Cursor project store).
