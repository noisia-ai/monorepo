-- Backend 06: governed client views and atomic binding sets.
--
-- Forward-only and intentionally data-neutral. This migration:
-- - creates no semantic base, policy, derivation, compilation, binding or pointer;
-- - preserves the 0064 primary-brand semantic base and the 0071/0072 brand history;
-- - reuses the existing population, derivation, compilation and binding stores;
-- - opens only the four closed client-safe views and the three canonical modules.

CREATE OR REPLACE FUNCTION signal_governed_client_view_is_valid_v1(
  target_view_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT target_view_key IN ('brand', 'competition', 'category', 'all-governed');
$$;

CREATE OR REPLACE FUNCTION signal_governed_view_required_usage_purposes_v1(
  target_module_key text,
  target_view_key text
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN target_view_key NOT IN ('brand', 'competition', 'category', 'all-governed')
      THEN NULL::text[]
    WHEN target_module_key = 'brand-monitoring'
      THEN ARRAY['client-derived-metrics']::text[]
    WHEN target_module_key = 'mentions'
      THEN ARRAY['client-mention-list', 'client-text-or-excerpt']::text[]
    WHEN target_module_key = 'topics-narratives'
      THEN ARRAY['client-derived-metrics']::text[]
    ELSE NULL::text[]
  END;
$$;

-- Declared before the scope matcher because PostgreSQL validates SQL function
-- bodies eagerly. Repeated below only to keep the entity-authority block
-- self-contained on idempotent re-application.
CREATE OR REPLACE FUNCTION signal_population_policy_entity_is_governed_v1(
  target_workspace_id uuid,
  target_scope text,
  target_entity_type text,
  target_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM signal_workspaces workspace
    WHERE workspace.id = target_workspace_id AND workspace.status = 'active'
      AND CASE target_scope
        WHEN 'primary_brand' THEN target_entity_type = 'brand'
          AND target_entity_id = workspace.brand_id
        WHEN 'competitor' THEN target_entity_type = 'competitor' AND EXISTS (
          SELECT 1 FROM competitors competitor
          JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
          WHERE competitor.id = target_entity_id
            AND competitor.brand_id = workspace.brand_id AND seed.active)
        WHEN 'category' THEN target_entity_type = 'category' AND EXISTS (
          SELECT 1 FROM intelligence_entities entity
          WHERE entity.id = target_entity_id
            AND entity.organization_id = workspace.organization_id
            AND entity.brand_id = workspace.brand_id
            AND entity.entity_type = 'category' AND entity.status = 'active')
        WHEN 'reference' THEN target_entity_type = 'reference' AND EXISTS (
          SELECT 1 FROM intelligence_entities entity
          WHERE entity.id = target_entity_id
            AND entity.organization_id = workspace.organization_id
            AND entity.brand_id = workspace.brand_id
            AND entity.entity_type = 'reference' AND entity.status = 'active')
        ELSE false
      END
  );
$$;

CREATE OR REPLACE FUNCTION signal_governed_view_bundle_scopes_match_v1(
  target_policy_bundle_id uuid,
  target_view_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM signal_population_policy_bundles bundle
    WHERE bundle.id = target_policy_bundle_id
      AND CASE target_view_key
        WHEN 'brand' THEN
          cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes @> ARRAY['primary_brand']::text[]
        WHEN 'competition' THEN
          cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes @> ARRAY['competitor']::text[]
        WHEN 'category' THEN
          cardinality(bundle.allowed_scopes) = 1
          AND bundle.allowed_scopes @> ARRAY['category']::text[]
        WHEN 'all-governed' THEN
          cardinality(bundle.allowed_scopes) > 0
          AND cardinality(bundle.allowed_scopes) = (
            SELECT count(DISTINCT scope)::int FROM unnest(bundle.allowed_scopes) scope
          )
          AND bundle.allowed_scopes <@ ARRAY[
            'primary_brand', 'competitor', 'category', 'reference'
          ]::text[]
        ELSE false
      END
      AND NOT EXISTS (
        SELECT 1 FROM signal_population_policy_entities entity
        WHERE entity.policy_bundle_id = bundle.id
          AND (
            NOT (entity.scope = ANY(bundle.allowed_scopes))
            OR NOT signal_population_policy_entity_is_governed_v1(
              bundle.workspace_id, entity.scope, entity.entity_type, entity.entity_id
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(bundle.allowed_scopes) required_scope
        WHERE NOT EXISTS (
          SELECT 1 FROM signal_population_policy_entities entity
          WHERE entity.policy_bundle_id = bundle.id
            AND entity.scope = required_scope
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION signal_governed_view_bundle_entities_are_current_v1(
  target_policy_bundle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM signal_population_policy_bundles bundle
    WHERE bundle.id = target_policy_bundle_id
      AND NOT EXISTS (
        SELECT 1 FROM signal_population_policy_entities entity
        WHERE entity.policy_bundle_id = bundle.id
          AND NOT signal_population_policy_entity_is_governed_v1(
            bundle.workspace_id, entity.scope, entity.entity_type, entity.entity_id
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_entity_governed_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signal_population_policy_bundles bundle
    WHERE bundle.id = NEW.policy_bundle_id
      AND bundle.workspace_id = NEW.workspace_id
  ) OR NOT signal_population_policy_entity_is_governed_v1(
    NEW.workspace_id, NEW.scope, NEW.entity_type, NEW.entity_id
  ) THEN
    RAISE EXCEPTION 'Policy entity is unavailable, inactive or cross-workspace.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_population_policy_entity_governed_v1
  ON signal_population_policy_entities;
CREATE TRIGGER trg_signal_population_policy_entity_governed_v1
  BEFORE INSERT OR UPDATE OF workspace_id, policy_bundle_id, scope, entity_type, entity_id
  ON signal_population_policy_entities
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_population_policy_entity_governed_v1();

-- The attributable semantic base is a neutral workspace-level candidate for
-- competition/category/all-governed. It contains no quality, rights, period,
-- module or governed-view policy. Applying 0073 never creates it.
CREATE OR REPLACE FUNCTION signal_attributable_semantic_base_definition_v1()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'contract_version', 'signal-operational-attributable-semantic-v1',
    'canonical_only', true,
    'attribution_basis', 'mention_semantic',
    'attribution_review_status', 'approved',
    'eligibility_status', 'eligible',
    'allowed_scopes', jsonb_build_array(
      'primary_brand', 'competitor', 'category', 'reference'
    ),
    'excluded_scopes', jsonb_build_array('unattributed'),
    'deduplication_policy', 'canonical-root',
    'promotion_state', 'candidate_not_promoted'
  );
$$;

CREATE OR REPLACE FUNCTION signal_attributable_semantic_base_definition_hash_v1(
  target_workspace_id uuid,
  target_population_version integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(concat_ws('|',
    'signal-operational-attributable-semantic-v1',
    target_workspace_id::text,
    target_population_version::text,
    'attributable-semantic',
    '1'
  ), 'UTF8')), 'hex');
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_attributable_semantic_base_draft
  ON signal_population_definitions (workspace_id)
  WHERE purpose = 'operational'
    AND status = 'draft'
    AND definition->>'contract_version'
      = 'signal-operational-attributable-semantic-v1';

CREATE OR REPLACE FUNCTION enforce_signal_attributable_semantic_base_isolation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_contract constant text := 'signal-operational-attributable-semantic-v1';
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.definition->>'contract_version' = target_contract
     AND NEW.definition->>'contract_version' IS DISTINCT FROM target_contract THEN
    RAISE EXCEPTION 'Attributable semantic base identity cannot be replaced.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.definition->>'contract_version' IS DISTINCT FROM target_contract THEN
    RETURN NEW;
  END IF;
  IF NEW.population_key IS DISTINCT FROM 'attributable-semantic-operational'
     OR NEW.purpose IS DISTINCT FROM 'operational'
     OR NEW.status IS DISTINCT FROM 'draft'
     OR NEW.acceptance_status IS DISTINCT FROM 'included'
     OR cardinality(NEW.allowed_scopes) <> 4
     OR NOT (NEW.allowed_scopes @> ARRAY[
       'primary_brand', 'competitor', 'category', 'reference'
     ]::text[])
     OR NEW.min_quality_score IS NOT NULL
     OR NEW.period_start IS NOT NULL
     OR NEW.period_end IS NOT NULL
     OR NEW.policy_key IS DISTINCT FROM 'attributable-semantic'
     OR NEW.policy_version IS DISTINCT FROM '1'
     OR NEW.definition IS DISTINCT FROM signal_attributable_semantic_base_definition_v1()
     OR NEW.definition_hash IS DISTINCT FROM
       signal_attributable_semantic_base_definition_hash_v1(NEW.workspace_id, NEW.version) THEN
    RAISE EXCEPTION 'Attributable semantic base cannot contain view, period or governance policy state.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_attributable_semantic_base_isolation_v1
  ON signal_population_definitions;
CREATE TRIGGER trg_signal_attributable_semantic_base_isolation_v1
  BEFORE INSERT OR UPDATE OF workspace_id, population_key, version, purpose,
    status, acceptance_status, allowed_scopes, min_quality_score, period_start,
    period_end, definition_hash, policy_key, policy_version, definition
  ON signal_population_definitions
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_attributable_semantic_base_isolation_v1();

CREATE OR REPLACE FUNCTION ensure_signal_operational_attributable_semantic_base_v1(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
RETURNS TABLE(population_id uuid, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE persisted signal_population_definitions%ROWTYPE;
DECLARE next_version integer;
DECLARE empty_digest constant text :=
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
BEGIN
  IF NOT signal_data_governance_actor_is_valid(
    target_workspace_id, target_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Attributable semantic base actor is unauthorized.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'attributable-semantic-base-v1', target_workspace_id::text
  ), 0));
  SELECT * INTO persisted
  FROM signal_population_definitions population
  WHERE population.workspace_id = target_workspace_id
    AND population.purpose = 'operational'
    AND population.status = 'draft'
    AND population.definition->>'contract_version'
      = 'signal-operational-attributable-semantic-v1'
  FOR UPDATE;
  IF persisted.id IS NOT NULL THEN
    RETURN QUERY SELECT persisted.id, false;
    RETURN;
  END IF;
  SELECT COALESCE(max(population.version), 0) + 1 INTO next_version
  FROM signal_population_definitions population
  WHERE population.workspace_id = target_workspace_id
    AND population.population_key = 'attributable-semantic-operational';
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, min_quality_score,
    period_start, period_end, definition_hash, policy_key, policy_version,
    timezone, membership_digest, created_by_user_id, definition
  ) VALUES (
    target_workspace_id, 'attributable-semantic-operational', next_version,
    'operational', 'draft', 'included', ARRAY[
      'primary_brand', 'competitor', 'category', 'reference'
    ]::text[], NULL, NULL, NULL,
    signal_attributable_semantic_base_definition_hash_v1(
      target_workspace_id, next_version
    ),
    'attributable-semantic', '1', NULL, empty_digest,
    target_actor_user_id, signal_attributable_semantic_base_definition_v1()
  ) RETURNING * INTO persisted;
  RETURN QUERY SELECT persisted.id, true;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_signal_attributable_semantic_base_digest_v1(
  target_population_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE computed_digest text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signal_population_definitions population
    WHERE population.id = target_population_id
      AND population.status = 'draft'
      AND population.definition->>'contract_version'
        = 'signal-operational-attributable-semantic-v1'
  ) THEN
    RAISE EXCEPTION 'Attributable semantic base is unavailable.'
      USING ERRCODE = '23514';
  END IF;
  SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
    membership.mention_id::text, ',' ORDER BY membership.mention_id
  ) FILTER (WHERE membership.membership_status = 'included'
      AND membership.removed_at IS NULL), ''), 'UTF8')), 'hex')
  INTO computed_digest
  FROM signal_population_memberships membership
  WHERE membership.population_id = target_population_id;
  UPDATE signal_population_definitions
  SET membership_digest = computed_digest, updated_at = now()
  WHERE id = target_population_id;
  RETURN computed_digest;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_attributable_semantic_base_mention_v1(
  target_workspace_id uuid,
  target_mention_id uuid,
  refresh_digest boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE target_root mentions%ROWTYPE;
DECLARE candidate signal_population_definitions%ROWTYPE;
DECLARE target_brand_id uuid;
DECLARE eligible boolean;
BEGIN
  SELECT * INTO target_root FROM mentions mention
  WHERE mention.id = target_mention_id
    AND mention.workspace_id = target_workspace_id
    AND mention.canonical_mention_id = mention.id;
  IF target_root.id IS NULL THEN
    FOR candidate IN
      SELECT * FROM signal_population_definitions population
      WHERE population.workspace_id = target_workspace_id
        AND population.status = 'draft'
        AND population.definition->>'contract_version'
          = 'signal-operational-attributable-semantic-v1'
    LOOP
      UPDATE signal_population_memberships
      SET membership_status = 'excluded',
          membership_reason = 'canonical_identity_changed_v1',
          removed_at = now()
      WHERE population_id = candidate.id
        AND mention_id = target_mention_id
        AND (membership_status <> 'excluded' OR removed_at IS NULL);
      IF refresh_digest THEN
        PERFORM refresh_signal_attributable_semantic_base_digest_v1(candidate.id);
      END IF;
    END LOOP;
    RETURN;
  END IF;
  SELECT workspace.brand_id INTO target_brand_id
  FROM signal_workspaces workspace WHERE workspace.id = target_workspace_id;
  FOR candidate IN
    SELECT * FROM signal_population_definitions population
    WHERE population.workspace_id = target_workspace_id
      AND population.status = 'draft'
      AND population.definition->>'contract_version'
        = 'signal-operational-attributable-semantic-v1'
  LOOP
    eligible := target_root.inclusion_status = 'included' AND EXISTS (
      SELECT 1
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = target_workspace_id
        AND attribution.mention_id = target_root.id
        AND attribution.attribution_basis = 'mention_semantic'
        AND attribution.is_current
        AND attribution.review_status = 'approved'
        AND attribution.eligibility_status = 'eligible'
        AND attribution.scope IN ('primary_brand', 'competitor', 'category', 'reference')
        AND signal_population_policy_entity_is_governed_v1(
          target_workspace_id, attribution.scope,
          attribution.entity_type, attribution.entity_id
        )
    );
    IF eligible OR EXISTS (
      SELECT 1 FROM signal_population_memberships membership
      WHERE membership.population_id = candidate.id
        AND membership.mention_id = target_root.id
    ) THEN
      INSERT INTO signal_population_memberships (
        population_id, workspace_id, mention_id, membership_status,
        membership_reason, effective_at, removed_at
      ) VALUES (
        candidate.id, target_workspace_id, target_root.id,
        CASE WHEN eligible THEN 'included' ELSE 'excluded' END,
        CASE WHEN eligible
          THEN 'semantic_attributable_approved_eligible_v1'
          ELSE 'semantic_attributable_not_eligible_v1' END,
        now(), CASE WHEN eligible THEN NULL ELSE now() END
      )
      ON CONFLICT (population_id, mention_id) DO UPDATE SET
        membership_status = EXCLUDED.membership_status,
        membership_reason = EXCLUDED.membership_reason,
        effective_at = CASE
          WHEN signal_population_memberships.membership_status
            IS DISTINCT FROM EXCLUDED.membership_status
          THEN now() ELSE signal_population_memberships.effective_at END,
        removed_at = EXCLUDED.removed_at;
    END IF;
    IF refresh_digest THEN
      PERFORM refresh_signal_attributable_semantic_base_digest_v1(candidate.id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_operational_attributable_semantic_base_v1(
  target_workspace_id uuid,
  target_actor_user_id uuid
)
RETURNS TABLE(population_id uuid, membership_count integer, membership_digest text)
LANGUAGE plpgsql
AS $$
DECLARE target_population_id uuid;
DECLARE root record;
DECLARE observed_count integer := 0;
BEGIN
  IF NOT signal_data_governance_actor_is_valid(
    target_workspace_id, target_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Attributable semantic reconciliation actor is unauthorized.'
      USING ERRCODE = '42501';
  END IF;
  SELECT ensured.population_id INTO target_population_id
  FROM ensure_signal_operational_attributable_semantic_base_v1(
    target_workspace_id, target_actor_user_id
  ) ensured;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'attributable-semantic-reconcile-v1', target_workspace_id::text
  ), 0));
  FOR root IN
    SELECT mention.id FROM mentions mention
    WHERE mention.workspace_id = target_workspace_id
      AND mention.canonical_mention_id = mention.id
    ORDER BY mention.id
  LOOP
    PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
      target_workspace_id, root.id, false
    );
  END LOOP;
  SELECT count(*)::int INTO observed_count
  FROM signal_population_memberships membership
  WHERE membership.population_id = target_population_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  RETURN QUERY SELECT target_population_id, observed_count,
    refresh_signal_attributable_semantic_base_digest_v1(target_population_id);
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_signal_attributable_semantic_base_from_row_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_workspace_id uuid;
DECLARE row_mention_id uuid;
DECLARE target_root_id uuid;
DECLARE old_root_id uuid;
DECLARE new_root_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'mentions' THEN
    target_workspace_id := NEW.workspace_id;
    old_root_id := OLD.canonical_mention_id;
    new_root_id := NEW.canonical_mention_id;
    IF old_root_id IS NOT NULL THEN
      PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
        target_workspace_id, old_root_id
      );
    END IF;
    IF new_root_id IS NOT NULL AND new_root_id IS DISTINCT FROM old_root_id THEN
      PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
        target_workspace_id, new_root_id
      );
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    target_workspace_id := OLD.workspace_id;
    row_mention_id := OLD.mention_id;
  ELSE
    target_workspace_id := NEW.workspace_id;
    row_mention_id := CASE WHEN TG_TABLE_NAME = 'mentions' THEN NEW.id ELSE NEW.mention_id END;
  END IF;
  SELECT mention.canonical_mention_id INTO target_root_id
  FROM mentions mention
  WHERE mention.id = row_mention_id AND mention.workspace_id = target_workspace_id;
  IF target_root_id IS NOT NULL THEN
    PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
      target_workspace_id, target_root_id
    );
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_attributable_semantic_base_attribution
  ON signal_mention_attributions;
