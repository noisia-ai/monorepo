-- Analyst dismissals belong to an exact study lexicon, independently of paid labels.
CREATE TABLE signal_mass_labeling_lexicon_dismissals (
 workspace_id uuid NOT NULL REFERENCES signal_workspaces(id),
 lexicon_digest text NOT NULL CHECK(lexicon_digest ~ '^sha256:[0-9a-f]{64}$'),
 term text NOT NULL CHECK(length(term) BETWEEN 1 AND 200 AND term=btrim(term)),
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,lexicon_digest,term)
);
ALTER TABLE signal_mass_labeling_lexicon_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_lexicon_dismissals FROM PUBLIC,anon,authenticated;

-- The product engine admits the two exact editorial profiles, including sealed R14 work.
CREATE OR REPLACE FUNCTION signal_mass_labeling_product_engine_v2(target_workspace uuid,contract text,snapshot jsonb) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH approved AS (SELECT '{"contract_version":"workspace-engine-interpretation-config-v1","provider":"anthropic","model":"claude-sonnet-4-6","prompt_digest":"sha256:0a06bc9251980b9b106aae4356ec4d5967a0c2116386fbaaf034ee191355fdce","schema_digest":"sha256:5831582bd98aba048f55aad6aa47f01361f262e053edd28844143d75ea972454","pricing_version":"claude-sonnet-4-6-standard-global-usd-2026-09-09","input_micro_usd_per_million_tokens":3000000,"output_micro_usd_per_million_tokens":15000000,"cache_read_micro_usd_per_million_tokens":300000,"cache_creation_micro_usd_per_million_tokens":3750000,"thinking":"disabled","effort":"high","max_output_tokens":16384,"token_bound_version":"utf8-request-bytes-times-four-plus-8192-v1","citation_wire_version":"group-local-reference-labels-v1","representative_count":30,"consolidation_contract_version":"workspace-mass-labeling-consolidation-v1","consolidation_prompt_digest":"sha256:62666381e9c24bba150e67475f1909d4260a86bbbbd65cf19d76865b3a1a6eff","consolidation_schema_digest":"sha256:57555a0eb2af9341cada92fe3292fa3bb9b46fd0c537462a74bf0f0da789b64d","consolidation_max_output_tokens":65536,"output_language":"en-US","localization_contract_version":"signal-topic-localization-v1","category_lexicon_contract_version":"mass-labeling-category-lexicon-v1"}'::jsonb configuration)
 SELECT COALESCE(contract='workspace-topic-engine-v1' AND snapshot->'mass_labeling_product'='true'::jsonb
   AND snapshot#>>'{engine_config,profile_version}'='workspace-bertopic-mass-labeling-v3'
   AND NOT snapshot ? 'discovery_population'
   AND snapshot#>'{interpretation_config,call_configuration}' IN(approved.configuration,
     jsonb_set(approved.configuration,'{consolidation_prompt_digest}',to_jsonb('sha256:269a651444fe7b18c3257f706a961a1fd874f256ed41b1963f2abcab65124700'::text)))
   AND EXISTS(SELECT 1 FROM signal_workspace_features WHERE workspace_id=target_workspace AND feature='mass_labeling'),false) FROM approved
$$;
REVOKE ALL ON FUNCTION signal_mass_labeling_product_engine_v2(uuid,text,jsonb) FROM PUBLIC;
