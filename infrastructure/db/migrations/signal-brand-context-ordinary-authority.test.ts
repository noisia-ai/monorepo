import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migration=await readFile(new URL('./0153_signal_brand_context_preparation.sql',import.meta.url),'utf8');
const authority=migration.match(/CREATE OR REPLACE FUNCTION signal_semantic_context_ordinary_authority_valid_v1\(target_element_id uuid\)\n([\s\S]*?)\nEND; \$\$;/u)?.[1];
const publication=await readFile(new URL('./0102_signal_semantic_context_ordinary_editing.sql',import.meta.url),'utf8');

// Offline checks of the SQL trust boundary. JSON extraction of a missing key
// yields SQL NULL; a present JSON null is instead the non-null jsonb value null.
// Coalescing only the typed-column side accepts the latter without accepting
// an omitted key. PG execution remains in the synthetic publication bridge.
for(const field of ['scope','relation_kind','relation_target_key']){
  test(`ordinary save preserves explicit JSON null, missing-key rejection and value equality for ${field}`,()=>{
    assert.ok(authority);
    const line=authority.split('\n').find(value=>value.includes(`->'values'->'${field}' IS NOT DISTINCT FROM`));
    assert.equal(line?.trim(),`AND operation.semantic_context_decision_input->'values'->'${field}' IS NOT DISTINCT FROM COALESCE(to_jsonb(element.${field}),'null'::jsonb)`+
      (field==='relation_target_key'?'))':''));
    assert.ok(!line!.includes('COALESCE(operation.'),'missing request keys must remain SQL NULL and fail equality');
    assert.ok(line!.includes(`to_jsonb(element.${field})`),'non-null values must still match the stored column exactly');
  });
}

test('nullable comparison repair retains the sealed command, carry proof and publication blocker',()=>{
  assert.ok(authority);
  assert.match(authority,/operation\.semantic_context_decision_input_digest=element\.ordinary_command_input_digest/u);
  assert.match(authority,/signal_semantic_context_digest_json_v2\(operation\.semantic_context_decision_input\)=element\.ordinary_command_input_digest/u);
  assert.match(authority,/element\.ordinary_command_basis=expected_basis/u);
  assert.match(authority,/predecessor\.carried_from_element_id IS NOT NULL AND signal_brand_context_carried_row_valid_v1\(predecessor\)/u);
  assert.match(publication,/disposition='approved' AND signal_semantic_context_ordinary_authority_valid_v1\(id\)/u);
  assert.match(publication,/IF missing>0 THEN blockers:=array_append\(blockers,'decision_basis_missing'\); END IF;/u);
  assert.doesNotMatch(migration,/WHERE value<>\s*'decision_basis_missing'/u,'the new cut must not suppress a missing basis');
});

test('automatic publication permits an explicit empty pack while retaining every authority blocker',()=>{
  assert.match(migration,
    /WHERE NOT \(\(value='pending_elements' AND pending=quarantined\) OR value='zero_approved_elements'\);/u);
  for(const blocker of ['decision_basis_missing','locale_market_required_unresolved','authority_drift'])
    assert.doesNotMatch(migration,new RegExp(`value<>\\s*'${blocker}'`,'u'));
});
