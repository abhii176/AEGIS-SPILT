# Aegis-Split

Escrow marketplace where clients fund milestones via PayPal, freelancers ship on GitHub, and AI audits merges before payout.

## What's built

| Slice | What |
|-------|------|
| **KYC + consent** | DigiLocker / Stripe Identity scaffolds, `ConsentLogs`, gate middleware |
| **Projects + milestones** | Client/freelancer projects, milestones with acceptance criteria + amounts |
| **PayPal escrow** | Orders API lock (fund vault); Payouts API release; admin/demo trigger |
| **GitHub merge** | Link repo/PR to milestone; webhook HMAC; AI auditor → PayPal release |
| **AI auditor** | Structured criteria checks (LLM if keyed, else deterministic heuristics). Optional client sign-off holds payout until the client approves |
| **Notifications** | In-app FUNDED / AUDIT_PASSED|FAILED / PAID / exit+deposit alerts (idempotent); demo bell + toasts |
| **Exit & penalties** | Mutual cancel, client one-sided penalty, freelancer walk-away; security deposit; consent v2 |
| **Project chat** | Plain-text client ↔ freelancer messages per project (DB-backed; polling; allowed after cancel) |
| **Demo UI** | Static judge walkthrough at `/` (Rohan ↔ Sarah) wired to the Express API |
| **Agency preview** | Read-only “Agency (preview)” tab. One Load demo agency button, summary cards, and a project table. White-label is marked coming soon |

## Deploy (public HTTPS for judges)

See **[DEPLOY.md](./DEPLOY.md)** for one-click paths:

- **Render Blueprint** (`render.yaml`) + **Neon** free Postgres — preferred
- **Railway** (`railway.toml` + Dockerfile)
- **Fly.io** (`fly.toml`) when `FLY_API_TOKEN` is available

Docker image runs `prisma migrate deploy` on boot. Set `PAYPAL_MOCK` / credentials in the host dashboard (`render.yaml` keeps them `sync: false` so Blueprint sync cannot force mock). `DEMO_ADMIN_KEY` defaults to `hackathon-demo-key`.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprints/new?repo=https://github.com/abhii176/AEGIS-SPILT)

## Setup

```bash
cp .env.example .env
# set DATABASE_URL, KYC placeholders, PayPal sandbox credentials,
# and GITHUB_WEBHOOK_SECRET / GITHUB_TOKEN (or use demo simulate-merge)
# or set PAYPAL_MOCK=true for local demo without PayPal credentials
# DEMO_ADMIN_KEY defaults to hackathon-demo-key (simulate-merge + seed users)
npm install
npx prisma migrate deploy
# or: npx prisma migrate dev
npm start
# open http://localhost:3000  — demo UI + API on the same origin
# (or: npm run dev for watch mode)
# production-style: npm run start:prod  (migrate deploy + start)
```

Auth is stubbed: send `X-User-Id: <user cuid>` on protected routes until sessions land. The demo UI sets this when you pick Sarah or Rohan.

### Demo UI (judges)

1. `npm start` → open `http://localhost:3000`
2. **Seed Sarah, Rohan & Maya** (uses `X-Demo-Admin-Key` / `DEMO_ADMIN_KEY`)
2b. Open **Agency** in the step rail and press **Load demo agency**. Sample rows are marked Sample. Live Sarah/Rohan projects are marked Live. White-label is a coming-soon note.
3. On Verify, use **Quick verify (judges)** or walk the DigiLocker-style sandbox (email OTP, phone OTP, sandbox ID). Then sign the consent agreement. Stripe Identity stays disabled.
4. Create project + milestone → fund vault (open PayPal `approvalUrl`, or check auto-capture for mock)
5. Link GitHub → **Simulate merge** → see AI audit PASS/FAIL + paid status

PayPal browser return/cancel (no auth header):

- Return / capture: `GET /api/vault/paypal/return?token=ORDER_ID`
- Cancel: `GET /api/vault/paypal/cancel?token=ORDER_ID`

## Key routes

