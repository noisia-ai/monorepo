/** Private dev-test scheduler isolation; never installed by product migrations. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {createHybridMembershipRuntimeStoreV1,hybridMembershipDrainerSqlV1} from '../../services/workers/src/workers/signal-hybrid-membership';
import type {Pool,PoolClient} from '../../infrastructure/db/node_modules/@types/pg';
const functionName='mfp_harness.h1_audit_r8_calendar',triggerName='mfp_h1_audit_r8_calendar';
void main(async()=>{
  if(!process.argv.includes('--real'))throw new Error('mfp_isolation_real_required');
  const teardown=process.argv.includes('--teardown'),identity=await loadMfpEvalIdentity();
  const route=process.argv.find(arg=>arg.startsWith('--route-digest='))?.split('=')[1];
  const runId=process.argv.find(arg=>arg.startsWith('--run-id='))?.split('=')[1];
  if(!route||!/^sha256:[a-f0-9]{64}$/.test(route)||!runId||!/^[-a-f0-9]{36}$/.test(runId))throw new Error('mfp_isolation_arguments_invalid');
  const body=`BEGIN IF NEW.workspace_id='${identity.workspace_id}'::uuid AND NEW.membership_snapshot->>'route_digest'='${route}' THEN NEW.next_poll_at='infinity'::timestamptz; END IF; RETURN NEW; END`;
  const ddl=`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $isolation$${body}$isolation$;
    CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON signal_labeling_runs FOR EACH ROW EXECUTE FUNCTION ${functionName}();`;
  const hash=createHash('sha256').update(ddl).digest('hex'),pool=await openDatabase() as Pool;
  const client=await pool.connect();
  const scope=[identity.workspace_id,route];
  const directory='.data/dev-corpus/voyage-real/hybrid-h1-audit-r8';await mkdir(directory,{recursive:true,mode:0o700});
  try{
    const existing=(await client.query(`SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)`,[functionName+'()'])).rows[0];
    if(existing&&existing.prosrc!==body)throw new Error('mfp_isolation_existing_ddl_mismatch');
    if(teardown){
      await client.query('BEGIN');
      const activity=(await client.query(`SELECT count(*)::int active FROM signal_labeling_runs run WHERE run.workspace_id=$1
        AND run.membership_snapshot->>'route_digest'=$2 AND (run.status IN('queued','running') OR run.lease_token IS NOT NULL OR
          EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=run.id AND call.status IN('submitting','submitted','unknown')))`,scope)).rows[0];
      if(activity.active)throw new Error('mfp_isolation_teardown_active');
      if(existing){await client.query(`DROP TRIGGER ${triggerName} ON signal_labeling_runs; DROP FUNCTION ${functionName}();`);
        await client.query(`UPDATE signal_labeling_runs SET next_poll_at=now() WHERE workspace_id=$1 AND membership_snapshot->>'route_digest'=$2 AND next_poll_at='infinity'`,scope);}
      await client.query('COMMIT');
      const receipt={stage:'isolation_teardown',removed:!!existing,ddl_sha256:hash,active:0,at:new Date().toISOString()};
      await writeFile(`${directory}/isolation-teardown.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));return;
    }
    if(existing){console.log(JSON.stringify({stage:'isolation_already_installed',ddl_sha256:hash}));return;}
    // The run row lock serializes with product claim/reserve/markSubmitting. Never interrupt transport.
    for(let attempt=0;attempt<300;attempt++){
      await client.query('BEGIN');
      const before=(await client.query(`SELECT id,status,lease_token,lease_until,next_poll_at::text,waiting_full_confirmation
        FROM signal_labeling_runs WHERE id=$3 AND workspace_id=$1 AND membership_snapshot->>'route_digest'=$2 FOR UPDATE`,[...scope,runId])).rows[0];
      if(!before)throw new Error('mfp_isolation_run_identity_invalid');
      const active=(await client.query(`SELECT count(*)::int active FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2
        AND status IN('submitting','submitted','unknown')`,[identity.workspace_id,runId])).rows[0].active;
      if(before.lease_token||active){await client.query('ROLLBACK');await delay(100);continue;}
      if(before.status!=='running'||before.waiting_full_confirmation)throw new Error('mfp_isolation_run_not_claimable');
      const callsBefore=(await client.query('SELECT count(*)::int n FROM signal_labeling_calls')).rows[0].n;
      const otherBefore=(await client.query(`SELECT id,workspace_id,membership_snapshot->>'route_digest' route_digest,next_poll_at::text FROM signal_labeling_runs WHERE workspace_id<>$1
        OR membership_snapshot->>'route_digest' IS DISTINCT FROM $2 ORDER BY id`,scope)).rows;
      // Acceptance first, against real product tables/functions, then rollback to the locked preimage.
      await client.query('SAVEPOINT acceptance');await client.query(ddl);
      await client.query(`UPDATE signal_labeling_runs SET next_poll_at=now() WHERE id=$1`,[runId]);
      assert.equal((await client.query(hybridMembershipDrainerSqlV1)).rows.some(row=>row.id===runId),false);
      for(const other of [otherBefore.find(row=>row.workspace_id!==identity.workspace_id),otherBefore.find(row=>row.workspace_id===identity.workspace_id)]){
        assert.ok(other,'both nonmatching workspace and nonmatching route must exist');
        await client.query('SAVEPOINT other_scope_probe');
        await client.query('UPDATE signal_labeling_runs SET next_poll_at=now() WHERE id=$1',[other.id]);
        assert.notEqual((await client.query('SELECT next_poll_at::text FROM signal_labeling_runs WHERE id=$1',[other.id])).rows[0].next_poll_at,'infinity');
        await client.query('ROLLBACK TO SAVEPOINT other_scope_probe');
      }
      const query=async(sql:any,params?:any)=>{
        const command=typeof sql==='string'?sql.trim().toUpperCase():'';
        if(command==='BEGIN')return client.query('SAVEPOINT product');
        if(command==='COMMIT')return client.query('RELEASE SAVEPOINT product');
        if(command==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT product');
        return client.query(sql,params);
      };
      const database={query,connect:async()=>({query,release(){}} as unknown as PoolClient)} as unknown as Pool;
      const store=createHybridMembershipRuntimeStoreV1('jev',database),claimed=await store.claim(runId);
      assert.ok(claimed);assert.equal(await store.claim(runId),null,'lease excludes a second driver');
      const call=(await client.query('SELECT * FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at LIMIT 1',[runId])).rows[0];
      assert.ok(call);assert.equal((await store.reserve(claimed,[call],false))[0]!.id,call.id,'existing custom_id replays without a call');
      await store.release(claimed);
      assert.equal((await client.query('SELECT next_poll_at::text FROM signal_labeling_runs WHERE id=$1',[runId])).rows[0].next_poll_at,'infinity');
      assert.equal((await client.query('SELECT count(*)::int n FROM signal_labeling_calls')).rows[0].n,callsBefore);
      assert.deepEqual((await client.query(`SELECT id,workspace_id,membership_snapshot->>'route_digest' route_digest,next_poll_at::text FROM signal_labeling_runs WHERE workspace_id<>$1
        OR membership_snapshot->>'route_digest' IS DISTINCT FROM $2 ORDER BY id`,scope)).rows,otherBefore);
      await client.query('ROLLBACK TO SAVEPOINT acceptance');
      assert.deepEqual((await client.query(`SELECT id,status,lease_token,lease_until,next_poll_at::text,waiting_full_confirmation
        FROM signal_labeling_runs WHERE id=$1`,[runId])).rows[0],before);
      await client.query(ddl);await client.query(`UPDATE signal_labeling_runs SET next_poll_at='infinity' WHERE id=$1`,[runId]);
      await client.query('COMMIT');
      const receipt={stage:'isolation_postgres_acceptance_and_install',passed:true,ddl,ddl_sha256:hash,
        workspace_id:identity.workspace_id,route_digest:route,run_id:runId,before,after:{next_poll_at:'infinity'},
        checks:['exact_workspace_and_route','drainer_excluded','product_driver_claim','duplicate_driver_denied','reservation_replay','rollback_preimage','other_runs_unchanged'],
        transports_in_flight_under_lock:active,provider_calls:0,at:new Date().toISOString()};
      await writeFile(`${directory}/isolation-installed.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...receipt,ddl:undefined}));return;
    }
    console.log(JSON.stringify({stage:'isolation_waiting_safe_boundary',installed:false,provider_calls:0}));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
});
