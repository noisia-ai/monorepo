-- SQL-only category evidence is versioned with the immutable study policy.
-- Readers join these booleans instead of normalizing and matching corpus text.
CREATE TABLE signal_mass_labeling_category_matches (
 workspace_id uuid NOT NULL,
 policy_revision integer NOT NULL CHECK(policy_revision>=0),
 stored_policy_revision integer GENERATED ALWAYS AS(NULLIF(policy_revision,0)) STORED,
 root_id uuid NOT NULL,
 matched boolean NOT NULL,
 PRIMARY KEY(workspace_id,policy_revision,root_id),
 FOREIGN KEY(workspace_id,stored_policy_revision) REFERENCES signal_mass_labeling_study_policies(workspace_id,revision),
 FOREIGN KEY(workspace_id,root_id) REFERENCES mentions(workspace_id,id)
);
CREATE INDEX mass_labeling_category_positive ON signal_mass_labeling_category_matches(workspace_id,policy_revision,root_id) WHERE matched;
ALTER TABLE signal_mass_labeling_category_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_category_matches FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON signal_mass_labeling_category_matches FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON signal_mass_labeling_category_matches FROM authenticated; END IF;
END $$;

-- Revision zero is the pre-policy Brand OS default used by existing maps.
-- This mirrors the governed seed names, including aliases, without reading a
-- delivered taxonomy or mutating the analyst's append-only policy history.
CREATE FUNCTION signal_mass_labeling_default_lexicon_v1(target_workspace uuid) RETURNS text[]
 LANGUAGE sql STABLE SET search_path=public,extensions,pg_temp AS $$
 WITH brand AS MATERIALIZED (
  SELECT b.* FROM signal_workspaces w JOIN brands b ON b.id=w.brand_id
  WHERE w.id=target_workspace AND w.status='active' AND b.status='active'
 ), names AS (
  SELECT unnest(ARRAY[name,display_name,slug,industry,industry_sub]||COALESCE(brand_seed_handles,ARRAY[]::text[])) term FROM brand
  UNION ALL SELECT product.name FROM brand JOIN brand_os_profiles p ON p.brand_id=brand.id AND p.status='active'
   JOIN brand_os_products product ON product.brand_os_profile_id=p.id AND product.status='active'
  UNION ALL SELECT unnest(ARRAY[seed.canonical_name]||COALESCE(seed.aliases,ARRAY[]::text[])||COALESCE(seed.detection_patterns,ARRAY[]::text[]))
   FROM brand JOIN competitors competitor ON competitor.brand_id=brand.id
   JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
   WHERE competitor.status='current' AND competitor.effective_from<=clock_timestamp()
    AND (competitor.effective_to IS NULL OR competitor.effective_to>clock_timestamp())
  UNION ALL SELECT entity.canonical_name FROM brand JOIN intelligence_entities entity ON entity.brand_id=brand.id
   WHERE entity.entity_type='category' AND entity.status='active'
  UNION ALL SELECT alias.alias FROM brand JOIN intelligence_entities entity ON entity.brand_id=brand.id
   JOIN entity_aliases alias ON alias.entity_id=entity.id WHERE entity.entity_type='category' AND entity.status='active'
 ) SELECT COALESCE(array_agg(DISTINCT btrim(term) ORDER BY btrim(term)),ARRAY[]::text[]) FROM names WHERE term IS NOT NULL AND btrim(term)<>''
$$;
REVOKE ALL ON FUNCTION signal_mass_labeling_default_lexicon_v1(uuid) FROM PUBLIC;

CREATE TABLE signal_mass_labeling_default_lexicons (
 workspace_id uuid PRIMARY KEY REFERENCES signal_workspaces(id),
 lexicon_terms text[] NOT NULL
);
ALTER TABLE signal_mass_labeling_default_lexicons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_mass_labeling_default_lexicons FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON signal_mass_labeling_default_lexicons FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON signal_mass_labeling_default_lexicons FROM authenticated; END IF;
END $$;

-- The row lock makes concurrent REPEATABLE READ seed edits serialize or retry.
-- READ COMMITTED refreshes derive the seed set after taking the shared lock.
CREATE FUNCTION refresh_signal_mass_labeling_default_lexicon_v1(target_workspace uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE previous_terms text[]; current_terms text[]; pattern text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||target_workspace::text,0));
 IF EXISTS(SELECT 1 FROM signal_mass_labeling_study_policies WHERE workspace_id=target_workspace) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM signal_mass_labeling_default_lexicons WHERE workspace_id=target_workspace)
   AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_items WHERE workspace_id=target_workspace) THEN RETURN; END IF;
 SELECT lexicon_terms INTO previous_terms FROM signal_mass_labeling_default_lexicons WHERE workspace_id=target_workspace FOR UPDATE;
 current_terms:=signal_mass_labeling_default_lexicon_v1(target_workspace);
 INSERT INTO signal_mass_labeling_default_lexicons(workspace_id,lexicon_terms) VALUES(target_workspace,current_terms)
 ON CONFLICT(workspace_id) DO UPDATE SET lexicon_terms=EXCLUDED.lexicon_terms;
 IF previous_terms IS DISTINCT FROM current_terms THEN
  pattern:=signal_mass_labeling_category_pattern_v1(current_terms);
  UPDATE signal_mass_labeling_category_matches SET matched=
    signal_mass_labeling_category_pattern_matches_v1(mention.text_clean,pattern)
  FROM mentions mention WHERE signal_mass_labeling_category_matches.workspace_id=target_workspace
    AND signal_mass_labeling_category_matches.policy_revision=0
    AND mention.workspace_id=target_workspace AND mention.id=signal_mass_labeling_category_matches.root_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION refresh_signal_mass_labeling_default_lexicon_v1(uuid) FROM PUBLIC;

