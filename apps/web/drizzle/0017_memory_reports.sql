CREATE TABLE IF NOT EXISTS "memory_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"target_text" text NOT NULL,
	"note" text NOT NULL,
	"reporter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
