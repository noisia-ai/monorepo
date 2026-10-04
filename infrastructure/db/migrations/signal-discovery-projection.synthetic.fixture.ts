import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {buildSignalWorkspaceInterpretationBatchV1,signalWorkspaceInterpretationReferenceIdV1,
 SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as money from '../signal-workspace-engine-interpretation';
import {materializeSignalWorkspaceEngineTopicsV1} from '../signal-topic-catalog';
import {requestSignalWorkspaceTopicProjectionV1} from '../signal-workspace-topic-projection';

/** Synthetic interpretation receipt and catalogue only; no HTTP or Python.
 * The caller rolls this entire fixture back before continuing the money tests. */
export async function exerciseDiscoveryProjectionV1(args:{database:Pool;lease:engine.SignalWorkspaceEngineLeaseV1;
 actor_user_id:string;budget_timezone:string;daily_cap_micro_usd:number|null}){
 const {database,lease,actor_user_id}=args,workspace_id=lease.workspace_id,execution_id=lease.execution_id;
 const sha=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
 const access={database,workspace_id,actor_user_id,execution_id};
 const governed=await engine.readSignalWorkspaceEngineInterpretationContextV1({database,lease});
 const page=await engine.readSignalWorkspaceEngineChunksV1({database,lease,after:null,limit:1}),row=page.items[0]!;
 const identity={root_id:row.root_id,chunk_index:row.chunk_index,start:row.start,end:row.end,chunk_sha256:row.chunk_sha256};
 const ref_id=signalWorkspaceInterpretationReferenceIdV1(identity),key='open:fixture';
 const cluster={cluster_id:key,lane:'open' as const,cluster_digest:sha('synthetic grouping'),root_count:lease.snapshot.expected_roots,
  chunk_count:lease.snapshot.expected_chunks,terms:['Synthetic grouping'],representatives:[{...identity,ref_id,text:row.text,strength:0.8,selection_reason:'high_affiliation' as const}]};
 const batch=buildSignalWorkspaceInterpretationBatchV1(governed.context,[cluster]);
 const body=JSON.stringify({contract_version:'workspace-engine-interpretation-result-v1',execution_id,context:batch.context,clusters:batch.clusters,
  interpretations:[{cluster_id:key,cluster_digest:cluster.cluster_digest,status:'coherent',name:'Synthetic projection',
   definition:'Explicit synthetic interpretation used only to verify native projection admission.',
   inclusion:[{text:'The documented fixture conversation.',citations:[ref_id]}],exclusion:[],citations:[ref_id]}]});
 const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...access,idempotency_key:randomUUID(),request_digest:batch.request_digest,
  configuration,reserved_micro_usd:batch.reserved_micro_usd,budget_timezone:args.budget_timezone,daily_cap_micro_usd:args.daily_cap_micro_usd,execution_token:lease.execution_token});
 const token={database,call_id:call.call_id,attempt_token:call.attempt_token};
 await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
 await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${workspace_id}/${execution_id}/fixture-raw.json`,
  sha256:sha('synthetic usage'),size_bytes:15,http_status:200,provider_request_id:null}});
 await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
 const artifact=(artifact_key:string,content:string,metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>({artifact_key,
  artifact_type:'engine_proposals',title:'Synthetic rollback-only projection',storage_key:`workspace-engine/${workspace_id}/${execution_id}/${artifact_key}`,
  sha256:sha(content),size_bytes:Buffer.byteLength(content),media_type:'application/json',metadata});
 const checkpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1({database,lease,call_id:call.call_id,unit_keys:[key],artifact:artifact('fixture-interpretation.json',body)});
 async function* pages(){yield{artifact_id:checkpoint.artifact_id,body};}
 const materialization=await materializeSignalWorkspaceEngineTopicsV1({database,lease,proposals:pages()});
 const materialized=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact('materialization.json',JSON.stringify(materialization),{
  contract_version:'workspace-topic-materialization-v1',execution_id,interpretation_units_digest:sha(JSON.stringify(key)+'\n'),
  output_catalog_profile_id:materialization.output_catalog_profile_id,output_catalog_revision:materialization.output_catalog_revision,
  topic_count:materialization.topic_count,mapping_digest:materialization.mapping_digest})});
 await engine.completeSignalWorkspaceEngineAnalysisV1({database,lease,materialization_artifact_id:materialized.artifact_id});
 const request={database,workspace_id,actor_user_id,engine_execution_id:execution_id,idempotency_key:`workspace-projection:${execution_id}`};
 const projected=await requestSignalWorkspaceTopicProjectionV1(request);
 assert.equal(projected.replayed,true);
 assert.equal((await requestSignalWorkspaceTopicProjectionV1(request)).execution_id,projected.execution_id);
 const owner=(await database.query(`SELECT actor_user_id,input_contract FROM signal_topic_catalog_executions WHERE id=$1`,[projected.execution_id])).rows[0];
 assert.equal(owner.actor_user_id,actor_user_id);assert.equal(owner.input_contract,'workspace-topic-classification-v1');
 assert.equal((await database.query('SELECT count(*)::int n FROM signal_topic_classification_outbox WHERE execution_id=$1',[projected.execution_id])).rows[0].n,1);
}
