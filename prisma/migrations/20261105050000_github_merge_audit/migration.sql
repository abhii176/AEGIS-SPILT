-- AlterTable milestones: merge + AI audit metadata
ALTER TABLE "milestones" ADD COLUMN "github_merge_sha" TEXT;
ALTER TABLE "milestones" ADD COLUMN "github_merged_at" TIMESTAMP(3);
ALTER TABLE "milestones" ADD COLUMN "audit_passed" BOOLEAN;
ALTER TABLE "milestones" ADD COLUMN "audit_report" TEXT;
ALTER TABLE "milestones" ADD COLUMN "audit_checked_at" TIMESTAMP(3);

-- AlterTable merge_events: link to milestone + merge metadata
ALTER TABLE "merge_events" ADD COLUMN "milestone_id" TEXT;
ALTER TABLE "merge_events" ADD COLUMN "merge_sha" TEXT;
ALTER TABLE "merge_events" ADD COLUMN "source" TEXT DEFAULT 'manual';
ALTER TABLE "merge_events" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "milestones_github_repo_full_name_github_pr_number_idx" ON "milestones"("github_repo_full_name", "github_pr_number");
CREATE INDEX "merge_events_milestone_id_idx" ON "merge_events"("milestone_id");

-- AddForeignKey
ALTER TABLE "merge_events" ADD CONSTRAINT "merge_events_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