```
GET  /                                 # demo UI (static)
GET  /api/auth/me                      # stub user for X-User-Id
POST /api/auth/verify-identity                 # older scaffold; does not set the ID flag
GET  /api/auth/verify-identity/callback/digilocker  # refused; use the sandbox routes
GET  /api/auth/verify-identity/callback/stripe      # refused; Stripe Identity is roadmap
GET  /api/auth/kyc/sandbox                      # DigiLocker-style sandbox hint (demo OTP + fake ID)
POST /api/auth/kyc/sandbox/email/start
POST /api/auth/kyc/sandbox/email/confirm
POST /api/auth/kyc/sandbox/phone/start
POST /api/auth/kyc/sandbox/phone/confirm
POST /api/auth/kyc/sandbox/digilocker/start
POST /api/auth/kyc/sandbox/digilocker/confirm   # sets gov ID; stores mask + last 4 only
POST /api/auth/kyc/sandbox/quick                # one-click for Sarah, Rohan, Maya
GET  /api/consent/agreement                # User Consent Agreement markdown (v2.0.0)
POST /api/consent/monitoring               # { accepted, agreedName, agreedDate } → ConsentLogs

POST /api/projects                          # gated (KYC + consent); optional earlyExitPenaltyPercent, freelancerDepositAmountCents
GET  /api/projects
GET  /api/projects/:projectId               # includes penalty %, deposit amount/status, remaining vault
POST /api/projects/:projectId/milestones    # gated
GET  /api/projects/:projectId/milestones
POST /api/projects/:projectId/milestones/:milestoneId/github   # gated — link repo/PR
POST /api/projects/:projectId/milestones/:milestoneId/release  # gated — PayPal Payouts
POST /api/projects/:projectId/milestones/:milestoneId/signoff  # client only, after AI pass, when manual sign-off was requested
GET  /api/projects/:projectId/evidence                         # chat + audit + diff preview (parties only)
GET  /api/projects/:projectId/exit/preview?path=MUTUAL|CLIENT_ONESIDED|FREELANCER_WALKAWAY
POST /api/projects/:projectId/cancel/request
POST /api/projects/:projectId/cancel/accept
POST /api/projects/:projectId/exit/client   # client one-sided cancel + penalty
POST /api/projects/:projectId/exit/abandon  # freelancer walk-away + deposit forfeit
POST /api/projects/:projectId/deposit/fund  # freelancer security deposit (Orders)
POST /api/projects/:projectId/deposit/capture
GET  /api/projects/:projectId/messages      # list chat (client/freelancer only)
POST /api/projects/:projectId/messages      # { body } — non-empty, max 2000 chars; OK after cancel

POST /api/vault/fund                       # gated — create PayPal order + approve link
POST /api/vault/capture                    # gated — capture after buyer approval
GET  /api/vault/paypal/return?token=...    # PayPal return — vault or deposit capture if APPROVED
GET  /api/vault/paypal/cancel?token=...    # PayPal cancel — mark fund/deposit CANCELLED
GET  /api/notifications                    # list for X-User-Id (optional ?unread=true)
POST /api/notifications/mark-read          # { notificationIds } or { all: true }
POST /api/webhooks/github                  # GitHub HMAC; pull_request closed+merged
POST /api/admin/demo/users/seed            # seed Sarah + Rohan (X-Demo-Admin-Key)
GET  /api/admin/demo/users                # list demo users (X-Demo-Admin-Key)
GET  /api/admin/demo/agency               # agency dashboard preview (read-only, X-Demo-Admin-Key)
POST /api/admin/demo/agency/seed          # idempotent sample agency rows (no PayPal movement)
POST /api/admin/demo/milestones/:milestoneId/release         # gated + X-Demo-Admin-Key
POST /api/admin/demo/milestones/:milestoneId/simulate-merge  # gated + X-Demo-Admin-Key
POST /api/merge                             # gated
GET  /health
```

### Notifications

Persisted for **both** client and freelancer when:

1. Vault/milestone **FUNDED** (after capture / auto-capture)
2. AI audit completes (**AUDIT_PASSED** or **AUDIT_FAILED**)
3. Milestone **PAID** (PayPal payout release)

Idempotent via `dedupeKey` (`TYPE:milestoneOrProjectId:userId`) so retries and double-capture do not spam. Demo UI: bell in the top bar + toast after fund / simulate-merge / paid refresh.

### Fund vault (lock escrow)

```json
POST /api/vault/fund
{
  "projectId": "<project_cuid>",
  "milestoneId": "<optional_milestone_cuid>",
  "amountCents": 50000
}
```

- Omit `milestoneId` + `amountCents` → creates an order for the sum of all `PENDING` milestones.
- Default: **no auto-capture**. Response includes `paypal.approvalUrl` / `approveUrl` — redirect the buyer (sandbox personal account) to approve, then PayPal hits `GET /api/vault/paypal/return?token=ORDER_ID` which captures only if the order is `APPROVED`.
- Cancel path: `GET /api/vault/paypal/cancel?token=ORDER_ID` marks the vault fund `CANCELLED`.
- Opt-in immediate capture (`PAYPAL_AUTO_CAPTURE=true` or `"capture": true`) is for mock/local demos only; live sandbox returns `ORDER_NOT_APPROVED` without buyer approval.
- Persist after capture: `VaultFund.paypalOrderId` / `paypalCaptureId`, `Project.fundedStatus`, milestone → `FUNDED`.

### Release milestone (payout)

```json
POST /api/projects/:projectId/milestones/:milestoneId/release
{
  "recipientEmail": "rohan-sandbox@example.com"
}
```

Or hackathon demo trigger:

```
POST /api/admin/demo/milestones/:milestoneId/release
X-User-Id: <client_or_freelancer>
X-Demo-Admin-Key: hackathon-demo-key
```

Uses freelancer `paypalEmail` (or `email`) when `recipientEmail` is omitted. Sets milestone `RELEASED` → `PAID` and stores payout batch/item ids.

### Create project / milestone bodies

```json
{
  "title": "Landing page redesign",
  "description": "Optional",
  "freelancerId": "<user_cuid>",
  "earlyExitPenaltyPercent": 50,
  "freelancerDepositAmountCents": 2500
}
```

