CREATE TABLE "model_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_kind" text NOT NULL,
	"operation_id" text NOT NULL,
	"model" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"estimated_input" integer NOT NULL,
	"reserved_output" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" text,
	"elapsed_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
