CREATE TABLE "staging_selections" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"accept_partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staging_selections" ADD CONSTRAINT "staging_selections_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_selections" ADD CONSTRAINT "staging_selections_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;