-- Every table read by the inherited seed builder invalidates its workspaces.
CREATE FUNCTION refresh_signal_mass_labeling_seed_defaults_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE before_row jsonb; after_row jsonb; affected_brands uuid[]; target_workspace uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 CASE TG_TABLE_NAME
 WHEN 'brands' THEN affected_brands:=ARRAY[(before_row->>'id')::uuid,(after_row->>'id')::uuid];
 WHEN 'signal_workspaces','brand_os_profiles','competitors','intelligence_entities' THEN
  affected_brands:=ARRAY[(before_row->>'brand_id')::uuid,(after_row->>'brand_id')::uuid];
 WHEN 'brand_os_products' THEN
  SELECT array_agg(brand_id) INTO affected_brands FROM brand_os_profiles
  WHERE id IN((before_row->>'brand_os_profile_id')::uuid,(after_row->>'brand_os_profile_id')::uuid);
 WHEN 'brand_seeds' THEN
  SELECT array_agg(brand_id) INTO affected_brands FROM competitors
  WHERE competitor_brand_seed_id IN((before_row->>'id')::uuid,(after_row->>'id')::uuid);
 WHEN 'entity_aliases' THEN
  SELECT array_agg(brand_id) INTO affected_brands FROM intelligence_entities
  WHERE id IN((before_row->>'entity_id')::uuid,(after_row->>'entity_id')::uuid);
 END CASE;
 FOR target_workspace IN SELECT workspace.id FROM signal_workspaces workspace
  WHERE workspace.brand_id=ANY(affected_brands)
  ORDER BY workspace.id LOOP
  PERFORM refresh_signal_mass_labeling_default_lexicon_v1(target_workspace);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION refresh_signal_mass_labeling_seed_defaults_v1() FROM PUBLIC;
DO $$ DECLARE source_table text; BEGIN
 FOREACH source_table IN ARRAY ARRAY['brands','signal_workspaces','brand_os_profiles','brand_os_products',
   'competitors','brand_seeds','intelligence_entities','entity_aliases'] LOOP
  EXECUTE format('CREATE TRIGGER mass_labeling_seed_defaults AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION refresh_signal_mass_labeling_seed_defaults_v1()',source_table);
 END LOOP;
END $$;

CREATE FUNCTION materialize_signal_mass_labeling_category_policy_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE pattern text; previous_revision integer;
BEGIN
 pattern:=signal_mass_labeling_category_pattern_v1(NEW.lexicon_terms);
 SELECT revision INTO previous_revision FROM signal_mass_labeling_study_policies
 WHERE workspace_id=NEW.workspace_id AND revision<NEW.revision AND lexicon_terms=NEW.lexicon_terms
 ORDER BY revision DESC LIMIT 1;
 INSERT INTO signal_mass_labeling_category_matches(workspace_id,policy_revision,root_id,matched)
 SELECT NEW.workspace_id,NEW.revision,mention.id,
   COALESCE(previous.matched,signal_mass_labeling_category_pattern_matches_v1(mention.text_clean,pattern))
 FROM mentions mention
 JOIN (SELECT DISTINCT root_id FROM signal_mass_labeling_items WHERE workspace_id=NEW.workspace_id) roots ON roots.root_id=mention.id
 LEFT JOIN signal_mass_labeling_category_matches previous ON previous.workspace_id=NEW.workspace_id
   AND previous.policy_revision=previous_revision AND previous.root_id=mention.id
 WHERE mention.workspace_id=NEW.workspace_id;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_category_policy AFTER INSERT ON signal_mass_labeling_study_policies
 FOR EACH ROW EXECUTE FUNCTION materialize_signal_mass_labeling_category_policy_v1();

