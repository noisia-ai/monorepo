import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  collectMarkValidationEnrScansV1,
  createMarkValidationObservationV1,
  extractMarkValidationEnrSourceV1,
  markValidationSafeFailureV1,
  markValidationRootGenerationKindV1,
  retainMarkValidationClientV1,
  runMarkValidationEnrProfileV1,
  sanitizeBoundedPopulationPlanV1,
} from './signal-listening-mark-validation-enr-profile.synthetic.fixture';

const native=process.env.NOISIA_R16_MARK_VALIDATION_ENR_PG==='true';
const pure=process.env.NOISIA_R16_MARK_VALIDATION_ENR_PURE==='true';
assert.ok(!(native&&pure),'native and pure Mark ENR modes must remain separate');

test('native Mark ENR probe observes the statement validator for 1000 reserved consumer calls before unchanged guards',{
  skip:!native,
},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native Mark ENR is authorized only in CI');
  assert.notEqual(process.env.NOISIA_R16_MARK_VALIDATION_ENR_PURE,'true');
  const directory=process.env.R16_MARK_VALIDATION_ENR_EVIDENCE_DIR;
  assert.ok(directory,'native Mark ENR evidence directory is required');
  const receipt=await runMarkValidationEnrProfileV1(directory);
  assert.equal(receipt.contract,'r16-listening-mark-validation-enr-v1');
  assert.equal(receipt.status,'observed');
  assert.equal(receipt.diagnostic_only,true);
  assert.equal(receipt.h1_accepted,false);
  assert.equal(receipt.cpu,'UNKNOWN');
  assert.equal(receipt.speedup_claim,false);
  assert.ok(!Object.hasOwn(receipt,'candidate_accepted'));
  assert.equal(receipt.synthetic_native_mark_executed,true);
  assert.equal(receipt.actual_full_workload_cohort,false);
  assert.equal(receipt.assert_raw_ready_original_preserved,true);
  assert.equal(receipt.pool_connect_borrow_count,1);
  assert.equal(receipt.selected_call_count,1000);
  assert.equal(receipt.open_reserved_micro_usd,500000);
  assert.equal(receipt.settled_micro_usd_synthetic,6000);
  assert.equal(receipt.unknown_exposure_micro_usd,0);
  assert.equal(receipt.provider_http_calls,0);
  const probe=receipt.probe as Record<string,unknown>;
  for(const [key,expected] of Object.entries({
    target_count:1,batch_transition_count:1000,old_status:'reserved',new_status:'submitting',
    explain_count:1,plain_warmups:0,enr_node_type:'Named Tuplestore Scan',
  }))assert.equal(probe[key],expected,key+' must match the exact native probe');
  assert.deepEqual(probe.enr_names_exactly_once,['listening_old_calls','listening_new_calls']);
  const expectedGates=[
    'catalog_restored','closure_confirmed','cohort_transition_exact','enr_scans_exact',
    'original_catalog_unchanged_on_install','original_guard_commit_ack','post_commit_state_exact',
    'probe_catalog_order','probe_plan_once','requeue_open_exposure_preserved','same_client_pin',
    'selector_once','source_binding','zero_target_control',
  ] as const;
  assert.deepEqual(Object.keys(receipt.gates).sort(),expectedGates);
  for(const key of expectedGates)assert.equal(receipt.gates[key],true,key+' must be explicitly observed');
  const persisted=JSON.parse(await readFile(join(directory,'mark-validation-enr.json'),'utf8'));
  assert.deepEqual(persisted,receipt,'persisted native evidence must match the returned receipt');
});

