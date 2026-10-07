CREATE TABLE "memory_node_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"commit_version" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"scope_id" uuid,
	"revision_id" uuid,
	"created_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_node_versions" ADD CONSTRAINT "memory_node_versions_node_id_memory_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."memory_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_node_versions" ADD CONSTRAINT "memory_node_versions_commit_version_memory_commits_version_fk" FOREIGN KEY ("commit_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_nodes" ADD CONSTRAINT "memory_nodes_revision_id_staging_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."staging_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_nodes" ADD CONSTRAINT "memory_nodes_created_version_memory_commits_version_fk" FOREIGN KEY ("created_version") REFERENCES "public"."memory_commits"("version") ON DELETE no action ON UPDATE no action;