-- This shares the policy writer's lock, so an import and lexical edit cannot
-- leave the committed current revision missing the newly admitted roots.
CREATE FUNCTION materialize_signal_mass_labeling_category_item_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE target_workspace uuid;
BEGIN
 FOR target_workspace IN SELECT DISTINCT workspace_id FROM admitted_items ORDER BY workspace_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||target_workspace::text,0));
  PERFORM refresh_signal_mass_labeling_default_lexicon_v1(target_workspace);
 END LOOP;
 WITH patterns AS MATERIALIZED (
  SELECT DISTINCT ON(policy.workspace_id) policy.workspace_id,policy.revision,
    signal_mass_labeling_category_pattern_v1(policy.lexicon_terms) pattern
  FROM (
   SELECT workspace_id,revision,lexicon_terms FROM signal_mass_labeling_study_policies
    WHERE workspace_id IN(SELECT workspace_id FROM admitted_items)
   UNION ALL SELECT workspace_id,0,signal_mass_labeling_default_lexicon_v1(workspace_id) FROM(SELECT DISTINCT workspace_id FROM admitted_items) workspaces
    WHERE NOT EXISTS(SELECT 1 FROM signal_mass_labeling_study_policies current_policy WHERE current_policy.workspace_id=workspaces.workspace_id)
  ) policy ORDER BY policy.workspace_id,policy.revision DESC
 ) INSERT INTO signal_mass_labeling_category_matches(workspace_id,policy_revision,root_id,matched)
 SELECT item.workspace_id,policy.revision,item.root_id,
   signal_mass_labeling_category_pattern_matches_v1(mention.text_clean,policy.pattern)
 FROM (SELECT DISTINCT workspace_id,root_id FROM admitted_items) item
 JOIN patterns policy ON policy.workspace_id=item.workspace_id
 JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
 ON CONFLICT(workspace_id,policy_revision,root_id) DO UPDATE SET matched=EXCLUDED.matched;
 RETURN NULL;
END $$;
CREATE TRIGGER mass_labeling_category_item AFTER INSERT ON signal_mass_labeling_items
 REFERENCING NEW TABLE AS admitted_items FOR EACH STATEMENT
 EXECUTE FUNCTION materialize_signal_mass_labeling_category_item_v1();

-- Text replacements refresh the derived booleans in the same transaction.
CREATE FUNCTION refresh_signal_mass_labeling_category_text_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.text_clean IS DISTINCT FROM OLD.text_clean THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||NEW.workspace_id::text,0));
  UPDATE signal_mass_labeling_category_matches cache SET matched=
    signal_mass_labeling_category_matches_v1(NEW.text_clean,policy.lexicon_terms)
  FROM (SELECT revision,lexicon_terms FROM signal_mass_labeling_study_policies WHERE workspace_id=NEW.workspace_id
    UNION ALL SELECT 0,signal_mass_labeling_default_lexicon_v1(NEW.workspace_id)) policy
  WHERE cache.workspace_id=NEW.workspace_id AND cache.root_id=NEW.id AND policy.revision=cache.policy_revision;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mass_labeling_category_text AFTER UPDATE OF text_clean ON mentions
 FOR EACH ROW EXECUTE FUNCTION refresh_signal_mass_labeling_category_text_v1();
REVOKE ALL ON FUNCTION materialize_signal_mass_labeling_category_policy_v1(),
 materialize_signal_mass_labeling_category_item_v1(),refresh_signal_mass_labeling_category_text_v1() FROM PUBLIC;

-- Populate existing policies once. No provider, admission or paid result changes.
INSERT INTO signal_mass_labeling_default_lexicons(workspace_id,lexicon_terms)
 SELECT workspace_id,signal_mass_labeling_default_lexicon_v1(workspace_id)
 FROM(SELECT DISTINCT workspace_id FROM signal_mass_labeling_items) workspaces
 WHERE NOT EXISTS(SELECT 1 FROM signal_mass_labeling_study_policies policy WHERE policy.workspace_id=workspaces.workspace_id);
WITH patterns AS MATERIALIZED (
 SELECT workspace_id,revision,signal_mass_labeling_category_pattern_v1(lexicon_terms) pattern
 FROM signal_mass_labeling_study_policies
 UNION ALL SELECT workspace_id,0,
  signal_mass_labeling_category_pattern_v1(signal_mass_labeling_default_lexicon_v1(workspace_id))
 FROM(SELECT DISTINCT workspace_id FROM signal_mass_labeling_items) workspaces
 WHERE NOT EXISTS(SELECT 1 FROM signal_mass_labeling_study_policies policy WHERE policy.workspace_id=workspaces.workspace_id)
), unique_patterns AS MATERIALIZED (
 SELECT DISTINCT workspace_id,pattern FROM patterns
), matches AS MATERIALIZED (
 SELECT policy.workspace_id,policy.pattern,mention.id root_id,
   signal_mass_labeling_category_pattern_matches_v1(mention.text_clean,policy.pattern) matched
 FROM unique_patterns policy
 JOIN (SELECT DISTINCT workspace_id,root_id FROM signal_mass_labeling_items) roots ON roots.workspace_id=policy.workspace_id
 JOIN mentions mention ON mention.workspace_id=roots.workspace_id AND mention.id=roots.root_id
) INSERT INTO signal_mass_labeling_category_matches(workspace_id,policy_revision,root_id,matched)
 SELECT policy.workspace_id,policy.revision,matched.root_id,matched.matched FROM patterns policy
 JOIN matches matched ON matched.workspace_id=policy.workspace_id AND matched.pattern IS NOT DISTINCT FROM policy.pattern;
ANALYZE signal_mass_labeling_category_matches;
