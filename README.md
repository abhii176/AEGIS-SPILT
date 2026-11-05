# Aegis-Split

Escrow marketplace where clients fund milestones via PayPal, freelancers ship on GitHub, and AI audits merges before payout.

## What's built

| Slice | What |
|-------|------|
| **KYC + consent** | DigiLocker / Stripe Identity scaffolds, `ConsentLogs`, gate middleware |
| **Projects + milestones** | Client/freelancer projects, milestones with acceptance criteria + amounts |
| **PayPal escrow** | Orders API lock (fund vault); Payouts API release; admin/demo trigger |

## Setup

```bash
cp .env.example .env
# set DATABASE_URL, KYC placeholders, and PayPal sandbox credentials
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
POST /api/projects/:projectId/milestones/:milestoneId/release  # gated — PayPal Payouts

POST /api/vault/fund                       # gated — PayPal Orders lock
POST /api/vault/capture                    # gated — capture pending order
POST /api/admin/demo/milestones/:milestoneId/release  # gated + X-Demo-Admin-Key
POST /api/merge                             # gated
GET  /health
```

### Fund vault (lock escrow)

```json
POST /api/vault/fund
{
  "projectId": "<project_cuid>",
  "milestoneId": "<optional_milestone_cuid>",
  "amountCents": 50000,
  "capture": true
}
```

- Omit `milestoneId` + `amountCents` → locks the sum of all `PENDING` milestones.
- With `PAYPAL_AUTO_CAPTURE=true` (default) or `"capture": true`, the order is captured immediately (sandbox happy path).
- Persist: `VaultFund.paypalOrderId` / `paypalCaptureId`, `Project.fundedStatus`, milestone → `FUNDED`.

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

## Hackathon demo (PayPal sandbox)

1. Create Sarah (client) + Rohan (freelancer) users with KYC + monitoring consent; set Rohan `paypal_email` to a sandbox personal account email.
2. Create project + Milestone 1 (`amountCents: 25000`).
3. As Sarah: `POST /api/vault/fund` with `projectId` + `milestoneId` (sandbox client credentials, or `PAYPAL_MOCK=true`).
4. Confirm vault fund `status: CAPTURED` and milestone `FUNDED`.
5. Trigger release: project release route or `POST /api/admin/demo/milestones/:id/release` with `X-Demo-Admin-Key`.
6. Confirm milestone `PAID` + `paypal_payout_batch_id` set.

## Tests

```bash
npm test
```
