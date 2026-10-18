import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { seedComposedFixture, quoteComposedFixture, startComposedFixture, semanticConfiguration,
  composedBundleCounts } from './signal-brand-context-composed.fixture';

const hash=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
test('classic composed preparation preserves optional strict maxima through quote, admission, reservation, settlement and unsent cancellation', {
  skip:process.env.NOISIA_MFP_PG_CI!=='true', timeout:120_000,
}, async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'});
  try{
    assert.equal((await pool.query('SELECT current_database() name')).rows[0].name,'noisia_mfp_ci');
    const fixture=await seedComposedFixture(pool,'optional-caps',{optionalStrictCaps:true});
    const quote=await quoteComposedFixture(pool,fixture);
    assert.equal(quote.quote_status,'quoted'); assert.equal(quote.maximum_total_micro_usd,null);
    assert.equal(quote.remaining_micro_usd,null);
    assert.deepEqual(quote.actions.map(x=>x.max_execution_micro_usd),[null,null]);
    const configuration={...semanticConfiguration,platform_hard_cap_micro_usd:null};
    const started=await startComposedFixture(pool,fixture,quote.quote_digest!,'classic-null-cap-start',configuration as typeof semanticConfiguration);
    const before=await composedBundleCounts(pool,fixture.workspaceId);
    assert.equal((await startComposedFixture(pool,fixture,quote.quote_digest!,'classic-null-cap-start',configuration as typeof semanticConfiguration)).replayed,true);
    assert.deepEqual(await composedBundleCounts(pool,fixture.workspaceId),before);
    const row=(await pool.query(`SELECT run.hard_cap_micro_usd::text,run.reservation_micro_usd::text,
      receipt.semantic_cap_micro_usd::text,receipt.prototype_cap_micro_usd::text,
      admission.execution_cap_micro_usd::text FROM signal_semantic_context_proposal_runs run
      JOIN signal_brand_context_processing_receipts receipt ON receipt.semantic_run_id=run.id
      JOIN signal_processing_admissions admission ON admission.id=run.processing_admission_id WHERE run.id=$1`,[started.run_id])).rows[0];
    assert.equal(row.hard_cap_micro_usd,null); assert.equal(row.semantic_cap_micro_usd,null);
    assert.equal(row.prototype_cap_micro_usd,null); assert.equal(row.execution_cap_micro_usd,null);
    assert.ok(BigInt(row.reservation_micro_usd)>0n,'reservation is still an exact token-based exposure');
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='processing',started_at=clock_timestamp(),
      provider_call_state='in_flight',provider_call_count=1 WHERE id=$1`,[started.run_id]);
    const raw='{"synthetic":true}';
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='response_persisted',
      provider_response_private=$2,provider_response_digest=$3 WHERE id=$1`,[started.run_id,raw,hash(raw)]);
    await pool.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',input_tokens=1,output_tokens=1,
      actual_micro_usd=18,settled_at=clock_timestamp() WHERE run_id=$1`,[started.run_id]);
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='settled',
      input_tokens=1,output_tokens=1,settled_micro_usd=18 WHERE id=$1`,[started.run_id]);
    assert.equal((await pool.query('SELECT actual_micro_usd::text amount FROM signal_semantic_context_budget_reservations WHERE run_id=$1',[started.run_id])).rows[0].amount,'18');
    const canceled=await seedComposedFixture(pool,'optional-cancel',{optionalStrictCaps:true});
    const cancelQuote=await quoteComposedFixture(pool,canceled);
    const cancelRun=await startComposedFixture(pool,canceled,cancelQuote.quote_digest!,'classic-null-cap-cancel',configuration as typeof semanticConfiguration);
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',stale_at=clock_timestamp(),
      error_code='fixture_source_changed' WHERE id=$1`,[cancelRun.run_id]);
    await pool.query(`UPDATE signal_semantic_context_budget_reservations SET status='released',released_at=clock_timestamp(),
      release_reason='fixture_source_changed' WHERE run_id=$1`,[cancelRun.run_id]);
    assert.deepEqual((await pool.query('SELECT provider_call_count,provider_call_state FROM signal_semantic_context_proposal_runs WHERE id=$1',[cancelRun.run_id])).rows[0],{provider_call_count:0,provider_call_state:'not_started'});
    const capped=await seedComposedFixture(pool,'explicit-caps'); const capQuote=await quoteComposedFixture(pool,capped);
    assert.equal(capQuote.maximum_total_micro_usd,'1100000');
    await assert.rejects(startComposedFixture(pool,capped,capQuote.quote_digest!,'classic-explicit-runtime-cap',
      {...semanticConfiguration,platform_hard_cap_micro_usd:1n}),error=>(error as {code?:string}).code==='brand_context_processing_runtime_drift');
  }finally{await pool.end();}
});
