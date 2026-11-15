import assert from 'node:assert/strict';
import {labelerDigestV1,signalListeningJevIdentityV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type LabelerIdentity} from '../../packages/query-engine/src/index';
import {authorizeSignalListeningV1,listeningTransactionV1,loadSignalListeningConfigurationWithClientV1,
 type SignalListeningAccessV1} from '../../infrastructure/db/signal-listening-configuration';
import {assertMassLabelingMapCurrentV1} from '../../infrastructure/db/signal-mass-labeling';

type Access=SignalListeningAccessV1&{configuration_id:string;map_id:string;run_id:string};
type CensusRow={root_id:string;question_count:number;resolved:boolean};

/** Read-only benchmark witness. The admitted Listening owner and native
 * population decide eligibility/completion; physical calls are never roots.
 * No admission, cache answer, profile or serving projection is written here. */
export async function loadR16ListeningNativeCensusV1(access:Access,expected_root_count=32768){
 assert.ok(Number.isSafeInteger(expected_root_count)&&expected_root_count>0,'r16_listening_census_count_invalid');
 const read=async(roots:string[]|null)=>listeningTransactionV1(access.database,async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await authorizeSignalListeningV1(c,access,'view');
  const cfg=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id,access.configuration_id);
  const current=await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id);
  assert.ok(cfg&&cfg.state==='published'&&current?.id===cfg.id,'r16_listening_census_configuration_changed');
  assert.equal(digest(cfg.configuration),cfg.configuration_digest,'r16_listening_census_configuration_digest');
  await assertMassLabelingMapCurrentV1(c,access.workspace_id,access.map_id);
  const owner=(await c.query<{organization_id:string;entity_context_digest:string;configuration_digest:string;
   concept_set_digest:string;identity:LabelerIdentity;labeler_digest:string;membership_snapshot:{configuration_id:string;map_id:string}}>(`
   SELECT w.organization_id,r.entity_context_digest,o.configuration_digest,r.concept_set_digest,l.identity,l.labeler_digest,r.membership_snapshot
   FROM signal_listening_runs o JOIN signal_labeling_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id
   JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
   JOIN signal_workspaces w ON w.id=r.workspace_id
   JOIN signal_mass_labeling_maps m ON m.id=o.map_id AND m.workspace_id=o.workspace_id AND m.entity_context_digest=r.entity_context_digest
   WHERE o.workspace_id=$1 AND o.configuration_id=$2 AND o.map_id=$3 AND o.run_id=$4 AND r.actor_user_id=$5`,
   [access.workspace_id,access.configuration_id,access.map_id,access.run_id,access.actor_user_id])).rows[0];
  assert.ok(owner,'r16_listening_census_owner_unavailable');
  assert.equal(owner.configuration_digest,cfg.configuration_digest,'r16_listening_census_owner_digest');
  assert.equal(owner.concept_set_digest,cfg.configuration_digest,'r16_listening_census_run_digest');
  assert.equal(owner.membership_snapshot?.configuration_id,cfg.id,'r16_listening_census_run_configuration');
  assert.equal(owner.membership_snapshot?.map_id,access.map_id,'r16_listening_census_run_map');
  const identity=signalListeningJevIdentityV1(cfg.configuration);
  assert.equal(owner.identity.params.request_version,'listening-jev-v1','r16_listening_census_not_listening');
  assert.equal(labelerDigestV1(owner.identity),labelerDigestV1(identity),'r16_listening_census_identity');
  assert.equal(owner.labeler_digest,labelerDigestV1(identity),'r16_listening_census_labeler_digest');
  const rows=await population(c,roots,owner.entity_context_digest);
  assert.ok(rows.every(row=>row.question_count===cfg.configuration.questions.length),'r16_listening_census_missing_question');
  return{organization_id:owner.organization_id,rows};
 });
 const population=async(c:Parameters<typeof authorizeSignalListeningV1>[0],roots:string[]|null,context:string)=>
  (await c.query<CensusRow>(`/* r16_listening_native_complete_roots_v1 */
   SELECT root_id,count(DISTINCT question_key)::int question_count,
    COALESCE(bool_and(NOT candidate OR scope_state='excluded' OR (scope_state='included' AND answer IS NOT NULL)),false) resolved
   FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],'client-derived-metrics')
   GROUP BY root_id ORDER BY root_id`,[access.workspace_id,access.configuration_id,access.map_id,context,roots])).rows;
 const initial=await read(null),roster=initial.rows.map(row=>row.root_id),expected=new Set(roster);
 assert.equal(expected.size,expected_root_count,'r16_listening_census_population_count');
 assert.equal(roster.length,expected.size,'r16_listening_census_duplicate_root');
 return{organization_id:initial.organization_id,root_ids:[...roster],
  async readResolvedRootIds(root_ids?:string[]):Promise<string[]>{
   if(root_ids!==undefined){
    assert.ok(root_ids.length>0&&root_ids.length<=1024,'r16_listening_census_batch_bounds');
    assert.equal(new Set(root_ids).size,root_ids.length,'r16_listening_census_duplicate_request');
    assert.ok(root_ids.every(id=>expected.has(id)),'r16_listening_census_foreign_root');
   }
   const result=await read(root_ids??null),requested=new Set(root_ids??roster);
   assert.equal(result.organization_id,initial.organization_id,'r16_listening_census_organization_changed');
   assert.equal(result.rows.length,requested.size,'r16_listening_census_population_changed');
   assert.ok(result.rows.every(row=>requested.has(row.root_id)),'r16_listening_census_population_changed');
   return result.rows.filter(row=>row.resolved).map(row=>row.root_id);
  }};
}
