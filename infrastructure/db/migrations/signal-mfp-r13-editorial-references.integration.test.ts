import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Pool} from 'pg';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import {seedMassLabelingSiblingEditorialV1} from './signal-mfp-mass-labeling-sibling.synthetic.fixture';
import {prepareSignalTopicEditorialBatchV2,claimDueSignalTopicEditorialBatchV2,
  markSubmittingSignalTopicEditorialBatchV2,attachProviderSignalTopicEditorialBatchV2,
  persistSignalTopicEditorialBatchItemV2,finishSignalTopicEditorialBatchImportV2,
  signalTopicEditorialCanonicalBodyV2} from '../signal-topic-editorial-batch-v2';
import {validateSignalTopicEditorialGroupOutputV2,type SignalTopicEditorialGroupRequestV2} from '@noisia/query-engine';

test('R13 editorial SQL accepts warning-only references from settled V2 receipts while rejecting alien references and changed decisions',{
  skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:180_000,
},async()=>{
  const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  try{
    await raw.query('BEGIN');
    let sequence=0;const stack:string[]=[];
    const query=async(sql:string,values?:unknown[])=>{
      if(sql.startsWith('BEGIN')){const save=`refs_${++sequence}`;stack.push(save);return raw.query(`SAVEPOINT ${save}`);}
      if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if(sql==='ROLLBACK'){const save=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${save}`);return raw.query(`RELEASE SAVEPOINT ${save}`);}
      if(sql.startsWith('SET TRANSACTION'))return raw.query('SELECT 1');
      return raw.query(sql,values);
    };
    const scoped=Object.assign(Object.create(raw),{query,release(){}});
    const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
    const seed=await seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{}});
    const owner=await seedMassLabelingSiblingEditorialV1({database,scoped,query,cleanup:async()=>{},identity:seed.identity});
    const before=(await query('SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE execution_id=$1',[owner.execution_id])).rows[0]!.n;
    assert.equal(before,0);
    const requestDigest=(await query('SELECT request_digest FROM signal_topic_editorial_requests WHERE execution_id=$1 ORDER BY batch_index LIMIT 1',[owner.execution_id])).rows[0]!.request_digest;
    for(const mode of ['empty','missing','repeated','alien','changed'] as const){
      await query('SAVEPOINT reference_variant');
      try{
        const batch=await prepareSignalTopicEditorialBatchV2({database,execution_id:owner.execution_id,request_digests:[requestDigest],submission_key:randomUUID()});
        assert.ok(batch);
        const lease=await claimDueSignalTopicEditorialBatchV2({database,batch_id:batch.batch_id});
        assert.ok(lease);
        await markSubmittingSignalTopicEditorialBatchV2({database,lease});
        await attachProviderSignalTopicEditorialBatchV2({database,lease,receipt_body:JSON.stringify({id:`msgbatch_${randomUUID()}`,
          processing_status:'ended',request_counts:{succeeded:lease.items.length,errored:0,canceled:0,expired:0,processing:0}})});
        const item=lease.items[0]!,request=item.request as SignalTopicEditorialGroupRequestV2;
        assert.ok(request.receipt.evidence.length>0);
        const evidence=request.receipt.evidence[0]!;
        const ids=mode==='repeated'?Array.from({length:request.receipt.evidence.length+1},()=>evidence.evidence_id)
          :mode==='alien'?['evidence_alien']:[];
        const output={contract_version:'signal-topic-editorial-group-output-v2',group_id:request.receipt.group_id,
          disposition:'topic',candidate:{label:'Synthetic topic',definition:'A synthetic topic definition.',locale:request.receipt.expected_locale},
          confidence:.8,rationale:'Synthetic group evidence reviewed.',...(mode==='missing'?{}:{cited_evidence_ids:ids})};
        await persistSignalTopicEditorialBatchItemV2({database,lease,custom_id:item.custom_id,storage_key:'synthetic/r13-item.json',
          raw_body:JSON.stringify({custom_id:item.custom_id,result:{type:'succeeded',message:{model:request.provider_request.params.model,
            stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:10,output_tokens:10}}}})});
        const warnings=mode==='repeated'?['references_excess','references_repeated']:['references_missing'];
        const decision={contract_version:'signal-topic-editorial-group-decision-v2',identity:request.identity,
          request_digest:request.request_digest,group_key:request.receipt.group_key,group_digest:request.receipt.group_digest,
          dossier_digest:request.receipt.dossier_digest,evidence_scope:'cited_evidence_only',disposition:'topic',
          candidate:{...output.candidate,candidate_key:`topic-v2-${request.request_digest.slice(7,31)}`},confidence:.8,
          rationale:output.rationale,cited_ref_ids:mode==='repeated'?ids.map(()=>evidence.ref_id):[],warnings};
        if(mode==='changed')decision.candidate.definition='An invented replacement for the paid decision.';
        const body=signalTopicEditorialCanonicalBodyV2({status:'accepted',decision});
        if(mode==='alien'||mode==='changed'){
          await assert.rejects(query('SELECT validate_signal_topic_editorial_batch_item_v2($1,$2,$3,$4,signal_semantic_context_digest_v1($4))',[lease.batch_id,lease.lease_token,item.custom_id,body]),
            mode==='alien'?/citation_invalid/:/validation_source_mismatch/);
        }else{
          await query('SELECT validate_signal_topic_editorial_batch_item_v2($1,$2,$3,$4,signal_semantic_context_digest_v1($4))',[lease.batch_id,lease.lease_token,item.custom_id,body]);
          const saved=(await query('SELECT validation FROM signal_topic_editorial_batch_items_v2 WHERE batch_id=$1 AND custom_id=$2',
            [lease.batch_id,item.custom_id])).rows[0]!.validation;
          assert.deepEqual(saved.decision.warnings,warnings);
          assert.equal(saved.decision.cited_ref_ids.length,ids.length);
        }
      }finally{await query('ROLLBACK TO SAVEPOINT reference_variant');await query('RELEASE SAVEPOINT reference_variant');}
    }
    assert.equal((await query('SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE execution_id=$1',[owner.execution_id])).rows[0]!.n,before);
    // Complete the real screening lifecycle before exercising the global catalog trigger.
    const requests=(await query('SELECT request_digest FROM signal_topic_editorial_requests WHERE execution_id=$1 ORDER BY batch_index',[owner.execution_id])).rows;
    for(const row of requests){
      const batch=await prepareSignalTopicEditorialBatchV2({database,execution_id:owner.execution_id,request_digests:[row.request_digest],submission_key:randomUUID()});
      const lease=await claimDueSignalTopicEditorialBatchV2({database,batch_id:batch.batch_id});assert.ok(lease);
      await markSubmittingSignalTopicEditorialBatchV2({database,lease});
      await attachProviderSignalTopicEditorialBatchV2({database,lease,receipt_body:JSON.stringify({id:`msgbatch_${randomUUID()}`,
        processing_status:'ended',request_counts:{succeeded:1,errored:0,canceled:0,expired:0,processing:0}})});
      const item=lease.items[0]!,request=item.request;
      const output={contract_version:'signal-topic-editorial-group-output-v2' as const,group_id:request.receipt.group_id,
        disposition:'topic' as const,candidate:{label:'Synthetic topic',definition:'A synthetic topic definition.',locale:request.receipt.expected_locale},
        confidence:.8,rationale:'Synthetic evidence reviewed.',cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]};
      await persistSignalTopicEditorialBatchItemV2({database,lease,custom_id:item.custom_id,storage_key:'synthetic/normal.json',
        raw_body:JSON.stringify({custom_id:item.custom_id,result:{type:'succeeded',message:{model:request.provider_request.params.model,stop_reason:'end_turn',
          content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:10,output_tokens:10}}}})});
      const body=JSON.stringify({status:'accepted',decision:validateSignalTopicEditorialGroupOutputV2(request,output)});
      await query('SELECT validate_signal_topic_editorial_batch_item_v2($1,$2,$3,$4,signal_semantic_context_digest_v1($4))',[lease.batch_id,lease.lease_token,item.custom_id,body]);
      await finishSignalTopicEditorialBatchImportV2({database,lease});
    }
    const stage=randomUUID();
    await query(`INSERT INTO signal_topic_editorial_global_stages_v2(stage_id,workspace_id,organization_id,execution_id,processing_admission_id,
      snapshot_digest,screening_review_digest,expected_group_count)
      SELECT $2,e.workspace_id,e.organization_id,e.id,e.processing_admission_id,min(r.receipts#>>'{request,identity,snapshot_digest}'),
        signal_semantic_context_digest_v1('synthetic review'),run.expected_group_count
      FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_requests r ON r.execution_id=e.id
      JOIN signal_topic_consolidation_runs run ON run.id=e.numeric_run_id WHERE e.id=$1 GROUP BY e.id,run.expected_group_count`,[owner.execution_id,stage]);
    const groups=(await query(`SELECT r.receipts#>>'{request,receipt,group_key}' group_key,
      r.receipts#>'{request,source_group,evidence}' evidence FROM signal_topic_editorial_requests r WHERE r.execution_id=$1 ORDER BY r.batch_index`,[owner.execution_id])).rows;
    for(const mode of ['empty','repeated','alien','coverage','warning_tamper'] as const){
      await query('SAVEPOINT global_reference_variant');
      try{
        let entries=groups.map(g=>({group_key:g.group_key,status:'noise',cited_ref_ids:[] as string[],warnings:['references_missing']}));
        if(mode==='repeated')entries=groups.map(g=>({group_key:g.group_key,status:'noise',
          cited_ref_ids:Array.from({length:g.evidence.length+1},()=>g.evidence[0].ref_id),warnings:['references_excess','references_repeated']}));
        if(mode==='alien')entries[0]!.cited_ref_ids=['sha256:'+ 'f'.repeat(64)];
        if(mode==='coverage')entries=entries.slice(1);
        if(mode==='warning_tamper')entries[0]!.warnings=[];
        const operation=query(`INSERT INTO signal_topic_editorial_global_stage_catalog_v2(stage_id,catalog_digest,catalog_body,group_evidence)
          VALUES($1,signal_topic_editorial_digest_json_v1($2::jsonb),$2::jsonb,$3::jsonb)`,[stage,JSON.stringify({synthetic:true}),JSON.stringify(entries)]);
        if(['alien','coverage','warning_tamper'].includes(mode))await assert.rejects(operation,/global_catalog_coverage_invalid/);
        else{await operation;assert.equal((await query('SELECT jsonb_array_length(group_evidence)::int n FROM signal_topic_editorial_global_stage_catalog_v2 WHERE stage_id=$1',[stage])).rows[0]!.n,groups.length);}
      }finally{await query('ROLLBACK TO SAVEPOINT global_reference_variant');await query('RELEASE SAVEPOINT global_reference_variant');}
    }
    await raw.query('ROLLBACK');
  }finally{await raw.query('ROLLBACK').catch(()=>{});raw.release();await pool.end();}
});

test('R13 V1 paid projections retain decisions and raw reference multiplicity while warning on omissions and rejecting alien evidence',{
  skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:30_000,
},async()=>{
  const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
  const pool:Pool=await openDatabase();
  try{
    const ref='sha256:'+'1'.repeat(64),receipts=[{group_key:'group-a',evidence_ref_ids:[ref]}, {group_key:'group-b',evidence_ref_ids:[ref]}];
    const decision={group_key:'group-a',disposition:'topic',candidate:{candidate_key:'b0000-synthetic',label:'Synthetic topic',definition:'Synthetic definition',locale:'en-US'},
      confidence:.8,rationale:'Synthetic rationale',cited_ref_ids:[ref]};
    const output={contract_version:'signal-topic-editorial-screening-output-v1',batch_index:0,decisions:[decision]};
    const project=async(value:unknown)=>(await pool.query('SELECT signal_topic_editorial_reference_output_v1($1::jsonb,$2::jsonb) value',
      [JSON.stringify(value),JSON.stringify(receipts)])).rows[0]!.value;
    assert.deepEqual(await project(output),output,'warning-free historical JSON remains identical');
    for(const mode of ['empty','missing','repeated'] as const){
      const changed:Record<string,unknown>={...decision,cited_ref_ids:mode==='repeated'?Array.from({length:11},()=>ref):[]};
      if(mode==='missing')delete changed.cited_ref_ids;
      const projected=await project({...output,decisions:[changed]});
      assert.equal(projected.decisions[0].disposition,'topic');
      assert.deepEqual(projected.decisions[0].candidate,decision.candidate);
      assert.deepEqual(projected.decisions[0].warnings,mode==='repeated'?['references_excess','references_repeated']:['references_missing']);
      assert.equal(projected.decisions[0].cited_ref_ids.length,mode==='repeated'?11:0);
    }
    assert.equal(await project({...output,decisions:[{...decision,cited_ref_ids:['sha256:'+'f'.repeat(64)]}]}),null);
    assert.equal(await project({...output,decisions:[{...decision,cited_ref_ids:null}]}),null);
    assert.equal((await pool.query('SELECT signal_topic_editorial_reference_output_v1($1::jsonb,$2::jsonb) value',
      [JSON.stringify(output),JSON.stringify([{group_key:'group-a',evidence_ref_ids:[]}])])).rows[0]!.value,null);
    const partial='{"contract_version":"signal-topic-editorial-screening-output-v1","batch_index":0,"decisions":['+
      JSON.stringify({...decision,cited_ref_ids:[]})+',{"group_key":';
    const raw=JSON.stringify({type:'message',role:'assistant',model:'claude-sonnet-4-6',stop_reason:'max_tokens',
      usage:{input_tokens:10,output_tokens:8192},content:[{type:'text',text:partial}]});
    const recovered=(await pool.query('SELECT signal_topic_editorial_truncated_output_v1($1,$2::jsonb,0,8192) value',[raw,JSON.stringify(receipts)])).rows[0]!.value;
    assert.equal(recovered.decisions[0].disposition,'topic','a missing reference does not quarantine a complete paid decision');
    assert.deepEqual(recovered.decisions[0].warnings,['references_missing']);
    assert.equal(recovered.decisions[1].disposition,'unresolved','the incomplete group remains unresolved');
    assert.equal((await pool.query("SELECT has_function_privilege('anon','signal_topic_editorial_reference_output_v1(jsonb,jsonb)','EXECUTE') allowed")).rows[0]!.allowed,false);
  }finally{await pool.end();}
});
