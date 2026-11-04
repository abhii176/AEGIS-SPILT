# Aegis-Split

Escrow marketplace where clients fund milestones via PayPal, freelancers ship on GitHub, and AI audits merges before payout.

## What's built

| Slice | What |
|-------|------|
| **KYC + consent** | DigiLocker / Stripe Identity scaffolds, `ConsentLogs`, gate middleware |
| **Projects + milestones** | Client/freelancer projects, milestones with acceptance criteria + amounts |

## Setup

```bash
cp .env.example .env
# set DATABASE_URL (PostgreSQL) and KYC placeholders
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

POST /api/vault/fund                       # gated
POST /api/merge                             # gated
GET  /health
```

### Create project body

```json
{
  "title": "Landing page redesign",
  "description": "Optional",
  "freelancerId": "<user_cuid>"
}
```

### Add milestone body

```json
{
  "title": "Milestone 1",
  "taskDescription": "Ship hero + CTA",
  "acceptanceCriteria": "Matches Figma; Lighthouse a11y >= 90",
  "amountCents": 25000,
  "githubRepoFullName": "acme/landing"
}
```

KYC provider credentials use env placeholders only — see `.env.example`.

## Tests

```bash
npm test
```
