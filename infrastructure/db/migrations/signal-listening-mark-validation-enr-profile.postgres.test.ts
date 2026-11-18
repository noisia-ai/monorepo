import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  extractMarkValidationEnrSourceV1,
  markValidationSafeFailureV1,
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
  });

  test('C plan sanitizer rejects poisoned ENR aliases and unknown structural nodes',()=>{
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{
      'Node Type':'Named Tuplestore Scan','Tuplestore Name':'private_customer_table','Actual Rows':1,'Actual Loops':1,
    }}]));
    assert.throws(()=>sanitizeBoundedPopulationPlanV1([{Plan:{'Node Type':'Private Executor','Actual Rows':1,'Actual Loops':1}}]));
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
    const leaf=Object.assign(new Error('PRIVATE SQL and customer text'),{code:'23514'});
    const cause=new AggregateError([leaf],'PRIVATE aggregate',{cause:leaf});
    const before=[cause,leaf].map(error=>Object.getOwnPropertyDescriptors(error));
    const safe=markValidationSafeFailureV1(cause);
    assert.equal(safe.message,'mark_validation_enr_diagnostic_failed_see_safe_evidence');
    const encoded=JSON.stringify(safe.cause);
    assert.ok(encoded);
    assert.doesNotMatch(encoded,/PRIVATE|customer|SELECT|SQL/u);
    assert.match(encoded,/23514/u);
    assert.deepEqual([cause,leaf].map(error=>Object.getOwnPropertyDescriptors(error)),before);
  });
}