Omit `freelancerDepositAmountCents` to default to **10% of milestone total** (floor cents) when the deposit is funded / shown.

### Exit & penalties

Three paths (amounts in integer cents; percentages use **floor**):

| Path | Status | Vault | Deposit |
|------|--------|-------|---------|
| **Mutual** (request → accept) | `CANCELLED_MUTUAL` | 100% unspent → client | Returned to freelancer |
| **Client one-sided** | `CANCELLED_BY_CLIENT` | `floor(remaining × earlyExitPenaltyPercent / 100)` → freelancer (default **50%**); rest → client | Returned to freelancer |
| **Freelancer walk-away** | `ABANDONED_BY_FREELANCER` | 100% unspent → client | Forfeited to client |

- Freelancer funds a **security deposit** via PayPal Orders (same approve → capture as vault) before work; `depositStatus`: `PENDING` → `HELD` → `RETURNED` | `FORFEITED`.
- On successful completion (all milestones paid after audit PASS), held deposit is returned via PayPal Payouts (or mock).
- After cancel/abandon, funding, GitHub linking, and merges are blocked.
- Exit handlers are **idempotent** (`ExitEvent.idempotencyKey = exit:<projectId>`).

### Project chat (text only)

```json
POST /api/projects/:projectId/messages
{ "body": "Can you clarify the login acceptance criteria?" }
```

- Only the project’s **client** or **freelancer** may `GET`/`POST` messages (`403` otherwise).
- Body must be non-empty, max **2000** characters.
- Chat remains available after cancel/abandon for dispute context (unlike fund/GitHub/merge).
- Demo UI: chat panel on the Project step; polls every few seconds (no WebSockets / calls).
- UI **Cancel / Exit** shows money destinations **before** confirm.
- Consent is the full **User Consent Agreement v2.0.0** (identity, platform-only communication, exit/penalty rules, conduct, disputes); users tick agree with **name + date**.

**PayPal sandbox / mock notes:** Mock mode simulates refunds and payouts without calling PayPal. Live sandbox **capture refunds** (`POST /v2/payments/captures/{id}/refund`) only work while PayPal still allows refunding that capture; partial refunds across multiple vault captures are applied oldest-first. Payouts for penalties / deposit return / forfeit use the Payouts API (or mock batch ids). No extra env vars beyond existing PayPal credentials / `PAYPAL_MOCK`.

```json
{
  "title": "Milestone 1",
  "taskDescription": "Ship hero + CTA",
  "acceptanceCriteria": "Matches Figma; Lighthouse a11y >= 90",
  "amountCents": 25000,
  "githubRepoFullName": "acme/landing"
}
```

KYC + PayPal credentials use env placeholders only — see `.env.example`.

### Link GitHub + merge → AI audit → payout

```json
POST /api/projects/:projectId/milestones/:milestoneId/github
{
  "githubRepoFullName": "acme/landing",
  "githubPrNumber": 1
}
```

Real webhook (needs public URL + `GITHUB_WEBHOOK_SECRET`):

```
POST /api/webhooks/github
X-Hub-Signature-256: sha256=...
X-GitHub-Event: pull_request
```

Handles `pull_request` `closed` with `merged=true`. Fetches PR diff via `GITHUB_TOKEN`, or accepts an embedded `diff` / `aegis_diff` stub. AI auditor (`services/aiAuditor.auditMilestone`) parses acceptance criteria into checks, scores the PR diff (OpenAI/Anthropic when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is set; otherwise deterministic heuristics), and returns `{ passed, reason, checks, report }`; on PASS calls existing escrow `releaseMilestone`.

Hackathon without a public URL:

```
POST /api/admin/demo/milestones/:milestoneId/simulate-merge
X-User-Id: <kyc_user>
X-Demo-Admin-Key: hackathon-demo-key
{ "diff": "optional stub; default includes acceptance keywords so audit PASSes" }
```

## Hackathon demo (PayPal sandbox + GitHub)

1. Create Sarah (client) + Rohan (freelancer) users with KYC + monitoring consent; set Rohan `paypal_email` to a sandbox personal account email.
2. Create project + Milestone 1 (`amountCents: 25000`, acceptance criteria with a few clear keywords).
3. As Sarah: `POST /api/vault/fund` with `projectId` + `milestoneId` (sandbox client credentials, or `PAYPAL_MOCK=true`).
4. Confirm vault fund `status: CAPTURED` and milestone `FUNDED`.
5. Link GitHub: `POST .../milestones/:id/github` with `githubRepoFullName` + optional PR.
6. Simulate merge (or fire a real webhook): `POST /api/admin/demo/milestones/:id/simulate-merge` with `X-Demo-Admin-Key`.
7. Confirm audit `PASS`, milestone `PAID` + `paypal_payout_batch_id` / `github_merge_sha` set. If the milestone was created with `requiresManualSignoff: true`, the pass stops at `PASSED` until the client calls `POST .../signoff`.
8. Judges see the structured audit on the simulate-merge / webhook JSON (`audit.reason`, `audit.checks[]`) and on `milestone.auditReport` (PASS/FAIL text with ✓/✗ evidence).

## Tests

```bash
npm test
```
