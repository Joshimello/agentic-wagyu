CREATE TABLE "approved_item_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"review_version" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"previous_version_id" uuid,
	"value" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"reviewer_added" jsonb NOT NULL,
	"memory_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_item_versions_review_version_unique" UNIQUE("review_version"),
	CONSTRAINT "approved_item_versions_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "change_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comparison_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_review_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"review_version" integer NOT NULL,
	"input" jsonb NOT NULL,
	"reviewer" text DEFAULT 'local user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_review_events_proposal_id_unique" UNIQUE("proposal_id"),
	CONSTRAINT "change_review_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "change_review_events_review_version_unique" UNIQUE("review_version")
);
--> statement-breakpoint
CREATE TABLE "comparison_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress" text DEFAULT 'Waiting to compare meetings' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"error" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "comparison_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interpretation_runs" ADD COLUMN "review_mode" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "approved_item_versions" ADD CONSTRAINT "approved_item_versions_project_id_memory_nodes_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memory_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_item_versions" ADD CONSTRAINT "approved_item_versions_event_id_change_review_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."change_review_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_item_versions" ADD CONSTRAINT "approved_item_versions_memory_version_memory_commits_version_fk" FOREIGN KEY ("memory_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_comparison_id_comparison_jobs_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparison_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_review_events" ADD CONSTRAINT "change_review_events_proposal_id_change_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."change_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_outbox" ADD CONSTRAINT "comparison_outbox_id_comparison_jobs_id_fk" FOREIGN KEY ("id") REFERENCES "public"."comparison_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approved_item_version_unique" ON "approved_item_versions" USING btree ("item_id","review_version");