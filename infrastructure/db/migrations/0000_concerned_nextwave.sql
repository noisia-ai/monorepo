CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text,
	"handle" text,
	"display_name" text,
	"profile_url" text,
	"follower_count_last_seen" integer,
	"inferred_gender" char(1),
	"inferred_country" char(2),
	"is_verified" boolean,
	"is_business" boolean,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	CONSTRAINT "uq_authors_platform_external" UNIQUE("platform","external_id")
);
--> statement-breakpoint
CREATE TABLE "brand_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT ARRAY[]::text[],
	"detection_patterns" text[] DEFAULT ARRAY[]::text[],
	"vertical" text,
	"sub_vertical" text,
	"country" char(2),
	"is_institution" boolean DEFAULT false,
	"notes" text,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_seeds_canonical_name_unique" UNIQUE("canonical_name")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"industry" text,
	"industry_sub" text,
	"countries" char(2)[] DEFAULT ARRAY['MX']::char(2)[],
	"description" text,
	"brand_seed_handles" text[] DEFAULT ARRAY[]::text[],
	"status" text NOT NULL,
	"primary_brand_manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug"),
	CONSTRAINT "uq_brands_org_slug" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_brand_seed_id" uuid NOT NULL,
	"priority" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_competitors_brand_seed" UNIQUE("brand_id","competitor_brand_seed_id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_corpus_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_file_name" text,
	"source_file_hash" text,
	"imported_by_user_id" uuid,
	"record_count" integer DEFAULT 0,
	"included_count" integer DEFAULT 0,
	"excluded_count" integer DEFAULT 0,
	"duplicate_count" integer DEFAULT 0,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_corpus_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_system" text NOT NULL,
	"source_file_id" uuid,
	"text_hash" text NOT NULL,
	"text_raw" text,
	"text_clean" text NOT NULL,
	"text_snippet" text,
	"title" text,
	"text_length" integer NOT NULL,
	"language" char(2),
	"published_at" timestamp with time zone NOT NULL,
	"platform" text NOT NULL,
	"url" text,
	"author_id" uuid,
	"country" char(2),
	"engagement" jsonb,
	"sentiment_source" text,
	"sentiment_score" text,
	"quality_score" integer,
	"inclusion_status" text DEFAULT 'pending' NOT NULL,
	"exclusion_reason" text,
	"quality_flags" jsonb,
	"raw_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_mentions_corpus_text_hash" UNIQUE("study_corpus_id","text_hash"),
	CONSTRAINT "uq_mentions_source_external" UNIQUE("source_system","external_id")
);
--> statement-breakpoint
CREATE TABLE "methodologies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"manifest_yaml" jsonb NOT NULL,
	"default_blocks" jsonb,
	"scrollytelling_template" jsonb,
	"ai_prompts" jsonb,
	"quality_gates" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text,
	"hq_country" char(2) DEFAULT 'MX',
	"industry_primary" text,
	"is_holding" boolean DEFAULT false,
	"status" text NOT NULL,
	"contract_started_at" date,
	"account_owner_kam_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "study_corpora" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"theme_id" uuid,
	"methodology_id" uuid NOT NULL,
	"methodology_version_at_creation" text NOT NULL,
	"business_question" text,
	"decision_to_inform" text,
	"audience_segment" text,
	"geo_focus" char(2)[] DEFAULT ARRAY['MX']::char(2)[],
	"target_window_months" integer DEFAULT 12,
	"context_form" jsonb,
	"status" text NOT NULL,
	"current_pipeline_version" text,
	"insights_manager_user_id" uuid,
	"kam_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"corpus_first_approved_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpus_has_exactly_one_subject" CHECK ((("study_corpora"."brand_id" IS NOT NULL)::int + ("study_corpora"."theme_id" IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"industry_focus" text[] DEFAULT ARRAY[]::text[],
	"geo_focus" char(2)[] DEFAULT ARRAY['MX']::char(2)[],
	"status" text NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_brand_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "uq_user_brand_access" UNIQUE("user_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"user_type" text NOT NULL,
	"primary_role" text NOT NULL,
	"organization_id" uuid,
	"status" text NOT NULL,
	"whatsapp_number" text,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by_user_id" uuid,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_primary_brand_manager_user_id_users_id_fk" FOREIGN KEY ("primary_brand_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_competitor_brand_seed_id_brand_seeds_id_fk" FOREIGN KEY ("competitor_brand_seed_id") REFERENCES "public"."brand_seeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_study_corpus_id_study_corpora_id_fk" FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_study_corpus_id_study_corpora_id_fk" FOREIGN KEY ("study_corpus_id") REFERENCES "public"."study_corpora"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_source_file_id_import_batches_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_account_owner_kam_id_users_id_fk" FOREIGN KEY ("account_owner_kam_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_corpora" ADD CONSTRAINT "study_corpora_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_corpora" ADD CONSTRAINT "study_corpora_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_corpora" ADD CONSTRAINT "study_corpora_methodology_id_methodologies_id_fk" FOREIGN KEY ("methodology_id") REFERENCES "public"."methodologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_corpora" ADD CONSTRAINT "study_corpora_insights_manager_user_id_users_id_fk" FOREIGN KEY ("insights_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_corpora" ADD CONSTRAINT "study_corpora_kam_user_id_users_id_fk" FOREIGN KEY ("kam_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brand_access" ADD CONSTRAINT "user_brand_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brand_access" ADD CONSTRAINT "user_brand_access_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brand_access" ADD CONSTRAINT "user_brand_access_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_brands_org" ON "brands" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_brands_industry" ON "brands" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "idx_import_batches_corpus" ON "import_batches" USING btree ("study_corpus_id");--> statement-breakpoint
CREATE INDEX "idx_import_batches_status" ON "import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mentions_corpus_platform" ON "mentions" USING btree ("study_corpus_id","platform");--> statement-breakpoint
CREATE INDEX "idx_mentions_corpus_inclusion" ON "mentions" USING btree ("study_corpus_id","inclusion_status");--> statement-breakpoint
CREATE INDEX "idx_mentions_published" ON "mentions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_mentions_text_hash" ON "mentions" USING btree ("text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_methodologies_slug_version" ON "methodologies" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "idx_methodologies_slug" ON "methodologies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_methodologies_status" ON "methodologies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_corpus_brand_method" ON "study_corpora" USING btree ("brand_id","methodology_id") WHERE "study_corpora"."brand_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_corpus_theme_method" ON "study_corpora" USING btree ("theme_id","methodology_id") WHERE "study_corpora"."theme_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sc_brand" ON "study_corpora" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_sc_theme" ON "study_corpora" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "idx_sc_method" ON "study_corpora" USING btree ("methodology_id");--> statement-breakpoint
CREATE INDEX "idx_sc_status" ON "study_corpora" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_themes_org" ON "themes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_themes_public" ON "themes" USING btree ("is_public") WHERE "themes"."is_public" = true;--> statement-breakpoint
CREATE INDEX "idx_uba_user" ON "user_brand_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_uba_brand" ON "user_brand_access" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("primary_role");