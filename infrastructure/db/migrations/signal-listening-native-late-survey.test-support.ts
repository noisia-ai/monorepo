// Test-only sidecar. It observes the actual store read; no SQL replay/substitution or persistent authority.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,type SignalListeningInputV1} from '@noisia/query-engine';
import type {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import type {LabelingRunV1} from '../signal-labeling-runs';
import type {LabelingInputBoundsV1} from '../signal-labeling-input-bounds';
import type {SignalListeningInputSurveyV1,SignalListeningInputHintV1} from '../signal-listening-runs';
import {createListeningInputPlanObserverV1,extractListeningInputPlanQueryV1,inputPlanTemplateHashV1,
 INPUT_PLAN_SURVEY_Q8_RAW_SHA_V1,INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1,type InputPlanDatabaseV1} from './signal-listening-input-plan.synthetic.fixture';
import {projectionShaV1} from './signal-listening-projection-linear-joins.oracle';
export const NATIVE_LATE_SURVEY_LIMITS_V1={max_rows:4096,hydrate_rows:720,max_working_bytes:512*1024*1024,
 receipt_bytes:1024*1024,plans_bytes:4*1024*1024,parameters_bytes:256*1024,selected_hints_bytes:640*1024} as const;
const hash=(s:string)=>'sha256:'+projectionShaV1(s);
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v)+'\n');
const productSha='97a7d61e77268524ba1f9d1557f54ffa0ba2dc9b154ab256ac683b81aa86a469';
type SurveyStoreV1={withInputSurvey<T>(run:LabelingRunV1,bounds:LabelingInputBoundsV1,body:(scope:SignalListeningInputSurveyV1)=>Promise<T>):Promise<T>};
export type NativeLateSurveyArgsV1<D extends InputPlanDatabaseV1>={database:D;run:LabelingRunV1;
 createStore:(database:D)=>SurveyStoreV1;consumerKeys:readonly string[];phase:'late-consumer';sourceBinding:SharedSourceV1};
type ObservationV1=Omit<ReturnType<ReturnType<typeof createListeningInputPlanObserverV1>['snapshot']>,'plans'>;
type FullSourceV1=ReturnType<typeof captureR16ExpectedGitProvenanceV1>|Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>;
type SharedSourceV1={expected_git:FullSourceV1;runtime_before:FullSourceV1};
type SourceV1={product_sha256:string;observer_fixture_sha256:string;helper_sha256:string;shared_native:SharedSourceV1};
export type NativeLateSurveyReceiptV1={contract:'r16-native-late-input-survey-v1';status:'observed'|'INCONCLUSIVE';
 diagnostic_only:true;h1_accepted:false;phase:'late-consumer';cpu:'UNKNOWN';source:SourceV1|null;
 sample:{sql_raw_sha256:string;sql_template_sha256:string;parameters_sha256:string|null;parameters:unknown[]|null;matching_queries:number};
 shape:{survey_max_rows:4096;hydration_max_rows:720;max_working_bytes:536870912;consumer_keys:string[];hint_count:number|null;survey_retained_bytes:number|null;hydration_working_bytes:number|null;hydration_retained_bytes:number|null;
 selected_root_count:number;selected_root_ids_sha256:string|null;selected_hints_sha256:string|null;selected_hints_bytes:number;inputs_sha256:string|null};
 plans_reference:{filename:'native-late-survey-plans.json';bytes:number;sha256:string}|null;observation:ObservationV1|null;
 lifecycle:{active_borrowed:number;release_failures:number}|null;close:{commit_ack:number;rollback_ack:number};rr_closed_and_restored:boolean;
 failure_stage:string|null};
export type NativeLateSurveyPlansV1={contract:'r16-native-late-input-survey-plans-v1';status:'observed'|'INCONCLUSIVE';
 phase:'late-consumer';source_reference:{receipt_filename:'native-late-survey.json';shared_native_sha256:string;product_sha256:string;observer_fixture_sha256:string;helper_sha256:string}|null;sql_raw_sha256:string;sql_template_sha256:string;
 selected_hints:SignalListeningInputHintV1[];
 plans:ReturnType<ReturnType<typeof createListeningInputPlanObserverV1>['snapshot']>['plans']};
