CREATE TABLE IF NOT EXISTS "task_completions" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
