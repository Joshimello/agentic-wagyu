CREATE TABLE "meeting_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"filenames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"accepted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_outbox" ADD CONSTRAINT "summary_outbox_id_meeting_summaries_id_fk" FOREIGN KEY ("id") REFERENCES "public"."meeting_summaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_summary_revision_prompt_unique" ON "meeting_summaries" USING btree ("revision_id","prompt_version");