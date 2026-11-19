import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {
  createListeningInputPlanObserverV1,
  extractListeningInputPlanQueryV1,
  extractListeningInputPlanQueryOldV1,
  INPUT_PLAN_TARGET_SHA_V1,
  inputPlanTemplateHashV1,
  INPUT_PLAN_LIMITS_V1,
  INPUT_PLAN_WIRE_E_TARGET_SHA_V1,
  sanitizeListeningInputPlanV1,
  withListeningInputPlanStorageV1,
  type InputPlanClientV1,
  type InputPlanDatabaseV1,
} from './signal-listening-input-plan.synthetic.fixture';

const pure=process.env.NOISIA_R16_LISTENING_INPUT_PLAN_PURE==='true';
const settingsNames=[
  'auto_explain.log_min_duration','auto_explain.log_analyze','auto_explain.log_timing','auto_explain.log_buffers',
  'auto_explain.log_format','auto_explain.log_level','auto_explain.log_nested_statements','auto_explain.sample_rate',
  'auto_explain.log_parameter_max_length','auto_explain.log_verbose','auto_explain.log_settings','auto_explain.log_triggers',
  'auto_explain.log_wal','client_min_messages','log_min_messages',
];

function planDocument(queryText:string,relation:string){
  return {'Query Text':queryText,Plan:{'Node Type':'Nested Loop','Actual Rows':2,'Actual Loops':1,
    Plans:[
      {'Node Type':'Seq Scan','Relation Name':relation,'Actual Rows':2,'Actual Loops':1,Filter:'PRIVATE_FILTER_SENTINEL'},
      {'Node Type':'Index Scan','Index Name':'PRIVATE_INDEX_SENTINEL','Actual Rows':2,'Actual Loops':1,Output:['PRIVATE_OUTPUT_SENTINEL']},
    ]},'Planning Time':0.25,'Execution Time':1.5,
    JIT:{Functions:2,Options:{Inlining:false,Optimization:true,Expressions:true,Deforming:true},
      Timing:{Generation:{Deform:0.1,Total:0.3},Inlining:0,Optimization:0.05,Emission:0.15,Total:0.5}}};
}

function makeDatabase(options:{targetSql:string;throwSelected?:boolean;selectedError?:unknown;existingNoticeListener?:boolean;rollbackError?:Error;releaseError?:Error;oversizedNotice?:boolean}){
  const listeners=new Set<(notice:unknown)=>void>();
  let targetCalls=0,releaseCalls=0,destroyed=false,selectedCalls=0;
  let loadCalls=0,settingUpdates=0;
  const originalResult={rows:[{value:'PRIVATE_RESULT_SENTINEL'}],rowCount:1};
  const initialSettings=new Map(settingsNames.map(name=>[name,`previous:${name}`]));
  const currentSettings=new Map(initialSettings);
  const preexisting=()=>{};
  if(options.existingNoticeListener)listeners.add(preexisting);
  const client={
    async query(...args:unknown[]){
      const text=typeof args[0]==='string'?args[0]:'';
      if(text.startsWith('SELECT pg_backend_pid()::int pid'))return {rows:[{pid:7123,role:'synthetic_ci_role',database:'noisia_mfp_ci',search_path:'public',superuser:'on',isolation:'repeatable read',readonly:'on',xid:null,snapshot:'snapshot-synthetic'}]};
      if(text.startsWith('SELECT name,current_setting(name) value')){
        const names=((args[1] as unknown[]|undefined)?.[0] as string[]|undefined)??[];
        return {rows:names.map(name=>({name,value:currentSettings.get(name)??''}))};
      }
      if(text==='SELECT set_config($1,$2,true)'){
        const [name,value]=args[1] as [string,string];settingUpdates++;currentSettings.set(name,value);return {rows:[{set_config:value}]};
      }
      if(text.startsWith('LOAD ')){loadCalls++;return {rows:[]};}
      if(text==='BEGIN'||text==='COMMIT')return {rows:[]};
      if(text==='ROLLBACK'){
        if(options.rollbackError)throw options.rollbackError;
        for(const [name,value] of initialSettings)currentSettings.set(name,value);
        return {rows:[]};
      }
      if(inputPlanTemplateHashV1(text)===INPUT_PLAN_WIRE_E_TARGET_SHA_V1){
        targetCalls++;
        if(targetCalls===INPUT_PLAN_LIMITS_V1.ordinal){
          selectedCalls++;
          if(options.throwSelected)throw options.selectedError;
          const parent=JSON.stringify(planDocument(text,'PRIVATE_PARENT_RELATION_SENTINEL'));
          const nested=JSON.stringify({'Query Text':'SELECT PRIVATE_NESTED_QUERY_SENTINEL','Plan':{'Node Type':'Seq Scan','Relation Name':'PRIVATE_NESTED_RELATION_SENTINEL','Actual Rows':1,'Actual Loops':1}});
          for(const listener of listeners){
            listener({message:options.oversizedNotice
              ?`duration: 3.25 ms plan: ${parent}${' '.repeat(INPUT_PLAN_LIMITS_V1.notice_bytes)}`
              :`duration: 3.25 ms plan: ${parent}`});
            if(!options.oversizedNotice)listener({message:`duration: 0.75 ms plan: ${nested}`});
          }
          return originalResult;
        }
        return {rows:[],rowCount:0};
      }
      throw new Error('unexpected_synthetic_query');
    },
    release(destroy?:boolean){releaseCalls++;destroyed=Boolean(destroy);if(options.releaseError)throw options.releaseError;},
    on(event:string,handler:(notice:unknown)=>void){if(event==='notice')listeners.add(handler);return this;},
    removeListener(event:string,handler:(notice:unknown)=>void){if(event==='notice')listeners.delete(handler);return this;},
    listenerCount(event:string){return event==='notice'?listeners.size:0;},
  } as unknown as InputPlanClientV1;
  const database={
    async connect(){return client;},
    async query(...args:unknown[]){return client.query(...args);},
  } as unknown as InputPlanDatabaseV1;
  return {database,client,originalResult,get targetCalls(){return targetCalls;},get selectedCalls(){return selectedCalls;},
    get releaseCalls(){return releaseCalls;},get destroyed(){return destroyed;},get listenerCount(){return listeners.size;},
    get loadCalls(){return loadCalls;},get settingUpdates(){return settingUpdates;}};
}

