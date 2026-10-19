-- Noisia Data OS foundation.
-- Adds governed catalogs, Brand OS structures, knowledge assertions, taxonomies,
-- entity graph, record tags/features, lineage and semantic layer tables.
-- This migration is additive and keeps published_outputs.payload as the fallback.

CREATE TABLE IF NOT EXISTS "data_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "data_source_id" uuid REFERENCES "data_sources"("id") ON DELETE SET NULL,
  "asset_kind" text NOT NULL,
  "layer" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "owner_team" text,
  "sensitivity" text NOT NULL DEFAULT 'internal',
  "status" text NOT NULL DEFAULT 'active',
  "storage_ref" text,
  "row_count" bigint,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_assets_scope_name_layer" UNIQUE ("study_corpus_id", "name", "layer")
);

CREATE INDEX IF NOT EXISTS "idx_data_assets_scope"
  ON "data_assets" ("organization_id", "brand_id", "study_corpus_id", "layer");
CREATE INDEX IF NOT EXISTS "idx_data_assets_source"
  ON "data_assets" ("data_source_id", "layer", "status");

CREATE TABLE IF NOT EXISTS "data_asset_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "data_asset_id" uuid NOT NULL REFERENCES "data_assets"("id") ON DELETE CASCADE,
  "field_name" text NOT NULL,
  "field_type" text,
  "semantic_type" text,
  "nullable" boolean,
  "description" text,
  "examples" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_asset_fields_asset_field" UNIQUE ("data_asset_id", "field_name")
);

CREATE TABLE IF NOT EXISTS "data_contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "data_asset_id" uuid NOT NULL REFERENCES "data_assets"("id") ON DELETE CASCADE,
  "contract_name" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'draft',
  "schema_contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quality_contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "freshness_contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "semantic_contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_contracts_asset_name_version" UNIQUE ("data_asset_id", "contract_name", "version")
);

CREATE INDEX IF NOT EXISTS "idx_data_contracts_asset_status"
  ON "data_contracts" ("data_asset_id", "status");

CREATE TABLE IF NOT EXISTS "data_quality_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "data_contract_id" uuid REFERENCES "data_contracts"("id") ON DELETE CASCADE,
  "rule_key" text NOT NULL,
  "rule_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'warning',
  "definition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_quality_rules_contract_key" UNIQUE ("data_contract_id", "rule_key")
);

CREATE INDEX IF NOT EXISTS "idx_data_quality_rules_contract"
  ON "data_quality_rules" ("data_contract_id", "active");

CREATE TABLE IF NOT EXISTS "data_quality_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "data_quality_rule_id" uuid REFERENCES "data_quality_rules"("id") ON DELETE SET NULL,
  "data_asset_id" uuid REFERENCES "data_assets"("id") ON DELETE CASCADE,
  "source_sync_run_id" uuid REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  "engine_analysis_id" uuid REFERENCES "engine_analyses"("id") ON DELETE SET NULL,
  "result_key" text NOT NULL DEFAULT 'default',
  "status" text NOT NULL,
  "observed_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expected_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_data_quality_results_asset_key" UNIQUE ("data_asset_id", "result_key")
);

CREATE INDEX IF NOT EXISTS "idx_data_quality_results_asset"
  ON "data_quality_results" ("data_asset_id", "checked_at");
CREATE INDEX IF NOT EXISTS "idx_data_quality_results_run"
  ON "data_quality_results" ("source_sync_run_id", "status");
CREATE INDEX IF NOT EXISTS "idx_data_quality_results_engine"
  ON "data_quality_results" ("engine_analysis_id", "status");

