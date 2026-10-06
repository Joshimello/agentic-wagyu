CREATE TABLE "chronicler_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_admissions" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"commit_version" integer NOT NULL,
	"source_time" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"commit_version" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"input" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"base_version" integer NOT NULL,
	"commit_version" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"progress" text DEFAULT 'Waiting for Chronicler' NOT NULL,
	"error" text,
	"checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" jsonb,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_batches_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "push_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"push_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"accept_partial" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"commit_version" integer NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"commit_version" integer NOT NULL,
	"text" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"effective_date" text,
	"evidence" jsonb NOT NULL,
	"entity_ids" jsonb NOT NULL,
	"update_basis_quote" text,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"state_key" text NOT NULL,
	"created_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_commits" ADD COLUMN "push_id" uuid;--> statement-breakpoint
ALTER TABLE "chronicler_outbox" ADD CONSTRAINT "chronicler_outbox_id_push_batches_id_fk" FOREIGN KEY ("id") REFERENCES "public"."push_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_admissions" ADD CONSTRAINT "evidence_admissions_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_admissions" ADD CONSTRAINT "evidence_admissions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_admissions" ADD CONSTRAINT "evidence_admissions_commit_version_memory_commits_version_fk" FOREIGN KEY ("commit_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_events" ADD CONSTRAINT "knowledge_events_commit_version_memory_commits_version_fk" FOREIGN KEY ("commit_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_project_id_memory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memory_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_created_version_memory_commits_version_fk" FOREIGN KEY ("created_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_projects" ADD CONSTRAINT "memory_projects_created_version_memory_commits_version_fk" FOREIGN KEY ("created_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_items" ADD CONSTRAINT "push_items_push_id_push_batches_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."push_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_items" ADD CONSTRAINT "push_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_items" ADD CONSTRAINT "push_items_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_relations" ADD CONSTRAINT "statement_relations_from_version_id_statement_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."statement_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_relations" ADD CONSTRAINT "statement_relations_to_version_id_statement_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."statement_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_relations" ADD CONSTRAINT "statement_relations_commit_version_memory_commits_version_fk" FOREIGN KEY ("commit_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_versions" ADD CONSTRAINT "statement_versions_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_versions" ADD CONSTRAINT "statement_versions_commit_version_memory_commits_version_fk" FOREIGN KEY ("commit_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_project_id_memory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memory_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_created_version_memory_commits_version_fk" FOREIGN KEY ("created_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_item_unique" ON "push_items" USING btree ("push_id","upload_id");--> statement-breakpoint
ALTER TABLE "memory_commits" ADD CONSTRAINT "memory_commits_push_id_unique" UNIQUE("push_id");