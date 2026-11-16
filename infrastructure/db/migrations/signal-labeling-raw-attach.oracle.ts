import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {labelingRawPageAttachSqlV1} from '../signal-labeling-raw-page-store';

// Verbatim attach UPDATE from product 0c216867a264d9f8cc35db05a8e991423dea9676.
// This independent reference is intentionally not built from the candidate.
export const rawAttachBeforeSqlV1=`UPDATE signal_labeling_calls c SET raw_sha256=m.raw_sha256,raw_storage_key=p.storage_key,
        raw_size_bytes=m.raw_size_bytes,raw_storage_verified_at=COALESCE(c.raw_storage_verified_at,p.verified_at),
        raw_storage_verified_key=p.storage_key,updated_at=CASE WHEN c.raw_sha256 IS NULL THEN clock_timestamp() ELSE c.updated_at END
        FROM signal_labeling_raw_page_members m JOIN signal_labeling_raw_pages p ON p.id=m.page_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 AND c.id=m.call_id AND c.workspace_id=m.workspace_id AND c.run_id=m.run_id
          AND c.request_digest=m.request_digest AND p.status='verified'
          AND (c.raw_sha256 IS NULL OR c.raw_sha256=m.raw_sha256 AND c.raw_storage_key=p.storage_key AND c.raw_size_bytes=m.raw_size_bytes)
        RETURNING c.id`;

// Verbatim attach lock SELECT from f0dca220002e057385b201fd14c5532aa58686f8.
// This is a separate synthetic oracle, not instrumentation of a mini query.
export const rawAttachLockSelectSqlV1=`SELECT c.id FROM signal_labeling_calls c
        JOIN signal_labeling_raw_page_members m ON m.call_id=c.id AND m.workspace_id=c.workspace_id AND m.run_id=c.run_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 ORDER BY c.id FOR UPDATE OF c`;
const lockSelectSha256=()=>createHash('sha256').update(rawAttachLockSelectSqlV1.replace(/\s+/gu,' ').trim()).digest('hex');

type Snapshot=Array<{id:string;stable:string;updated_at:string;fresh:boolean}>;
export async function rawAttachSnapshotV1(c:PoolClient,run:string):Promise<Snapshot>{
 return(await c.query(`SELECT c.id,(to_jsonb(c)-'updated_at')::text stable,c.updated_at::text updated_at,
  c.raw_sha256 IS NULL fresh FROM signal_labeling_calls c WHERE c.run_id=$1 ORDER BY c.id`,[run])).rows;
}
export type RawAttachPlanV1={phase:'plan-captured';arm:string;members:number;actual_rows:unknown;plan:unknown;execution_ms:number;planning_ms:number;
 trigger_stats:Array<{name:string;calls:number;ms:number}>;selected_nodes:Record<string,unknown>[]};
/** A lazy InitPlan may be unexecuted. Unknown values are never inferred as 0. */
export function rawAttachAtMostOnceV1(loops:unknown):boolean{
 return typeof loops==='number'&&Number.isSafeInteger(loops)&&loops>=0&&loops<=1;
}
export function rawAttachPhaseV1(phase:string,arm:string,members:number,event:string,error?:unknown){
 const code=typeof error==='object'&&error!==null&&'code'in error&&typeof error.code==='string'
  &&/^[A-Z0-9_]{1,40}$/u.test(error.code)?error.code:undefined;
 console.log('# raw attach oracle phase '+JSON.stringify({phase,arm,members,event,...(error===undefined?{}:{code:code??'unknown'})}));
}
function nodes(plan:Record<string,unknown>,out:Record<string,unknown>[]=[]){
 const keys=['Node Type','Parent Relationship','Subplan Name','Relation Name','Index Name','CTE Name','Alias','Plan Rows','Plan Width',
  'Actual Rows','Actual Loops','Actual Total Time','Rows Removed by Filter','Rows Removed by Join Filter','Shared Hit Blocks',
  'Shared Read Blocks','Temp Read Blocks','Temp Written Blocks'];
 out.push(Object.fromEntries(keys.filter(k=>k in plan).map(k=>[k,plan[k]])));
 for(const child of (plan.Plans??[])as Record<string,unknown>[])nodes(child,out);return out;
}
export function rawAttachLockSelectEvidenceV1(actual:{Plan:Record<string,unknown>;[key:string]:unknown},members:number){
 return{phase:'plan-captured',arm:'literal-f0-lock-select',members,actual_rows:actual.Plan['Actual Rows'],
  sql_sha256:lockSelectSha256(),diagnostic_scope:'standalone synthetic oracle SELECT, not the mini/runtime query',
  first_for_update_scope:'current RR/layout only; native reserve/mark committed before this transaction',
  prior_call_locks:'KEY SHARE retained from native member/FK guards',
  latency_scope:'includes KEY SHARE to FOR UPDATE upgrade; not production virgin locking latency',
  execution_ms:actual['Execution Time'],planning_ms:actual['Planning Time'],selected_nodes:nodes(actual.Plan)};
}
/** The layout seed has only native KEY SHARE call locks. This exact SELECT is
 * its first FOR UPDATE on calls; no page FOR UPDATE or direct ID lock precedes
 * it. Its locks remain until the enclosing RR/layout rollback. */