CREATE TRIGGER trg_signal_attributable_semantic_base_attribution
  AFTER INSERT OR DELETE OR UPDATE OF attribution_basis, is_current,
    review_status, eligibility_status, scope, entity_type, entity_id
  ON signal_mention_attributions
  FOR EACH ROW EXECUTE FUNCTION reconcile_signal_attributable_semantic_base_from_row_v1();

DROP TRIGGER IF EXISTS trg_signal_attributable_semantic_base_mention
  ON mentions;
CREATE TRIGGER trg_signal_attributable_semantic_base_mention
  AFTER UPDATE OF inclusion_status, canonical_mention_id ON mentions
  FOR EACH ROW WHEN (
    OLD.inclusion_status IS DISTINCT FROM NEW.inclusion_status
    OR OLD.canonical_mention_id IS DISTINCT FROM NEW.canonical_mention_id
  ) EXECUTE FUNCTION reconcile_signal_attributable_semantic_base_from_row_v1();

ALTER TABLE signal_data_governance_invalidations
  DROP CONSTRAINT IF EXISTS signal_data_governance_invalidation_reason,
  ADD CONSTRAINT signal_data_governance_invalidation_reason CHECK (reason_code IN (
    'quality-policy-changed', 'quality-state-changed', 'retention-policy-changed',
    'licensing-policy-changed', 'provenance-binding-changed', 'provenance-changed',
    'canonical-identity-changed', 'semantic-assertion-changed',
    'population-membership-changed', 'watermark-changed', 'governed-entity-changed'
  )),
  DROP CONSTRAINT IF EXISTS signal_data_governance_invalidation_kind,
  ADD CONSTRAINT signal_data_governance_invalidation_kind CHECK (object_kind IN (
    'quality-policy', 'retention-policy', 'licensing-policy', 'provenance-binding',
    'mention', 'attribution', 'membership', 'watermark', 'policy-entity'
  ));