async function sourceAndTarget(){
  const source=await readFile(fileURLToPath(new URL('../signal-listening-runs.ts',import.meta.url)),'utf8');
  return extractListeningInputPlanQueryV1(source);
}

async function runToOrdinal65(observer:ReturnType<typeof createListeningInputPlanObserverV1>,db:InputPlanDatabaseV1,targetSql:string,afterCapture=0){
  const wrapped=observer.wrapDatabase(db);const connection=await wrapped.connect();
  await connection.query('BEGIN');
  const binds=[1,2,3,4,5,6,7,['root-a','root-b','root-c'],9];
  for(let index=1;index<INPUT_PLAN_LIMITS_V1.ordinal;index++)await connection.query(targetSql,binds);
  const result=await connection.query(targetSql,binds);
  for(let index=0;index<afterCapture;index++)await connection.query(targetSql,binds);
  await connection.query('COMMIT');
  connection.release();
  return result;
}

if(pure){
  test('input-plan current E and explicit historical extraction bind independent frozen template digests',async()=>{
    const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),old=extractListeningInputPlanQueryOldV1(source);
    assert.equal(old.template_sha256,INPUT_PLAN_TARGET_SHA_V1);assert.equal(inputPlanTemplateHashV1(old.sql),INPUT_PLAN_TARGET_SHA_V1);
    assert.equal(extractListeningInputPlanQueryV1(source,'historical').sql,old.sql);
    const extracted=await sourceAndTarget();assert.equal(extracted.profile,'E');assert.equal(extracted.legacy_template_sha256,INPUT_PLAN_TARGET_SHA_V1);
    assert.throws(()=>extractListeningInputPlanQueryV1(source.replace('p.body_octets::bigint','p.body_octets::integer')));
    assert.throws(()=>createListeningInputPlanObserverV1({target_sql:old.sql}),'default E cannot observe the old target silently');
    const historic=createListeningInputPlanObserverV1({target_sql:old.sql,profile:'historical'});assert.equal(historic.snapshot().target_profile,'historical');
    assert.equal(extracted.template_sha256,INPUT_PLAN_WIRE_E_TARGET_SHA_V1);
    assert.equal(inputPlanTemplateHashV1(extracted.sql),INPUT_PLAN_WIRE_E_TARGET_SHA_V1);
    assert.ok(extracted.sql.length>0);
    assert.doesNotMatch(JSON.stringify(extracted),/PRIVATE_(?:ROOT|WORKSPACE|RUN)_SENTINEL/u);
  });

  test('auto_explain sanitization hashes identifiers and omits SQL expressions while retaining closed JIT metrics',async()=>{
    const {sql}=await sourceAndTarget();
    const value=sanitizeListeningInputPlanV1(planDocument(sql,'PRIVATE_RELATION_SENTINEL'));
    const encoded=JSON.stringify(value);
    assert.equal(value.plan.query_template_sha256,INPUT_PLAN_WIRE_E_TARGET_SHA_V1);
    const firstChild=((value.plan.Plan as Record<string,unknown>).Plans as Array<Record<string,unknown>>)[0]!;
    assert.match(String(firstChild['Relation Name SHA256']),/^sha256:[a-f0-9]{64}$/u);
    assert.ok(!Object.hasOwn(firstChild,'Relation Name'));
    assert.ok(!encoded.includes('PRIVATE_RELATION_SENTINEL'));
    assert.ok(!encoded.includes('PRIVATE_INDEX_SENTINEL'));
    assert.ok(!encoded.includes('PRIVATE_FILTER_SENTINEL'));
    assert.ok(!encoded.includes('PRIVATE_OUTPUT_SENTINEL'));
    assert.ok(!encoded.includes(sql));
    const jit=value.plan.JIT as Record<string,unknown>;
    const timing=jit.Timing as Record<string,unknown>;
    assert.deepEqual(timing.Generation,{Deform:0.1,Total:0.3});
    assert.equal(value.bytes,Buffer.byteLength(JSON.stringify(value.plan)));
    assert.match(value.sanitized_sha256,/^sha256:[a-f0-9]{64}$/u);
  });

  test('input-plan sanitizer rejects unknown structure, accessors, excessive node counts and depth',async()=>{
    const {sql}=await sourceAndTarget();
    const invalid={...planDocument(sql,'synthetic'),'PRIVATE_UNKNOWN_FIELD':'PRIVATE_UNKNOWN_SENTINEL'};
    assert.throws(()=>sanitizeListeningInputPlanV1(invalid),/r16_input_plan_observer_invalid_or_incomplete/u);
    let getterCalls=0;
    const accessor=planDocument(sql,'synthetic');
    Object.defineProperty(accessor.Plan,'PrivateField',{enumerable:true,get(){getterCalls++;throw Error('private getter must not execute');}});
    assert.throws(()=>sanitizeListeningInputPlanV1(accessor),/r16_input_plan_observer_invalid_or_incomplete/u);
    assert.equal(getterCalls,0);
    const tooMany=planDocument(sql,'synthetic');
    (tooMany.Plan as Record<string,unknown>).Plans=Array.from({length:512},()=>({'Node Type':'Result'}));
    assert.throws(()=>sanitizeListeningInputPlanV1(tooMany),/r16_input_plan_observer_invalid_or_incomplete/u);
    let deep:Record<string,unknown>={'Node Type':'Result'};
    for(let i=0;i<INPUT_PLAN_LIMITS_V1.depth+1;i++)deep={'Node Type':'Result',Plans:[deep]};
    assert.throws(()=>sanitizeListeningInputPlanV1({'Query Text':sql,Plan:deep}),/r16_input_plan_observer_invalid_or_incomplete/u);
  });

  test('observer captures only the 65th original RR read, parent and nested plans, preserving the result and controls',async()=>{
    const {sql}=await sourceAndTarget();const fake=makeDatabase({targetSql:sql});
    const observer=createListeningInputPlanObserverV1({target_sql:sql});
    const result=await runToOrdinal65(observer,fake.database,sql,2);
    const observation=observer.snapshot();
    assert.equal(result,fake.originalResult);
    assert.equal(fake.targetCalls,INPUT_PLAN_LIMITS_V1.ordinal+2);
    assert.equal(fake.selectedCalls,1);
    assert.equal(fake.releaseCalls,1);
    assert.equal(fake.destroyed,false);
    assert.equal(observation.status,'observed');
    assert.equal(observation.ordinal_seen,INPUT_PLAN_LIMITS_V1.ordinal+2);
    assert.equal(observation.selected_count,1);
    assert.equal(observation.original_executions,1);
    assert.equal(observation.original_succeeded,true);
    assert.equal(observation.result_reference_preserved,true);
    assert.equal(observation.bind_count,9);
    assert.equal(observation.root_argument_count,3);
    assert.equal(observation.returned_rows,1);
    assert.equal(observation.rr_read_only,true);
    assert.equal(observation.context_stable,true);
    assert.equal(observation.settings_restored,true);
    assert.equal(observation.parent_present,true);
    assert.equal(observation.nested_present,true);
    assert.equal(observation.loss,false);
    assert.equal(observation.library_loaded,true);
    assert.equal(observation.library_unloaded,false);
    assert.equal(observer.lifecycle().active_borrowed,0);
    assert.equal(observer.lifecycle().release_failures,0);
    assert.equal(fake.listenerCount,0,'the exclusive observer listener must be removed after the selected read');
    const encoded=JSON.stringify(observation);
    for(const raw of ['PRIVATE_PARENT_RELATION_SENTINEL','PRIVATE_NESTED_RELATION_SENTINEL','PRIVATE_NESTED_QUERY_SENTINEL','PRIVATE_FILTER_SENTINEL'])
      assert.ok(!encoded.includes(raw),'raw plan content must not be retained: '+raw);
    assert.ok(observation.plans.every(plan=>plan.variants==='NOT_COLLECTED'));
    for(const plan of observation.plans){
      const serialized=JSON.stringify(plan.first.plan);
      assert.equal(plan.first.bytes,Buffer.byteLength(serialized),'retained plan metadata must be included in byte accounting');
      assert.equal(plan.first.sanitized_sha256,'sha256:'+createHash('sha256').update(serialized,'utf8').digest('hex'),
        'retained plan digest must cover its exact serialized plan');
    }
  });

  test('observer preserves a falsy original query error and confirms rollback reset',async()=>{
    const {sql}=await sourceAndTarget();const fake=makeDatabase({targetSql:sql,throwSelected:true,selectedError:null});
    const observer=createListeningInputPlanObserverV1({target_sql:sql});const wrapped=observer.wrapDatabase(fake.database);
    const connection=await wrapped.connect();await connection.query('BEGIN');
    const binds=[1,2,3,4,5,6,7,['root-a'],9];
    for(let index=1;index<INPUT_PLAN_LIMITS_V1.ordinal;index++)await connection.query(sql,binds);
    let threw=false,original:unknown;
    try{await connection.query(sql,binds);}catch(error){threw=true;original=error;}
    assert.equal(threw,true);
    assert.equal(original,null,'the original null rejection must survive instrumentation');
    await connection.query('ROLLBACK');connection.release();
    const observation=observer.snapshot();
    assert.equal(observation.failure_stage,'original');
    assert.equal(observation.rollback_reset_confirmed,true);
    assert.equal(observation.discarded,false);
    assert.equal(observer.lifecycle().active_borrowed,0);
  });

  test('observer preserves falsy primary errors when rollback and release also fail',async()=>{
    const {sql}=await sourceAndTarget();
    for(const primary of [null,undefined]){
      const rollbackError=new Error('synthetic rollback secondary');
      const releaseError=new Error('synthetic release secondary');
      const fake=makeDatabase({targetSql:sql,throwSelected:true,selectedError:primary,rollbackError,releaseError});
      const observer=createListeningInputPlanObserverV1({target_sql:sql});const wrapped=observer.wrapDatabase(fake.database);
      const connection=await wrapped.connect();await connection.query('BEGIN');
      const binds=[1,2,3,4,5,6,7,['root-a'],9];
      for(let index=1;index<INPUT_PLAN_LIMITS_V1.ordinal;index++)await connection.query(sql,binds);
      let caughtPrimary=false,caughtValue:unknown;
      try{await connection.query(sql,binds);}catch(error){caughtPrimary=true;caughtValue=error;}
      assert.equal(caughtPrimary,true);assert.equal(caughtValue,primary);
      let rollbackThrown=false;
      try{await connection.query('ROLLBACK');}catch(error){rollbackThrown=true;assert.ok(error instanceof AggregateError);}
      assert.equal(rollbackThrown,true);
      let releaseThrown=false;
      try{connection.release();}catch(error){
        releaseThrown=true;assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors,[primary,rollbackError,releaseError]);
      }
      assert.equal(releaseThrown,true);
      const observation=observer.snapshot();
      assert.equal(observation.failure_stage,'original','the first primary failure stage must remain sticky');
      assert.equal(observation.discarded,true);
      assert.equal(observer.lifecycle().active_borrowed,0);
    }
  });

  test('observer refuses a pre-existing notice listener before loading or enabling auto_explain',async()=>{
    const {sql}=await sourceAndTarget();const fake=makeDatabase({targetSql:sql,existingNoticeListener:true});
    const observer=createListeningInputPlanObserverV1({target_sql:sql});const wrapped=observer.wrapDatabase(fake.database);
    await assert.rejects(wrapped.connect(),/r16_input_plan_observer_invalid_or_incomplete/u);
    const observation=observer.snapshot();
    assert.equal(observation.failure_stage,'listener');
    assert.equal(observation.loss,true);
    assert.equal(observation.original_executions,0);
    assert.equal(fake.selectedCalls,0);
    assert.equal(fake.targetCalls,0);
    assert.equal(fake.loadCalls,0,'auto_explain must not be loaded while another notice listener is installed');
    assert.equal(fake.settingUpdates,0,'observer controls must not be activated before listener exclusivity is known');
    assert.equal(fake.releaseCalls,1);
    assert.equal(fake.destroyed,true);
    assert.equal(fake.listenerCount,1,'the observer must preserve the pre-existing listener');
    assert.equal(observer.lifecycle().active_borrowed,0);
  });

  test('oversized notice is nonthrowing, marks loss and preserves the original query result',async()=>{
    const {sql}=await sourceAndTarget();const fake=makeDatabase({targetSql:sql,oversizedNotice:true});
    const observer=createListeningInputPlanObserverV1({target_sql:sql});const connection=await observer.wrapDatabase(fake.database).connect();
    await connection.query('BEGIN');const binds=[1,2,3,4,5,6,7,['root-a'],9];
    for(let index=1;index<INPUT_PLAN_LIMITS_V1.ordinal;index++)await connection.query(sql,binds);
    const result=await connection.query(sql,binds);
    await connection.query('COMMIT');connection.release();
    const observation=observer.snapshot();
    assert.equal(result,fake.originalResult);
    assert.equal(observation.status,'INCONCLUSIVE');
    assert.equal(observation.original_succeeded,true);
    assert.equal(observation.result_reference_preserved,true);
    assert.equal(observation.loss,true);
    assert.equal(observation.failure_stage,'notice');
    assert.ok(observation.input_bytes>INPUT_PLAN_LIMITS_V1.notice_bytes);
    assert.equal(observation.plans.length,0);
    assert.ok(!JSON.stringify(observation).includes('PRIVATE_PARENT_RELATION_SENTINEL'));
  });

  test('storage helper removes only its newly created UUID directory after the driver settles',async()=>{
    const privateRoot=resolve(process.cwd(),'.data/piloto-masivo/r16');
    await mkdir(privateRoot,{recursive:true,mode:0o700});
    const runRoot=await mkdtemp(join(privateRoot,'input-plan-pure-'));
    const evidence=join(runRoot,'evidence');
    const state={storage_owned:false,storage_closed:null as boolean|null,storage_absent:null as boolean|null};
    let ownedPath='';
    try{
      const result=await withListeningInputPlanStorageV1(evidence,state,async directory=>{
        ownedPath=directory;
        assert.equal(await realpath(directory),directory);
        assert.equal(await realpath(runRoot),runRoot);
        await writeFile(join(directory,'synthetic-marker'),'private fixture only',{flag:'wx',mode:0o600});
        return {finished:true};
      });
      assert.deepEqual(result,{finished:true});
      assert.deepEqual(state,{storage_owned:true,storage_closed:true,storage_absent:true});
      await assert.rejects(stat(ownedPath));
    }finally{await rm(runRoot,{recursive:true,force:true});}
  });

  test('storage helper preserves a falsy body rejection and leaves close acknowledgement unknown',async()=>{
    const privateRoot=resolve(process.cwd(),'.data/piloto-masivo/r16');
    await mkdir(privateRoot,{recursive:true,mode:0o700});
    const runRoot=await mkdtemp(join(privateRoot,'input-plan-reject-'));
    const state={storage_owned:false,storage_closed:null as boolean|null,storage_absent:null as boolean|null};
    let ownedPath='';
    try{
      let caught=false,caughtValue:unknown;
      try{await withListeningInputPlanStorageV1(join(runRoot,'evidence'),state,async directory=>{
        ownedPath=directory;throw null;
      });}catch(error){caught=true;caughtValue=error;}
      assert.equal(caught,true);assert.equal(caughtValue,null,'the original falsy rejection must not be replaced');
      assert.deepEqual(state,{storage_owned:true,storage_closed:null,storage_absent:true});
      await assert.rejects(stat(ownedPath));
    }finally{await rm(runRoot,{recursive:true,force:true});}
  });
}
