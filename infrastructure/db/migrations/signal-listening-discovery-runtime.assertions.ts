import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {claimSignalListeningDiscoveryRoundV1,type ListeningDiscoveryLeaseV1} from '../signal-listening-discovery-money';
import {getSignalListeningDiscoveryWorkerContextV1,renewSignalListeningDiscoveryRoundV1,
  releaseSignalListeningDiscoveryRoundV1} from '../signal-listening-discovery-runtime';
import type {SignalListeningAccessV1} from '../signal-listening-configuration';

export async function assertDiscoveryRuntimeLeaseV1(access:SignalListeningAccessV1,initial:ListeningDiscoveryLeaseV1){
  const database=access.database,args={database,lease:initial};
  const context=await getSignalListeningDiscoveryWorkerContextV1(args);assert.ok(context);
  assert.equal(context.actor_user_id,access.actor_user_id);assert.equal(context.workspace_id,access.workspace_id);
  assert.equal(context.request_body,initial.request_body);assert.equal(context.status,'reviewing');
  for(const lease of [{...initial,workspace_id:randomUUID()},{...initial,execution_token:randomUUID()}]){
    assert.equal(await getSignalListeningDiscoveryWorkerContextV1({database,lease}),null);
    assert.equal(await renewSignalListeningDiscoveryRoundV1({database,lease}),false);
    assert.equal(await releaseSignalListeningDiscoveryRoundV1({database,lease}),false);
  }
  assert.equal(await renewSignalListeningDiscoveryRoundV1(args),true);
  assert.equal(await releaseSignalListeningDiscoveryRoundV1(args),true);
  assert.equal(await releaseSignalListeningDiscoveryRoundV1(args),false);
  assert.equal(await renewSignalListeningDiscoveryRoundV1(args),false);
  assert.equal(await getSignalListeningDiscoveryWorkerContextV1(args),null);
  let lease=await claimSignalListeningDiscoveryRoundV1({database,round_id:initial.round_id});assert.ok(lease);
  assert.notEqual(lease.execution_token,initial.execution_token);
  // A SHARE holder does not modify the row. The waiting renewal must recheck
  // wall clock after its row lock rather than resurrect an expired lease.
  await database.query("UPDATE signal_listening_discovery_rounds SET execution_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[lease.round_id]);
  const holder=await database.connect();let waiting:Promise<boolean>|undefined;
  try{
    await holder.query('BEGIN');await holder.query('SELECT id FROM signal_listening_discovery_rounds WHERE id=$1 FOR SHARE',[lease.round_id]);
    waiting=renewSignalListeningDiscoveryRoundV1({database,lease});
    let blocked=false;
    for(let n=0;n<40;n++){
      blocked=Number((await database.query(`SELECT count(*)::int n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'WITH locked AS MATERIALIZED%'`)).rows[0].n)>0;
      if(blocked)break;await delay(10);
    }
    assert.ok(blocked,'renewal actually waits on the live round lock');
    assert.equal((await holder.query('SELECT execution_expires_at>clock_timestamp() live FROM signal_listening_discovery_rounds WHERE id=$1',[lease.round_id])).rows[0].live,true);
    await holder.query('SELECT pg_sleep(1.1)');await holder.query('COMMIT');
    assert.equal(await waiting,false,'a post-lock clock fence rejects expiration during the wait');
  }finally{await holder.query('ROLLBACK').catch(()=>undefined);holder.release();await waiting?.catch(()=>undefined);}
  assert.equal(await releaseSignalListeningDiscoveryRoundV1({database,lease}),false);
  assert.equal(await getSignalListeningDiscoveryWorkerContextV1({database,lease}),null);
  lease=await claimSignalListeningDiscoveryRoundV1({database,round_id:initial.round_id});assert.ok(lease);
  assert.equal((await database.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[initial.round_id])).rows[0].n,0,
    'lease scheduling creates no provider reservation or attempt');
  return lease;
}