CREATE OR REPLACE FUNCTION invalidate_signal_governed_entity_dependents_v1(
  target_scope text,
  target_entity_type text,
  target_entity_id uuid,
  target_identity text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE dependent record;
DECLARE target record;
DECLARE candidate record;
DECLARE affected integer := 0;
BEGIN
  FOR dependent IN
    SELECT DISTINCT bundle.workspace_id, compilation.population_id
    FROM signal_population_policy_entities policy_entity
    JOIN signal_population_policy_bundles bundle
      ON bundle.id = policy_entity.policy_bundle_id
    JOIN signal_population_policy_compilations compilation
      ON compilation.policy_bundle_id = bundle.id AND compilation.is_current
    WHERE policy_entity.scope = target_scope
      AND policy_entity.entity_type = target_entity_type
      AND policy_entity.entity_id = target_entity_id
  LOOP
    affected := affected + invalidate_signal_data_governance_compilations(
      dependent.workspace_id, 'governed-entity-changed', 'policy-entity',
      target_identity, NULL, dependent.population_id, NULL, NULL, NULL
    );
  END LOOP;
  FOR target IN
    SELECT DISTINCT attribution.workspace_id, attribution.mention_id
    FROM signal_mention_attributions attribution
    WHERE attribution.attribution_basis = 'mention_semantic'
      AND attribution.is_current
      AND attribution.scope = target_scope
      AND attribution.entity_type = target_entity_type
      AND attribution.entity_id = target_entity_id
  LOOP
    PERFORM reconcile_signal_attributable_semantic_base_mention_v1(
      target.workspace_id, target.mention_id, false
    );
  END LOOP;
  FOR candidate IN
    SELECT DISTINCT population.id
    FROM signal_population_definitions population
    JOIN signal_mention_attributions attribution
      ON attribution.workspace_id = population.workspace_id
    WHERE population.status = 'draft'
      AND population.definition->>'contract_version'
        = 'signal-operational-attributable-semantic-v1'
      AND attribution.attribution_basis = 'mention_semantic'
      AND attribution.scope = target_scope
      AND attribution.entity_type = target_entity_type
      AND attribution.entity_id = target_entity_id
  LOOP
    PERFORM refresh_signal_attributable_semantic_base_digest_v1(candidate.id);
  END LOOP;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION invalidate_signal_governed_entity_from_registry_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE entity record;
BEGIN
  IF TG_TABLE_NAME = 'intelligence_entities' THEN
    IF OLD.entity_type IN ('category', 'reference') THEN
      PERFORM invalidate_signal_governed_entity_dependents_v1(
        OLD.entity_type, OLD.entity_type, OLD.id,
        concat_ws(':', 'intelligence-entity', OLD.id::text, txid_current()::text)
      );
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type THEN
      IF NEW.entity_type IN ('category', 'reference') THEN
        PERFORM invalidate_signal_governed_entity_dependents_v1(
          NEW.entity_type, NEW.entity_type, NEW.id,
          concat_ws(':', 'intelligence-entity', NEW.id::text, txid_current()::text)
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'competitors' THEN
    PERFORM invalidate_signal_governed_entity_dependents_v1(
      'competitor', 'competitor', OLD.id,
      concat_ws(':', 'competitor', OLD.id::text, txid_current()::text)
    );
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      PERFORM invalidate_signal_governed_entity_dependents_v1(
        'competitor', 'competitor', NEW.id,
        concat_ws(':', 'competitor', NEW.id::text, txid_current()::text)
      );
    END IF;
  ELSE
    FOR entity IN
      SELECT competitor.id
      FROM competitors competitor
      WHERE competitor.competitor_brand_seed_id IN (OLD.id, NEW.id)
    LOOP
      PERFORM invalidate_signal_governed_entity_dependents_v1(
        'competitor', 'competitor', entity.id,
        concat_ws(':', 'competitor-seed', OLD.id::text, entity.id::text,
          txid_current()::text)
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_intelligence_entity_invalidation
  ON intelligence_entities;
CREATE TRIGGER trg_signal_governed_intelligence_entity_invalidation
  AFTER UPDATE OF organization_id, brand_id, entity_type, status
  ON intelligence_entities
  FOR EACH ROW WHEN (
    OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.brand_id IS DISTINCT FROM NEW.brand_id
    OR OLD.entity_type IS DISTINCT FROM NEW.entity_type
    OR OLD.status IS DISTINCT FROM NEW.status
  ) EXECUTE FUNCTION invalidate_signal_governed_entity_from_registry_v1();

DROP TRIGGER IF EXISTS trg_signal_governed_competitor_invalidation ON competitors;
CREATE TRIGGER trg_signal_governed_competitor_invalidation
  AFTER UPDATE OF brand_id, competitor_brand_seed_id ON competitors
  FOR EACH ROW WHEN (
    OLD.brand_id IS DISTINCT FROM NEW.brand_id
    OR OLD.competitor_brand_seed_id IS DISTINCT FROM NEW.competitor_brand_seed_id
  ) EXECUTE FUNCTION invalidate_signal_governed_entity_from_registry_v1();

DROP TRIGGER IF EXISTS trg_signal_governed_competitor_seed_invalidation ON brand_seeds;
CREATE TRIGGER trg_signal_governed_competitor_seed_invalidation
  AFTER UPDATE OF active ON brand_seeds
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION invalidate_signal_governed_entity_from_registry_v1();

CREATE OR REPLACE FUNCTION signal_governed_view_base_contract_is_valid_v1(
  target_workspace_id uuid,
  target_view_key text,
  target_base_population_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM signal_population_definitions base
    WHERE base.id = target_base_population_id
      AND base.workspace_id = target_workspace_id
      AND base.purpose = 'operational'
      AND base.status = 'draft'
      AND CASE target_view_key
        WHEN 'brand' THEN
          base.definition->>'contract_version'
            = 'signal-operational-primary-brand-semantic-v2'
          AND base.policy_key = 'primary-brand-semantic'
          AND base.allowed_scopes = ARRAY['primary_brand']::text[]
        WHEN 'competition' THEN
          base.definition->>'contract_version'
            = 'signal-operational-attributable-semantic-v1'
          AND base.policy_key = 'attributable-semantic'
        WHEN 'category' THEN
          base.definition->>'contract_version'
            = 'signal-operational-attributable-semantic-v1'
          AND base.policy_key = 'attributable-semantic'
        WHEN 'all-governed' THEN
          base.definition->>'contract_version'
            = 'signal-operational-attributable-semantic-v1'
          AND base.policy_key = 'attributable-semantic'
        ELSE false
      END
  );
$$;

ALTER TABLE signal_governed_view_population_derivations
  DROP CONSTRAINT IF EXISTS signal_governed_view_population_derivation_identity,
  ADD CONSTRAINT signal_governed_view_population_derivation_identity CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key IN ('brand', 'competition', 'category', 'all-governed')
  );

ALTER TABLE signal_data_governance_evaluations
  DROP CONSTRAINT IF EXISTS signal_data_governance_evaluation_module,
  ADD CONSTRAINT signal_data_governance_evaluation_module CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key IN ('brand', 'competition', 'category', 'all-governed')
  );

ALTER TABLE signal_population_policy_compilations
  DROP CONSTRAINT IF EXISTS signal_population_policy_compilation_module,
  ADD CONSTRAINT signal_population_policy_compilation_module CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key IN ('brand', 'competition', 'category', 'all-governed')
  );

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_binding_entity_authority_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.binding_status = 'current'
     AND signal_governed_client_view_is_valid_v1(NEW.view_key)
     AND NOT signal_governed_view_bundle_scopes_match_v1(
       NEW.policy_bundle_id, NEW.view_key
     ) THEN
    RAISE EXCEPTION 'Governed binding policy entities are unavailable or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_governed_view_binding_entity_authority_v1
  ON signal_governed_view_bindings;