export async function explainRawAttachLockSelectV1(c:PoolClient,args:[string,string,string],members:number){
 let phase='lock-select-provenance';
 try{
  assert.equal(lockSelectSha256(),'b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670','frozen f0 lock SELECT must remain literal');
  phase='lock-select-explain';
  const actual=(await c.query('EXPLAIN (ANALYZE,BUFFERS,TIMING,FORMAT JSON) '+rawAttachLockSelectSqlV1,args)).rows[0]['QUERY PLAN'][0];
  const safe=rawAttachLockSelectEvidenceV1(actual,members);
  // Distinct prefix, before all plan/count assertions. No full plan, SQL,
  // IndexCond, Filter, binds, UUIDs or request/body values leave this helper.
  console.log('# raw attach lock-select native plan '+JSON.stringify(safe));
  phase='lock-select-row-count';assert.equal(safe.actual_rows,members);
  assert.ok(safe.selected_nodes.some(n=>n['Node Type']==='LockRows'&&n['Actual Loops']===1&&n['Actual Rows']===members),
   'the literal SELECT must execute its actual LockRows for exactly this page');
  rawAttachPhaseV1('lock-select',safe.arm,members,'complete');
 }catch(error){rawAttachPhaseV1(phase,'literal-f0-lock-select',members,'failed',error);throw error;}
}
/** Both DML arms execute under a savepoint against the exact same locked native
 * fixture. No trigger, GUC, planner switch or clock is replaced. */
