CREATE TABLE "research_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
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
ALTER TABLE "research_outbox" ADD CONSTRAINT "research_outbox_id_research_runs_id_fk" FOREIGN KEY ("id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;