CREATE TRIGGER trg_signal_governed_view_binding_entity_authority_v1
  BEFORE INSERT OR UPDATE OF policy_bundle_id, view_key, binding_status
  ON signal_governed_view_bindings
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_view_binding_entity_authority_v1();

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_population_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE resolved signal_population_definitions%ROWTYPE;
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  SELECT * INTO resolved FROM signal_population_definitions WHERE id = NEW.resolved_population_id;
  IF bundle.id IS NULL OR resolved.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR resolved.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.definition_hash IS DISTINCT FROM NEW.policy_definition_hash
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR bundle.status = 'retired'
     OR NOT signal_governed_client_view_is_valid_v1(NEW.view_key)
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, NEW.view_key)
     OR NOT signal_governed_view_base_contract_is_valid_v1(
       NEW.workspace_id, NEW.view_key, NEW.base_population_id
     )
     OR resolved.purpose <> 'operational' OR resolved.status <> 'draft'
     OR resolved.definition->>'contract_version'
       <> 'signal-governed-view-resolved-population-v1'
     OR resolved.definition->>'module_key' <> NEW.module_key
     OR resolved.definition->>'view_key' <> NEW.view_key
     OR resolved.definition->>'policy_bundle_id' <> NEW.policy_bundle_id::text
     OR resolved.definition->>'base_population_id' <> NEW.base_population_id::text
     OR resolved.definition->>'policy_definition_hash' <> NEW.policy_definition_hash
     OR resolved.definition->>'compiled_plan_hash' <> NEW.compiled_plan_hash THEN
    RAISE EXCEPTION 'Governed view population derivation is cross-workspace or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_signal_governed_view_population_derivation(
  target_workspace_id uuid,
  target_policy_bundle_id uuid,
  target_base_population_id uuid,
  target_module_key text,
  target_view_key text,
  target_policy_definition_hash text,
  target_compiled_plan_hash text,
  target_actor_user_id uuid
)
RETURNS TABLE (
  derivation_id uuid,
  resolved_population_id uuid,
  population_key text,
  population_version integer,
  population_definition_hash text,
  created boolean
)
LANGUAGE plpgsql
AS $$
DECLARE persisted record;
DECLARE target_population_key text;
DECLARE next_version integer;
DECLARE target_population_definition_hash text;
DECLARE empty_digest constant text :=
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
BEGIN
  IF target_module_key NOT IN ('brand-monitoring', 'mentions', 'topics-narratives')
     OR NOT signal_governed_client_view_is_valid_v1(target_view_key) THEN
    RAISE EXCEPTION 'Governed view population identity is unsupported.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT signal_data_governance_actor_is_valid(target_workspace_id, target_actor_user_id) THEN
    RAISE EXCEPTION 'Governed view population actor is not authorized.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO bundle FROM signal_population_policy_bundles candidate
  WHERE candidate.id = target_policy_bundle_id
    AND candidate.workspace_id = target_workspace_id
    AND candidate.status <> 'retired';
  IF bundle.id IS NULL
     OR bundle.definition_hash IS DISTINCT FROM target_policy_definition_hash
     OR NOT (target_module_key = ANY(bundle.authorized_modules))
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, target_view_key)
     OR NOT signal_governed_view_base_contract_is_valid_v1(
       target_workspace_id, target_view_key, target_base_population_id
     ) THEN
    RAISE EXCEPTION 'Governed view population inputs are unavailable or incompatible.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    'governed-view-population', target_workspace_id::text,
    target_module_key, target_view_key, target_policy_bundle_id::text
  ), 0));
  SELECT derivation.id, population.id AS resolved_population_id,
    population.population_key, population.version,
    population.definition_hash AS population_definition_hash
  INTO persisted
  FROM signal_governed_view_population_derivations derivation
  JOIN signal_population_definitions population
    ON population.id = derivation.resolved_population_id
  WHERE derivation.workspace_id = target_workspace_id
    AND derivation.module_key = target_module_key
    AND derivation.view_key = target_view_key
    AND derivation.policy_bundle_id = target_policy_bundle_id
  FOR UPDATE OF derivation;
  IF persisted.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM signal_governed_view_population_derivations derivation
      WHERE derivation.id = persisted.id
        AND derivation.base_population_id = target_base_population_id
        AND derivation.policy_definition_hash = target_policy_definition_hash
        AND derivation.compiled_plan_hash = target_compiled_plan_hash
    ) THEN
      RAISE EXCEPTION 'Existing governed view population derivation has incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT persisted.id, persisted.resolved_population_id,
      persisted.population_key, persisted.version,
      persisted.population_definition_hash, false;
    RETURN;
  END IF;
  IF bundle.status <> 'draft' THEN
    RAISE EXCEPTION 'A new governed view derivation requires a draft policy bundle.'
      USING ERRCODE = '23514';
  END IF;
  target_population_key := target_module_key || '-' || target_view_key || '-governed';
  SELECT COALESCE(max(population.version), 0) + 1 INTO next_version
  FROM signal_population_definitions population
  WHERE population.workspace_id = target_workspace_id
    AND population.population_key = target_population_key;
  target_population_definition_hash := 'sha256:' || encode(sha256(convert_to(concat_ws(chr(31),
    'signal-governed-view-resolved-population-v1', target_workspace_id::text,
    target_policy_bundle_id::text, target_base_population_id::text,
    target_module_key, target_view_key, target_policy_definition_hash,
    target_compiled_plan_hash, target_population_key, next_version::text
  ), 'UTF8')), 'hex');
  INSERT INTO signal_population_definitions (
    workspace_id, population_key, version, purpose, status,
    acceptance_status, allowed_scopes, min_quality_score,
    period_start, period_end, definition_hash, policy_key, policy_version,
    timezone, membership_digest, created_by_user_id, definition
  ) VALUES (
    target_workspace_id, target_population_key, next_version, 'operational', 'draft',
    bundle.acceptance_status, bundle.allowed_scopes, bundle.min_quality_score,
    bundle.period_start, bundle.period_end, target_population_definition_hash,
    bundle.policy_key, bundle.policy_version::text, bundle.timezone, empty_digest,
    target_actor_user_id, jsonb_build_object(
      'contract_version', 'signal-governed-view-resolved-population-v1',
      'module_key', target_module_key,
      'view_key', target_view_key,
      'policy_bundle_id', target_policy_bundle_id::text,
      'base_population_id', target_base_population_id::text,
      'policy_definition_hash', target_policy_definition_hash,
      'compiled_plan_hash', target_compiled_plan_hash,
      'deduplication_policy', 'canonical-root',
      'promotion_state', 'candidate_not_bound'
    )
  ) RETURNING id INTO resolved_population_id;
  INSERT INTO signal_governed_view_population_derivations (
    workspace_id, module_key, view_key, policy_bundle_id,
    base_population_id, resolved_population_id, policy_definition_hash,
    compiled_plan_hash, created_by_user_id
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, target_policy_bundle_id,
    target_base_population_id, resolved_population_id, target_policy_definition_hash,
    target_compiled_plan_hash, target_actor_user_id
  ) RETURNING id INTO derivation_id;
  population_key := target_population_key;
  population_version := next_version;
  population_definition_hash := target_population_definition_hash;
  created := true;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_data_governance_evaluation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE expected_usages text[];
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  expected_usages := signal_governed_view_required_usage_purposes_v1(
    NEW.module_key, NEW.view_key
  );
  IF expected_usages IS NULL
     OR bundle.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status = 'retired'
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, NEW.view_key)
     OR NEW.usage_purposes IS DISTINCT FROM expected_usages
     OR NOT (NEW.usage_purposes <@ bundle.required_usage_purposes)
     OR bundle.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR NOT signal_data_governance_actor_is_valid(
       NEW.workspace_id, NEW.evaluated_by_user_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM signal_governed_view_population_derivations derivation
       WHERE derivation.workspace_id = NEW.workspace_id
         AND derivation.policy_bundle_id = NEW.policy_bundle_id
         AND derivation.resolved_population_id = NEW.population_id
         AND derivation.module_key = NEW.module_key
         AND derivation.view_key = NEW.view_key
         AND derivation.policy_definition_hash = bundle.definition_hash
     ) THEN
    RAISE EXCEPTION 'Governance evaluation requires an exact module/view population derivation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_population_policy_compilation_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
