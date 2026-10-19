import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalTopicEditorialGlobalStageReservationMicroUsdV2,
  signalTopicEditorialGlobalStageRevisionConceptsV2} from './signal-topic-editorial-global-stage-v2';
import {parseSignalTopicConsolidationRevisionV1,signalTopicConsolidationDigestV1} from './signal-topic-consolidation';

test('global stages reserve with the existing batch price and exact UTF-8 bytes',()=>{
  assert.equal(signalTopicEditorialGlobalStageReservationMicroUsdV2('é',128_000),960_003n);
  assert.equal(signalTopicEditorialGlobalStageReservationMicroUsdV2('',1),8n);
  assert.throws(()=>signalTopicEditorialGlobalStageReservationMicroUsdV2('x',0),/topic_editorial_global_stage_request_invalid/u);
});

test('0202 keeps global stages under original admission/execution and batch exposure',async()=>{
  const sql=await readFile(new URL('./migrations/0202_signal_topic_editorial_global_stage_v2.sql',import.meta.url),'utf8');
  assert.match(sql,/g\.processing_admission_id IS DISTINCT FROM e\.processing_admission_id/u);
  assert.match(sql,/spent\+NEW\.reserved_micro_usd>e\.hard_cap_micro_usd/u);
  assert.match(sql,/daily_spent\+NEW\.reserved_micro_usd>p\.daily_cap_micro_usd/u);
  assert.match(sql,/signal_processing_org_exposure_pre0176_v1/u);
  assert.match(sql,/FROM signal_topic_editorial_calls WHERE execution_id=e\.id/u);
  assert.match(sql,/FROM signal_topic_editorial_global_stage_calls_v2 WHERE execution_id=e\.id/u);
  assert.match(sql,/signal_topic_editorial_batch_cost_v2\(envelope\)/u);
  assert.match(sql,/b\.provider_batch_id=NEW\.response_provider_request_id/u);
  assert.match(sql,/clock_timestamp\(\)>=owner_row\.send_not_after/u);
  assert.doesNotMatch(sql,/octet_length\(request_body\).*max_tokens.*30/u);
  assert.match(sql,/NEW\.catalog_digest IS DISTINCT FROM signal_topic_editorial_digest_json_v1\(NEW\.catalog_body\)/u);
  assert.match(sql,/jsonb_array_length\(NEW\.group_evidence\)<>s\.expected_group_count/u);
  assert.match(sql,/signal_topic_atomic_group_evidence evidence/u);
  assert.match(sql,/evidence\.ref_id=cited\.ref_id/u);
  assert.match(sql,/topic_editorial_global_stage_manifest_binding_invalid/u);
  assert.match(sql,/i\.call_identity=entry\.value->>'call_id'/u);
  assert.match(sql,/r\.stage_identity=entry\.value->>'stage_identity'/u);
});

test('logical replay closes the durable stage as materialized',async()=>{
  const source=await readFile(new URL('./signal-topic-editorial-global-stage-v2.ts',import.meta.url),'utf8');
  const replay=source.slice(source.indexOf('if(sameLogical){'),source.indexOf('nextRevision=(rows[0]?.revision??0)+1'));
  assert.match(replay,/SET state='materialized',completed_at=clock_timestamp\(\)/u);
});

test('replay parses a persisted revision while keeping concept metadata in its sidecar',()=>{
  const persisted=[{concept_key:'topic-one',kind:'topic' as const,label:'Rutinas Alexa+',
    definition:'Conversaciones sobre rutinas.',locale:'es-MX',source:'model' as const,
    metadata:{contract_version:'signal-topic-editorial-concept-metadata-v2',priority_rank:1}}];
  const decisions=[{group_key:'open:first',disposition:'topic' as const,concept_key:'topic-one',
    source:'model' as const,confidence:0.8,rationale:'Cita original.'}];
  const body={contract_version:'signal-topic-consolidation-revision-v1' as const,revision:1,
    concepts:signalTopicEditorialGlobalStageRevisionConceptsV2(persisted),decisions};
  const parsed=parseSignalTopicConsolidationRevisionV1({...body,revision_digest:signalTopicConsolidationDigestV1(body)},['open:first']);
  assert.equal(parsed.concepts[0]?.concept_key,'topic-one');
  assert.equal('metadata' in parsed.concepts[0]!,false);
  assert.equal(persisted[0]?.metadata.priority_rank,1);
});

test('Worker locks org/day and actor/execution before the Batch row',async()=>{
  const source=await readFile(new URL('./signal-topic-editorial-global-stage-v2.ts',import.meta.url),'utf8');
  const sql=await readFile(new URL('./migrations/0202_signal_topic_editorial_global_stage_v2.sql',import.meta.url),'utf8');
  const worker=source.slice(source.indexOf('const withBatch='),source.indexOf('  return {\n    async claimDue'));
  const trigger=sql.slice(sql.indexOf('CREATE FUNCTION signal_topic_editorial_global_stage_call_guard_v2()'));
  const ordered=(body:string,needles:string[])=>needles.map(needle=>body.indexOf(needle));
  const lockOrder=['signal_processing_lock_v1','signal_brand_context_processing_lock_actor_v1','FOR UPDATE OF e,o','FOR UPDATE OF b'];
  const workerPositions=ordered(worker,lockOrder);
  assert.ok(workerPositions.every(position=>position>=0));
  assert.deepEqual(workerPositions,[...workerPositions].sort((a,b)=>a-b));
  const triggerPositions=ordered(trigger,['signal_processing_lock_v1','signal_brand_context_processing_lock_actor_v1','FOR UPDATE']);
  assert.ok(triggerPositions.every(position=>position>=0));
  assert.deepEqual(triggerPositions,[...triggerPositions].sort((a,b)=>a-b));
});
