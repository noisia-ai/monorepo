import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile,signalQualityPolicyDefinitionHashV1,
 signalRetentionPolicyDefinitionHashV1,signalLicensingPolicyDefinitionHashV1,signalProvenancePolicyBindingDefinitionHashV1} from '@noisia/query-engine';
import {workspaceProjectionFixtureBodyV1,fixtureSha,type WorkspaceProjectionCheckpointFixtureV1} from './signal-workspace-topic-projection.fixture';
import {requestSignalWorkspaceCorpusPreparationStoreV1,loadSignalWorkspaceCorpusPreparationStoreV1} from '../signal-workspace-corpus-preparation-management';
import {signalWorkspaceCorpusPreparationJobV1} from '../../../services/workers/src/workers/signal-workspace-corpus-preparation';
import {quoteSignalWorkspaceEmbeddingsStoreV1,requestSignalWorkspaceEmbeddingsStoreV1} from '../signal-workspace-embeddings-management';
import {quoteSignalWorkspaceTopicPrototypesV1,requestSignalWorkspaceTopicPrototypesV1} from '../signal-workspace-topic-prototypes-management';
import * as embeddings from '../signal-workspace-embeddings';
import {insertSignalTaxonomyDraftCoreV1} from '../signal-taxonomy-profile';
import {loadSignalTopicInheritedContextStoreV1} from '../signal-topic-catalog';

export const NOI19_SYNTHETIC_TEXTS=Object.freeze([
 'Synthetic fixture A: a customer describes a quiet blue bicycle and a convenient repair appointment.',
 'Synthetic fixture B: a customer describes a sturdy green bicycle and helpful repair instructions.',
 'Synthetic fixture C: a customer describes a light orange bicycle and a delayed repair appointment.',
]);
export type SyntheticTransactionV1={database:Pool;scoped:PoolClient;query:WorkspaceProjectionCheckpointFixtureV1['query'];cleanup:()=>Promise<void>};

/** No connection, credentials, files, import exports or provider are read here.
 * The dedicated runner owns target/empty-schema guards and the physical rollback.
 * These invented rights and usage receipts are TEST DATA, never product grants. */