DECLARE evaluation signal_data_governance_evaluations%ROWTYPE;
DECLARE quality signal_quality_policies%ROWTYPE;
DECLARE included_count integer;
DECLARE proof_count integer;
DECLARE expected_usages text[];
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles WHERE id = NEW.policy_bundle_id;
  expected_usages := signal_governed_view_required_usage_purposes_v1(
    NEW.module_key, NEW.view_key
  );
  IF expected_usages IS NULL
     OR NOT signal_governed_view_bundle_scopes_match_v1(
       NEW.policy_bundle_id, NEW.view_key
     )
     OR NOT EXISTS (
       SELECT 1 FROM signal_governed_view_population_derivations derivation
       WHERE derivation.workspace_id = NEW.workspace_id
         AND derivation.module_key = NEW.module_key
         AND derivation.view_key = NEW.view_key
         AND derivation.policy_bundle_id = NEW.policy_bundle_id
         AND derivation.resolved_population_id = NEW.population_id
         AND derivation.policy_definition_hash = NEW.policy_definition_hash
         AND derivation.compiled_plan_hash = NEW.compiled_plan_hash
     ) THEN
    RAISE EXCEPTION 'Policy compilation lacks an exact module/view population derivation.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.compilation_status <> 'ready' OR bundle.visibility_class <> 'client-safe' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO evaluation FROM signal_data_governance_evaluations
  WHERE id = NEW.governance_evaluation_id;
  SELECT * INTO quality FROM signal_quality_policies WHERE id = NEW.quality_policy_id;
  IF bundle.data_governance_contract_status <> 'resolved'
     OR bundle.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR NOT (NEW.module_key = ANY(bundle.authorized_modules))
     OR NEW.usage_purposes IS DISTINCT FROM expected_usages
     OR NOT (NEW.usage_purposes <@ bundle.required_usage_purposes)
     OR quality.status <> 'active'
     OR quality.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR quality.canonical_root_disposition <> 'evaluate'
     OR quality.definition_hash IS DISTINCT FROM NEW.quality_policy_hash
     OR quality.policy_version IS DISTINCT FROM NEW.quality_policy_version
     OR evaluation.evaluation_status <> 'complete'
     OR evaluation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR evaluation.policy_bundle_id IS DISTINCT FROM NEW.policy_bundle_id
     OR evaluation.population_id IS DISTINCT FROM NEW.population_id
     OR evaluation.module_key IS DISTINCT FROM NEW.module_key
     OR evaluation.view_key IS DISTINCT FROM NEW.view_key
     OR evaluation.quality_policy_id IS DISTINCT FROM NEW.quality_policy_id
     OR evaluation.usage_purposes IS DISTINCT FROM NEW.usage_purposes
     OR evaluation.retention_policy_digest IS DISTINCT FROM NEW.retention_policy_digest
     OR evaluation.licensing_policy_digest IS DISTINCT FROM NEW.licensing_policy_digest
     OR evaluation.governance_digest IS DISTINCT FROM NEW.governance_digest
     OR evaluation.policy_evaluation_watermark IS DISTINCT FROM NEW.policy_evaluation_watermark
     OR evaluation.authorized_root_count IS DISTINCT FROM NEW.authorized_root_count
     OR evaluation.retention_blocked_count IS DISTINCT FROM NEW.retention_blocked_count
     OR evaluation.licensing_blocked_count IS DISTINCT FROM NEW.licensing_blocked_count
     OR evaluation.governance_unknown_count IS DISTINCT FROM NEW.governance_unknown_count THEN
    RAISE EXCEPTION 'Client-safe compilation lacks exact relational governance authority.'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::int INTO included_count
  FROM signal_population_memberships membership
  WHERE membership.population_id = NEW.population_id
    AND membership.workspace_id = NEW.workspace_id
    AND membership.membership_status = 'included'
    AND membership.removed_at IS NULL;
  SELECT count(*)::int INTO proof_count
  FROM signal_data_governance_evaluation_items item
  WHERE item.evaluation_id = evaluation.id
    AND item.workspace_id = NEW.workspace_id
    AND item.decision = 'included'
    AND item.reason_code = 'policy_eligible';
  IF included_count <> proof_count
     OR included_count <> NEW.authorized_root_count
     OR EXISTS (
       SELECT 1 FROM signal_population_memberships membership
       WHERE membership.population_id = NEW.population_id
         AND membership.workspace_id = NEW.workspace_id
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM signal_data_governance_evaluation_items item
           WHERE item.evaluation_id = evaluation.id
             AND item.mention_id = membership.mention_id
             AND item.decision = 'included'
             AND item.reason_code = 'policy_eligible'
         )
     ) THEN
    RAISE EXCEPTION 'Client-safe compilation membership lacks exact authorized provenance proof.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Generalize the existing append-only set ledger in place. The historical name
