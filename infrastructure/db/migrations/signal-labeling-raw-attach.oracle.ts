import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {labelingRawPageAttachSqlV1,labelingRawPageLockSqlV1} from '../signal-labeling-raw-page-store';
import type {LabelingDatabaseV1} from '../signal-mention-facets';

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
const lockSelectSha256=(sql=rawAttachLockSelectSqlV1)=>createHash('sha256').update(sql.replace(/\s+/gu,' ').trim()).digest('hex');

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
export function rawAttachLockSelectEvidenceV1(actual:{Plan:Record<string,unknown>;[key:string]:unknown},members:number,arm:'original'|'candidate'='original'){
 return{phase:'plan-captured',arm,members,actual_rows:actual.Plan['Actual Rows'],
  sql_sha256:lockSelectSha256(arm==='original'?rawAttachLockSelectSqlV1:labelingRawPageLockSqlV1),diagnostic_scope:'standalone synthetic oracle SELECT, not the mini/runtime query',
  first_for_update_scope:'each RR/layout arm starts after SAVEPOINT rollback to native KEY SHARE; reserve/mark committed before RR',
  prior_call_locks:'KEY SHARE retained from native member/FK guards',
  latency_scope:'includes KEY SHARE to FOR UPDATE upgrade; not production virgin locking latency',
  execution_ms:actual['Execution Time'],planning_ms:actual['Planning Time'],selected_nodes:nodes(actual.Plan)};
}
/** A second backend tests every committed call with a compatible KEY SHARE
 * request. Native 55P03 distinguishes an actual FOR UPDATE lock from the seed's
 * KEY SHARE, without SKIP LOCKED, changed guards, lock timeouts or extra fixtures.
 * The temporary function and all observer row locks roll back on every probe. */
export async function assertRawAttachLockSetV1(database:LabelingDatabaseV1,ownerPid:number,workspace:string,run:string,
 allIds:string[],lockedIds:string[],arm:string){
 const observer=await database.connect();
 try{
  assert.notEqual(Number((await observer.query('SELECT pg_backend_pid() pid')).rows[0].pid),ownerPid);
  await observer.query('BEGIN');
  await observer.query(`CREATE FUNCTION pg_temp.r16_raw_key_share_probe_v1(w uuid,r uuid,ids uuid[])
   RETURNS TABLE(id uuid,blocked boolean) LANGUAGE plpgsql AS $probe$
   DECLARE candidate_id uuid;found_id uuid;found_workspace uuid;found_run uuid;
   BEGIN
    FOR candidate_id IN SELECT q.value FROM unnest(ids) q(value) ORDER BY q.value LOOP
     BEGIN
      SELECT c.id,c.workspace_id,c.run_id INTO found_id,found_workspace,found_run
       FROM public.signal_labeling_calls c WHERE c.id=candidate_id FOR KEY SHARE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'raw_lock_oracle_call_missing'; END IF;
      IF found_workspace IS DISTINCT FROM w OR found_run IS DISTINCT FROM r THEN RAISE EXCEPTION 'raw_lock_oracle_scope_mismatch'; END IF;
      RETURN QUERY SELECT candidate_id,false;
     EXCEPTION WHEN lock_not_available THEN RETURN QUERY SELECT candidate_id,true;
     END;
    END LOOP;
   END $probe$`);
  const actual=(await observer.query<{id:string;blocked:boolean}>('SELECT * FROM pg_temp.r16_raw_key_share_probe_v1($1,$2,$3::uuid[])',[workspace,run,allIds])).rows;
  const selected=new Set(lockedIds),expected=[...allIds].sort().map(id=>({id,blocked:selected.has(id)}));
  const digest=(rows:unknown)=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const equal=digest(actual)===digest(expected);
  console.log('# raw attach lock-select semantic check '+JSON.stringify({arm,phase:'lockset',probed_calls:actual.length,
   blocked_calls:actual.filter(r=>r.blocked).length,expected_blocked_calls:lockedIds.length,exact_lockset:equal}));
  assert.equal(actual.length,allIds.length);assert.equal(equal,true,'every selected call must be UPDATE-locked and every disjoint call compatible');
 }finally{try{await observer.query('ROLLBACK');}finally{observer.release();}}
}
/** Both SELECT arms start at the same native KEY SHARE lock state. The savepoint
 * rollback releases each FOR UPDATE upgrade before the next arm; a separate
 * backend proves that reset and the complete held/disjoint lock set. */