CREATE TABLE IF NOT EXISTS "brand_os_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "version" integer NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brand_os_profile_has_subject" CHECK ("brand_id" IS NOT NULL OR "theme_id" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_profiles_scope"
  ON "brand_os_profiles" ("organization_id", "brand_id", "theme_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_profiles_brand_version"
  ON "brand_os_profiles" ("brand_id", "version") WHERE "brand_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_profiles_theme_version"
  ON "brand_os_profiles" ("theme_id", "version") WHERE "theme_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "brand_os_objectives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "objective_type" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "success_criteria" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "priority" integer,
  "active_from" date,
  "active_to" date,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_objectives_profile"
  ON "brand_os_objectives" ("brand_os_profile_id", "status", "priority");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_objectives_profile_type_name"
  ON "brand_os_objectives" ("brand_os_profile_id", "objective_type", "name");

CREATE TABLE IF NOT EXISTS "brand_os_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "objective_id" uuid REFERENCES "brand_os_objectives"("id") ON DELETE SET NULL,
  "knowledge_source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE SET NULL,
  "brief_type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "source_kind" text,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_brand_os_briefs_profile_corpus_type_title" UNIQUE ("brand_os_profile_id", "study_corpus_id", "brief_type", "title")
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_briefs_profile"
  ON "brand_os_briefs" ("brand_os_profile_id", "brief_type", "status");
CREATE INDEX IF NOT EXISTS "idx_brand_os_briefs_objective"
  ON "brand_os_briefs" ("objective_id", "status");
CREATE INDEX IF NOT EXISTS "idx_brand_os_briefs_source"
  ON "brand_os_briefs" ("knowledge_source_id") WHERE "knowledge_source_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "brand_os_audiences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_audiences_profile"
  ON "brand_os_audiences" ("brand_os_profile_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_audiences_profile_name"
  ON "brand_os_audiences" ("brand_os_profile_id", "name");

CREATE TABLE IF NOT EXISTS "brand_os_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "product_type" text,
  "description" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_products_profile"
  ON "brand_os_products" ("brand_os_profile_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_products_profile_name"
  ON "brand_os_products" ("brand_os_profile_id", "name");

CREATE TABLE IF NOT EXISTS "brand_os_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "claim_text" text NOT NULL,
  "claim_type" text,
  "status" text NOT NULL DEFAULT 'active',
  "valid_from" date,
  "valid_to" date,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_claims_profile"
  ON "brand_os_claims" ("brand_os_profile_id", "status", "claim_type");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_claims_profile_text"
  ON "brand_os_claims" ("brand_os_profile_id", "claim_text");

CREATE TABLE IF NOT EXISTS "brand_os_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "external_id" text,
  "campaign_type" text,
  "channel_mix" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active_from" date,
  "active_to" date,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_brand_os_campaigns_external" UNIQUE ("brand_os_profile_id", "external_id")
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_campaigns_profile"
  ON "brand_os_campaigns" ("brand_os_profile_id", "active_from", "active_to");

CREATE TABLE IF NOT EXISTS "brand_os_competitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "competitor_name" text NOT NULL,
  "competitor_brand_seed_id" uuid REFERENCES "brand_seeds"("id") ON DELETE SET NULL,
  "role" text,
  "priority" integer,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_competitors_profile"
  ON "brand_os_competitors" ("brand_os_profile_id", "priority");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_competitors_profile_name"
  ON "brand_os_competitors" ("brand_os_profile_id", "competitor_name");

CREATE TABLE IF NOT EXISTS "brand_os_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "event_type" text,
  "event_date" date,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_events_profile_date"
  ON "brand_os_events" ("brand_os_profile_id", "event_date");

CREATE TABLE IF NOT EXISTS "brand_os_seed_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "seed_set_type" text NOT NULL,
  "objective_id" uuid REFERENCES "brand_os_objectives"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_seed_sets_profile"
  ON "brand_os_seed_sets" ("brand_os_profile_id", "seed_set_type", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_brand_os_seed_sets_profile_type_name"
  ON "brand_os_seed_sets" ("brand_os_profile_id", "seed_set_type", "name");

CREATE TABLE IF NOT EXISTS "brand_os_seed_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seed_set_id" uuid NOT NULL REFERENCES "brand_os_seed_sets"("id") ON DELETE CASCADE,
  "term" text NOT NULL,
  "term_type" text NOT NULL DEFAULT 'keyword',
  "brand_seed_id" uuid REFERENCES "brand_seeds"("id") ON DELETE SET NULL,
  "weight" numeric,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_brand_os_seed_terms_set_term" UNIQUE ("seed_set_id", "term")
);

CREATE TABLE IF NOT EXISTS "brand_os_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_os_profile_id" uuid NOT NULL REFERENCES "brand_os_profiles"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "relation_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_brand_os_links_relation" UNIQUE ("source_type", "source_id", "target_type", "target_id", "relation_type")
);

CREATE INDEX IF NOT EXISTS "idx_brand_os_links_source"
  ON "brand_os_links" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "idx_brand_os_links_target"
  ON "brand_os_links" ("target_type", "target_id");

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_source_id" uuid NOT NULL REFERENCES "brand_knowledge_sources"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "chunk_text" text NOT NULL,
  "token_count" integer,
  "embedding_status" text NOT NULL DEFAULT 'pending',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_knowledge_chunks_source_index" UNIQUE ("knowledge_source_id", "chunk_index")
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_chunks_source"
  ON "knowledge_chunks" ("knowledge_source_id", "chunk_index");

CREATE TABLE IF NOT EXISTS "knowledge_assertions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE SET NULL,
  "assertion_text" text NOT NULL,
  "assertion_type" text NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "confidence" text,
  "status" text NOT NULL DEFAULT 'candidate',
  "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_assertions_source"
  ON "knowledge_assertions" ("knowledge_source_id", "status", "assertion_type");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_knowledge_assertions_source_type_text"
  ON "knowledge_assertions" ("knowledge_source_id", "assertion_type", "assertion_text");

CREATE TABLE IF NOT EXISTS "knowledge_assertion_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_assertion_id" uuid NOT NULL REFERENCES "knowledge_assertions"("id") ON DELETE CASCADE,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "relation_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_knowledge_assertion_links_relation" UNIQUE ("knowledge_assertion_id", "target_type", "target_id", "relation_type")
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_assertion_links_target"
  ON "knowledge_assertion_links" ("target_type", "target_id");

CREATE TABLE IF NOT EXISTS "knowledge_assertion_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_assertion_id" uuid REFERENCES "knowledge_assertions"("id") ON DELETE CASCADE,
  "reviewer_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "previous_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "next_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_assertion_review_events_assertion"
  ON "knowledge_assertion_review_events" ("knowledge_assertion_id", "created_at");

CREATE TABLE IF NOT EXISTS "knowledge_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_source_id" uuid REFERENCES "brand_knowledge_sources"("id") ON DELETE SET NULL,
  "knowledge_chunk_id" uuid REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL,
  "knowledge_assertion_id" uuid REFERENCES "knowledge_assertions"("id") ON DELETE SET NULL,
  "engine_analysis_id" uuid REFERENCES "engine_analyses"("id") ON DELETE SET NULL,
  "usage_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_usage_analysis"
  ON "knowledge_usage_events" ("engine_analysis_id", "usage_type");
CREATE INDEX IF NOT EXISTS "idx_knowledge_usage_source"
  ON "knowledge_usage_events" ("knowledge_source_id", "created_at");

CREATE TABLE IF NOT EXISTS "taxonomies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taxonomy_key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "scope" text NOT NULL DEFAULT 'global',
  "methodology_slug" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_taxonomies_scope"
  ON "taxonomies" ("scope", "methodology_slug", "status");

CREATE TABLE IF NOT EXISTS "taxonomy_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "taxonomy_id" uuid NOT NULL REFERENCES "taxonomies"("id") ON DELETE CASCADE,
  "term_key" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "parent_term_id" uuid REFERENCES "taxonomy_terms"("id") ON DELETE SET NULL,
  "sort_order" integer,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_taxonomy_terms_taxonomy_key" UNIQUE ("taxonomy_id", "term_key")
);

CREATE INDEX IF NOT EXISTS "idx_taxonomy_terms_taxonomy_parent"
  ON "taxonomy_terms" ("taxonomy_id", "parent_term_id", "status");

CREATE TABLE IF NOT EXISTS "taxonomy_term_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_term_id" uuid NOT NULL REFERENCES "taxonomy_terms"("id") ON DELETE CASCADE,
  "to_term_id" uuid NOT NULL REFERENCES "taxonomy_terms"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "uq_taxonomy_term_edges_relation" UNIQUE ("from_term_id", "to_term_id", "relation_type")
);

CREATE TABLE IF NOT EXISTS "methodology_taxonomy_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "methodology_slug" text NOT NULL,
  "taxonomy_id" uuid NOT NULL REFERENCES "taxonomies"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "required" boolean NOT NULL DEFAULT false,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "uq_methodology_taxonomy_bindings_role" UNIQUE ("methodology_slug", "taxonomy_id", "role")
);