-- is retained to avoid a parallel store and preserve every 0071/0072 reference.
ALTER TABLE signal_governed_brand_binding_set_operations
  ADD COLUMN IF NOT EXISTS view_key text NOT NULL DEFAULT 'brand';

ALTER TABLE signal_governed_brand_binding_set_operations
  DROP CONSTRAINT IF EXISTS signal_governed_brand_binding_set_action,
  ADD CONSTRAINT signal_governed_brand_binding_set_action CHECK (
    (view_key = 'brand' AND action IN ('promote', 'withdraw-to-bridge'))
    OR (view_key IN ('competition', 'category', 'all-governed')
      AND action IN ('promote', 'withdraw-to-absence'))
  ),
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_set_view,
  ADD CONSTRAINT signal_governed_view_binding_set_view CHECK (
    view_key IN ('brand', 'competition', 'category', 'all-governed')
  );

ALTER TABLE signal_governed_brand_binding_set_operation_items
  DROP CONSTRAINT IF EXISTS signal_governed_brand_binding_set_item_identity,
  ADD CONSTRAINT signal_governed_brand_binding_set_item_identity CHECK (
    module_key IN ('brand-monitoring', 'mentions', 'topics-narratives')
    AND view_key IN ('brand', 'competition', 'category', 'all-governed')
  );

