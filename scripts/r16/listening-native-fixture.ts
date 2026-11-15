import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {runMassLabelingAcceptanceFixtureV1} from '../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../infrastructure/db/signal-listening-configuration';
import {prepareSignalListeningV1} from '../../infrastructure/db/signal-listening-preparation';
import type {R16ListeningFixtureV1} from './run-listening-benchmark';
import type {r16ListeningWorkloadV1} from './listening-workload';
import type {WorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';

type Access=R16ListeningFixtureV1['access'];
/** The census hook is implemented/reviewed by the native DB owner. No SQL scope
 * or answer projection is invented here. Discovered topics need their own native
 * preparation owner; do not publish fake prototypes to enable that optional arm. */
export function createR16ListeningNativeFixtureV1(options:{
 decorateDatabase?:(database:Access['database'])=>Access['database'];
 loadNativeCensus(access:Access&{run_id:string}):Promise<Pick<R16ListeningFixtureV1,'organization_id'|'root_ids'|'readResolvedRootIds'>>;
}){
 return async function withNativeFixture<T>(context:{workload:ReturnType<typeof r16ListeningWorkloadV1>;storage:WorkspaceEngineStorageV1},run:(fixture:R16ListeningFixtureV1)=>Promise<T>):Promise<T>{
  if(context.workload.arm!=='defined_consumer_second_pass')throw Error('r16_discovered_arm_requires_native_prototype_owner');
  let result:{value:T}|undefined;
  await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:32768,execution_cap_micro_usd:20000000,
   import_batch_size:512,preparation_page_size:100,embedding_page_limit:264,
   beforeProcessing:async ctx=>{
    const database=options.decorateDatabase?.(ctx.database)??ctx.database;
    // Fixture-only cancellation authorized by the orchestrator. This exact
    // queued legacy run must have zero calls; never cancel another execution.
    const canceled=await database.query(`UPDATE signal_labeling_runs r SET status='canceled' WHERE r.id=$1
      AND r.workspace_id=$2 AND r.status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls c WHERE c.run_id=r.id) RETURNING r.id`,[ctx.run_id,ctx.workspace_id]);
    assert.equal(canceled.rows.length,1,'only the fixture queued Mass run with zero calls may be canceled');
    const access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
    const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:context.workload.configuration});
    const admission_started_at_ms=performance.now();
    const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
     idempotency_key:`r16-listening-benchmark:${randomUUID()}`,cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false});
    assert.ok(prepared.status==='labeling'&&prepared.run_id,'native preparation must admit a Listening run; no handwritten admission');
    const binding={...access,configuration_id:cfg.id,map_id:ctx.map_id,question_key:'voice'};
    const census=await options.loadNativeCensus({...binding,run_id:prepared.run_id});
    result={value:await run({...census,access:binding,run_id:prepared.run_id,admission_started_at_ms})};
   }}});
  assert.ok(result,'native fixture callback did not run');return result.value;
 };
}