CREATE TABLE IF NOT EXISTS "tagging_rule_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_set_key" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "methodology_slug" text,
  "subject_type" text NOT NULL DEFAULT 'mention',
  "scope" text NOT NULL DEFAULT 'global',
  "taxonomy_id" uuid REFERENCES "taxonomies"("id") ON DELETE SET NULL,
  "rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_tagging_rule_sets_key_version" UNIQUE ("rule_set_key", "version")
);

CREATE INDEX IF NOT EXISTS "idx_tagging_rule_sets_scope"
  ON "tagging_rule_sets" ("scope", "methodology_slug", "subject_type", "status");
CREATE INDEX IF NOT EXISTS "idx_tagging_rule_sets_taxonomy"
  ON "tagging_rule_sets" ("taxonomy_id", "status");

CREATE TABLE IF NOT EXISTS "tagging_model_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_key" text NOT NULL,
  "provider" text,
  "version" text NOT NULL,
  "methodology_slug" text,
  "tagging_rule_set_id" uuid REFERENCES "tagging_rule_sets"("id") ON DELETE SET NULL,
  "prompt_hash" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_tagging_model_versions_key_version" UNIQUE ("model_key", "version")
);

CREATE TABLE IF NOT EXISTS "intelligence_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "theme_id" uuid REFERENCES "themes"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "canonical_name" text NOT NULL,
  "external_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_intelligence_entities_scope"
  ON "intelligence_entities" ("organization_id", "brand_id", "entity_type", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_intelligence_entities_type_external"
  ON "intelligence_entities" ("entity_type", "external_id") WHERE "external_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "intelligence_entities"("id") ON DELETE CASCADE,
  "alias" text NOT NULL,
  "alias_type" text,
  "source" text,
  "confidence" numeric,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_entity_aliases_entity_alias" UNIQUE ("entity_id", "alias")
);