export async function assertRawAttachOracleV1(c:PoolClient,args:[string,string,string],expected:string[],plans:RawAttachPlanV1[]){
 const before=await rawAttachSnapshotV1(c,args[2]),ordered=[...expected].sort();let reference:Snapshot|undefined;
 for(const [arm,sql]of [['original',rawAttachBeforeSqlV1],['candidate',labelingRawPageAttachSqlV1]]as const){
  await c.query('SAVEPOINT raw_attach_arm');
  let phase='physical-clock-before';
  try{
   const lower=(await c.query('SELECT clock_timestamp()::text value')).rows[0].value;
   // Actual UPDATE with all native guards. Map construction is inside EXPLAIN,
   // and the plan includes target scans, all InitPlans, widths and buffer/temp IO.
   phase='explain';const actual=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,args)).rows[0]['QUERY PLAN'][0];
   const observed=nodes(actual.Plan);
   const captured:RawAttachPlanV1={phase:'plan-captured',arm,members:expected.length,actual_rows:actual.Plan['Actual Rows'],plan:actual,
    execution_ms:actual['Execution Time'],planning_ms:actual['Planning Time'],
    trigger_stats:(actual.Triggers??[]).map((t:Record<string,unknown>)=>({name:String(t['Trigger Name']),calls:Number(t.Calls),ms:Number(t.Time)})),selected_nodes:observed};
   plans.push(captured);
   // Emit the sanitized actual plan BEFORE every validation, even if this arm
   // subsequently fails. Full SQL/IndexCond/Filter/binds stay only in memory.
   const {plan,...safe}=captured;console.log('# raw attach original/candidate native plan '+JSON.stringify(safe));
   phase='physical-clock-after';const upper=(await c.query('SELECT clock_timestamp()::text value')).rows[0].value;
   phase='returning-count';assert.equal(actual.Plan['Actual Rows'],expected.length,'RETURNING must emit exactly the page member count');
   if(arm==='candidate'){
    phase='member-scan-bound';
    const memberScans=observed.filter(n=>n['Relation Name']==='signal_labeling_raw_page_members');
    assert.ok(memberScans.length>0);assert.ok(memberScans.every(n=>n['Actual Loops']===1),'candidate scans page members only once');
    const mapScans=observed.filter(n=>n['CTE Name']==='raw_attach_page');
    phase='map-scan-bound';assert.ok(mapScans.length>0);
    assert.ok(mapScans.every(n=>rawAttachAtMostOnceV1(n['Actual Loops'])),'uncorrelated map/ID/scalar InitPlans must have a known 0 or 1 loops; rescans and unknowns are rejected');
   }
   phase='exact-target-ids';
   const found=(await c.query(`SELECT c.id FROM signal_labeling_calls c JOIN signal_labeling_raw_pages p ON p.id=$1
    WHERE c.run_id=$3 AND c.workspace_id=$2 AND c.raw_storage_key=p.storage_key ORDER BY c.id`,args)).rows.map(r=>r.id);
   assert.deepEqual(found,ordered,'native attach must change exactly the selected page and no disjoint call');
   phase='snapshot-and-disjoint';const after=await rawAttachSnapshotV1(c,args[2]);
   assert.equal(after.length,before.length);
   for(let i=0;i<after.length;i++){
    const a=after[i]!,b=before[i]!;assert.equal(a.id,b.id);
    if(!ordered.includes(a.id))assert.deepEqual(a,b,'disjoint calls remain byte-identical');
    else if(!b.fresh)assert.equal(a.updated_at,b.updated_at,'partial replay preserves its original timestamp exactly');
   }
   phase='physical-timestamp-bracket';const fresh=before.filter(row=>row.fresh&&ordered.includes(row.id)).map(row=>row.id);
   const stamps=(await c.query(`SELECT COALESCE(bool_and(updated_at BETWEEN $2::timestamptz AND $3::timestamptz),true) valid
    FROM signal_labeling_calls WHERE id=ANY($1::uuid[])`,[fresh,lower,upper])).rows[0];
   assert.equal(stamps.valid,true,'first attachment uses the real physical clock inside this arm bracket');
   phase='cross-arm-equivalence';if(reference)assert.deepEqual(after.map(({updated_at,...row})=>row),reference.map(({updated_at,...row})=>row),
    'both arms preserve every other field including native bigint, timestamp microseconds, JSON and lineage');
   else reference=after;
   phase='exact-replay';const replay=await c.query(sql,args);assert.deepEqual(replay.rows.map(r=>r.id).sort(),ordered);
   assert.deepEqual(await rawAttachSnapshotV1(c,args[2]),after,'exact replay preserves every field including updated_at');
   rawAttachPhaseV1('exact-replay',arm,expected.length,'complete');
  }catch(error){rawAttachPhaseV1(phase,arm,expected.length,'failed',error);throw error;}
  finally{await c.query('ROLLBACK TO SAVEPOINT raw_attach_arm');await c.query('RELEASE SAVEPOINT raw_attach_arm');}
  rawAttachPhaseV1('rollback-preimage',arm,expected.length,'checking');
  assert.deepEqual(await rawAttachSnapshotV1(c,args[2]),before,'each DML arm rolls all siblings back to the identical preimage');
 }
}
export async function assertRawAttachDeniedV1(c:PoolClient,args:[string,string,string],run:string){
 const before=await rawAttachSnapshotV1(c,run);
 for(const sql of [rawAttachBeforeSqlV1,labelingRawPageAttachSqlV1]){
  await c.query('SAVEPOINT raw_attach_denied');
  try{const changed=await c.query(sql,args);assert.equal(changed.rows.length,0);}
  finally{await c.query('ROLLBACK TO SAVEPOINT raw_attach_denied');await c.query('RELEASE SAVEPOINT raw_attach_denied');}
  assert.deepEqual(await rawAttachSnapshotV1(c,run),before);
 }
}
