-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'AUDITING', 'PASSED', 'FAILED', 'PAID', 'CANCELLED');

-- AlterTable: evolve scaffold projects (owner_id) → client/freelancer/status
ALTER TABLE "projects" ADD COLUMN "client_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "freelancer_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT';

-- Backfill from legacy owner_id (scaffold data); freelancer mirrors client when unknown
UPDATE "projects"
SET "client_id" = "owner_id",
    "freelancer_id" = "owner_id"
WHERE "client_id" IS NULL;

ALTER TABLE "projects" ALTER COLUMN "client_id" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "freelancer_id" SET NOT NULL;

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_id_fkey";
DROP INDEX IF EXISTS "projects_owner_id_idx";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "owner_id";

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "acceptance_criteria" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "github_repo_full_name" TEXT,
    "github_pr_number" INTEGER,
    "github_pr_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_client_id_idx" ON "projects"("client_id");
CREATE INDEX "projects_freelancer_id_idx" ON "projects"("freelancer_id");
CREATE INDEX "projects_status_idx" ON "projects"("status");
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");
CREATE INDEX "milestones_status_idx" ON "milestones"("status");
CREATE UNIQUE INDEX "milestones_project_id_sequence_key" ON "milestones"("project_id", "sequence");
CREATE INDEX "vault_funds_project_id_idx" ON "vault_funds"("project_id");
CREATE INDEX "merge_events_project_id_idx" ON "merge_events"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_freelancer_id_fkey" FOREIGN KEY ("freelancer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vault_funds" ADD CONSTRAINT "vault_funds_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merge_events" ADD CONSTRAINT "merge_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
