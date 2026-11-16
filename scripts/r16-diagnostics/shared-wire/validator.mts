import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,
 type SignalListeningConfigurationV1} from '../../../packages/query-engine/src/index.js';
import {withMoneyFixture,proposals,transaction,type NativeFixture} from '../../../infrastructure/db/migrations/signal-listening-money.synthetic.fixture.js';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page.js';
import {anchorListeningStatementOracleParametersV1, listeningExpectedProjectionOracleSqlV1} from '../../../infrastructure/db/migrations/signal-listening-statement-validator.oracle.js';
import {candidateSql,fixtureConfigurations,sharedWireValidatorSql,validatorCanonicalProjectionSql} from './candidate.mjs';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const names=['0318_signal_listening_statement_population.sql','0322_signal_listening_statement_selected_materialization.sql',
 '0323_signal_listening_statement_selected_full_join.sql','0328_signal_listening_owner_target_sets.sql','0329_signal_listening_expected_projection.sql'];
export const defects=['text','request_digest','question_digest','duplicate_question','input_digest','map_id','configuration_digest','scope_basis','empty_questions']as const;
type Rows=ReturnType<typeof proposals>;
type PoolClient=Parameters<Parameters<typeof transaction>[1]>[0];
export function validatorFromSource(source:string):string{
 const matches=[...source.matchAll(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/gu)];
 if(matches.length!==1||(matches[0]![1]!.match(/%s/gu)??[]).length!==1)throw Error('shared_wire_native_validator_source');
 return matches[0]![1]!.replace('%s','SELECT n.* FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$8::jsonb) n');
}
function rehash(f:NativeFixture,row:Rows[number]){
 row.request_digest=signalListeningRequestDigestV1(f.run,row.inputs[0]!,row.request);
 row.custom_id='listening_'+row.request_digest.slice(7,67);
}
export function defectRows(f:NativeFixture,defect:typeof defects[number]):Rows{
 const rows=structuredClone(proposals(f,1000)),bad=rows[1]!,input=bad.inputs[0]!;
 if(defect==='text'){input.text+=' forged text';bad.request={...bad.request,state:input.text};}
 if(defect==='question_digest')input.question_digests={...input.question_digests,voice:'sha256:'+'f'.repeat(64)};
 if(defect==='duplicate_question'){input.question_keys=['voice','voice'];input.question_digests={voice:input.question_digests.voice!};input.scope_basis={};bad.request={...bad.request,questions:{voice:bad.request.questions.voice!}};}
 if(defect==='input_digest')input.input_digest='sha256:'+'0'.repeat(64);
 if(defect==='map_id')input.map_id=randomUUID();
 if(defect==='configuration_digest')input.configuration_digest='sha256:'+'1'.repeat(64);
 if(defect==='scope_basis')input.scope_basis={voice:'sha256:'+'2'.repeat(64)};
 if(defect==='empty_questions'){input.question_keys=[];input.question_digests={};input.scope_basis={};bad.request={...bad.request,questions:{}};}
 rehash(f,bad);if(defect==='request_digest'){bad.request_digest='sha256:'+'e'.repeat(64);bad.custom_id='listening_'+bad.request_digest.slice(7,67);}
 return rows;
}
async function observe(c:PoolClient,sql:string,params:unknown[],canonical:string){
 const flags=(await c.query(anchorListeningStatementOracleParametersV1(sql),params)).rows[0];
 const projected=await c.query(listeningExpectedProjectionOracleSqlV1(sql),params);
 const exact=(await c.query(listeningExpectedProjectionOracleSqlV1(sql,true),params)).rows.map(r=>r.value as string);
 const fields=projected.fields.map(f=>({name:f.name,type:f.dataTypeID,modifier:f.dataTypeModifier,size:f.dataTypeSize,format:f.format}));
 const preimages=(await c.query(anchorListeningStatementOracleParametersV1(canonical),params)).rows;
 assert.deepEqual(fields.map(({name,type})=>({name,type})),[
  {name:'id',type:2950},{name:'request',type:3802},{name:'request_digest',type:25},{name:'i',type:3802},
  {name:'selected_count',type:23},{name:'digests',type:3802},{name:'basis',type:3802},{name:'expected_request',type:3802}]);
 assert.equal(preimages.length,exact.length);
 for(const row of preimages){assert.match(row.bytes,/^(?:[0-9a-f]{2})+$/u);assert.match(row.digest,/^sha256:[0-9a-f]{64}$/u);}
 return{flags,exact,fields,preimages};
}
export type ValidatorObservation={id:string;complete:boolean;equal:boolean|null;validators?:number;rows?:number;flags?:unknown;consumption_sha256?:string;code?:string};
export type NativePublicSeal={scope:string;before_sha256:string;after_sha256?:string;functions:number;unchanged:boolean;error?:boolean};
async function publicFunctions(database:NativeFixture['database']){
 return(await database.query(`SELECT p.oid::text,to_jsonb(p) metadata,p.proacl::text acl,
  CASE WHEN p.prokind='a' THEN pg_get_function_identity_arguments(p.oid) ELSE pg_get_functiondef(p.oid) END definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows;
}
/** Original product DML supplies the consumer prerequisite receipts ONLY.
 * Neither candidate SELECT nor pg_temp helper is installed on a trigger. */
async function seedOriginalBaseAnswers(f:NativeFixture){
 const calls=await f.store.reserve(f.run,proposals(f,1000));await f.store.markSubmitting(f.run,calls);
 const pages=calls.map(call=>{
  const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,f.configuration);
  const response={model:f.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
   ?{type:'noul' as const,noul:.1}:{type:'choice' as const,choice:'individual',confidence:.9,
    probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
  return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),
   results:[mapSignalListeningJevResponseV1(input,f.run.context,f.configuration,response)]};
 });
 await f.store.persistRawPage(f.run,pages);
 await f.store.settlePage(f.run,pages.map(({call})=>({call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
 await f.store.apply(f.run,pages);
}

export async function runNativeValidatorExperiment(observations:ValidatorObservation[],seals:NativePublicSeal[]):Promise<void>{
 const originals=await Promise.all(names.map(async name=>validatorFromSource(await readFile(new URL('../../../infrastructure/db/migrations/'+name,import.meta.url),'utf8'))));
 const latest=originals.at(-1)!,validators=[...originals,sharedWireValidatorSql(latest)];
 for(const configuration of fixtureConfigurations().filter(c=>c.configuration_json!==null)){
  await withMoneyFixture(1000000,async f=>{
   const before=await publicFunctions(f.database),seal:NativePublicSeal={scope:configuration.id,before_sha256:hash(before),functions:before.length,unchanged:false};
   seals.push(seal);let primary:unknown;
   try{
   const owner=(await f.database.query(`SELECT o.configuration_id,o.map_id,c.configuration_digest FROM signal_listening_runs o
    JOIN signal_listening_configurations c ON c.id=o.configuration_id AND c.workspace_id=o.workspace_id WHERE o.run_id=$1`,[f.run.id])).rows[0];
   async function cases(phase:string){
    await transaction(f,async c=>{
     await c.query(candidateSql);
     const params=[f.run.id,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,
      f.inputs.map(i=>i.root_id),owner.configuration_digest,''];
     async function check(id:string,json:string,expected?:Record<string,boolean>){
      const entry:ValidatorObservation={id:configuration.id+':'+phase+':'+id,complete:false,equal:null};observations.push(entry);
      try{
       params[7]=json;
       const outputs=[];
       for(let i=0;i<validators.length;i++)outputs.push(await observe(c,validators[i]!,params,
        validatorCanonicalProjectionSql(i===5?latest:originals[i]!,i===5?'candidate':'old')));
       for(const output of outputs.slice(1))assert.deepEqual(output,outputs[0],'all six complete validators preserve flags, eight typed values, multiplicity, exact bytes and FULL hashes');
       if(expected)assert.deepEqual(outputs[0]!.flags,expected);
       entry.complete=true;entry.equal=true;entry.validators=6;entry.rows=outputs[0]!.exact.length;entry.flags=outputs[0]!.flags;
       entry.consumption_sha256=hash(outputs[0]);
      }catch(error){entry.code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'assertion';
       entry.equal=/^[0-9A-Z]{5}$/u.test(entry.code)?null:false;throw error;}
     }
     const good=proposals(f,1000),valid={invalid_questions:false,invalid_request:false,invalid_prior:false};
     await check('valid',JSON.stringify(good),valid);await check('empty','[]',valid);
     const precise=(await c.query(`SELECT jsonb_set(jsonb_set($1::jsonb,'{0,inputs,0,native_precision_probe}',
      '1234567890.1234567890123456789'::jsonb),'{0,inputs,0,published_at}','"2026-01-01T00:00:00.123456Z"'::jsonb)::text batch`,[JSON.stringify(good)])).rows[0].batch;
     assert.ok(precise.includes('1234567890.1234567890123456789'));await check('precision-microseconds',precise,valid);
     const heterogeneous=structuredClone(good);
     for(const [index,row]of heterogeneous.entries())if(index%2===0){
      const input=row.inputs[0]!,keys=input.question_keys.slice(0,1);input.question_keys=keys;
      input.question_digests=Object.fromEntries(keys.map(k=>[k,input.question_digests[k]!]));
      input.scope_basis=Object.fromEntries(Object.entries(input.scope_basis).filter(([k])=>keys.includes(k)));
      row.request=buildSignalListeningJevRequestV1(input,f.configuration);rehash(f,row);
     }
     await check('heterogeneous-subsets',JSON.stringify(heterogeneous),valid);
     const first=heterogeneous[0]!,key=first.inputs[0]!.question_keys[0]!;
     const questionJson=JSON.stringify(first.request.questions),duplicate=questionJson.replace('{','{'+JSON.stringify(key)+':null,');
     await check('postcollapse-duplicate-wire-key',JSON.stringify(heterogeneous).replace(questionJson,duplicate),valid);
     await check('duplicate-identical-row',JSON.stringify([...good,good[0]]),valid);
     for(const kind of ['null','missing']as const){const rows=structuredClone(good)as Array<Record<string,unknown>>;
      if(kind==='null')rows[0]!.request=null;else delete rows[0]!.request;
      await check('request-'+kind,JSON.stringify(rows),{...valid,invalid_request:true});
     }
     // Empty selection makes expected.questions JSON null and exercises the
     // generic fallback inside the complete SELECT, rather than the micro alone.
     if(phase==='base')for(const defect of defects){
      // Other flags may ALSO reject the forged row; equality to all five is the
      // authority here, while preserving the original error-priority assertion.
      await check('defect-'+defect,JSON.stringify(defectRows(f,defect)));
      const actual=observations.at(-1)!.flags as Record<string,boolean>;
      assert.equal(actual[defect==='text'||defect==='request_digest'?'invalid_request':'invalid_questions'],true);assert.equal(actual.invalid_prior,false);
     }
     // A committed temp function outlives the transaction on a pooled backend.
     // Remove only our private function before COMMIT, so the next phase can
     // reuse that same backend. On any earlier error, ROLLBACK removes its DDL.
     await c.query('DROP FUNCTION pg_temp.r16_shared_wire_json_v1(jsonb,jsonb)');
    });
   }
   await cases('base');await seedOriginalBaseAnswers(f);
   f.inputs=await f.store.inputs(f.run);assert.ok(f.inputs.length>0);assert.ok(f.inputs.every(i=>Object.keys(i.scope_basis).length>0));
   await cases('consumer');
   }catch(error){primary=error;}finally{
    try{const after=await publicFunctions(f.database);seal.after_sha256=hash(after);assert.deepEqual(after,before,'native clone public functions or ACLs changed');seal.unchanged=true;}
    catch(error){seal.error=true;primary??=error;}
   }
   if(primary)throw primary;
  },false,JSON.parse(configuration.configuration_json!)as SignalListeningConfigurationV1);
 }
 assert.equal(observations.length,50,'two canonical configurations, base 17 and consumer 8 cases each');
 assert.ok(observations.every(x=>x.complete&&x.equal&&x.validators===6));
 assert.equal(seals.length,2);assert.ok(seals.every(s=>s.unchanged));
}
