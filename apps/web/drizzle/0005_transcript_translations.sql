CREATE TABLE "transcript_translations" (
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
CREATE TABLE "translation_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_translations" ADD CONSTRAINT "transcript_translations_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_outbox" ADD CONSTRAINT "translation_outbox_id_transcript_translations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."transcript_translations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_translation_revision_language_prompt_unique" ON "transcript_translations" USING btree ("revision_id","language","prompt_version");