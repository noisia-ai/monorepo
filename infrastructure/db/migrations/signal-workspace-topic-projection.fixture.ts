import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg,{type Pool,type PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1,signalWorkspaceInterpretationReferenceIdV1,buildSignalWorkspaceInterpretationBatchV1,
 type SignalTopicDefinitionV1,type SignalWorkspaceInterpretationClusterV1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as money from '../signal-workspace-engine-interpretation';
import {insertSignalTaxonomyDraftCoreV1} from '../signal-taxonomy-profile';
import {loadSignalTopicInheritedContextStoreV1,materializeSignalWorkspaceEngineTopicsV1} from '../signal-topic-catalog';
export const fixtureSha=(s:string)=>`sha256:${createHash('sha256').update(s,'utf8').digest('hex')}`;
/** Local disposable, existing 3-root complete embedding fixture. No provider or fit.
 * Construct genuine metered-receipt/catalog transactions with explicit synthetic
 * numerical memberships, kept in an outer rollback for independent consumers. */
export type WorkspaceProjectionCheckpointFixtureV1={database:Pool;query:(sql:string,params?:unknown[])=>Promise<pg.QueryResult>;
 access:{database:Pool;workspace_id:string;actor_user_id:string};lease:engine.SignalWorkspaceEngineLeaseV1;
 proposals:Array<{artifact_id:string;body:string}>;bodies:Map<string,string>};
export type WorkspaceProjectionFixtureOptionsV1={empty?:boolean;migrations?:string[];
 interpretation_definitions?:Readonly<Record<string,string>>;preserve_catalog?:boolean;model_configuration?:Record<string,unknown>;cluster_ids?:readonly[string,string];
 onMaterialized?:(profile_id:string)=>Promise<void>;
 onCheckpoint?:(fixture:WorkspaceProjectionCheckpointFixtureV1)=>Promise<void>};
export async function workspaceProjectionFixtureV1(options:WorkspaceProjectionFixtureOptionsV1={}){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.match(url.pathname,/^\/noisia_(national_import_test|projection_test)_\d+$/u);
 const pool=new pg.Pool({connectionString:url.href,ssl:false,max:1}),client=await pool.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
 const stack:string[]=[];let index=0;const query=async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const key=`projection_${++index}`;stack.push(key);return client.query(`SAVEPOINT ${key}`);}
  if(sql==='COMMIT')return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==='ROLLBACK'){const key=stack.pop()!;await client.query(`ROLLBACK TO SAVEPOINT ${key}`);return client.query(`RELEASE SAVEPOINT ${key}`);}
  return client.query(sql,params);
 };
 const scoped=Object.create(client) as PoolClient;scoped.query=query as PoolClient['query'];scoped.release=()=>{};
 const database=Object.assign(Object.create(pool) as Pool,{query:query as Pool['query'],connect:async()=>scoped});
 const workspace_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_ACTOR_ID!,embedding_run_id=process.env.NOISIA_WORKSPACE_ENGINE_TEST_EMBEDDING_ID!;
 assert.ok(workspace_id&&actor_user_id&&embedding_run_id);
 const cleanup=async()=>{await client.query('ROLLBACK');client.release();await pool.end();};
 return workspaceProjectionFixtureBodyV1({database,query,scoped,workspace_id,actor_user_id,embedding_run_id,cleanup},options);
}
/** Test-only body. The caller owns the physical transaction, target guard and synthetic
 * seed. No connection/environment lookup occurs here; historical guard stays above. */
