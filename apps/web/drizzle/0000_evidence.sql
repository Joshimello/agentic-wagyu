CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "memory_commits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_commits_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"run_id" uuid,
	"parent_revision_id" uuid,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interpretation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress" text DEFAULT 'Waiting for worker' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_outbox" ADD CONSTRAINT "job_outbox_id_interpretation_runs_id_fk" FOREIGN KEY ("id") REFERENCES "public"."interpretation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_revisions" ADD CONSTRAINT "staging_revisions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_revisions" ADD CONSTRAINT "staging_revisions_run_id_interpretation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."interpretation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretation_runs" ADD CONSTRAINT "interpretation_runs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staging_run_unique" ON "staging_revisions" USING btree ("run_id");