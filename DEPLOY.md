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
5. In the Blueprint confirm / Environment UI, set PayPal flags (they are **dashboard-owned** via `sync: false` — Blueprint will not overwrite them on later syncs):
   - Judge demo without PayPal: `PAYPAL_MOCK=true`, optionally `PAYPAL_AUTO_CAPTURE=true`
   - Live sandbox: `PAYPAL_MOCK=false`, `PAYPAL_AUTO_CAPTURE=false`, plus sandbox `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`
6. Create Blueprint → wait for the first deploy (Docker build + migrate).
7. Copy the service URL (`https://aegis-split-xxxx.onrender.com`).
8. In **Environment**, set (then **Manual Deploy**):
   - `APP_BASE_URL` = that HTTPS origin (no trailing slash)
   - `PAYPAL_RETURN_URL` = `{APP_BASE_URL}/api/vault/paypal/return`
   - `PAYPAL_CANCEL_URL` = `{APP_BASE_URL}/api/vault/paypal/cancel`  
   *(If you skip these, the app falls back to `https://$RENDER_EXTERNAL_HOSTNAME`.)*
9. Confirm live mode with `GET /health` → `paypal.mock` should be `false` when `PAYPAL_MOCK=false` and credentials are set.

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
| `PAYPAL_MOCK` | `true` (judges) / `false` (live sandbox) | Dashboard-owned (`sync: false`). Do **not** Blueprint-hardcode `true` — that overwrote live sandbox. |
| `PAYPAL_AUTO_CAPTURE` | `true` only with mock | Dashboard-owned. Leave `false` for live sandbox approve → return. |
| `PAYPAL_MODE` | `sandbox` | |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | *(omit when mock)* | Required when `PAYPAL_MOCK=false` |
| `PAYPAL_WEBHOOK_ID` | *(optional)* | Dashboard `sync: false`. Needed only for `POST /api/webhooks/paypal` signature verify. Approve → return → capture works without it. |
| `DEMO_ADMIN_KEY` | `hackathon-demo-key` | Header `X-Demo-Admin-Key` |
| `AI_AUDITOR_PROVIDER` | `gemini` (or `auto`) | Dashboard-owned (`sync: false`). With `GEMINI_API_KEY` set, uses Gemini 2.5 Flash (`GEMINI_MODEL=gemini-2.5-flash`). Unset keys fall back to the keyword check. |

**PayPal on Render:** `PAYPAL_MOCK` / `PAYPAL_AUTO_CAPTURE` / client credentials are set in the dashboard (`sync: false`). Explicit `PAYPAL_MOCK=false` never silent-falls back to `MOCK-ORDER` when secrets are missing — OAuth fails loudly instead. Check `GET /health` → `paypal.mock`.

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
