import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SIGNAL_TOPIC_INTEREST_REVIEW_CONFIGURATION_V1, SIGNAL_TOPIC_INTEREST_REVIEW_CAPACITY_V1 } from '@noisia/query-engine';

// Static safety/contract checks only. This suite does not execute PostgreSQL and
// does not replace the synthetic PG migration+identity+rights+replay gate.
const sql = readFileSync(new URL('./0183_signal_topic_interest_review.sql', import.meta.url), 'utf8');
const executable = sql.replace(/--[^\n]*/gu, '');
function body(name: string) {
  const found = sql.match(new RegExp(`CREATE FUNCTION ${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'u'))?.[1];
  assert.ok(found, `required function ${name} must have an implementation`);
  return found;
}

test('0183 adds only immutable preparation storage and never changes or admits the paid pipeline', () => {
  assert.deepEqual([...executable.matchAll(/CREATE TABLE (\w+)/gu)].map(match => match[1]), ['signal_topic_interest_review_preparations'], 'no new ledger or execution owner');
  assert.doesNotMatch(executable, /CREATE OR REPLACE|ALTER FUNCTION|DROP\s|\bGRANT\s|SECURITY DEFINER/iu, 'historical guards and privileges remain intact');
  assert.doesNotMatch(executable, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:signal_processing_|signal_topic_editorial_)/iu, 'no paid admissions, calls, requests, outbox or owner mutation');
  assert.deepEqual([...executable.matchAll(/ALTER TABLE (\w+)/gu)].map(match => match[1]), ['signal_topic_interest_review_preparations'], 'no old schema constraints are widened');
  assert.match(body('prepare_signal_topic_interest_review_v1'), /'provider_execution_enabled',false/u, 'preparation receipt never claims execution authority');
  assert.match(body('load_signal_topic_interest_review_preparation_v1'), /'provider_execution_enabled',false/u, 'loaded snapshot never claims execution authority');
});

test('0183 seals the current fixed interest provider configuration without changing historical configuration', () => {
  const literal = body('signal_topic_interest_review_configuration_v1').match(/SELECT '(.*?)'::jsonb/u)?.[1];
  assert.ok(literal, 'new configuration must be a fixed JSON literal');
  assert.deepEqual(JSON.parse(literal), SIGNAL_TOPIC_INTEREST_REVIEW_CONFIGURATION_V1, 'SQL and pure contract prompt/schema/model/prices agree');
  assert.doesNotMatch(executable, /CREATE FUNCTION signal_topic_editorial_configuration_v1/u, 'legacy configuration remains byte-identical');
});

test('0183 reuses screening evidence checks and seals complete ordinal batches with fixed request bodies', () => {
  const valid = body('signal_topic_interest_review_plan_valid_v1');
  assert.match(valid, /signal_topic_editorial_plan_valid_v1\(target_run,plan\)/u, 'existing evidence/right provenance guard is reused');
  assert.match(valid, /review->>'review_digest' IS DISTINCT FROM signal_topic_editorial_digest_json_v1\(review-'review_digest'\)/u, 'review digest is recomputed');
  assert.match(valid, /manifest IS DISTINCT FROM expected_manifest/u, 'full catalog/group manifest is reconstructed');
  assert.match(valid, /batch->'pairs' IS DISTINCT FROM expected_pairs/u, 'missing, extra or repeated matrix pairs are rejected');
  assert.match(valid, /payload IS DISTINCT FROM expected_payload/u, 'definitions, scope, boundaries and refs are bound to each wire payload');
  assert.match(valid, /configuration->>'prompt_digest'/u, 'prompt is fixed');
  assert.match(valid, /configuration->>'schema_digest'/u, 'schema is fixed');
  assert.match(valid, /wire IS DISTINCT FROM jsonb_build_object/u, 'unexpected tools, repair, provider options or message shapes are rejected');
  assert.match(valid, /generate_series\(batch_index::bigint\*20,least\(pair_count-1,batch_index::bigint\*20\+19\)\)/u, 'matrix validation visits at most twenty positions per batch');
  assert.doesNotMatch(valid, /CROSS JOIN jsonb_array_elements\(catalog\)/u, 'no complete Cartesian product repeated for every batch');
  assert.ok(valid.includes(`pair_count NOT BETWEEN 1 AND ${SIGNAL_TOPIC_INTEREST_REVIEW_CAPACITY_V1.max_pairs}`), 'technical pair capacity agrees');
  assert.ok(valid.includes(`octet_length(signal_topic_editorial_canonical_json_v1(review))>${SIGNAL_TOPIC_INTEREST_REVIEW_CAPACITY_V1.max_review_bytes}`), 'JSONB whitespace cannot create false capacity failures');
});

test('0183 resolves the working catalog, preserves manual interests and recomputes meaning digests', () => {
  const working = body('signal_topic_interest_review_working_profile_v1'), catalog = body('signal_topic_interest_review_catalog_v1'), definition = body('signal_topic_interest_review_definition_v1');
  assert.match(working, /metadata->>'catalog_role'='working' OR metadata->>'catalog_role' IS NULL/u, 'working/legacy head is explicit');
  assert.match(working, /metadata->>'source_catalog_profile_id'=head.id::text AND version>head.version/u, 'only actual descendants advance the head');
  assert.match(catalog, /definition->>'origin'<>'workspace_discovery' OR definition->'discovery_guidance'='true'::jsonb/u, 'manual guidance=false stays classifiable; discovery needs explicit opt-in');
  assert.match(catalog, /definition->>'lifecycle'<>'archived'/u, 'archived interests are excluded');
  assert.match(catalog, /definition->>'term_key' IS DISTINCT FROM term_key/u, 'metadata identity matches the actual taxonomy term');
  assert.match(definition, /signal_topic_editorial_digest_json_v1\(meaning\) IS DISTINCT FROM normalized->>'definition_digest'/u, 'definition digests are recomputed, not trusted as strings');
  for (const field of ['definition','scope','lifecycle','origin','source','inclusion','exclusion','positive_examples','negative_examples']) {
    assert.ok(definition.includes(`'${field}'`), `meaning preserves ${field}`);
  }
  assert.match(body('signal_topic_interest_review_utf16_length_v1'), /ascii\(item\)>65535 THEN 2 ELSE 1/u, 'length limits match JavaScript UTF-16 including astral text');
});

test('0183 exact replay remains scoped, current and idempotent after a lost acknowledgement', () => {
  const prepare = body('prepare_signal_topic_interest_review_v1'), load = body('load_signal_topic_interest_review_preparation_v1');
  assert.match(prepare, /workspace_id=target_workspace AND actor_user_id=target_actor AND idempotency_key=request_key/u, 'idempotency is actor/workspace scoped');
  assert.match(prepare, /saved.request_digest IS DISTINCT FROM hash OR saved.review IS DISTINCT FROM review/u, 'same key cannot be reused for different bytes');
  assert.match(prepare, /replayed AND source IS DISTINCT FROM saved.source_binding/u, 'replay after source drift is rejected');
  assert.match(prepare, /IF replayed THEN[\s\S]*signal_topic_interest_review_plan_valid_v1[\s\S]*ELSE\s+INSERT INTO/u, 'replay checks current catalog and never inserts');
  assert.match(load, /id=target_preparation AND workspace_id=target_workspace/u, 'load cannot cross workspace');
  assert.match(load, /source IS DISTINCT FROM saved.source_binding/u, 'load checks current source');
  assert.match(load, /signal_topic_interest_review_plan_valid_v1\(target_workspace,saved.numeric_run_id,saved.review\)/u, 'load checks current catalog and full contract');
  assert.match(prepare, /signal_topic_interest_review_can_read_v1\(target_workspace,target_actor\)/u, 'prepare checks current read rights');
  assert.match(load, /signal_topic_interest_review_can_read_v1\(target_workspace,target_actor\)/u, 'load checks current read rights without spending authorization');
});

test('0183 protects private evidence and immutable rows even from direct inserts', () => {
  const guard = body('signal_topic_interest_review_preparation_guard_v1');
  assert.match(guard, /IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'topic_interest_review_history_retained'/u, 'snapshots cannot be edited or deleted');
  assert.match(guard, /FOR SHARE OF u,w,b/u, 'read authority is held through writes');
  assert.match(guard, /FOR SHARE OF a/u, 'grant revocation cannot race insertion');
  assert.match(guard, /signal_topic_interest_review_plan_valid_v1\(NEW.workspace_id,NEW.numeric_run_id,NEW.review\)/u, 'direct insertion cannot bypass plan validation');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u, 'evidence table has RLS');
  assert.match(sql, /REVOKE ALL ON TABLE signal_topic_interest_review_preparations FROM PUBLIC/u, 'table is not publicly readable');
  assert.match(sql, /ARRAY\['anon','authenticated'\]/u, 'default Supabase role grants are revoked');
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/u, 'private functions are revoked from PUBLIC');
});
