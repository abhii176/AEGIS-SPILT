-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "requires_manual_signoff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "milestones" ADD COLUMN "manual_signed_off_at" TIMESTAMP(3);
ALTER TABLE "milestones" ADD COLUMN "manual_signed_off_by_user_id" TEXT;
