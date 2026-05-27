CREATE TABLE "memory_brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"memory_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"source_corpus_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_industry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry" text NOT NULL,
	"industry_sub" text,
	"methodology_slug" text,
	"memory_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"evidence_count" integer,
	"shareable" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_consulted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "query_iterations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_corpus_id" uuid NOT NULL,
	"iteration_number" integer NOT NULL,
	"query_text" text NOT NULL,
	"query_components" jsonb,
	"mentions_returned" integer,
	"quality_score" numeric(5, 2),
	"density_score" numeric(5, 2),
	"noise_score" numeric(5, 2),
	"ai_evaluation_notes" text,
	"insights_manager_decision" text,
	"insights_manager_user_id" uuid,
	"decision_at" timestamp with time zone,
	"pipeline_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_query_iterations_corpus_iteration" UNIQUE("study_corpus_id","iteration_number")
);
--> statement-breakpoint
ALTER TABLE "memory_brand" ADD CONSTRAINT "memory_brand_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_brand" ADD CONSTRAINT "memory_brand_source_corpus_id_study_corpora_id_fk" FOREIGN KEY ("source_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_iterations" ADD CONSTRAINT "query_iterations_study_corpus_id_study_corpora_id_fk" FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_iterations" ADD CONSTRAINT "query_iterations_insights_manager_user_id_users_id_fk" FOREIGN KEY ("insights_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mb_brand" ON "memory_brand" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_mb_type" ON "memory_brand" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "idx_mi_industry" ON "memory_industry" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "idx_mi_method" ON "memory_industry" USING btree ("methodology_slug");--> statement-breakpoint
CREATE INDEX "idx_mi_shareable" ON "memory_industry" USING btree ("shareable");--> statement-breakpoint
CREATE INDEX "idx_qi_corpus" ON "query_iterations" USING btree ("study_corpus_id");--> statement-breakpoint
CREATE INDEX "idx_qi_created" ON "query_iterations" USING btree ("created_at");