export class NativeLateSurveyObservationErrorV1 extends Error{
 constructor(readonly receipt:NativeLateSurveyReceiptV1,readonly plans:NativeLateSurveyPlansV1,cause:unknown){
  super('native_late_survey_observation_failed',{cause});this.name='NativeLateSurveyObservationErrorV1';
 }
}
export async function observeNativeLateSurveyV1<D extends InputPlanDatabaseV1>(args:NativeLateSurveyArgsV1<D>):Promise<{
 inputs:SignalListeningInputV1[];receipt:NativeLateSurveyReceiptV1;plans:NativeLateSurveyPlansV1}>{
 const limit=NATIVE_LATE_SURVEY_LIMITS_V1;
 const receipt:NativeLateSurveyReceiptV1={contract:'r16-native-late-input-survey-v1',status:'INCONCLUSIVE',diagnostic_only:true,h1_accepted:false,
  phase:args.phase,cpu:'UNKNOWN',source:null,
  sample:{sql_raw_sha256:INPUT_PLAN_SURVEY_Q8_RAW_SHA_V1,sql_template_sha256:INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1,parameters_sha256:null,parameters:null,matching_queries:0},
  shape:{survey_max_rows:4096,hydration_max_rows:720,max_working_bytes:536870912,consumer_keys:[...args.consumerKeys].sort(),hint_count:null,survey_retained_bytes:null,hydration_working_bytes:null,hydration_retained_bytes:null,
   selected_root_count:0,selected_root_ids_sha256:null,selected_hints_sha256:null,selected_hints_bytes:0,inputs_sha256:null},
  plans_reference:null,observation:null,lifecycle:null,close:{commit_ack:0,rollback_ack:0},rr_closed_and_restored:false,failure_stage:null};
 const plans:NativeLateSurveyPlansV1={contract:'r16-native-late-input-survey-plans-v1',status:'INCONCLUSIVE',phase:args.phase,
  source_reference:null,sql_raw_sha256:INPUT_PLAN_SURVEY_Q8_RAW_SHA_V1,sql_template_sha256:INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1,selected_hints:[],plans:[]};
 let observer:ReturnType<typeof createListeningInputPlanObserverV1>|undefined,stage='source';
 const capture=()=>{if(observer){const {plans:observedPlans,...observation}=observer.snapshot();receipt.observation=observation;
  receipt.lifecycle=observer.lifecycle();plans.plans=observedPlans;}};
 const bindPlans=()=>{receipt.plans_reference={filename:'native-late-survey-plans.json',bytes:bytes(plans),sha256:hash(JSON.stringify(plans)+'\n')};};
 try{
  assert.equal(args.phase,'late-consumer');assert.equal(receipt.shape.consumer_keys.length,2);assert.equal(new Set(args.consumerKeys).size,2);
  assert.ok(args.consumerKeys.every(key=>typeof key==='string'&&key.length>0));
  const configuration=validateSignalListeningConfigurationV1(args.run.identity.params.configuration);
  const configuredDigests=new Map(configuration.questions.map(question=>[question.key,signalListeningQuestionDigestV1(configuration,question)]));
  assert.deepEqual(configuration.questions.filter(question=>question.scope==='consumer_category').map(question=>question.key).sort(),receipt.shape.consumer_keys,'keys come from the actual run configuration, not a Full shape imputation');
  const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');assert.equal(projectionShaV1(source),productSha);
  receipt.source={product_sha256:hash(source),observer_fixture_sha256:hash(await readFile(new URL('./signal-listening-input-plan.synthetic.fixture.ts',import.meta.url),'utf8')),
   helper_sha256:hash(await readFile(new URL('./signal-listening-native-late-survey.test-support.ts',import.meta.url),'utf8')),shared_native:args.sourceBinding};
  assert.deepEqual(args.sourceBinding.runtime_before,args.sourceBinding.expected_git,'shared full Native source binding must match immutable Git');
  const full=args.sourceBinding.expected_git;assert.ok(full.file_count>0&&full.file_count===full.file_manifest.length);
  assert.equal(full.source_tree_sha256,hash(JSON.stringify(full.file_manifest.map(entry=>[entry.path,entry.sha256]))));
  assert.equal(full.tree_status_sha256,hash(''));
  const paths=full.file_manifest.map(entry=>entry.path);assert.deepEqual(paths,[...new Set(paths)].sort());
  for(const [path,digest]of [['infrastructure/db/signal-listening-runs.ts',receipt.source.product_sha256],
   ['infrastructure/db/migrations/signal-listening-input-plan.synthetic.fixture.ts',receipt.source.observer_fixture_sha256],
   ['infrastructure/db/migrations/signal-listening-native-late-survey.test-support.ts',receipt.source.helper_sha256]]){
   assert.equal(full.file_manifest.find(entry=>entry.path===path)?.sha256,digest,'actual complete source file must be in the shared full manifest');
  }
  plans.source_reference={receipt_filename:'native-late-survey.json',shared_native_sha256:hash(JSON.stringify(args.sourceBinding)),
   product_sha256:receipt.source.product_sha256,observer_fixture_sha256:receipt.source.observer_fixture_sha256,helper_sha256:receipt.source.helper_sha256};
  const extracted=extractListeningInputPlanQueryV1(source,'survey-Q8');
  observer=createListeningInputPlanObserverV1({target_sql:extracted.sql,profile:'survey-Q8',ordinal:1});
  const observed=observer.wrapDatabase(args.database);
  // This thin capture preserves every actual query/argument/result. Controls are still owned by the original observer.
  const database=new Proxy(observed,{get(target,key,receiver){
   if(key==='connect')return async()=>{const c=await target.connect();return new Proxy(c,{get(client,field){
    if(field==='query')return async(...queryArgs:any[])=>{
     const sql=typeof queryArgs[0]==='string'?queryArgs[0]:queryArgs[0]?.text;
     if(typeof sql==='string'&&inputPlanTemplateHashV1(sql)===INPUT_PLAN_SURVEY_Q8_TARGET_SHA_V1){
      receipt.sample.matching_queries++;assert.equal(sql,extracted.sql);assert.equal(receipt.sample.matching_queries,1,'one actual4096 metadata statement');
      const values=typeof queryArgs[0]==='string'?queryArgs[1]:queryArgs[0].values;
      assert.ok(Array.isArray(values)&&values.length===9);assert.ok(Array.isArray(values[7])&&values[7].length===4096);
      assert.equal(new Set(values[7]).size,4096);assert.equal(values[5],4096);assert.equal(values[8],String(limit.max_working_bytes));
      assert.equal(values[0],args.run.workspace_id);assert.equal(values[3],args.run.entity_context_digest);assert.equal(values[4],args.run.id);
      assert.ok(values.slice(0,5).every(value=>typeof value==='string'));assert.ok(typeof values[6]==='number'&&Number.isSafeInteger(values[6])&&values[6]>=0);
      const encoded=JSON.stringify(values);assert.ok(Buffer.byteLength(encoded)<=limit.parameters_bytes);receipt.sample.parameters=JSON.parse(encoded) as unknown[];
      receipt.sample.parameters_sha256=hash(encoded);
     }
     const result=await client.query(...queryArgs);
     if(typeof sql==='string'&&sql.trim()==='COMMIT')receipt.close.commit_ack++;
     if(typeof sql==='string'&&sql.trim()==='ROLLBACK')receipt.close.rollback_ack++;
     return result;
    };
    const value=Reflect.get(client,field);return typeof value==='function'?value.bind(client):value;
   }});};
   const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
  }}) as D;
  stage='actual_survey_and_hydration';
  const inputs=await args.createStore(database).withInputSurvey(args.run,{max_rows:limit.max_rows,max_working_bytes:limit.max_working_bytes},async scope=>{
   receipt.shape.hint_count=scope.hints.length;assert.ok(scope.hints.length>=limit.hydrate_rows);
   assert.ok(Number.isSafeInteger(scope.retained_bytes)&&scope.retained_bytes>=0&&scope.retained_bytes<limit.max_working_bytes);
   receipt.shape.survey_retained_bytes=scope.retained_bytes;receipt.shape.hydration_working_bytes=limit.max_working_bytes-scope.retained_bytes;
   const selected=scope.hints.slice(0,limit.hydrate_rows),ids=selected.map(h=>h.root_id);assert.equal(new Set(ids).size,limit.hydrate_rows);
   assert.deepEqual(ids,[...ids].sort());
   for(const hint of selected){assert.deepEqual([...hint.question_keys].sort(),receipt.shape.consumer_keys);
    assert.deepEqual(Object.keys(hint.question_digests).sort(),receipt.shape.consumer_keys);
    for(const key of receipt.shape.consumer_keys)assert.equal(hint.question_digests[key],configuredDigests.get(key));assert.match(hint.input_digest,/^sha256:[a-f0-9]{64}$/u);
    assert.ok(BigInt(hint.working_bytes)>0n&&Number.isSafeInteger(hint.state_json_bytes)&&hint.state_json_bytes>=2);}
   assert.ok(bytes(selected)<=limit.selected_hints_bytes);plans.selected_hints=JSON.parse(JSON.stringify(selected)) as SignalListeningInputHintV1[];
   receipt.shape.selected_root_count=ids.length;receipt.shape.selected_root_ids_sha256=hash(JSON.stringify(ids));receipt.shape.selected_hints_sha256=hash(JSON.stringify(selected));receipt.shape.selected_hints_bytes=bytes(selected);
   const hydrated=await scope.hydrate(ids,{max_rows:limit.hydrate_rows,max_working_bytes:receipt.shape.hydration_working_bytes});
   assert.equal(hydrated.kind,'ready');if(hydrated.kind!=='ready')throw Error('native_late_survey_hydration_stale');
   assert.ok(Number.isSafeInteger(hydrated.retained_bytes)&&hydrated.retained_bytes>=0&&hydrated.retained_bytes+scope.retained_bytes<=limit.max_working_bytes);
   receipt.shape.hydration_retained_bytes=hydrated.retained_bytes;
   assert.equal(hydrated.inputs.length,limit.hydrate_rows);assert.deepEqual(hydrated.inputs.map(input=>input.root_id),ids);
   for(let i=0;i<hydrated.inputs.length;i++){const input:SignalListeningInputV1=hydrated.inputs[i]!,hint=selected[i]!;
    assert.deepEqual(Object.keys(input).sort(),['root_id','input_digest','text','title','platform','content_type','author','published_at','language','map_id','configuration_digest','question_keys','question_digests','scope_basis'].sort());
    assert.equal(input.input_digest,hint.input_digest);assert.deepEqual(input.question_keys,hint.question_keys);
    assert.deepEqual(input.question_digests,hint.question_digests);assert.deepEqual(input.scope_basis,hint.scope_basis);
    assert.equal(Buffer.byteLength(JSON.stringify(input.text)),hint.state_json_bytes);
   }
   receipt.shape.inputs_sha256=hash(JSON.stringify(hydrated.inputs));return hydrated.inputs;
  });
  stage='observer_close';capture();const observation=receipt.observation!;assert.equal(observation.status,'observed');
  assert.equal(observation.target_profile,'survey-Q8');assert.equal(observation.ordinal_seen,1);assert.equal(observation.root_argument_count,4096);
  assert.equal(observation.bind_count,9);assert.equal(observation.selected_count,1);assert.equal(observation.original_executions,1);
  assert.equal(observation.discarded,false);assert.equal(observation.rollback_reset_confirmed,false);
  assert.deepEqual(receipt.lifecycle,{active_borrowed:0,release_failures:0});assert.deepEqual(receipt.close,{commit_ack:1,rollback_ack:0});
  receipt.rr_closed_and_restored=observation.rr_read_only&&observation.settings_restored&&observation.context_stable;
  assert.equal(receipt.rr_closed_and_restored,true);receipt.status='observed';plans.status='observed';
  stage='retention';bindPlans();assert.ok(bytes(receipt)<=limit.receipt_bytes);assert.ok(bytes(plans)<=limit.plans_bytes);
  return{inputs,receipt,plans};
 }catch(cause){capture();receipt.status='INCONCLUSIVE';plans.status='INCONCLUSIVE';receipt.failure_stage=stage;bindPlans();
  throw new NativeLateSurveyObservationErrorV1(receipt,plans,cause);
 }
}
