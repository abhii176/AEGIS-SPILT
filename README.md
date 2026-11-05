# Aegis-Split

Escrow marketplace where clients fund milestones via PayPal, freelancers ship on GitHub, and AI audits merges before payout.

## What's built

| Slice | What |
|-------|------|
| **KYC + consent** | DigiLocker / Stripe Identity scaffolds, `ConsentLogs`, gate middleware |
| **Projects + milestones** | Client/freelancer projects, milestones with acceptance criteria + amounts |
| **PayPal escrow** | Orders API lock (fund vault); Payouts API release; admin/demo trigger |
| **GitHub merge** | Link repo/PR to milestone; webhook HMAC; AI auditor → PayPal release |
| **AI auditor** | Structured criteria checks (LLM if keyed, else deterministic heuristics) |

## Setup

```bash
cp .env.example .env
# set DATABASE_URL, KYC placeholders, PayPal sandbox credentials,
# and GITHUB_WEBHOOK_SECRET / GITHUB_TOKEN (or use demo simulate-merge)
# or set PAYPAL_MOCK=true for local demo without PayPal credentials
npm install
npx prisma migrate deploy
# or: npx prisma migrate dev
npm run dev
```

Auth is stubbed: send `X-User-Id: <user cuid>` on protected routes until sessions land.

## Key routes

```
POST /api/auth/verify-identity
GET  /api/auth/verify-identity/callback/digilocker
GET  /api/auth/verify-identity/callback/stripe
POST /api/consent/monitoring

POST /api/projects                          # gated (KYC + consent)
GET  /api/projects
GET  /api/projects/:projectId
POST /api/projects/:projectId/milestones    # gated
GET  /api/projects/:projectId/milestones
POST /api/projects/:projectId/milestones/:milestoneId/github   # gated — link repo/PR
POST /api/projects/:projectId/milestones/:milestoneId/release  # gated — PayPal Payouts

POST /api/vault/fund                       # gated — create PayPal order + approve link
POST /api/vault/capture                    # gated — capture after buyer approval
GET  /api/vault/paypal/return?token=...    # PayPal return — capture if APPROVED
GET  /api/vault/paypal/cancel?token=...    # PayPal cancel — mark fund CANCELLED
POST /api/webhooks/github                  # GitHub HMAC; pull_request closed+merged
POST /api/admin/demo/milestones/:milestoneId/release         # gated + X-Demo-Admin-Key
POST /api/admin/demo/milestones/:milestoneId/simulate-merge  # gated + X-Demo-Admin-Key
POST /api/merge                             # gated
GET  /health
```

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
  "freelancerId": "<user_cuid>"
}
```

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
7. Confirm audit `PASS`, milestone `PAID` + `paypal_payout_batch_id` / `github_merge_sha` set.
8. Judges see the structured audit on the simulate-merge / webhook JSON (`audit.reason`, `audit.checks[]`) and on `milestone.auditReport` (PASS/FAIL text with ✓/✗ evidence).

## Tests

```bash
npm test
```
