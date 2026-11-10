-- Sandbox KYC fields. Full ID numbers are not stored; only a mask and last 4.
ALTER TABLE "users" ADD COLUMN "kyc_method" TEXT;
ALTER TABLE "users" ADD COLUMN "kyc_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "kyc_id_last4" TEXT;
ALTER TABLE "users" ADD COLUMN "kyc_masked_id" TEXT;
ALTER TABLE "users" ADD COLUMN "kyc_phone_last4" TEXT;
ALTER TABLE "users" ADD COLUMN "kyc_sandbox_progress" JSONB;
