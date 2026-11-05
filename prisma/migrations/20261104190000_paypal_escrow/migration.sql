-- CreateEnum
CREATE TYPE "ProjectFundedStatus" AS ENUM ('UNFUNDED', 'PARTIAL', 'FUNDED');

-- CreateEnum
CREATE TYPE "VaultFundStatus" AS ENUM ('PENDING', 'ORDER_CREATED', 'CAPTURED', 'FAILED');

-- AlterEnum
ALTER TYPE "MilestoneStatus" ADD VALUE 'RELEASED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "paypal_email" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "funded_status" "ProjectFundedStatus" NOT NULL DEFAULT 'UNFUNDED';
ALTER TABLE "projects" ADD COLUMN "paypal_order_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "paypal_capture_id" TEXT;

-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "paypal_payout_batch_id" TEXT;
ALTER TABLE "milestones" ADD COLUMN "paypal_payout_item_id" TEXT;
ALTER TABLE "milestones" ADD COLUMN "payout_email" TEXT;
ALTER TABLE "milestones" ADD COLUMN "released_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vault_funds" ADD COLUMN "milestone_id" TEXT;
ALTER TABLE "vault_funds" ADD COLUMN "status" "VaultFundStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "vault_funds" ADD COLUMN "paypal_order_id" TEXT;
ALTER TABLE "vault_funds" ADD COLUMN "paypal_capture_id" TEXT;
ALTER TABLE "vault_funds" ADD COLUMN "approval_url" TEXT;
ALTER TABLE "vault_funds" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "projects_funded_status_idx" ON "projects"("funded_status");
CREATE INDEX "vault_funds_milestone_id_idx" ON "vault_funds"("milestone_id");
CREATE INDEX "vault_funds_paypal_order_id_idx" ON "vault_funds"("paypal_order_id");

-- AddForeignKey
ALTER TABLE "vault_funds" ADD CONSTRAINT "vault_funds_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
