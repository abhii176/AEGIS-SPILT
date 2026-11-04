# Aegis-Split

Escrow marketplace where clients fund milestones via PayPal, freelancers ship on GitHub, and AI audits merges before payout.

## Sprint 1 — Auth + KYC + monitoring consent

This slice scaffolds:

| Piece | What |
|-------|------|
| Prisma `User` | `gov_id_verified`, `kyc_provider`, `monitoring_consent_granted` |
| Prisma `ConsentLogs` | Timestamp + IP when the user accepts chat/call monitoring ToS |
| `POST /api/auth/verify-identity` | India → DigiLocker OAuth; other countries → Stripe Identity (regional scaffold) |
| Callbacks | DigiLocker + Stripe Identity set `gov_id_verified` + `kyc_provider` |
| `POST /api/consent/monitoring` | Writes `ConsentLogs` and sets `monitoring_consent_granted` |
| Gate middleware | Blocks project create, vault fund, and code merge unless **both** flags are true |

## Setup

```bash
cp .env.example .env
# set DATABASE_URL (PostgreSQL) and KYC placeholders
npm install
npx prisma migrate dev --name init_kyc_consent
npm run dev
```

Auth is stubbed: send `X-User-Id: <user cuid>` on protected routes until sessions land.

## Key routes

```
POST /api/auth/verify-identity
GET  /api/auth/verify-identity/callback/digilocker
GET  /api/auth/verify-identity/callback/stripe
POST /api/consent/monitoring
POST /api/projects          # gated
POST /api/vault/fund        # gated
POST /api/merge             # gated
GET  /health
```

KYC provider credentials use env placeholders only — see `.env.example`.
