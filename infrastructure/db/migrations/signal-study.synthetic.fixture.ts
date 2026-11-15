import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{withDiscoveryAdvanceFixtureV1}from'./signal-listening-discovery-advance.synthetic.fixture';
import{enqueueSignalListeningDiscoveryRoundV1,activateSignalListeningServingSnapshotV1}from'../signal-listening-discovery-money';
import{ensureSignalStudyCorpusV1,saveSignalStudyConfigurationV1}from'../signal-study-configuration';
import{requestSignalStudyExecutionV1}from'../signal-study-executions';
import{SIGNAL_STUDY_TB_TEMPLATE_V1,SIGNAL_STUDY_TB_ROLES_V1,createSignalStudyTemplateSnapshotV1,buildSignalStudyExecutionConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningConfigurationV1,type SignalStudyV1}from'@noisia/query-engine';
export async function withSignalStudyFixtureV1(fn:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>,options:{population_count?:number}={}){
 await withDiscoveryAdvanceFixtureV1(async f=>fn(await seed(f)),options);
}
async function seed(f:Parameters<Parameters<typeof withDiscoveryAdvanceFixtureV1>[0]>[0]){
 const db=f.database,access={database:db,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const round=await enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:f.execution.id,generation_id:f.confirmed.id,orphan_groups:[],provider_available:true});
 assert.equal((await f.finishRound(round)).status,'completed');
 const listeningSnapshot=await activateSignalListeningServingSnapshotV1({...access,round_id:round.id});
 const serving=(await db.query('SELECT * FROM signal_listening_serving_snapshots WHERE id=$1',[listeningSnapshot.id])).rows[0]!;
 const listening=(await db.query<{id:string;configuration_digest:string;configuration:SignalListeningConfigurationV1}>('SELECT * FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2',[serving.configuration_id,f.workspace_id])).rows[0]!;
 // Legitimate synthetic organization policy, never a test admission bypass.
 const prior=(await db.query('SELECT * FROM signal_processing_policy_versions WHERE id=$1',[f.policy.id])).rows[0]!;
 const policy=(await db.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
  SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[prior.id])).rows[0]!;
 await db.query('INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1',[prior.id,policy.id]);
 await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
  SELECT $1,'study_analysis','provider','anthropic','claude-sonnet-4-6',c,signal_labeling_digest_v1(c),10000000,false FROM(SELECT signal_study_analysis_configuration_v1() c)x`,[policy.id]);
 await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[prior.id]);await db.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy.id]);
 const corpus=await ensureSignalStudyCorpusV1(access);
 // The explicit external snapshot is stored data; the worker cannot substitute
 // its internal default even though this synthetic fixture starts from the seed.
 const template={...structuredClone(SIGNAL_STUDY_TB_TEMPLATE_V1),version:'synthetic-external-r16',instructions:'Stored synthetic study instructions for {{subject}}.'};
 const template_snapshot=createSignalStudyTemplateSnapshotV1({template,roles:SIGNAL_STUDY_TB_ROLES_V1,provenance:'human',revision:1,human_locked:false});
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id:f.workspace_id,corpus_id:corpus.id,listening_configuration_id:listening.id,listening_configuration_digest:listening.configuration_digest,
  methodology:{key:'triggers_barriers',version:template.version,template_digest:template_snapshot.template_digest},subject:{kind:'category',name:'bicycles',category:'bicycles',own_brand:'Synthetic',competitors:[],alternatives:[]},business_question:'Which synthetic forces explain the configured choice?',
  cut:{start_at:'2020-01-01T00:00:00Z',end_at:'2030-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:1};
 const envelope=buildSignalStudyExecutionConfigurationV1({study,template_snapshot,source_listening:{configuration_id:listening.id,configuration_digest:listening.configuration_digest,configuration:listening.configuration}});
 const cfg=await saveSignalStudyConfigurationV1({...access,expected_revision:0,configuration:envelope,listening_snapshot_id:listeningSnapshot.id,provenance:'human'});
 const request=(cap_micro_usd=4000000,idempotency_key=randomUUID())=>requestSignalStudyExecutionV1({...access,configuration_id:cfg.id,idempotency_key,cap_micro_usd});
 const createStudy=async()=>{const configuration=await saveSignalStudyConfigurationV1({...access,expected_revision:0,configuration:envelope,listening_snapshot_id:listeningSnapshot.id,provenance:'human'});return{configuration,request:(cap_micro_usd=4000000,idempotency_key=randomUUID())=>requestSignalStudyExecutionV1({...access,configuration_id:configuration.id,cap_micro_usd,idempotency_key})};};
 return{...f,...access,corpus,study,template_snapshot,envelope,cfg,listening,listeningSnapshot,policy,request,digest,createStudy};
}
export type SignalStudySyntheticFixtureV1=Awaited<ReturnType<typeof seed>>;