CREATE INDEX IF NOT EXISTS "idx_entity_aliases_alias"
  ON "entity_aliases" ("alias");

CREATE TABLE IF NOT EXISTS "entity_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_entity_id" uuid NOT NULL REFERENCES "intelligence_entities"("id") ON DELETE CASCADE,
  "target_entity_id" uuid NOT NULL REFERENCES "intelligence_entities"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_entity_links_relation" UNIQUE ("source_entity_id", "target_entity_id", "relation_type")
);

CREATE TABLE IF NOT EXISTS "record_entity_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "intelligence_entities"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "confidence" text,
  "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_record_entity_links_subject"
  ON "record_entity_links" ("subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "idx_record_entity_links_entity"
  ON "record_entity_links" ("entity_id", "relation_type");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_entity_links_subject_entity_relation"
  ON "record_entity_links" ("subject_type", "subject_id", "entity_id", "relation_type");

CREATE TABLE IF NOT EXISTS "record_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "taxonomy_term_id" uuid NOT NULL REFERENCES "taxonomy_terms"("id") ON DELETE CASCADE,
  "value" text,
  "score" numeric,
  "confidence" text,
  "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source" text NOT NULL DEFAULT 'system',
  "model_version_id" uuid REFERENCES "tagging_model_versions"("id") ON DELETE SET NULL,
  "review_status" text NOT NULL DEFAULT 'unreviewed',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_record_tags_scope"
  ON "record_tags" ("study_corpus_id", "subject_type", "taxonomy_term_id");
CREATE INDEX IF NOT EXISTS "idx_record_tags_subject"
  ON "record_tags" ("subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "idx_record_tags_review"
  ON "record_tags" ("study_corpus_id", "review_status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_tags_subject_term_source"
  ON "record_tags" ("subject_type", "subject_id", "taxonomy_term_id", "source");

CREATE TABLE IF NOT EXISTS "record_feature_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "feature_key" text NOT NULL,
  "feature_value" jsonb NOT NULL,
  "value_type" text,
  "confidence" text,
  "source" text NOT NULL DEFAULT 'system',
  "model_version_id" uuid REFERENCES "tagging_model_versions"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_record_feature_values_subject_key_source" UNIQUE ("subject_type", "subject_id", "feature_key", "source")
);

CREATE INDEX IF NOT EXISTS "idx_record_feature_values_scope"
  ON "record_feature_values" ("study_corpus_id", "subject_type", "feature_key");

CREATE TABLE IF NOT EXISTS "tag_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_tag_id" uuid REFERENCES "record_tags"("id") ON DELETE CASCADE,
  "reviewer_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "previous_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "next_value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_tag_review_events_tag"
  ON "tag_review_events" ("record_tag_id", "created_at");

CREATE TABLE IF NOT EXISTS "lineage_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "relation_type" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_lineage_edges_relation" UNIQUE ("source_type", "source_id", "target_type", "target_id", "relation_type")
);

CREATE INDEX IF NOT EXISTS "idx_lineage_edges_source"
  ON "lineage_edges" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "idx_lineage_edges_target"
  ON "lineage_edges" ("target_type", "target_id");

CREATE TABLE IF NOT EXISTS "metric_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "grain" text NOT NULL,
  "unit" text,
  "definition" jsonb NOT NULL,
  "dimensions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "owner_team" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_metric_definitions_status"
  ON "metric_definitions" ("status", "grain");

CREATE TABLE IF NOT EXISTS "semantic_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "base_asset_id" uuid REFERENCES "data_assets"("id") ON DELETE SET NULL,
  "entities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "dimensions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "measures" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_semantic_models_status"
  ON "semantic_models" ("status");

CREATE TABLE IF NOT EXISTS "metric_materializations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_definition_id" uuid NOT NULL REFERENCES "metric_definitions"("id") ON DELETE CASCADE,
  "semantic_model_id" uuid REFERENCES "semantic_models"("id") ON DELETE SET NULL,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "period_id" uuid REFERENCES "report_periods"("id") ON DELETE SET NULL,
  "filters_hash" text NOT NULL DEFAULT 'default',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stale_after" timestamp with time zone,
  CONSTRAINT "uq_metric_materializations_ref" UNIQUE ("metric_definition_id", "study_corpus_id", "period_id", "filters_hash")
);

CREATE INDEX IF NOT EXISTS "idx_metric_materializations_lookup"
  ON "metric_materializations" ("study_corpus_id", "metric_definition_id", "period_id");

CREATE TABLE IF NOT EXISTS "dashboard_data_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "output_id" uuid REFERENCES "published_outputs"("id") ON DELETE CASCADE,
  "study_corpus_id" uuid REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "ref_key" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "visibility" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_dashboard_data_refs_output_key" UNIQUE ("output_id", "ref_key")
);

CREATE INDEX IF NOT EXISTS "idx_dashboard_data_refs_corpus"
  ON "dashboard_data_refs" ("study_corpus_id", "ref_key");