export async function explainRawAttachLockSelectV1(c:PoolClient,args:[string,string,string],expected:string[],
 observe:(locked:string[],arm:string)=>Promise<void>){
 const before=await rawAttachSnapshotV1(c,args[2]),ordered=[...expected].sort();
 for(const [arm,sql]of [['original',rawAttachLockSelectSqlV1],['candidate',labelingRawPageLockSqlV1]]as const){
  await c.query('SAVEPOINT raw_lock_select_arm');let phase='lock-select-provenance';
  try{
   assert.equal(lockSelectSha256(),'b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670','frozen f0 lock SELECT must remain literal');
   phase='lock-select-reset-proof';await observe([],arm+'-baseline');
   phase='lock-select-explain';
   const actual=(await c.query('EXPLAIN (ANALYZE,BUFFERS,TIMING,FORMAT JSON) '+sql,args)).rows[0]['QUERY PLAN'][0];
   const safe=rawAttachLockSelectEvidenceV1(actual,ordered.length,arm);
   console.log('# raw attach lock-select native plan '+JSON.stringify(safe));
   phase='lock-select-row-count';assert.equal(safe.actual_rows,ordered.length);
   assert.ok(safe.selected_nodes.some(n=>n['Node Type']==='LockRows'&&n['Actual Loops']===1&&n['Actual Rows']===ordered.length));
   if(arm==='candidate'){
    const members=safe.selected_nodes.filter(n=>n['Relation Name']==='signal_labeling_raw_page_members');
    assert.ok(members.length>0&&members.every(n=>n['Actual Loops']===1),'physical page members must be scanned once');
    const arrays=safe.selected_nodes.filter(n=>n['CTE Name']==='raw_lock_page');
    assert.ok(arrays.length>0&&arrays.every(n=>rawAttachAtMostOnceV1(n['Actual Loops'])),'page ID InitPlans must have known zero/one loops');
   }
   phase='lock-select-exact-ids-order';
   const rows=(await c.query<{id:string}>(sql,args)).rows.map(row=>row.id);
   assert.deepEqual(rows,ordered,'semantic reentry preserves exact page IDs and global UUID output order');
   phase='lock-select-held-proof';await observe(ordered,arm+'-held');
   assert.deepEqual(await rawAttachSnapshotV1(c,args[2]),before,'SELECT locks never alter any call value');
   rawAttachPhaseV1('lock-select',arm,ordered.length,'complete');
  }catch(error){rawAttachPhaseV1(phase,arm,ordered.length,'failed',error);throw error;}
  finally{await c.query('ROLLBACK TO SAVEPOINT raw_lock_select_arm');await c.query('RELEASE SAVEPOINT raw_lock_select_arm');}
 }
 await observe([],'after-both-arms');
}
/** Semantic edge cases execute both frozen/current SELECTs without collecting
 * extra timing plans. Each replay is isolated so it cannot pre-lock a timed arm. */
export async function assertRawAttachLockRowsV1(c:PoolClient,args:[string,string,string],expected:string[]){
 const before=await rawAttachSnapshotV1(c,args[2]);
 for(const sql of [rawAttachLockSelectSqlV1,labelingRawPageLockSqlV1]){
  await c.query('SAVEPOINT raw_lock_rows');
  try{const rows=(await c.query<{id:string}>(sql,args)).rows.map(row=>row.id);assert.deepEqual(rows,[...expected].sort());}
  finally{await c.query('ROLLBACK TO SAVEPOINT raw_lock_rows');await c.query('RELEASE SAVEPOINT raw_lock_rows');}
 }
 assert.deepEqual(await rawAttachSnapshotV1(c,args[2]),before);
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
