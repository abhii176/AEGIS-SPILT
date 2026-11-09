-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'HELD', 'RETURNED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExitPath" AS ENUM ('MUTUAL', 'CLIENT_ONESIDED', 'FREELANCER_WALKAWAY');

-- CreateEnum
CREATE TYPE "DepositDisposition" AS ENUM ('NONE', 'RETURNED', 'FORFEITED');

-- AlterEnum ProjectStatus
ALTER TYPE "ProjectStatus" ADD VALUE 'CANCELLED_MUTUAL';
ALTER TYPE "ProjectStatus" ADD VALUE 'CANCELLED_BY_CLIENT';
ALTER TYPE "ProjectStatus" ADD VALUE 'ABANDONED_BY_FREELANCER';

-- AlterTable projects
ALTER TABLE "projects"
  ADD COLUMN "early_exit_penalty_percent" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "freelancer_deposit_amount_cents" INTEGER,
  ADD COLUMN "deposit_status" "DepositStatus" NOT NULL DEFAULT 'PENDING';

CREATE INDEX "projects_deposit_status_idx" ON "projects"("deposit_status");

-- AlterTable vault_funds (idempotent refund tracking)
ALTER TABLE "vault_funds"
  ADD COLUMN "refunded_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paypal_refund_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable freelancer_deposits
CREATE TABLE "freelancer_deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "VaultFundStatus" NOT NULL DEFAULT 'PENDING',
    "paypal_order_id" TEXT,
    "paypal_capture_id" TEXT,
    "approval_url" TEXT,
    "disposition_batch_id" TEXT,
    "disposition_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freelancer_deposits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "freelancer_deposits_user_id_idx" ON "freelancer_deposits"("user_id");
CREATE INDEX "freelancer_deposits_project_id_idx" ON "freelancer_deposits"("project_id");
CREATE INDEX "freelancer_deposits_paypal_order_id_idx" ON "freelancer_deposits"("paypal_order_id");

ALTER TABLE "freelancer_deposits"
  ADD CONSTRAINT "freelancer_deposits_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "freelancer_deposits"
  ADD CONSTRAINT "freelancer_deposits_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable cancellation_requests
CREATE TABLE "cancellation_requests" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "responded_by_user_id" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cancellation_requests_project_id_status_idx" ON "cancellation_requests"("project_id", "status");
CREATE INDEX "cancellation_requests_requested_by_user_id_idx" ON "cancellation_requests"("requested_by_user_id");

ALTER TABLE "cancellation_requests"
  ADD CONSTRAINT "cancellation_requests_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cancellation_requests"
  ADD CONSTRAINT "cancellation_requests_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cancellation_requests"
  ADD CONSTRAINT "cancellation_requests_responded_by_user_id_fkey"
  FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable exit_events
CREATE TABLE "exit_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "exit_path" "ExitPath" NOT NULL,
    "initiated_by_user_id" TEXT NOT NULL,
    "reason" TEXT,
    "remaining_vault_cents" INTEGER NOT NULL,
    "penalty_cents" INTEGER NOT NULL DEFAULT 0,
    "client_refund_cents" INTEGER NOT NULL DEFAULT 0,
    "freelancer_payout_cents" INTEGER NOT NULL DEFAULT 0,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "deposit_disposition" "DepositDisposition" NOT NULL DEFAULT 'NONE',
    "transfer_ids" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_events_idempotency_key_key" ON "exit_events"("idempotency_key");
CREATE INDEX "exit_events_project_id_idx" ON "exit_events"("project_id");
CREATE INDEX "exit_events_exit_path_idx" ON "exit_events"("exit_path");

ALTER TABLE "exit_events"
  ADD CONSTRAINT "exit_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exit_events"
  ADD CONSTRAINT "exit_events_initiated_by_user_id_fkey"
  FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
