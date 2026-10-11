ALTER TABLE "push_batches" ADD COLUMN "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_batches" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interpretation_runs" ADD COLUMN "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "interpretation_runs" SET "progress_percent" = 100 WHERE "state" IN ('ready', 'ready_with_warnings');
--> statement-breakpoint
UPDATE "push_batches" SET "progress_percent" = 100 WHERE "state" = 'committed';
