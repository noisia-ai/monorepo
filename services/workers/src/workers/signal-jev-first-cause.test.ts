import assert from 'node:assert/strict';
import test from 'node:test';
import {llmPriceV1,type FacetInput} from '@noisia/query-engine';
import type {LabelingCallV1,LabelingCallProposalV1,LabelingRunV1} from '@noisia/db';
import {processJevStreamingWindowV2,jevCallWorkingBytesV2} from './signal-jev-streaming-window';

type Args=Parameters<typeof processJevStreamingWindowV2<FacetInput,string>>[0];
type Stage='RAW'|'feedback'|'notification';
function gate(){let resolve!:()=>void;return{promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}
function fixture(stage:Stage,first:unknown){
  const execution={max_in_flight:2,window_size:2,flush_size:1,max_flushes:2,flush_interval_ms:1000,max_buffered_bytes:4*1024*1024};
  const run={id:'first-cause-run',lease_token:'lease',status:'running',error_code:null}as LabelingRunV1;
  const proposals:LabelingCallProposalV1<FacetInput>[]=Array.from({length:2},(_,i)=>({
    custom_id:'first-cause-'+i,request_digest:'digest-'+i,reserved_micro_usd:100,
    request:{model:'jev-1.13.0',state:'state-'+i,questions:{q:{type:'noul' as const,instructions:'Configured question'}}},
    inputs:[{root_id:'root-'+i,input_digest:'input-'+i,text:'state-'+i}as FacetInput],
  }));
  const asCall=(proposal:LabelingCallProposalV1<FacetInput>,status:'reserved'|'submitting'):LabelingCallV1<FacetInput>=>({
    ...proposal,request:JSON.parse(JSON.stringify(proposal.request)),inputs:JSON.parse(JSON.stringify(proposal.inputs)),
    id:'call-'+proposal.custom_id,status,raw_body:null,results_applied:false,provider_batch_id:null,retry_depth:0,
  });
  const rows=stage==='notification'?[]:proposals.map(proposal=>asCall(proposal,'reserved'));
  const sent:string[]=[],settled:string[]=[],applied:string[]=[],failed:string[]=[],snapshots:number[]=[],events:string[]=[];
  const durable=new Map<string,string>(),later=gate(),cancellation=new AbortController();
  cancellation.signal.addEventListener('abort',later.resolve,{once:true});
  const subsequent=Error('a later failure must never replace the first observed value');
  let rawFaults=0,feedbackFaults=0,feeds=0,notifications=0,finishCalls=0,technical=0;
  const store={
    async markSubmitting(_run:unknown,page:typeof rows){for(const row of page)row.status='submitting';},
    async persistRawPage(_run:unknown,page:Array<{call:LabelingCallV1<FacetInput>;raw:string}>){
      events.push('RAW');
      if(stage==='RAW'){
        if(rawFaults++===0)throw first;
        await later.promise;throw subsequent;
      }
      for(const row of page){durable.set(row.call.id,row.raw);row.call.raw_body=row.raw;}
    },
    async settlePage(_run:unknown,page:Array<{call:LabelingCallV1<FacetInput>}>){for(const row of page){settled.push(row.call.id);row.call.status='settled';}},
    async apply(_run:unknown,page:Array<{call:LabelingCallV1<FacetInput>}>){for(const row of page){applied.push(row.call.id);row.call.results_applied=true;}},
    async markFailed(_run:unknown,page:typeof rows,unknown:boolean){for(const row of page){failed.push(row.id);row.status=unknown?'unknown':'failed';}},
    async requeueUnsent(){throw Error('both committed cohort members were already delivered');},
    async fail(){throw Error('no invented technical result may replace the physical persistence/feedback failure');},
    async finish(){finishCalls++;return rows.every(row=>row.results_applied)?'completed':'outcome_unknown';},
  }as unknown as Args['store'];
  const args:Args={run,calls:rows,store,execution,cancellation,price:llmPriceV1('typesafe','jev-1.13.0','sync',.042),
    provider:{max_response_bytes:4096,max_concurrency:2,
      async evaluate(request){sent.push(String(request.state));return{http_status:200,latency_ms:1,body:JSON.stringify({
        model:request.model,usage:{input_tokens:10,output_tokens:0},answers:{q:{type:'noul',noul:.9}},
      })};},
      async observeUsage(){
        events.push('feedback');if(stage!=='feedback')return;
        if(feedbackFaults++===0)throw first;
        await later.promise;throw subsequent;
      },
    },
    hooks:{map:(_run,row)=>[row.id],error:()=>{technical++;return['technical'];},labeled:()=>true,fail_on_error:true},
    observe_stream:metrics=>snapshots.push(metrics.reserved_working_bytes),
  };
  if(stage==='notification'){
    args.calls=[];
    args.feed_next=async()=>++feeds===1?{proposals,workspace_bytes:64*1024,byte_limited:false,
      on_committed:()=>{notifications++;throw first;}}:{closed:true};
    store.admitAndMarkSelected=async(_run,candidates,callbacks)=>{
      const selected=callbacks.selectFresh(candidates),committed=selected.map(proposal=>asCall(proposal,'submitting'));
      callbacks.validateBeforeCommit(committed,selected);rows.push(...committed);return{kind:'committed',calls:committed};
    };
  }
  return{args,rows,sent,settled,applied,failed,snapshots,events,durable,cancellation,later,subsequent,
    state:()=>({rawFaults,feedbackFaults,feeds,notifications,finishCalls,technical})};
}

for(const stage of ['RAW','feedback','notification']as const)for(const [label,first]of [['null',null],['undefined',undefined],['zero',0]]as const){
  test(`stream first ${stage} failure preserves ${label} while every paid sibling drains`,{timeout:5000},async()=>{
    const f=fixture(stage,first);let rejected=false,caught:unknown;
    try{await processJevStreamingWindowV2(f.args);}catch(error){rejected=true;caught=error;}
    finally{f.cancellation.abort();f.later.resolve();}
    assert.equal(rejected,true,'falsy failures must not become a successful return or ledger-only status');
    assert.strictEqual(caught,first,'the first thrown value must survive a later truthy failure and reconciliation');
    assert.notStrictEqual(caught,f.subsequent);
    assert.deepEqual(f.sent,['state-0','state-1'],'all members already handed off are sent exactly once');
    assert.equal(new Set(f.rows.map(row=>row.id)).size,2);
    assert.equal(f.state().technical,0,'no replacement technical label');
    assert.equal(f.state().finishCalls,1,'the original failure is reconciled through the existing catch path');
    assert.ok(f.rows.every(row=>row.raw_body===null),'response custody ends after each consume finally');
    assert.ok(f.snapshots.every(value=>Number.isSafeInteger(value)&&value>=0&&value<=f.args.execution.max_buffered_bytes),'no negative/double credit or over-budget owner');
    if(stage==='RAW'){
      assert.equal(f.state().rawFaults,2,'both RAW failures were observed, including the later truthy one');
      assert.equal(f.durable.size,0);assert.equal(f.settled.length,0);assert.equal(f.applied.length,0);
      assert.ok(f.rows.every(row=>row.status==='unknown'&&!row.results_applied));
      assert.deepEqual([...new Set(f.failed)].sort(),f.rows.map(row=>row.id).sort(),'both physical outcomes remain unresolved for durable recovery');
    }else{
      assert.equal(f.durable.size,2);assert.deepEqual([...f.durable.keys()].sort(),f.rows.map(row=>row.id).sort());
      assert.equal(f.settled.length,2);assert.equal(f.applied.length,2);assert.equal(f.failed.length,0);
      assert.ok(f.rows.every(row=>row.status==='settled'&&row.results_applied));
      for(const raw of f.durable.values())assert.equal(JSON.parse(JSON.parse(raw).body).answers.q.noul,.9,'the exact persisted successful RAW still carries its original result');
      if(stage==='feedback')assert.equal(f.state().feedbackFaults,2,'both feedback failures drain before returning the first');
      else assert.equal(f.state().notifications,1,'the scheduler notice is not retried');
    }
    const retained=stage==='notification'?0:f.rows.reduce((sum,row)=>sum+jevCallWorkingBytesV2(row),0);
    assert.equal(f.snapshots.at(-1),retained,'after failure only the caller-owned initial request page remains; no RAW/workspace credit leaks');
  });
}