ALTER TABLE signal_governed_view_binding_events
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_event_action,
  ADD CONSTRAINT signal_governed_view_binding_event_action CHECK (
    action IN ('promote', 'rollback', 'withdraw-to-bridge', 'withdraw-to-absence')
  ),
  DROP CONSTRAINT IF EXISTS signal_governed_view_binding_event_transition_shape,
  ADD CONSTRAINT signal_governed_view_binding_event_transition_shape CHECK (
    (action IN ('promote', 'rollback') AND next_binding_id IS NOT NULL)
    OR (action = 'withdraw-to-bridge' AND view_key = 'brand'
      AND previous_binding_id IS NOT NULL AND next_binding_id IS NULL
      AND request_digest ~ '^sha256:[0-9a-f]{64}$')
    OR (action = 'withdraw-to-absence'
      AND view_key IN ('competition', 'category', 'all-governed')
      AND previous_binding_id IS NOT NULL AND next_binding_id IS NULL
      AND request_digest ~ '^sha256:[0-9a-f]{64}$')
  );

CREATE OR REPLACE FUNCTION enforce_signal_governed_view_binding_event_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE next_binding signal_governed_view_bindings%ROWTYPE;
DECLARE previous_binding signal_governed_view_bindings%ROWTYPE;
DECLARE target_organization_id uuid;
BEGIN
  IF NEW.action IN ('withdraw-to-bridge', 'withdraw-to-absence') THEN
    IF NEW.next_binding_id IS NOT NULL OR NEW.previous_binding_id IS NULL
       OR (NEW.action = 'withdraw-to-bridge' AND NEW.view_key <> 'brand')
       OR (NEW.action = 'withdraw-to-absence' AND NEW.view_key = 'brand') THEN
      RAISE EXCEPTION 'Governed binding withdrawal target is incompatible with its view.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.next_binding_id IS NULL THEN
      RAISE EXCEPTION 'Promotion and rollback events require a successor binding.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO next_binding FROM signal_governed_view_bindings binding
    WHERE binding.id = NEW.next_binding_id;
    IF next_binding.id IS NULL
       OR next_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR next_binding.module_key IS DISTINCT FROM NEW.module_key
       OR next_binding.view_key IS DISTINCT FROM NEW.view_key THEN
      RAISE EXCEPTION 'Governed binding event target is cross-workspace or incompatible.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT workspace.organization_id INTO target_organization_id
  FROM signal_workspaces workspace WHERE workspace.id = NEW.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    WHERE actor.id = NEW.actor_user_id
      AND actor.status = 'active'
      AND (actor.user_type = 'noisia_internal'
        OR actor.organization_id = target_organization_id)
  ) THEN
    RAISE EXCEPTION 'Governed binding event actor is not valid for the workspace.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_binding_id IS NOT NULL THEN
    SELECT * INTO previous_binding FROM signal_governed_view_bindings binding
    WHERE binding.id = NEW.previous_binding_id;
    IF previous_binding.id IS NULL
       OR previous_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR previous_binding.module_key IS DISTINCT FROM NEW.module_key
       OR previous_binding.view_key IS DISTINCT FROM NEW.view_key THEN
      RAISE EXCEPTION 'Governed binding event history is cross-workspace or incompatible.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_signal_governed_view_binding(
  target_workspace_id uuid,
  target_module_key text,
  target_view_key text,
  target_actor_user_id uuid,
  target_expected_binding_id uuid,
  target_expected_binding_digest text,
  target_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE workspace signal_workspaces%ROWTYPE;
DECLARE actor users%ROWTYPE;
DECLARE current_binding signal_governed_view_bindings%ROWTYPE;
DECLARE persisted_event signal_governed_view_binding_events%ROWTYPE;
DECLARE expected_request_digest text;
DECLARE expected_action text;
DECLARE observed_binding_digest text;
DECLARE transition_at timestamptz := clock_timestamp();
BEGIN
  IF target_module_key NOT IN ('brand-monitoring', 'mentions', 'topics-narratives')
     OR NOT signal_governed_client_view_is_valid_v1(target_view_key)
     OR target_expected_binding_id IS NULL
     OR target_expected_binding_digest !~ '^sha256:[0-9a-f]{64}$'
     OR target_idempotency_key !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Governed view withdrawal contract is invalid.'
      USING ERRCODE = '23514';
  END IF;
  expected_action := CASE WHEN target_view_key = 'brand'
    THEN 'withdraw-to-bridge' ELSE 'withdraw-to-absence' END;
  -- Preserve the 0071 digest and lock identities for brand so an accepted
  -- request can still be retried after this migration. Other views use a
  -- namespaced v2 digest and lock because they did not exist before 0073.
  expected_request_digest := CASE WHEN target_view_key = 'brand' THEN
    'sha256:' || encode(sha256(convert_to(concat_ws('|',
      'signal-governed-view-withdrawal-v1', target_workspace_id::text,
      target_module_key, target_view_key, target_actor_user_id::text,
      target_expected_binding_id::text, target_expected_binding_digest
    ), 'UTF8')), 'hex')
  ELSE
    'sha256:' || encode(sha256(convert_to(concat_ws('|',
      'signal-governed-view-withdrawal-v2', target_workspace_id::text,
      target_module_key, target_view_key, target_actor_user_id::text,
      target_expected_binding_id::text, target_expected_binding_digest,
      expected_action
    ), 'UTF8')), 'hex')
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    CASE WHEN target_view_key = 'brand'
      THEN target_workspace_id::text || ':brand-binding-set'
      ELSE concat_ws(':', target_workspace_id::text, target_view_key, 'binding-set')
    END, 0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    target_workspace_id::text, target_module_key, target_view_key
  ), 0));
  SELECT * INTO persisted_event FROM signal_governed_view_binding_events event
  WHERE event.workspace_id = target_workspace_id
    AND event.idempotency_key = target_idempotency_key;
  IF persisted_event.id IS NOT NULL THEN
    IF persisted_event.action IS DISTINCT FROM expected_action
       OR persisted_event.module_key IS DISTINCT FROM target_module_key
       OR persisted_event.view_key IS DISTINCT FROM target_view_key
       OR persisted_event.actor_user_id IS DISTINCT FROM target_actor_user_id
       OR persisted_event.previous_binding_id IS DISTINCT FROM target_expected_binding_id
       OR persisted_event.next_binding_id IS NOT NULL
       OR persisted_event.request_digest IS DISTINCT FROM expected_request_digest THEN
      RAISE EXCEPTION 'Governed view idempotency key was reused with incompatible inputs.'
        USING ERRCODE = '23514';
    END IF;
    RETURN persisted_event.previous_binding_id;
  END IF;
  SELECT * INTO workspace FROM signal_workspaces candidate
  WHERE candidate.id = target_workspace_id AND candidate.status = 'active';
  SELECT * INTO actor FROM users candidate WHERE candidate.id = target_actor_user_id;
  IF workspace.id IS NULL OR actor.id IS NULL OR actor.status <> 'active' OR NOT (
    actor.user_type = 'noisia_internal'
    OR actor.organization_id IS NOT DISTINCT FROM workspace.organization_id
  ) THEN
    RAISE EXCEPTION 'Governed view withdrawal actor is not valid for the workspace.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO current_binding FROM signal_governed_view_bindings binding
  WHERE binding.workspace_id = target_workspace_id
    AND binding.module_key = target_module_key
    AND binding.view_key = target_view_key
    AND binding.binding_status = 'current'
  FOR UPDATE;
  observed_binding_digest := signal_governed_view_binding_digest_v1(current_binding.id);
  IF current_binding.id IS NULL
     OR current_binding.id IS DISTINCT FROM target_expected_binding_id
     OR observed_binding_digest IS DISTINCT FROM target_expected_binding_digest THEN
    RAISE EXCEPTION 'Governed view withdrawal compare-and-swap failed.'
      USING ERRCODE = '40001';
  END IF;
  UPDATE signal_governed_view_bindings
  SET binding_status = 'retired', effective_to = transition_at
  WHERE id = current_binding.id;
  INSERT INTO signal_governed_view_binding_events (
    workspace_id, module_key, view_key, action,
    previous_binding_id, next_binding_id, actor_user_id,
    idempotency_key, request_digest
  ) VALUES (
    target_workspace_id, target_module_key, target_view_key, expected_action,
    current_binding.id, NULL, target_actor_user_id,
    target_idempotency_key, expected_request_digest
  );
  RETURN current_binding.id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_operation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle signal_population_policy_bundles%ROWTYPE;