export async function syntheticClientWorkspaceFixtureV1(tx:SyntheticTransactionV1,options:{
 identity?:{organization_id:string;brand_id:string;actor_user_id:string;workspace_id:string};
 projection?:Parameters<typeof workspaceProjectionFixtureBodyV1>[1];
}={}){
 const {database,query,scoped,cleanup}=tx;
 const org=options.identity?.organization_id??randomUUID(),brand=options.identity?.brand_id??randomUUID(),actor_user_id=options.identity?.actor_user_id??randomUUID(),source=randomUUID(),batch=randomUUID();
 if(!options.identity){
 await query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Synthetic NOI-19 test organization','active')",[org,`noi19-${org}`]);
 await query("INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES($1,$2,'Synthetic fixture operator','noisia_internal','noisia_admin',$3,'active')",[actor_user_id,`${actor_user_id}@example.test`,org]);
 await query("INSERT INTO brands(id,organization_id,slug,name,description,status) VALUES($1,$2,$3,'Synthetic bicycle brand','Invented test context; no customer data','active')",[brand,org,`noi19-${brand}`]);
 }
 const workspace_id=(await query('SELECT id FROM signal_workspaces WHERE brand_id=$1 AND organization_id=$2',[brand,org])).rows[0]?.id as string;
 assert.ok(workspace_id,'brand provisioning trigger must create a workspace');
 await query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,source_key,status)
 VALUES($1,$2,$3,$4,'social_listening','synthetic','manual','Synthetic fixture source',$5,'active')`,[source,workspace_id,org,brand,`source-sha256-${fixtureSha(source).slice(7)}`]);
 await query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,status,
 record_count,included_count,excluded_count,duplicate_count,imported_by_user_id)
 VALUES($1,$2,$3,'synthetic','invented-three-roots.txt',$4,'completed',3,3,0,0,$5)`,[batch,workspace_id,source,fixtureSha(NOI19_SYNTHETIC_TEXTS.join('\n')),actor_user_id]);
 for(const [index,text] of NOI19_SYNTHETIC_TEXTS.entries()){
  const root=randomUUID();
  await query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,source_system,
   source_file_id,text_hash,text_raw,text_clean,text_length,published_at,platform,resolved_platform,language,inclusion_status)
   VALUES($1,$2,$3,$1,$4,$4,'synthetic',$5,$6,$7,$7,$8,'2026-09-01T12:00:00Z','synthetic','synthetic','en','included')`,
   [root,workspace_id,source,`noi19-${root}-${index}`,batch,fixtureSha(text),text,text.length]);
  await query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id,ingestion_disposition)
   VALUES($1,$2,$3,$4,'included') ON CONFLICT(mention_id,import_batch_id) DO NOTHING`,[workspace_id,root,batch,source]);
 }
 const quality=randomUUID(),retention=randomUUID(),license=randomUUID();
 const q={workspace_id,policy_key:'noi19-synthetic-quality',policy_version:1,min_quality_score:null,
  required_quality_flags:[],forbidden_quality_flags:[],canonical_root_disposition:'evaluate' as const};
 await query(`INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
 canonical_root_disposition,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
 VALUES($1,$2,$3,$4,1,'active','evaluate',$5,$6,$6,now(),$7)`,[quality,org,workspace_id,q.policy_key,signalQualityPolicyDefinitionHashV1(q),actor_user_id,fixtureSha('synthetic quality')]);
 const r={workspace_id,policy_key:'noi19-synthetic-retention',policy_version:1,retention_state:'allowed' as const,
  retention_mode:'indefinite' as const,retain_until:null,expiry_action:'block_use' as const,approval_evidence_hash:fixtureSha('invented retention evidence')};
 await query(`INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,policy_version,status,retention_state,
 retention_mode,expiry_action,approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
 VALUES($1,$2,$3,$4,1,'active','allowed','indefinite','block_use',$5,$6,$7,$7,now(),$8)`,
 [retention,org,workspace_id,r.policy_key,r.approval_evidence_hash,signalRetentionPolicyDefinitionHashV1(r),actor_user_id,fixtureSha('synthetic retention')]);
 const l={workspace_id,policy_key:'noi19-synthetic-license',policy_version:1,approval_evidence_hash:fixtureSha('invented license evidence'),
 usages:(['llm-processing','client-derived-metrics','client-mention-list','client-text-or-excerpt'] as const).map(usage_purpose=>({usage_purpose,decision:'allowed' as const}))};
 await query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,approval_evidence_hash,
 definition_hash,created_by_user_id,creation_idempotency_key) VALUES($1,$2,$3,$4,1,'draft',$5,$6,$7,$8)`,
 [license,org,workspace_id,l.policy_key,l.approval_evidence_hash,signalLicensingPolicyDefinitionHashV1(l),actor_user_id,fixtureSha('synthetic license')]);
 for(const usage of l.usages)await query("INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision) VALUES($1,$2,$3,'allowed')",[workspace_id,license,usage.usage_purpose]);
 await query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1",[license,actor_user_id]);
 const b={workspace_id,data_source_id:source,import_batch_id:null,binding_version:1,quality_policy_id:quality,retention_policy_id:retention,licensing_policy_id:license};
 await query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,binding_version,status,quality_policy_id,
 retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
 VALUES($1,$2,1,'active',$3,$4,$5,$6,$7,$7,now(),$8)`,[workspace_id,source,quality,retention,license,signalProvenancePolicyBindingDefinitionHashV1(b),actor_user_id,fixtureSha('synthetic binding')]);
 const access={database,workspace_id,actor_user_id};
 const prep=await requestSignalWorkspaceCorpusPreparationStoreV1({...access,idempotency_key:randomUUID()});
 const prepJob=(await query('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1',[prep.run_id])).rows[0]!.worker_job_id;
 await signalWorkspaceCorpusPreparationJobV1({id:prepJob,data:{run_id:prep.run_id},updateProgress:async()=>{}},{database,page_size:3});
 const prepared=await loadSignalWorkspaceCorpusPreparationStoreV1({queryable:database,workspace_id});
 assert.equal(prepared.is_current,true);assert.equal(prepared.latest_completed?.counts.eligible_roots,3);
 const quoted=await quoteSignalWorkspaceEmbeddingsStoreV1({...access,profile});
 const embedded=await requestSignalWorkspaceEmbeddingsStoreV1({...access,profile,preparation_run_id:quoted.preparation_run_id,
  quote_digest:quoted.quote_digest,idempotency_key:randomUUID(),hard_cap_micro_usd:1_000_000,provider_available:true});
 await embedSyntheticRunV1(tx,embedded.run_id);
 const context=await loadSignalTopicInheritedContextStoreV1({queryable:database,workspace_id,complete_context:true});
 await insertSignalTaxonomyDraftCoreV1({client:scoped,workspace_id,kind:'topic',context_hash:fixtureSha('synthetic-empty-catalog'),terms:[],rules:{topics:[]},
  rule_set_metadata:{},provider:'operator',model_version:'synthetic-test',prompt_hash:fixtureSha('synthetic'),model_metadata:{},
  profile_metadata:{contract_version:'signal-topic-catalog-v1'},context_refs:context.context_refs});
 const guides=await quoteSignalWorkspaceTopicPrototypesV1(access);
 const requested=await requestSignalWorkspaceTopicPrototypesV1({...access,idempotency_key:randomUUID(),plan_digest:guides.plan_digest,
  quote_digest:guides.quote_digest,hard_cap_micro_usd:1_000_000,max_run_cost_micro_usd:1_000_000,provider_available:true});
 await embedSyntheticRunV1(tx,requested.run_id);
 // No migrations: the private runner requires the restored current schema. The
 // existing projection body uses real guards/receipts with explicit numerical data.
 return workspaceProjectionFixtureBodyV1({...tx,workspace_id,actor_user_id,embedding_run_id:embedded.run_id},options.projection);
}
async function embedSyntheticRunV1(tx:SyntheticTransactionV1,run_id:string){
 const {database,query}=tx;
 const worker_job_id=(await query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[run_id])).rows[0]!.worker_job_id;
 let lease=await embeddings.claimSignalWorkspaceEmbeddingRunV1({database,run_id,worker_job_id});assert.ok(lease);
 for(let page=0;;page++){
  assert.ok(page<8,'tiny synthetic fixture must remain bounded');
  const batch=await embeddings.readSignalWorkspaceEmbeddingBatchV1({database,lease});if(!batch.items.length)break;
  const call=await embeddings.reserveSignalWorkspaceEmbeddingCallV1({database,lease,batch});
  if(call){
   const vectors=batch.inputs.map(input=>({chunk_sha256:input.chunk_sha256,embedding:Array.from({length:1024},(_,index)=>index===0?1:0)}));
   await embeddings.markSignalWorkspaceEmbeddingCallSentV1({database,lease,call_id:call.call_id,attempt_token:call.attempt_token});
   await embeddings.persistSignalWorkspaceEmbeddingResponseV1({database,call_id:call.call_id,attempt_token:call.attempt_token,
    response:{http_status:200,provider_request_id:'synthetic-no-transport',body:JSON.stringify({model:profile.model,usage:{total_tokens:vectors.length},
     data:vectors.map((vector,index)=>({index,embedding:vector.embedding}))})}});
   lease=await embeddings.commitSignalWorkspaceEmbeddingBatchV1({database,lease,batch,call_id:call.call_id,attempt_token:call.attempt_token,
    validated:{vectors,total_tokens:vectors.length,provider_request_id:'synthetic-no-transport'}});
  }else lease=await embeddings.commitSignalWorkspaceEmbeddingBatchV1({database,lease,batch,call_id:null});
  if(batch.done)break;
 }
 await embeddings.finishSignalWorkspaceEmbeddingsV1({database,lease});
}
