import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migration=await readFile(new URL('./0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
const predecessor=await readFile(new URL('./0103_signal_semantic_context_simple_creation.sql',import.meta.url),'utf8');
const publication=await readFile(new URL('./0101_signal_semantic_context_inherited_applicability.sql',import.meta.url),'utf8');
const wrapper=migration.match(/CREATE FUNCTION signal_semantic_context_effective_applicability_v1\(target_element_id uuid,expected_live_authority jsonb\)\n([\s\S]*?)\nEND \$\$;/u)?.[1];
const localeWrapper=migration.match(/CREATE FUNCTION signal_semantic_context_locale_authority_valid_v1\(target_element_id uuid\) RETURNS boolean LANGUAGE plpgsql STABLE STRICT AS \$\$\n([\s\S]*?)\nEND \$\$;/u)?.[1];

// These are offline migration-contract checks. The existing synthetic PG bridge
// exercises the same function through ordinary edit, activation and publication.
test('normal applicability keeps its exact generation-origin fence and delegates to the predecessor',()=>{
  assert.ok(wrapper,'carry applicability adapter must be installed');
  assert.match(predecessor,/origin\.generation_id<>element\.generation_id/u,
    'the historical function must still reject a foreign proposal origin');
  assert.match(migration,/ALTER FUNCTION signal_semantic_context_effective_applicability_v1\(uuid,jsonb\)\s+RENAME TO signal_semantic_context_effective_applicability_v1_pre_0153;/u);
  assert.match(wrapper,/IF element\.carried_from_element_id IS NULL THEN\s+base:=signal_semantic_context_effective_applicability_v1_pre_0153\(target_element_id,expected_live_authority\);/u);
  assert.match(wrapper,/base->>'reason' IS DISTINCT FROM 'proposal_origin_invalid' OR element\.origin_kind IS DISTINCT FROM 'operator_ordinary'/u);
  assert.doesNotMatch(wrapper,/\b(?:UPDATE|INSERT|DELETE)\b/u,'resolution cannot rewrite original proposal identity');
});

test('invalid or indeterminate copy proof fails closed before resolving inherited applicability',()=>{
  assert.ok(wrapper);
  assert.match(wrapper,/IF signal_brand_context_carried_row_valid_v1\(element\) IS DISTINCT FROM true THEN\s+RETURN jsonb_build_object\('valid',false,'reason','carried_element_invalid'\);\s+END IF;/u);
  const directCopy=wrapper.slice(wrapper.indexOf('IF signal_brand_context_carried_row_valid_v1'));
  assert.ok(directCopy.indexOf("'carried_element_invalid'")<directCopy.indexOf('parent_result:='));
  assert.ok(directCopy.indexOf("'carried_element_invalid'")<directCopy.indexOf('source_result:='));
});

test('invalid source or child live authority cannot become a valid carried applicability',()=>{
  assert.ok(wrapper);
  assert.match(wrapper,/parent_result:=signal_semantic_context_parent_applicability_v1\(element\.generation_id,expected_live_authority\);\s+IF parent_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN parent_result; END IF;/u);
  assert.match(wrapper,/source_result:=signal_semantic_context_effective_applicability_v1\(element\.carried_from_element_id,expected_live_authority\);\s+IF source_result->>'valid' IS DISTINCT FROM 'true' THEN\s+RETURN jsonb_build_object\('valid',false,'reason','carried_source_applicability_invalid'\);\s+END IF;/u);
  assert.ok(wrapper.indexOf("'carried_source_applicability_invalid'")<wrapper.indexOf("applicability:=(source_result->'applicability')"));
});

test('ordinary edits require a strictly descending authorized chain to a valid carried source',()=>{
  assert.ok(wrapper);
  assert.match(wrapper,/element\.disposition IS DISTINCT FROM 'approved' OR element\.locale_decision_contract_version IS NOT NULL THEN RETURN base/u);
  assert.match(wrapper,/WHILE cursor_element\.carried_from_element_id IS NULL LOOP\s+IF cursor_element\.origin_kind IS DISTINCT FROM 'operator_ordinary'\s+OR signal_semantic_context_ordinary_authority_valid_v1\(cursor_element\.id\) IS DISTINCT FROM true THEN RETURN base/u);
  assert.match(wrapper,/prior\.id=cursor_element\.supersedes_element_id AND prior\.generation_id=element\.generation_id\s+AND prior\.workspace_id=element\.workspace_id AND prior\.element_key=element\.element_key\s+AND prior\.element_version<cursor_element\.element_version/u);
  assert.match(wrapper,/IF predecessor\.id IS NULL THEN RETURN base; END IF;/u);
  assert.match(wrapper,/source_result:=signal_semantic_context_effective_applicability_v1\(\s+signal_brand_context_approved_applicability_source_v1\(cursor_element\.id\),expected_live_authority\);\s+IF source_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN base;/u);
  assert.match(wrapper,/signal_semantic_context_locale_authority_valid_v1\(element\.id\) IS DISTINCT FROM true/u);
  assert.doesNotMatch(wrapper,/state:='explicit_global'/u,'an ordinary edit cannot invent Global applicability');
});

test('validated copy retains source applicability and binds its envelope and digest to the child',()=>{
  assert.ok(wrapper);
  assert.match(wrapper,/applicability:=\(source_result->'applicability'\)\|\|jsonb_build_object\(\s+'parent_authority',parent_result->'parent_authority',\s+'parent_authority_digest',parent_result->>'parent_authority_digest'\);/u);
  assert.match(wrapper,/'applicability_digest',signal_semantic_context_digest_json_v2\(applicability\)/u);
  assert.match(publication,/invalid_applicability>0 THEN\s+blockers:=array_append\(blockers,'locale_market_required_unresolved'\)/u);
  assert.doesNotMatch(migration,/value<>\s*'locale_market_required_unresolved'/u,
    'carry resolution must not remove the global publication blocker');
});

test('preserved explicit locale or Global authority resolves from the validated source after the legacy path',()=>{
  assert.ok(localeWrapper);
  assert.match(localeWrapper,/IF signal_semantic_context_locale_authority_valid_v1_pre_0153\(target_element_id\) IS TRUE THEN RETURN true; END IF;/u);
  assert.match(localeWrapper,/element\.origin_kind IS DISTINCT FROM 'operator_ordinary' OR element\.disposition IS DISTINCT FROM 'approved' THEN RETURN false/u);
  assert.match(localeWrapper,/RETURN signal_brand_context_carried_row_valid_v1\(cursor_element\)\s+AND COALESCE\(signal_semantic_context_locale_authority_valid_v1\(\s+signal_brand_context_approved_applicability_source_v1\(cursor_element\.id\)\),false\)/u);
  assert.match(localeWrapper,/prior\.generation_id=element\.generation_id\s+AND prior\.workspace_id=element\.workspace_id AND prior\.element_key=element\.element_key\s+AND prior\.element_version<cursor_element\.element_version/u);
  assert.doesNotMatch(localeWrapper,/THEN[^;]*'global'/u,'Global must come from the proven source, never be synthesized');
});

test('any inherited locale decision field drift or invalid ordinary link is rejected',()=>{
  assert.ok(localeWrapper);
  assert.match(localeWrapper,/signal_semantic_context_ordinary_authority_valid_v1\(cursor_element\.id\) IS DISTINCT FROM true THEN RETURN false/u);
  assert.match(localeWrapper,/IF predecessor\.id IS NULL OR ROW\([\s\S]*?\)\s+IS DISTINCT FROM ROW\([\s\S]*?\) THEN RETURN false; END IF;/u);
  const compared=localeWrapper.match(/IF predecessor\.id IS NULL OR ROW\(([\s\S]*?)\)\s+IS DISTINCT FROM ROW\(([\s\S]*?)\) THEN RETURN false;/u);
  assert.ok(compared);
  const fields=['locale','locale_decision_contract_version','locale_decision_disposition','locale_decision_locale',
    'locale_decision_reason_code','locale_decision_rationale','locale_decision_basis_digest','locale_decision_input_digest',
    'locale_decision_authority_snapshot','locale_decision_authority_digest','locale_decision_prestate_digest','locale_decision_poststate_digest'];
  assert.deepEqual(compared[1]!.split(',').map(value=>value.trim()),fields.map(field=>`cursor_element.${field}`));
  assert.deepEqual(compared[2]!.split(',').map(value=>value.trim()),fields.map(field=>`predecessor.${field}`));
});

const restoredSource=migration.match(/CREATE FUNCTION signal_brand_context_approved_applicability_source_v1\(p_element_id uuid\)\n([\s\S]*?)\nEND \$\$;/u)?.[1];
test('restore resolves through archived provenance without granting public applicability to archived leaves',()=>{
  assert.ok(restoredSource);assert.ok(wrapper);
  assert.match(predecessor,/IF element.disposition<>'approved' THEN RETURN jsonb_build_object\('valid',false,'reason','element_not_approved'\); END IF/u);
  assert.match(restoredSource,/IF cursor_element.disposition='approved' THEN[\s\S]*?RETURN cursor_element.id;/u);
  assert.match(restoredSource,/cursor_element.ordinary_command_action IS DISTINCT FROM 'archive'/u);
  assert.match(restoredSource,/cursor_element.disposition IS DISTINCT FROM 'archived' OR cursor_element.lifecycle_state IS DISTINCT FROM 'archived'/u);
  assert.match(wrapper,/source_result:=signal_semantic_context_effective_applicability_v1\(\s+signal_brand_context_approved_applicability_source_v1\(cursor_element.id\),expected_live_authority\)/u);
  assert.doesNotMatch(restoredSource,/jsonb_build_object\('valid',true|\b(?:UPDATE|INSERT|DELETE)\b/u);
});
test('invalid archive/carry authority, foreign identity or cycles cannot supply a restored locale',()=>{
  assert.ok(restoredSource);
  assert.match(restoredSource,/signal_brand_context_carried_row_valid_v1\(cursor_element\) IS DISTINCT FROM true THEN RETURN NULL/u);
  assert.match(restoredSource,/signal_semantic_context_ordinary_authority_valid_v1\(cursor_element.id\) IS DISTINCT FROM true THEN RETURN NULL/u);
  assert.match(restoredSource,/prior.workspace_id=origin.workspace_id\s+AND prior.element_key=origin.element_key AND prior_generation.generation_version<current_generation.generation_version/u);
  assert.match(restoredSource,/prior.generation_id=cursor_element.generation_id AND prior.element_key=origin.element_key\s+AND prior.element_version<cursor_element.element_version/u);
  assert.match(restoredSource,/IF predecessor.id IS NULL OR ROW/u);
});
test('archive traversal cannot change any inherited locale/global decision or fall back to an unresolved source',()=>{
  assert.ok(restoredSource);assert.ok(localeWrapper);assert.ok(wrapper);
  const compared=restoredSource.match(/IF predecessor.id IS NULL OR ROW\(([\s\S]*?)\)\s+IS DISTINCT FROM ROW\(([\s\S]*?)\) THEN RETURN NULL;/u);
  assert.ok(compared);
  const fields=['locale','locale_decision_contract_version','locale_decision_disposition','locale_decision_locale',
    'locale_decision_reason_code','locale_decision_rationale','locale_decision_basis_digest','locale_decision_input_digest',
    'locale_decision_authority_snapshot','locale_decision_authority_digest','locale_decision_prestate_digest','locale_decision_poststate_digest'];
  assert.deepEqual(compared[1]!.split(',').map(v=>v.trim()),fields.map(field=>`cursor_element.${field}`));
  assert.deepEqual(compared[2]!.split(',').map(v=>v.trim()),fields.map(field=>`predecessor.${field}`));
  assert.match(localeWrapper,/COALESCE\(signal_semantic_context_locale_authority_valid_v1\([\s\S]*?\),false\)/u);
  assert.match(wrapper,/IF source_result->>'valid' IS DISTINCT FROM 'true' THEN RETURN base/u);
});