BEGIN
  SELECT * INTO bundle FROM signal_population_policy_bundles candidate
  WHERE candidate.id = NEW.policy_bundle_id;
  IF NOT signal_data_governance_actor_is_valid(NEW.workspace_id, NEW.actor_user_id)
     OR bundle.id IS NULL
     OR bundle.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR bundle.status = 'retired'
     OR NOT signal_governed_client_view_is_valid_v1(NEW.view_key)
     OR NOT signal_governed_view_bundle_scopes_match_v1(bundle.id, NEW.view_key)
     OR NOT ARRAY[
       'brand-monitoring', 'mentions', 'topics-narratives'
     ]::text[] <@ bundle.authorized_modules THEN
    RAISE EXCEPTION 'Governed binding-set operation is cross-workspace or unauthorized.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE operation signal_governed_brand_binding_set_operations%ROWTYPE;
DECLARE event signal_governed_view_binding_events%ROWTYPE;
DECLARE previous_binding signal_governed_view_bindings%ROWTYPE;
DECLARE next_binding signal_governed_view_bindings%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM signal_governed_brand_binding_set_operations candidate
  WHERE candidate.id = NEW.operation_id;
  SELECT * INTO event FROM signal_governed_view_binding_events candidate
  WHERE candidate.id = NEW.binding_event_id;
  IF NEW.previous_binding_id IS NOT NULL THEN
    SELECT * INTO previous_binding FROM signal_governed_view_bindings candidate
    WHERE candidate.id = NEW.previous_binding_id;
  END IF;
  IF NEW.next_binding_id IS NOT NULL THEN
    SELECT * INTO next_binding FROM signal_governed_view_bindings candidate
    WHERE candidate.id = NEW.next_binding_id;
  END IF;
  IF operation.id IS NULL OR event.id IS NULL
     OR operation.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR operation.view_key IS DISTINCT FROM NEW.view_key
     OR event.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR event.module_key IS DISTINCT FROM NEW.module_key
     OR event.view_key IS DISTINCT FROM NEW.view_key
     OR event.action IS DISTINCT FROM operation.action
     OR event.actor_user_id IS DISTINCT FROM operation.actor_user_id
     OR event.previous_binding_id IS DISTINCT FROM NEW.previous_binding_id
     OR event.next_binding_id IS DISTINCT FROM NEW.next_binding_id
     OR (NEW.previous_binding_id IS NOT NULL AND (
       previous_binding.id IS NULL
       OR previous_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR previous_binding.module_key IS DISTINCT FROM NEW.module_key
       OR previous_binding.view_key IS DISTINCT FROM NEW.view_key
     ))
     OR (NEW.next_binding_id IS NOT NULL AND (
       next_binding.id IS NULL
       OR next_binding.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR next_binding.module_key IS DISTINCT FROM NEW.module_key
       OR next_binding.view_key IS DISTINCT FROM NEW.view_key
     ))
     OR (operation.action = 'promote' AND (
       NEW.next_binding_id IS NULL
       OR next_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
     ))
     OR (operation.action IN ('withdraw-to-bridge', 'withdraw-to-absence') AND (
       NEW.previous_binding_id IS NULL
       OR NEW.next_binding_id IS NOT NULL
       OR previous_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id
     )) THEN
    RAISE EXCEPTION 'Governed binding-set item is incompatible with its operation authority.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_signal_governed_brand_binding_set_cardinality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE observed_count integer;
DECLARE observed_modules text[];
DECLARE observed_views text[];
BEGIN
  SELECT count(*)::int,
    array_agg(item.module_key ORDER BY item.module_key),
    array_agg(DISTINCT item.view_key ORDER BY item.view_key)
  INTO observed_count, observed_modules, observed_views
  FROM signal_governed_brand_binding_set_operation_items item
  WHERE item.operation_id = NEW.id;
  IF observed_count <> 3
     OR observed_modules IS DISTINCT FROM
       ARRAY['brand-monitoring', 'mentions', 'topics-narratives']::text[]
     OR observed_views IS DISTINCT FROM ARRAY[NEW.view_key]::text[] THEN
    RAISE EXCEPTION 'Governed binding-set operation requires the three canonical modules for exactly one view.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Recreate the existing triggers with generalized functions; history remains
-- append-only and the legacy table names stay stable for deployed code.
DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_operation
  ON signal_governed_brand_binding_set_operations;
CREATE TRIGGER trg_signal_governed_brand_binding_set_operation
  BEFORE INSERT ON signal_governed_brand_binding_set_operations
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_operation();

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_item
  ON signal_governed_brand_binding_set_operation_items;
CREATE TRIGGER trg_signal_governed_brand_binding_set_item
  BEFORE INSERT ON signal_governed_brand_binding_set_operation_items
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_item();

DROP TRIGGER IF EXISTS trg_signal_governed_brand_binding_set_cardinality
  ON signal_governed_brand_binding_set_operations;
CREATE CONSTRAINT TRIGGER trg_signal_governed_brand_binding_set_cardinality
  AFTER INSERT ON signal_governed_brand_binding_set_operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_signal_governed_brand_binding_set_cardinality();

COMMENT ON FUNCTION ensure_signal_operational_attributable_semantic_base_v1 IS
  'Server-owned, idempotent creation of the neutral attributable semantic base; never called by migration apply.';
COMMENT ON FUNCTION reconcile_signal_operational_attributable_semantic_base_v1 IS
  'Reconciles canonical roots having current approved eligible attributable semantics, deduplicated once per workspace base.';
COMMENT ON FUNCTION signal_governed_view_required_usage_purposes_v1 IS
  'Closed data-use contract for each canonical module and client-safe governed view.';
COMMENT ON TABLE signal_governed_brand_binding_set_operations IS
  'Append-only atomic three-module binding-set ledger, generalized in 0073 across the four closed client-safe views; historical name retained.';