if(pure){
  test('0331 source extraction is byte-bound and keeps the original raw-read guard before pool checkout',async()=>{
    const sql=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
    const extracted=extractMarkValidationEnrSourceV1(sql);
    assert.equal(extracted.source_sha256,'cabed81234f56cf2647368aab03be14817d8de99073929f0d255b2a1f1153cf5');
    assert.match(extracted.query_sha256,/^[a-f0-9]{64}$/u);
    assert.equal((extracted.validation_sql.match(/%s/gu)??[]).length,1);
    assert.ok(!extracted.query_sql.includes('%s'));
    assert.throws(()=>extractMarkValidationEnrSourceV1(sql.replace('FULL JOIN listening_old_calls','JOIN listening_old_calls')));
    assert.throws(()=>extractMarkValidationEnrSourceV1(sql.replace('call_owner.workspace_id=matched.workspace_id','call_owner.workspace_id=matched.run_id')));
    assert.throws(()=>extractMarkValidationEnrSourceV1(sql.replace('root_ids,c.configuration_digest','c.configuration_digest,root_ids')));

    const source=await readFile(new URL('../signal-labeling-runs.ts',import.meta.url),'utf8');
    const method=source.slice(source.indexOf('async markSubmittingSelected('),source.indexOf('\n      },',source.indexOf('async markSubmittingSelected(')));
    assert.ok(method.length>0,'native selector method must remain present');
    const rawReady=method.indexOf('await options.assertRawReady?.()');
    const checkout=method.indexOf('const c=await db.connect()');
    const begin=method.indexOf('await c.query("BEGIN")');
    assert.ok(rawReady>=0&&rawReady<checkout&&checkout<begin,'original raw-read guard must execute before pool checkout and BEGIN');
  });

  test('0331 transition and target extraction preserves the native OLD/NEW join and seven typed binds',async()=>{
    const sql=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');
    const extracted=extractMarkValidationEnrSourceV1(sql);
    assert.deepEqual(extracted.binds,[
      'target','r.workspace_id','owner.configuration_id','owner.map_id',
      'r.entity_context_digest','root_ids','c.configuration_digest',
    ]);
    assert.match(extracted.batch_sql,/FULL JOIN listening_old_calls o ON o\.id=n\.id/u);
    assert.match(extracted.batch_sql,/matched\.old_status='reserved'/u);
    assert.match(extracted.batch_sql,/\(matched\.new_call\)\.status='submitting'/u);
    assert.match(extracted.targets_sql,/call_owner\.workspace_id=matched\.workspace_id/u);
    assert.match(extracted.query_sql,/EXISTS\(SELECT 1 FROM population pending/u);
  });

  test('C plan sanitizer accepts only the two real PG17 ENR names and omits private leaves',()=>{
    const sanitized=sanitizeBoundedPopulationPlanV1([{
      Plan:{'Node Type':'Nested Loop','Actual Rows':1000,'Actual Loops':1,Plans:[
        {'Node Type':'Named Tuplestore Scan','Tuplestore Name':'listening_old_calls','Actual Rows':1000,'Actual Loops':1,Filter:'PRIVATE_OLD_SQL',Output:['PRIVATE_OLD_TEXT']},
        {'Node Type':'Named Tuplestore Scan','Tuplestore Name':'listening_new_calls','Actual Rows':1000,'Actual Loops':1,Filter:'PRIVATE_NEW_SQL',Output:['PRIVATE_NEW_TEXT']},
      ]},'Planning Time':1,'Execution Time':2,
    }]);
    const encoded=JSON.stringify(sanitized.plan);
    assert.equal(sanitized.nodes,3);
    assert.ok(!encoded.includes('PRIVATE_OLD_SQL')&&!encoded.includes('PRIVATE_NEW_SQL'));
    assert.ok(!encoded.includes('PRIVATE_OLD_TEXT')&&!encoded.includes('PRIVATE_NEW_TEXT'));
    assert.ok(!encoded.includes('Filter')&&!encoded.includes('Output'));
    assert.ok(encoded.includes('listening_old_calls')&&encoded.includes('listening_new_calls'));
    const sanitizedBeforeCollection=JSON.stringify(sanitized.plan);
    const collection=collectMarkValidationEnrScansV1(sanitized);
    assert.deepEqual(collection,{
      status:'complete',traversal_complete:true,visited_named_nodes:2,old_count:1,new_count:1,
      missing_name_count:0,invalid_name_count:0,
      scans:[
        {name_status:'allowed',name:'listening_old_calls',actual_rows:1000,actual_loops:1,execution:'observed'},
        {name_status:'allowed',name:'listening_new_calls',actual_rows:1000,actual_loops:1,execution:'observed'},
      ],
    });
    assert.equal(JSON.stringify(sanitized.plan),sanitizedBeforeCollection,'scan census must not mutate the sanitized plan');
    assert.deepEqual(Object.keys(collection).sort(),[
      'invalid_name_count','missing_name_count','new_count','old_count','scans','status','traversal_complete','visited_named_nodes',
    ]);

    const timing=(generation:unknown)=>({Generation:generation,Inlining:0.1,Optimization:0.2,Emission:0.3,Total:0.6});
    const pg17RootGeneration={Deform:0.04,Total:0.1};
    const pg17WorkerGeneration={Deform:0.01,Total:0.03};
    const pg17=sanitizeBoundedPopulationPlanV1([{
      Plan:{'Node Type':'Gather','Workers Planned':1,'Workers Launched':1,Workers:[{
        'Worker Number':0,JIT:{Functions:1,Options:{Inlining:false,Optimization:true,Expressions:true,Deforming:true},Timing:timing(pg17WorkerGeneration)},
      }]},
      JIT:{Functions:4,Options:{Inlining:false,Optimization:true,Expressions:true,Deforming:true},Timing:timing(pg17RootGeneration)},
      'Planning Time':1,'Execution Time':2,
    }]);
    const pg17Document=pg17.plan as Record<string,unknown>;
    const rootJit=pg17Document.JIT as {Timing:Record<string,unknown>};
    const rootGeneration=rootJit.Timing.Generation as Record<string,number>;
    assert.deepEqual(rootGeneration,{Deform:0.04,Total:0.1});
    const pg17Plan=pg17Document.Plan as {Workers:Array<{JIT:{Timing:Record<string,unknown>}}>};
    assert.deepEqual(pg17Plan.Workers[0]!.JIT.Timing.Generation,{Deform:0.01,Total:0.03});
    assert.equal(pg17.jit,'observed');

    const legacy=sanitizeBoundedPopulationPlanV1([{
      Plan:{'Node Type':'Result'},JIT:{Functions:1,Timing:timing(0.12)},'Planning Time':1,'Execution Time':2,
    }]);
    assert.equal((legacy.plan as {JIT:{Timing:Record<string,unknown>}}).JIT.Timing.Generation,0.12);

    const generation=(value:unknown)=>[{JIT:{Timing:{Generation:value}}}];
    const rootKinds=[
      markValidationRootGenerationKindV1(generation(0.12)),
      markValidationRootGenerationKindV1(generation({Deform:0.04,Total:0.1,PRIVATE:'PRIVATE_JIT_VALUE'})),
      markValidationRootGenerationKindV1([{}]),
      markValidationRootGenerationKindV1(generation('PRIVATE_JIT_VALUE')),
      markValidationRootGenerationKindV1(generation(['PRIVATE_JIT_VALUE'])),
    ];
    assert.deepEqual(rootKinds,['number','object','missing','other','other']);
    assert.doesNotMatch(JSON.stringify(rootKinds),/PRIVATE/u,'root JIT classifier must return only closed enums');
  });

  test('C plan sanitizer rejects poisoned ENR aliases and unknown structural nodes',()=>{
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{
      'Node Type':'Named Tuplestore Scan','Tuplestore Name':'private_customer_table','Actual Rows':1,'Actual Loops':1,
    }}]));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Private Executor','Actual Rows':1,'Actual Loops':1}}]));

    const makeJitPlan=(generation:unknown)=>[{
      Plan:{'Node Type':'Result'},JIT:{Functions:1,Timing:{Generation:generation}},'Planning Time':1,'Execution Time':2,
    }];
    for(const invalid of ['0.1',Number.NaN,Number.POSITIVE_INFINITY,-0.1]){
      assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan(invalid)));
    }
    for(const invalid of [
      {Deform:'0.1',Total:0.2},
      {Deform:Number.NaN,Total:0.2},
      {Deform:Number.POSITIVE_INFINITY,Total:0.2},
      {Deform:-0.1,Total:0.2},
      {Deform:[0.1],Total:0.2},
    ])assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan(invalid)));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan([0.1,0.2])));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan({Deform:0.1,Total:0.2,Extra:0})));
    const symbolGeneration=Object.assign({Deform:0.1,Total:0.2},{[Symbol('private')]:0});
    assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan(symbolGeneration)));
    let getterCalls=0;
    const accessorGeneration=Object.defineProperty({Total:0.2},'Deform',{enumerable:true,get(){getterCalls++;return 0.1;}});
    assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan(accessorGeneration)));
    assert.equal(getterCalls,0,'poisoned JIT fields must be rejected without invoking getters');
    const inheritedGeneration=Object.assign(Object.create({private:true}),{Deform:0.1,Total:0.2});
    assert.throws(()=>sanitizeBoundedPopulationPlanV1(makeJitPlan(inheritedGeneration)));
    const cyclicJit:Record<string,unknown>={};cyclicJit.Timing=cyclicJit;
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Result'},JIT:cyclicJit,'Planning Time':1,'Execution Time':2}]));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Gather',Workers:[{
      'Worker Number':0,JIT:{Functions:1,Timing:{Generation:{Deform:-0.1,Total:0.2}}},
    }]},'Planning Time':1,'Execution Time':2}]));

    let rootGenerationGetterCalls=0;
    const rootTiming=Object.defineProperty({},'Generation',{enumerable:true,get(){rootGenerationGetterCalls++;return{Deform:0.1,Total:0.2};}});
    const accessorPlan=[{JIT:{Timing:rootTiming}}];
    assert.equal(markValidationRootGenerationKindV1(accessorPlan),'unsafe');
    assert.equal(rootGenerationGetterCalls,0,'root JIT classifier must inspect descriptors without invoking getters');
    const inheritedPlan=[{JIT:{Timing:{Generation:Object.assign(Object.create({private:true}),{Deform:0.1,Total:0.2})}}}];
    assert.equal(markValidationRootGenerationKindV1(inheritedPlan),'unsafe');
    const accessorPlanJson=JSON.stringify(markValidationRootGenerationKindV1(accessorPlan));
    assert.doesNotMatch(accessorPlanJson,/PRIVATE|Deform|Total|0\.1|0\.2/u);

    const planWithScans=(scans:Array<Record<string,unknown>>)=>sanitizeBoundedPopulationPlanV1([{
      Plan:{'Node Type':'Nested Loop',Plans:scans},'Planning Time':1,'Execution Time':2,
    }]);
    const scan=(name:unknown,rows:unknown,loops:unknown):Record<string,unknown>=>({
      'Node Type':'Named Tuplestore Scan','Tuplestore Name':name,'Actual Rows':rows,'Actual Loops':loops,
    });

    const empty=planWithScans([{'Node Type':'Result'}]);
    const emptyBefore=JSON.stringify(empty.plan);
    const emptyCollection=collectMarkValidationEnrScansV1(empty);
    assert.deepEqual(emptyCollection,{
      status:'complete',traversal_complete:true,visited_named_nodes:0,old_count:0,new_count:0,
      missing_name_count:0,invalid_name_count:0,scans:[],
    },'a completed empty scan census keeps zero distinct from not_started UNKNOWNs');
    assert.equal(JSON.stringify(empty.plan),emptyBefore);

    const duplicate=planWithScans([
      scan('listening_old_calls',3,2),scan('listening_old_calls',0,0),scan('listening_new_calls',7.5,0.5),
    ]);
    const duplicateBefore=JSON.stringify(duplicate.plan);
    const duplicateCollection=collectMarkValidationEnrScansV1(duplicate);
    assert.deepEqual(duplicateCollection,{
      status:'complete',traversal_complete:true,visited_named_nodes:3,old_count:2,new_count:1,
      missing_name_count:0,invalid_name_count:0,
      scans:[
        {name_status:'allowed',name:'listening_old_calls',actual_rows:3,actual_loops:2,execution:'observed'},
        {name_status:'allowed',name:'listening_old_calls',actual_rows:0,actual_loops:0,execution:'not_executed'},
        {name_status:'allowed',name:'listening_new_calls',actual_rows:7.5,actual_loops:0.5,execution:'observed'},
      ],
    },'the collector records actual multiplicity and finite noncanonical rows/loops without accepting the shape');
    assert.equal(JSON.stringify(duplicate.plan),duplicateBefore);
    assert.ok(!Object.hasOwn(duplicateCollection,'gates'),'scan census must not promote a method gate');

    const scanNodes=(result:ReturnType<typeof planWithScans>)=>(((result.plan as Record<string,unknown>).Plan as Record<string,unknown>).Plans as Array<Record<string,unknown>>);
    const missing=planWithScans([scan('listening_old_calls',9,1)]);
    const missingNode=scanNodes(missing)[0]!;
    delete missingNode['Tuplestore Name'];
    const missingBefore=JSON.stringify(missing.plan);
    const missingCollection=collectMarkValidationEnrScansV1(missing);
    assert.deepEqual(missingCollection.scans,[{name_status:'missing',name:null,actual_rows:9,actual_loops:1,execution:'observed'}]);
    assert.equal(missingCollection.missing_name_count,1);
    assert.equal(missingCollection.old_count,0);
    assert.equal(JSON.stringify(missing.plan),missingBefore);

    const invalid=planWithScans([scan('listening_new_calls',5,1)]);
    const invalidNode=scanNodes(invalid)[0]!;
    invalidNode['Tuplestore Name']='PRIVATE_UNKNOWN_ENR_ALIAS';
    const invalidBefore=JSON.stringify(invalid.plan);
    const invalidCollection=collectMarkValidationEnrScansV1(invalid);
    assert.deepEqual(invalidCollection.scans,[{name_status:'invalid',name:null,actual_rows:5,actual_loops:1,execution:'observed'}]);
    assert.equal(invalidCollection.invalid_name_count,1);
    assert.doesNotMatch(JSON.stringify(invalidCollection),/PRIVATE_UNKNOWN_ENR_ALIAS/u);
    assert.equal(JSON.stringify(invalid.plan),invalidBefore);
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Named Tuplestore Scan','Tuplestore Name':'PRIVATE_UNKNOWN_ENR_ALIAS','Actual Rows':5,'Actual Loops':1}}]),/bounded_population_plan_invalid_or_over_limit/u,'the census does not widen the original sanitizer allowlist');

    const unknownMetrics=planWithScans([scan('listening_old_calls',1,1)]);
    const unknownNode=scanNodes(unknownMetrics)[0]!;
    delete unknownNode['Actual Rows'];
    delete unknownNode['Actual Loops'];
    const unknownCollection=collectMarkValidationEnrScansV1(unknownMetrics);
    assert.deepEqual(unknownCollection.scans,[{name_status:'allowed',name:'listening_old_calls',actual_rows:'UNKNOWN',actual_loops:'UNKNOWN',execution:'UNKNOWN'}]);

    for(const poison of [-1,Number.NaN,Number.POSITIVE_INFINITY,'PRIVATE_METRIC']){
      const poisoned=planWithScans([scan('listening_old_calls',1,1)]);
      scanNodes(poisoned)[0]!['Actual Loops']=poison;
      assert.throws(()=>collectMarkValidationEnrScansV1(poisoned));
    }

    const cyclic=planWithScans([scan('listening_old_calls',1,1)]);
    const cyclicPlan=(cyclic.plan as Record<string,unknown>).Plan as Record<string,unknown>;
    (cyclicPlan.Plans as unknown[]).push(cyclicPlan);
    assert.throws(()=>collectMarkValidationEnrScansV1(cyclic),'collector must fail closed on cyclic plan input');
  });

  test('finite connect pin lends the original client once, restores descriptors, and releases it exactly once',async()=>{
    let originalConnectCalls=0,rawReleaseCalls=0,deferredReads=0,destroyed=false;
    const database:{connect:()=>Promise<unknown>}={async connect(){originalConnectCalls++;throw new Error('original connect must be bypassed for the one retained client');}};
    const client={async query(){assert.equal(rawReleaseCalls,0,'the retained client must remain open for post-Mark reads');deferredReads++;},release(error?:Error|boolean){rawReleaseCalls++;destroyed=Boolean(error);}};
    const connectDescriptor=Object.getOwnPropertyDescriptor(database,'connect');
    const releaseDescriptor=Object.getOwnPropertyDescriptor(client,'release');
    const pin=retainMarkValidationClientV1(database,client);
    await pin.run(async()=>{
      const borrowed=await database.connect();
      assert.equal(borrowed,client,'store must receive the exact client already checked out from its original pool');
      (borrowed as typeof client).release();
    });
    assert.deepEqual(Object.getOwnPropertyDescriptor(database,'connect'),connectDescriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(client,'release'),releaseDescriptor);
    assert.deepEqual(pin.snapshot(),{connect_calls:1,release_requests:1,owner_releases:0,uncertain:false,active:false});
    assert.equal(rawReleaseCalls,0,'the pool client release must stay deferred until all post-Mark reads finish');
    await client.query();
    assert.equal(deferredReads,1);
    await pin.release();
    assert.equal(originalConnectCalls,0);
    assert.equal(rawReleaseCalls,1);
    assert.equal(destroyed,false);
    assert.equal(pin.snapshot().owner_releases,1);

    let failedReleaseCalls=0,failedRelease=false;
    const secondDb:{connect:()=>Promise<unknown>}={async connect(){throw new Error('unused original connect');}};
    const secondClient={release(error?:Error|boolean){failedReleaseCalls++;failedRelease=Boolean(error);}};
    const secondConnectDescriptor=Object.getOwnPropertyDescriptor(secondDb,'connect');
    const secondReleaseDescriptor=Object.getOwnPropertyDescriptor(secondClient,'release');
    const second=retainMarkValidationClientV1(secondDb,secondClient);
    let bodyCompleted=false;
    await assert.rejects(second.run(async()=>{
      const borrowed=await secondDb.connect();
      (borrowed as typeof secondClient).release();
      assert.throws(()=>secondDb.connect(),/mark_enr_unexpected_connect/u);
      bodyCompleted=true;
    }),/mark_enr_pin_incomplete|mark_enr_unexpected_connect/u);
    assert.equal(bodyCompleted,true,'the second-borrow error must be caught by the body before the pin rejects');
    assert.deepEqual(Object.getOwnPropertyDescriptor(secondDb,'connect'),secondConnectDescriptor);
    assert.deepEqual(Object.getOwnPropertyDescriptor(secondClient,'release'),secondReleaseDescriptor);
    assert.equal(second.snapshot().uncertain,true);
    await second.release();
    assert.equal(failedRelease,true,'uncertain client must be discarded on owner release');
    assert.equal(failedReleaseCalls,1);
    assert.equal(second.snapshot().owner_releases,1);
  });

  test('safe failure tree retains bounded codes without messages or mutable error descriptors',()=>{
    const primary=Object.assign(new Error('PRIVATE primary SQL and customer text'),{code:'23514'});
    const secondary=Object.assign(new Error('PRIVATE secondary cleanup detail'),{code:'XX000'});
    const cause=new AggregateError([primary,secondary],'PRIVATE aggregate',{cause:primary});
    const before=[cause,primary,secondary].map(error=>Object.getOwnPropertyDescriptors(error));
    const safe=markValidationSafeFailureV1(cause);
    assert.equal(safe.message,'mark_validation_enr_diagnostic_failed_see_safe_evidence');
    const encoded=JSON.stringify(safe.cause);
    assert.ok(encoded);
    assert.doesNotMatch(encoded,/PRIVATE|customer|SELECT|SQL/u);
    assert.match(encoded,/23514/u);
    assert.match(encoded,/XX000/u,'secondary failure may add a safe code without replacing the primary');
    assert.deepEqual([cause,primary,secondary].map(error=>Object.getOwnPropertyDescriptors(error)),before);

    const observation=createMarkValidationObservationV1();
    observation.enter('capture_read');
    observation.fail();
    observation.enter('probe_cleanup');
    observation.fail();
    assert.deepEqual(observation.snapshot(),{observation_stage:'probe_cleanup',failure_stage:'capture_read'});
    assert.throws(()=>observation.enter('PRIVATE_STAGE' as never),/mark_enr_observation_stage/u);
    assert.deepEqual(observation.snapshot(),{observation_stage:'probe_cleanup',failure_stage:'capture_read'});
  });
}
