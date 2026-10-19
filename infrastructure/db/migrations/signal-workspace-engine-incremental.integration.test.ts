import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {signalWorkspaceIncrementalDigestV1 as digest, type SignalWorkspaceIncrementalInputV1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as incremental from '../signal-workspace-engine-incremental';
import {workspaceProjectionFixtureV1,fixtureSha} from './signal-workspace-topic-projection.fixture';
const enabled=process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED==='true';
const migrations=['0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql','0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql'];

test('incremental numeric child accepts paid partial parent without changing its costs or authorizing interpretation', {skip:!enabled,timeout:90_000},async()=>{
 const finished=new Error('local numeric gate finished');let passed=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations,model_configuration:{fixture:true,versions:{python:'local-PG-contract-fixture'}},onCheckpoint:async f=>{
  await f.query(await readFile(new URL('./0145_signal_workspace_incremental_numeric.sql',import.meta.url),'utf8'));
  const privateFunctions=(await f.query(`SELECT count(*)::int n,bool_and(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, extensions, pg_temp']
   AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) valid
   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'signal_workspace_incremental_%' OR p.proname LIKE 'guard_workspace_incremental_%')`)).rows[0]!;
  assert.equal(privateFunctions.n,11);assert.equal(privateFunctions.valid,true);
  const source=f.lease,workspace_id=f.access.workspace_id,parentId=source.execution_id;
  const artifact=(lease:engine.SignalWorkspaceEngineLeaseV1,name:string,type:engine.SignalWorkspaceEngineArtifactV1['artifact_type'],body:string,
   metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>({artifact_key:name,artifact_type:type,title:'Explicit local numeric SQL fixture',
    storage_key:`workspace-engine/${workspace_id}/${lease.execution_id}/${name}`,sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),media_type:'application/octet-stream',metadata:{filename:name,...metadata}});
  await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease:source,artifact:artifact(source,'guide-vectors.npy','engine_output','local guide bytes')});
  const modelBody='local opaque model; never deserialized',modelSha=fixtureSha(modelBody);
  const originalModel=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease:source,artifact:artifact(source,'model.open.joblib','engine_model',modelBody)});
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease:source,error_code:'workspace_engine_interpretation_daily_authority_expired'});
  const parentBefore=(await f.query('SELECT to_jsonb(execution) body FROM signal_topic_catalog_executions execution WHERE id=$1::uuid',[parentId])).rows[0]!.body;
  const costsBefore=(await f.query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[parentId])).rows;
  const editorialBefore=await engine.loadSignalWorkspaceEngineStatusV1(f.access);
  const start={...f.access,idempotency_key:randomUUID(),embedding_run_id:source.snapshot.embedding_run_id,
   expected_context_digest:source.snapshot.context_digest,expected_catalog_digest:source.snapshot.catalog_digest,engine_config:source.snapshot.engine_config,close_requested:false};
  const request=await incremental.beginSignalWorkspaceIncrementalEngineV1(start);
  assert.equal((await incremental.beginSignalWorkspaceIncrementalEngineV1(start)).replayed,true);
  await assert.rejects(incremental.beginSignalWorkspaceIncrementalEngineV1({...start,close_requested:true}),/idempotency_conflict/u);
  const lease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...request,worker_job_id:`workspace-engine-${request.execution_id}-1`});assert.ok(lease);
  const descriptor=lease.snapshot.numeric_descriptor!;assert.equal(descriptor.parent.execution_id,parentId);
  const roots=await incremental.readSignalWorkspaceIncrementalRootsV1({database:f.database,lease,after_root_id:null});assert.equal(roots.items.length,3);assert.equal(roots.done,true);
  assert.equal(roots.items.reduce((n,row)=>n+row.expected_chunks,0),133);
  const empty=await incremental.readSignalWorkspaceIncrementalRootsV1({database:f.database,lease,after_root_id:roots.next_cursor});assert.deepEqual(empty.items,[]);assert.equal(empty.done,true);
  const parentFiles=await incremental.readSignalWorkspaceIncrementalParentArtifactsV1({database:f.database,lease});assert.ok(parentFiles.items.some(row=>row.artifact_id===originalModel.artifact_id));
  const history=await incremental.readSignalWorkspaceIncrementalEditorialHistoryV1({database:f.database,lease});assert.equal(history.items.length,1);assert.equal(history.parent_history,null);
  const rootBody=roots.items.map(root=>JSON.stringify(root)+'\n').join('');
  const input:SignalWorkspaceIncrementalInputV1={contract_version:'workspace-topic-incremental-input-v1',workspace_id,execution_id:lease.execution_id,
   mode:'frozen-model-delta',policy_version:'workspace-frozen-model-cohort-v1',current_input_manifest:{file:'manifest.json',sha256:fixtureSha('input manifest'),bytes:14},
   current_roots:{file:'current-roots.jsonl',sha256:fixtureSha(rootBody),bytes:Buffer.byteLength(rootBody),rows:3},parent:{execution_id:parentId,manifest_sha256:descriptor.parent.manifest_sha256},
   compatibility:descriptor.compatibility,discovery:{cohort_key:fixtureSha('explicit local cohort key; validator tested separately'),close_requested:false}};
  const inputFiles=['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','current-roots.jsonl'].map(name=>({name,
   storage_key:`workspace-engine/${workspace_id}/${lease.execution_id}/input/${name}`,
   sha256:name==='manifest.json'?input.current_input_manifest.sha256:name==='current-roots.jsonl'?input.current_roots.sha256:fixtureSha(name),
   size_bytes:name==='manifest.json'?input.current_input_manifest.bytes:name==='current-roots.jsonl'?input.current_roots.bytes:1,media_type:'application/octet-stream'}));
  const inputArgs={database:f.database,lease,input,roots_count:3,chunks_count:133,input_files:inputFiles,artifact:artifact(lease,'incremental-input.json','engine_output',JSON.stringify(input))};
  await assert.rejects(incremental.persistSignalWorkspaceIncrementalInputV1({...inputArgs,input_files:inputFiles.slice(1)}),/input_files_invalid/u);
  const savedInput=await incremental.persistSignalWorkspaceIncrementalInputV1(inputArgs);assert.equal((await incremental.persistSignalWorkspaceIncrementalInputV1(inputArgs)).artifact_id,savedInput.artifact_id);
  assert.equal((await incremental.readSignalWorkspaceIncrementalCheckpointV1({database:f.database,lease})).input_artifact?.artifact_id,savedInput.artifact_id);
  assert.equal((await incremental.readSignalWorkspaceIncrementalCheckpointV1({database:f.database,lease})).numeric_checkpoint,null);
  const componentKey=digest([parentId,modelSha,'open']),population=fixtureSha('explicit complete local population');
  const units=[{local_label:0,unit_key:`open:${randomUUID()}`,birth_membership_digest:fixtureSha('original membership census')}];
  const names=['roots.jsonl','population.jsonl','root-transitions.jsonl','memberships.jsonl','model-components.json','candidate-groups.json',
   'relations.json','pending-cohort.jsonl','guides.jsonl','guide-vectors.npy','model.open.joblib'];
  const bodies=new Map(names.map(name=>[name,name==='model.open.joblib'?modelBody:`local numeric fixture ${name}`]));
  const files=names.map(file=>({file,sha256:fixtureSha(bodies.get(file)!),bytes:Buffer.byteLength(bodies.get(file)!)}));
  const component={component_key:componentKey,lane:'open' as const,model_origin:{execution_id:parentId,model_artifact_sha256:modelSha},
   model:files.find(file=>file.file==='model.open.joblib')!,center:null,units};
  const output={contract_version:'workspace-topic-incremental-output-v1',workspace_id,execution_id:lease.execution_id,
   request_digest:digest({input,runtime_digest:descriptor.compatibility.runtime_digest}),previous_manifest_sha256:descriptor.parent.manifest_sha256,
   compatibility:descriptor.compatibility,policy_version:'workspace-frozen-model-cohort-v1',status:'completed',quality:'uncalibrated',approval_policy:'none',
   discovery_status:'complete',relations_status:'none',population_digest:population,
   counts:{roots:3,occurrences:133,added_roots:0,content_changed_roots:0,metadata_changed_roots:0,unchanged_roots:3,removed_roots:0,
    delta_occurrences:0,cohort_occurrences:0,pending_occurrences:0,memberships:0,components:1,new_components:0,model_bank_bytes:component.model.bytes},
   components:[component],artifacts:files,coverage:[{component_key:componentKey,population_digest:population,expected_occurrences:133,
    copied_occurrences:133,transformed_occurrences:0,fitted_occurrences:0}],operations:{fit:[],transform:[]},metrics:{resident_bytes:0,elapsed_seconds:0},
   limitations:['Explicit SQL authority fixture; numerical files are independently validated by the Worker tests.']};
  const outputBody=JSON.stringify(output),manifestRef={file:'manifest.json',sha256:fixtureSha(outputBody),bytes:Buffer.byteLength(outputBody)};
  const indexArgs={database:f.database,lease,input_artifact_id:savedInput.artifact_id,output_manifest:{sha256:manifestRef.sha256,size_bytes:manifestRef.bytes},
   file_count:files.length+3,artifact:artifact(lease,'incremental-output-index.json','engine_output','private exact inventory')};
  const index=await incremental.persistSignalWorkspaceIncrementalOutputIndexV1(indexArgs);
  assert.equal((await incremental.persistSignalWorkspaceIncrementalOutputIndexV1(indexArgs)).artifact_id,index.artifact_id);
  const stored=new Map<string,string>();
  for(const file of files)stored.set(file.file,(await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,
   artifact:artifact(lease,file.file,file.file.endsWith('.joblib')?'engine_model':'engine_output',bodies.get(file.file)!)})).artifact_id);
  const outputArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact(lease,'manifest.json','engine_output',outputBody)});
  const bankArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease,artifact:artifact(lease,'model-manifest.json','engine_model','local bank manifest')});
  const bankArgs={database:f.database,lease,model_bank_artifact_id:bankArtifact.artifact_id,output_artifact_id:outputArtifact.artifact_id};
  const bank=await incremental.registerSignalWorkspaceIncrementalModelBankV1(bankArgs);
  assert.equal((await incremental.registerSignalWorkspaceIncrementalModelBankV1(bankArgs)).model_version_id,bank.model_version_id);
  const componentArgs={database:f.database,lease,model_version_id:bank.model_version_id,components:[{component_key:componentKey,lane:'open' as const,
   model_artifact_id:stored.get('model.open.joblib')!,center_artifact_id:null,model_origin:component.model_origin,unit_count:1,unit_digest:digest(units)}]};
  await assert.rejects(incremental.registerSignalWorkspaceIncrementalComponentsV1({...componentArgs,components:[{...componentArgs.components[0]!,
   component_key:digest([randomUUID(),modelSha,'open']),model_origin:{execution_id:randomUUID(),model_artifact_sha256:modelSha}}]}),/component_invalid/u);
  const aliases=await incremental.registerSignalWorkspaceIncrementalComponentsV1(componentArgs);
  assert.equal((await incremental.registerSignalWorkspaceIncrementalComponentsV1(componentArgs)).items[0]!.artifact_id,aliases.items[0]!.artifact_id);
  const alias=(await f.query('SELECT content,metadata FROM analysis_artifacts WHERE id=$1::uuid',[aliases.items[0]!.artifact_id])).rows[0]!;
  assert.equal(alias.metadata.origin_model_artifact_id,originalModel.artifact_id);assert.equal(alias.metadata.origin_registry_id,descriptor.parent.model_version_id);
  assert.equal(alias.metadata.model_origin.execution_id,parentId);assert.equal(alias.content.sha256,modelSha);
  const savedHistory=await incremental.persistSignalWorkspaceIncrementalHistoryV1({database:f.database,lease,relations_artifact_id:stored.get('relations.json')!,
   artifact:artifact(lease,'incremental-history.json','engine_output','immutable references to the paid parent checkpoint')});
  const historyMetadata=(await f.query('SELECT metadata FROM analysis_artifacts WHERE id=$1::uuid',[savedHistory.artifact_id])).rows[0]!.metadata;
  assert.equal(historyMetadata.parent_paid_units,1);assert.equal(historyMetadata.editorial_completion,'not_evaluated','relations none does not settle inherited editorial backlog');
  const validation={contract_version:'workspace-incremental-file-validation-v1' as const,request_digest:output.request_digest,population_digest:population,
   complete_file_digest:digest([manifestRef,...files].sort((a,b)=>a.file<b.file?-1:1)),
   origin_digest:digest([{component_key:componentKey,lane:component.lane,model_origin:component.model_origin,
    model:{sha256:component.model.sha256,bytes:component.model.bytes},center:null,units}]),roots:3,occurrences:133,memberships:0,pending_occurrences:0,
   relations_scope:'new_candidates_in_this_execution' as const};
  const checkpointArgs={database:f.database,lease,input_artifact_id:savedInput.artifact_id,output_index_artifact_id:index.artifact_id,
   output_artifact_id:outputArtifact.artifact_id,model_bank_artifact_id:bankArtifact.artifact_id,model_version_id:bank.model_version_id,
   history_artifact_id:savedHistory.artifact_id,output,validation};
  await assert.rejects(incremental.checkpointSignalWorkspaceIncrementalOutputV1(checkpointArgs),/coverage_invalid/u);
  await engine.heartbeatSignalWorkspaceEngineV1({database:f.database,lease,phase:'persisting',exported:{roots:3,chunks:133,guides:lease.snapshot.expected_guides,
   stream_digest:input.current_input_manifest.sha256}});
  await assert.rejects(incremental.checkpointSignalWorkspaceIncrementalOutputV1({...checkpointArgs,validation:{...validation,origin_digest:fixtureSha('forged')}}),/file_validation_invalid/u);
  const checkpoint=await incremental.checkpointSignalWorkspaceIncrementalOutputV1(checkpointArgs);
  assert.equal((await incremental.checkpointSignalWorkspaceIncrementalOutputV1(checkpointArgs)).checkpoint_digest,checkpoint.checkpoint_digest);
  assert.equal((await incremental.readSignalWorkspaceIncrementalCheckpointV1({database:f.database,lease})).numeric_checkpoint?.checkpoint_digest,checkpoint.checkpoint_digest);
  assert.equal(checkpoint.numeric_complete,true);assert.equal(checkpoint.analysis_complete,false);
  await f.query('BEGIN');try{
   await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.access.actor_user_id]);
   await assert.rejects(incremental.readSignalWorkspaceIncrementalRootsV1({database:f.database,lease,after_root_id:null}),/forbidden/u);
  }finally{await f.query('ROLLBACK');}
  await f.query('BEGIN');try{
   await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid',[workspace_id]);
   await assert.rejects(incremental.readSignalWorkspaceIncrementalParentArtifactsV1({database:f.database,lease}),/inputs_stale/u);
  }finally{await f.query('ROLLBACK');}
  await assert.rejects(incremental.readSignalWorkspaceIncrementalParentArtifactsV1({database:f.database,lease:{...lease,workspace_id:randomUUID()}}),/lease_conflict/u);
  await f.query('BEGIN');try{
   await assert.rejects(f.query(`UPDATE signal_topic_catalog_executions SET status='ready',result_summary=result_summary||'{"result_kind":"incremental_numeric"}'::jsonb
    WHERE id=$1::uuid`,[lease.execution_id]),error=>String((error as {code?:string}).code)==='23514');
  }finally{await f.query('ROLLBACK');}
  const done=await incremental.finishSignalWorkspaceIncrementalNumericV1({database:f.database,lease,checkpoint_digest:checkpoint.checkpoint_digest});
  assert.equal(done.numeric_complete,true);assert.equal(done.analysis_complete,false);
  assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:lease.execution_id,worker_job_id:'replay'}),null);
  const status=await incremental.loadSignalWorkspaceIncrementalStatusV1({...f.access,execution_id:lease.execution_id});
  assert.equal(status?.status,'ready');assert.equal(status?.is_current,true);assert.equal(status?.analysis_complete,false);
  const sqlReject=async(sql:string,values:unknown[])=>{await f.query('BEGIN');try{
   await assert.rejects(f.query(sql,values),error=>['23514','55000'].includes(String((error as {code?:string}).code)));
  }finally{await f.query('ROLLBACK');}};
  await sqlReject(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||'{"analysis_complete":true}'::jsonb WHERE id=$1::uuid`,[lease.execution_id]);
  await sqlReject(`UPDATE analysis_artifacts SET content=jsonb_set(content,'{sha256}',to_jsonb($2::text)) WHERE id=$1::uuid`,[aliases.items[0]!.artifact_id,fixtureSha('mutation')]);
  const nextStart={...start,idempotency_key:randomUUID()};
  const next=await incremental.beginSignalWorkspaceIncrementalEngineV1(nextStart);
  const nextLease=await engine.claimSignalWorkspaceEngineV1({database:f.database,...next,worker_job_id:'local-next-numeric'});assert.ok(nextLease);
  assert.equal(nextLease.snapshot.numeric_descriptor?.parent.execution_id,lease.execution_id);
  assert.equal(nextLease.snapshot.numeric_descriptor?.parent.manifest_contract,'workspace-topic-incremental-output-v1');
  const nextHistory=await incremental.readSignalWorkspaceIncrementalEditorialHistoryV1({database:f.database,lease:nextLease});
  assert.equal(nextHistory.items.length,0);assert.equal(nextHistory.parent_history?.artifact_id,savedHistory.artifact_id);
  assert.equal((await incremental.readSignalWorkspaceIncrementalParentComponentsV1({database:f.database,lease:nextLease})).items[0]!.metadata.unit_digest,digest(units));
  const nextFiles=await incremental.readSignalWorkspaceIncrementalParentArtifactsV1({database:f.database,lease:nextLease});
  assert.equal(nextFiles.items.length,files.length+1);assert.ok(nextFiles.items.some(file=>file.artifact_key==='manifest.json'));
  assert.ok(!nextFiles.items.some(file=>file.artifact_key.startsWith('component-')||file.artifact_key==='incremental-history.json'));
  await f.query(await readFile(new URL('./0146_signal_workspace_incremental_projection.sql',import.meta.url),'utf8'));
  await engine.failSignalWorkspaceEngineV1({database:f.database,lease:nextLease,error_code:'workspace_engine_incremental_transport_unavailable'});
  const retry=await incremental.retrySignalWorkspaceNumericUpdateV1({...f.access,execution_id:next.execution_id,idempotency_key:randomUUID()});
  await f.query('BEGIN');try{
   await f.query("UPDATE users SET status='inactive' WHERE id=$1::uuid",[f.access.actor_user_id]);
   assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:retry.execution_id,worker_job_id:'revoked-claim'}),null);
   assert.equal((await f.query('SELECT status,error_code FROM signal_topic_catalog_executions WHERE id=$1::uuid',[next.execution_id])).rows[0]!.status,'failed');
  }finally{await f.query('ROLLBACK');}
  await f.query('BEGIN');try{
   await f.query("UPDATE data_sources SET status='inactive' WHERE workspace_id=$1::uuid",[workspace_id]);
   assert.equal((await f.query('SELECT signal_workspace_incremental_parent_current_v1($1::uuid,$2::uuid,$3::uuid) valid',[parentId,workspace_id,f.access.actor_user_id])).rows[0]!.valid,false);
   assert.equal((await incremental.loadSignalWorkspaceIncrementalStatusV1({...f.access,execution_id:lease.execution_id}))?.is_current,false);
   assert.equal(await engine.claimSignalWorkspaceEngineV1({database:f.database,execution_id:next.execution_id,worker_job_id:'parent-revoked-claim'}),null);
   assert.equal((await f.query('SELECT error_code FROM signal_topic_catalog_executions WHERE id=$1::uuid',[next.execution_id])).rows[0]!.error_code,'workspace_engine_inputs_stale');
  }finally{await f.query('ROLLBACK');}
  const editorialAfter=await engine.loadSignalWorkspaceEngineStatusV1(f.access);
  assert.equal(editorialAfter.latest_run?.execution_id,parentId,'numeric child is not an editorial latest-complete result');
  assert.equal(editorialAfter.latest_complete_execution_id,editorialBefore.latest_complete_execution_id);
  assert.equal(editorialAfter.latest_complete?.execution_id,editorialBefore.latest_complete?.execution_id);
  assert.deepEqual((await f.query('SELECT to_jsonb(execution) body FROM signal_topic_catalog_executions execution WHERE id=$1::uuid',[parentId])).rows[0]!.body,parentBefore);
  assert.deepEqual((await f.query('SELECT to_jsonb(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1::uuid ORDER BY id',[parentId])).rows,costsBefore);
  assert.equal((await f.query('SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1::uuid',[lease.execution_id])).rows[0]!.n,0);
  assert.match(digest(input),/^sha256:/u);assert.ok(modelSha);passed=true;throw finished;
 }}),error=>{if(error!==finished)throw error;return true;});
 assert.equal(passed,true);
});

test('running editorial parent permits one numeric child and a sealed history cutoff rejects late visibility', {skip:!enabled,timeout:90_000},async()=>{
 const finished=new Error('local concurrent history gate finished');let child:engine.SignalWorkspaceEngineLeaseV1|null=null;let checked=false;
 await assert.rejects(workspaceProjectionFixtureV1({migrations,model_configuration:{fixture:true,versions:{python:'local-PG-contract-fixture'}},onCheckpoint:async f=>{
  if(f.proposals.length===1){
   await f.query(await readFile(new URL('./0145_signal_workspace_incremental_numeric.sql',import.meta.url),'utf8'));
   const body='local guide vector bytes';
   await engine.persistSignalWorkspaceEngineArtifactV1({database:f.database,lease:f.lease,artifact:{artifact_key:'guide-vectors.npy',artifact_type:'engine_output',title:'Local fixture guides',
    storage_key:`workspace-engine/${f.access.workspace_id}/${f.lease.execution_id}/guide-vectors.npy`,sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),
    media_type:'application/octet-stream',metadata:{filename:'guide-vectors.npy'}}});
   const start={...f.access,idempotency_key:randomUUID(),embedding_run_id:f.lease.snapshot.embedding_run_id,
    expected_context_digest:f.lease.snapshot.context_digest,expected_catalog_digest:f.lease.snapshot.catalog_digest,engine_config:f.lease.snapshot.engine_config,close_requested:false};
   const request=await incremental.beginSignalWorkspaceIncrementalEngineV1(start);
   assert.equal((await f.query('SELECT status FROM signal_topic_catalog_executions WHERE id=$1::uuid',[f.lease.execution_id])).rows[0]!.status,'running');
   child=await engine.claimSignalWorkspaceEngineV1({database:f.database,...request,worker_job_id:'child-of-running-editorial-parent'});assert.ok(child);
   assert.equal(child.snapshot.numeric_descriptor?.parent.execution_id,f.lease.execution_id);
   assert.equal(child.snapshot.numeric_descriptor?.editorial_cut.unit_count,1);
   assert.equal((await incremental.readSignalWorkspaceIncrementalEditorialHistoryV1({database:f.database,lease:child})).items.length,1);
   await assert.rejects(incremental.beginSignalWorkspaceIncrementalEngineV1({...start,idempotency_key:randomUUID()}),/execution_active/u);
   await assert.rejects(incremental.beginSignalWorkspaceIncrementalEngineV1({...start,idempotency_key:randomUUID(),parent_execution_id:child.execution_id}),/parent_unavailable/u);
   return;
  }
  assert.ok(child);assert.equal(f.proposals.length,2);
  // All nested fixture transactions share an older creation timestamp. This
  // reproduces a receipt becoming visible later despite lying before the cutoff.
  assert.equal((await f.query('SELECT unit_count::int FROM signal_workspace_incremental_editorial_cut_v1($1::uuid,$2::uuid)',[f.lease.execution_id,child.execution_id])).rows[0]!.unit_count,2);
  await assert.rejects(incremental.readSignalWorkspaceIncrementalEditorialHistoryV1({database:f.database,lease:child}),/history_changed/u);
  await assert.rejects(incremental.persistSignalWorkspaceIncrementalHistoryV1({database:f.database,lease:child,relations_artifact_id:randomUUID(),artifact:{
   artifact_key:'incremental-history.json',artifact_type:'engine_output',title:'Rejected mixed history',
   storage_key:`workspace-engine/${f.access.workspace_id}/${child.execution_id}/incremental-history.json`,sha256:fixtureSha('mixed'),size_bytes:5,media_type:'application/json',metadata:{}}}),/history_changed/u);
  assert.equal((await f.query('SELECT count(*)::int n FROM analysis_artifacts WHERE engine_execution_id=$1::uuid',[child.execution_id])).rows[0]!.n,0);
  checked=true;throw finished;
 }}),error=>{if(error!==finished)throw error;return true;});assert.equal(checked,true);
});
