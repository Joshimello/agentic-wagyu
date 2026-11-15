CREATE TABLE IF NOT EXISTS "hidden_projects" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
