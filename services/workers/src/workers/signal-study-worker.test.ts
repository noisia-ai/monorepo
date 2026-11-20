import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {signalStudyAnalysisReadyV1,signalStudyWorkerJobV1,drainSignalStudiesOnceV1,startSignalStudyDrainerV1,
 type SignalStudyWorkerOptionsV1} from './signal-study-worker';

const ready={NOISIA_SIGNAL_STUDY_ENABLED:'true',NOISIA_SIGNAL_LISTENING_ENABLED:'true',NOISIA_JEV_PROVIDER_ENABLED:'true',
 NOISIA_JEV_STREAMING_V2_ENABLED:'true',NOISIA_STUDY_ANTHROPIC_API_KEY:'synthetic-scoped',TYPESAFE_API_KEY:'synthetic-jev'};
test('Study analysis requires explicit capabilities and dedicated credentials without global fallback',()=>{
 assert.equal(signalStudyAnalysisReadyV1(ready),true);
 for(const flag of ['NOISIA_SIGNAL_STUDY_ENABLED','NOISIA_SIGNAL_LISTENING_ENABLED','NOISIA_JEV_PROVIDER_ENABLED','NOISIA_JEV_STREAMING_V2_ENABLED'])
  for(const value of [undefined,'false','TRUE','1'])assert.equal(signalStudyAnalysisReadyV1({...ready,[flag]:value}),false);
 assert.equal(signalStudyAnalysisReadyV1({...ready,NOISIA_STUDY_ANTHROPIC_API_KEY:undefined,ANTHROPIC_API_KEY:'synthetic-global'}),false);
 assert.equal(signalStudyAnalysisReadyV1({...ready,TYPESAFE_API_KEY:''}),false);
 assert.equal(signalStudyAnalysisReadyV1({...ready,NOISIA_STUDY_ANTHROPIC_API_KEY:'invalid\ncredential'}),false);
});
test('Study worker rejects malformed identity before opening database or Storage',async()=>{
 await assert.rejects(signalStudyWorkerJobV1('not-an-execution',{env:{}}),/study_worker_execution_invalid/u);
});
function db(ready:boolean){let reads=0;
 return{database:{query:async()=>{reads++;return{rows:[{ready}]};}}as unknown as NonNullable<SignalStudyWorkerOptionsV1['database']>,reads:()=>reads};
}
test('Study drain is harmless before additive schema exists and stops before scanning on shutdown',async()=>{
 const f=db(false);let pending=0;
 const result=await drainSignalStudiesOnceV1({database:f.database,pending:async()=>{pending++;return[];}});
 assert.deepEqual(result,{candidates:0,completed:0,waiting:0,failed:0});assert.equal(f.reads(),1);assert.equal(pending,0);
 await drainSignalStudiesOnceV1({database:f.database,should_stop:()=>true});assert.equal(f.reads(),1);
});
test('Study drain remains available for disabled-analysis bookkeeping without granting provider readiness',async()=>{
 const f=db(true),execution_id=randomUUID();let received:string|undefined;
 const result=await drainSignalStudiesOnceV1({database:f.database,env:{},pending:async()=>[{execution_id}],
  job:(async(id,options)=>{received=id;assert.equal(signalStudyAnalysisReadyV1(options?.env??{}),false);return{status:'not_claimed'};})as typeof signalStudyWorkerJobV1});
 assert.equal(received,execution_id);assert.equal(result.waiting,1);assert.equal(result.failed,0);
 // This tests dispatch only. Financial recovery is covered by native PostgreSQL.
});
test('Study drainer coalesces ticks, executes serially and drains its current job before close',async()=>{
 const f=db(true),ids=[randomUUID(),randomUUID()];let release!:()=>void,entered!:()=>void,calls=0,stop:(()=>boolean)|undefined;
 const enteredPromise=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const drainer=startSignalStudyDrainerV1({database:f.database,run_immediately:false,interval_ms:60000,
  pending:async()=>ids.map(execution_id=>({execution_id})),job:(async(id,options)=>{
   calls++;assert.equal(id,ids[0]);stop=options?.should_stop;entered();await gate;return{status:'completed'};
  })as typeof signalStudyWorkerJobV1});
 try{const first=drainer.drainNow(),second=drainer.drainNow();assert.equal(first,second);await enteredPromise;
  assert.equal(calls,1);assert.equal(f.reads(),1);let closed=false;
  const closing=drainer.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false);assert.equal(stop?.(),true);
  release();await closing;await first;assert.equal(calls,1);await drainer.drainNow();assert.equal(f.reads(),1);
 }finally{release();await drainer.close();}
});