export async function workspaceProjectionFixtureBodyV1(seed:{database:Pool;query:WorkspaceProjectionCheckpointFixtureV1['query'];
 scoped:PoolClient;workspace_id:string;actor_user_id:string;embedding_run_id:string;cleanup:()=>Promise<void>},
 options:WorkspaceProjectionFixtureOptionsV1={}){
 const {database,query,scoped,workspace_id,actor_user_id,embedding_run_id,cleanup}=seed;
 try{
 for(const name of options.migrations??[]) {assert.match(name,/^014[1-7]_[a-z_]+\.sql$/u);await query(await readFile(new URL(name,import.meta.url),'utf8'));}
 const context=await loadSignalTopicInheritedContextStoreV1({queryable:database,workspace_id,complete_context:true});
 const catalog=async(terms:SignalTopicDefinitionV1[]=[],metadata:Record<string,unknown>={})=>insertSignalTaxonomyDraftCoreV1({client:scoped,workspace_id,kind:'topic',context_hash:fixtureSha('projection-catalog'),
  terms:terms.map(topic=>({term_key:topic.term_key,label:topic.label,definition:topic.definition,status:topic.lifecycle==='archived'?'archived':'candidate',metadata:{topic}})),rules:{topics:terms},rule_set_metadata:{},provider:'operator',model_version:'local',
  prompt_hash:fixtureSha('local'),model_metadata:{},profile_metadata:{contract_version:'signal-topic-catalog-v1',...metadata},context_refs:context.context_refs});
 if(!options.preserve_catalog)await catalog();
 const access={database,workspace_id,actor_user_id};
 const preflight=await engine.loadSignalWorkspaceEnginePreflightV1(access);assert.equal(preflight.missing_guides,0);
 const configuration=SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1;
 const started=await engine.beginSignalWorkspaceEngineV1({...access,embedding_run_id,idempotency_key:randomUUID(),expected_catalog_digest:preflight.expected_catalog_digest,
  expected_context_digest:preflight.expected_context_digest,engine_config:{fixture:'native-projection-only'},parent_execution_id:null,claude_cap_micro_usd:30_000_000,
  interpretation_config:{call_configuration:configuration,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:30_000_000}});
 const lease=await engine.claimSignalWorkspaceEngineV1({database,...started,worker_job_id:'local-projection-fixture'});assert.ok(lease);
 assert.ok(lease.snapshot.expected_roots<=10,'tiny fixture only');
 const chunks:Array<Awaited<ReturnType<typeof engine.readSignalWorkspaceEngineChunksV1>>['items'][number]>=[];
 let after:Parameters<typeof engine.readSignalWorkspaceEngineChunksV1>[0]['after']=null;
 for(;;){const page=await engine.readSignalWorkspaceEngineChunksV1({database,lease,after,limit:128});chunks.push(...page.items);if(page.done)break;after=page.next_cursor;}
 const coverage={roots:lease.snapshot.expected_roots,chunks:lease.snapshot.expected_chunks,guides:lease.snapshot.expected_guides};
 await engine.heartbeatSignalWorkspaceEngineV1({database,lease,exported:{...coverage,stream_digest:fixtureSha('local-full-export')},phase:'fitting'});
 const bodies=new Map<string,string>();
 const artifact=(key:string,type:engine.SignalWorkspaceEngineArtifactV1['artifact_type'],body:string,metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>{
  const storage_key=`workspace-engine/${workspace_id}/${started.execution_id}/${key}`;bodies.set(storage_key,body);
  return{artifact_key:key,artifact_type:type,title:'Explicit synthetic projection fixture',storage_key,sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),media_type:'application/json',metadata};
 };
 const [stableOne,stableTwo]=options.cluster_ids??['stable_one','stable_two'];
 const roots=new Map<string,{root_id:string;root_fingerprint:string;chunk_count:number;open:string[];guided:string[]}>();
 for(const row of chunks){let root=roots.get(row.root_id);if(!root){root={root_id:row.root_id,root_fingerprint:row.root_fingerprint,chunk_count:0,open:options.empty?[]:[stableOne],guided:options.empty?[]:[stableTwo]};roots.set(row.root_id,root);}root.chunk_count++;}
 const rootBody=[...roots.values()].map(row=>JSON.stringify(row)+'\n').join('');
 const artifacts:Array<{file:string;sha256:string;bytes:number}>=[];
 const add=async(key:string,body:string)=>{const ref=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact(key,'engine_output',body)});artifacts.push({file:key,sha256:fixtureSha(body),bytes:Buffer.byteLength(body)});return ref;};
 await add('roots.jsonl',rootBody);
 const assignment_artifact_ids:string[]=[];
 for(const [lane,cluster] of (options.empty?[['open',stableOne]]:[['open',stableOne],['guided',stableTwo]]) as Array<[string,string]>){
  const body=chunks.map((row,ordinal)=>JSON.stringify({ordinal,root_id:row.root_id,chunk_index:row.chunk_index,start:row.start,end:row.end,chunk_sha256:row.chunk_sha256,
   stable_cluster_id:options.empty?null:cluster,local_label:options.empty?-1:0,strength:options.empty?0:0.8})+'\n').join('');assignment_artifact_ids.push((await add(`assignments.${lane}.jsonl`,body)).artifact_id);
 }
 const model=options.empty?null:await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact('model-manifest.json','engine_model',JSON.stringify({fixture:true}))});
 const outputBody=JSON.stringify({contract_version:'workspace-topic-engine-output-v1',workspace_id,quality:'uncalibrated',approval_policy:'none',counts:{occurrences:chunks.length,roots:roots.size},
  lanes:(options.empty?['open']:['open','guided']).map(lane=>({lane,assignments_file:`assignments.${lane}.jsonl`,occurrences:chunks.length,roots:roots.size,clusters:options.empty?0:1,outlier_occurrences:options.empty?chunks.length:0})),artifacts});
 const output=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact('manifest.json','engine_output',outputBody)});
 const keys=options.empty?[]:[`open:${stableOne}`,`guided:${stableTwo}`],unit_digest=fixtureSha([...keys].sort().map(key=>JSON.stringify(key)+'\n').join(''));
 await engine.checkpointSignalWorkspaceEngineFitV1({database,lease,model_artifact_id:model?.artifact_id??null,output_artifact_id:output.artifact_id,result_kind:options.empty?'insufficient_population':'computational_grouping',coverage,
  model_configuration:options.model_configuration??{fixture:true},runtime_kind:'python',artifact_format:'workspace-model-bundle-v1',license_key:'local-only',interpretation_manifest:{unit_count:keys.length,unit_digest}});
 const governed=await engine.readSignalWorkspaceEngineInterpretationContextV1({database,lease});
 const proposals:Array<{artifact_id:string;body:string}>=[];
 for(const key of keys){const row=chunks[0]!,identity={root_id:row.root_id,chunk_index:row.chunk_index,start:row.start,end:row.end,chunk_sha256:row.chunk_sha256};
  const ref_id=signalWorkspaceInterpretationReferenceIdV1(identity);
  const cluster:SignalWorkspaceInterpretationClusterV1={cluster_id:key,lane:key.startsWith('open')?'open':'guided',cluster_digest:fixtureSha(chunks.map((chunk,ordinal)=>JSON.stringify({ordinal,root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256})+'\n').join('')),root_count:roots.size,chunk_count:chunks.length,terms:['fixture conversation'],
   representatives:[{...identity,ref_id,text:row.text,strength:0.8,selection_reason:'high_affiliation'}]};
  const batch=buildSignalWorkspaceInterpretationBatchV1(governed.context,[cluster]);
  const body=JSON.stringify({contract_version:'workspace-engine-interpretation-result-v1',execution_id:started.execution_id,context:batch.context,clusters:batch.clusters,
   interpretations:[{cluster_id:key,cluster_digest:cluster.cluster_digest,status:'coherent',name:`Fixture ${key}`,definition:options.interpretation_definitions?.[key]??'Conversation evidenced by the full numerical fixture.',inclusion:[{text:'The documented conversation.',citations:[ref_id]}],exclusion:[],citations:[ref_id]}]});
  const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...access,...started,idempotency_key:randomUUID(),request_digest:batch.request_digest,configuration,
   reserved_micro_usd:batch.reserved_micro_usd,budget_timezone:'America/Mexico_City',daily_cap_micro_usd:30_000_000,execution_token:lease.execution_token});
  const token={database,call_id:call.call_id,attempt_token:call.attempt_token};
  await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
  await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${workspace_id}/${started.execution_id}/raw-${call.call_id}.json`,sha256:fixtureSha('local usage'),size_bytes:11,http_status:200,provider_request_id:null}});
  await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
  const checkpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1({database,lease,call_id:call.call_id,unit_keys:[key],artifact:artifact(`interpretation-${proposals.length}.json`,'engine_proposals',body)});
  proposals.push({artifact_id:checkpoint.artifact_id,body});
  await options.onCheckpoint?.({database,query,access,lease,proposals,bodies});
 }
 async function* pages(){yield* proposals;}
 const materialization=await materializeSignalWorkspaceEngineTopicsV1({database,lease,proposals:pages()});
 await options.onMaterialized?.(materialization.output_catalog_profile_id);
 const materialized=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact('materialization.json','engine_proposals',JSON.stringify(materialization),{
  contract_version:'workspace-topic-materialization-v1',execution_id:started.execution_id,interpretation_units_digest:unit_digest,output_catalog_profile_id:materialization.output_catalog_profile_id,
  output_catalog_revision:materialization.output_catalog_revision,topic_count:materialization.topic_count,mapping_digest:materialization.mapping_digest})});
 await engine.completeSignalWorkspaceEngineAnalysisV1({database,lease,materialization_artifact_id:materialized.artifact_id});
 return{database,query,access,workspace_id,actor_user_id,embedding_run_id,engine_execution_id:started.execution_id,roots:[...roots.values()],chunks,materialization,bodies,
  assignment_artifact_ids,materialization_artifact_id:materialized.artifact_id,catalog,cleanup};
 }catch(error){await cleanup();throw error;}
}
