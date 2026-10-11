-- Both branches shipped migration 0005 independently. Drizzle orders applied
-- migrations by timestamp, so upgrades from the translation branch can skip
-- the older Researcher migrations. Converge either history without rewriting
-- applied migrations or replacing existing research/translation records.
CREATE TABLE IF NOT EXISTS "research_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress" text DEFAULT 'Waiting for Researcher' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"answer" jsonb,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_outbox_id_research_runs_id_fk' AND conrelid = 'public.research_outbox'::regclass) THEN
    ALTER TABLE "research_outbox" ADD CONSTRAINT "research_outbox_id_research_runs_id_fk" FOREIGN KEY ("id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "research_outbox" ADD COLUMN IF NOT EXISTS "generation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transcript_translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"language" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"fingerprint" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"total_segments" integer NOT NULL,
	"completed_segments" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translation_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcript_translations_revision_id_staging_revisions_id_fk' AND conrelid = 'public.transcript_translations'::regclass) THEN
    ALTER TABLE "transcript_translations" ADD CONSTRAINT "transcript_translations_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'translation_outbox_id_transcript_translations_id_fk' AND conrelid = 'public.translation_outbox'::regclass) THEN
    ALTER TABLE "translation_outbox" ADD CONSTRAINT "translation_outbox_id_transcript_translations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."transcript_translations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transcript_translation_revision_language_prompt_unique" ON "transcript_translations" USING btree ("revision_id","language","prompt_version");
