import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {Pool} from 'pg';
import {syntheticClientWorkspaceFixtureV1} from './signal-client-workspace-entry.synthetic.fixture';
import {incrementalProjectionFixtureV1} from './signal-workspace-incremental-projection.fixture';
import {fixtureSha} from './signal-workspace-topic-projection.fixture';

test('MFP incremental history allows renewed discovery context only with frozen parent compatibility and live historical authority',{
  skip:process.env.NOISIA_MFP_PG_CI!=='true',timeout:300_000,
},async()=>{
  const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect();
  try{
    await raw.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    let sequence=0;const stack:string[]=[];
    const query=async(sql:string,params?:unknown[])=>{
      if(sql.startsWith('BEGIN')){const key=`context_history_${++sequence}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
      if(sql==='COMMIT')return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if(sql==='ROLLBACK'){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
      return raw.query(sql,params);
    };
    const scoped=Object.assign(Object.create(raw),{query,release(){}});
    const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
    const clusterIds=[randomUUID(),randomUUID()] as const,done=new Error('context history acceptance complete');
    let checked=false;
    await assert.rejects(syntheticClientWorkspaceFixtureV1({database,scoped,query,cleanup:async()=>{}},{projection:{
      cluster_ids:clusterIds,model_configuration:{fixture:true,versions:{python:'synthetic-context-history'}},
      onCheckpoint:async checkpoint=>{
        const f=await incrementalProjectionFixtureV1(checkpoint,clusterIds,{migrations_applied:true});
        const child=f.lease.execution_id,parent=checkpoint.lease.execution_id,workspace=f.access.workspace_id;
        const current=async()=>Boolean((await query('SELECT signal_workspace_incremental_projection_history_current_v1($1::uuid) current',[child])).rows[0].current);
        assert.equal(await current(),true,'genuine settled receipts, editorial cut and model lineage are current');
        const rows=(await query('SELECT id,input_snapshot FROM signal_topic_catalog_executions WHERE id=ANY($1::uuid[])',[[parent,child]])).rows;
        const parentSnapshot=rows.find(row=>row.id===parent)!.input_snapshot;
        const childSnapshot=rows.find(row=>row.id===child)!.input_snapshot;
        const body=(await query("SELECT prosrc FROM pg_proc WHERE oid='signal_workspace_incremental_projection_history_current_v1(uuid)'::regprocedure")).rows[0].prosrc as string;
        // Evaluate the ACTUAL migrated SQL over adjacent synthetic snapshots.
        // Execution rows stay immutable; all lineage/cut/receipt/model/rights
        // functions still resolve the genuine fixture rows, never mocked guards.
        const evaluate=async(parentInput:unknown,childInput:unknown)=>Boolean((await query(`WITH context_history_executions AS (
          SELECT (jsonb_populate_record(execution,jsonb_build_object('input_snapshot',
            CASE WHEN execution.id=$1::uuid THEN $2::jsonb WHEN execution.id=$3::uuid THEN $4::jsonb ELSE execution.input_snapshot END))).*
          FROM signal_topic_catalog_executions execution
        ) SELECT history.current FROM (${body.replaceAll('signal_topic_catalog_executions','context_history_executions').replaceAll('target_execution','$1::uuid')}) history(current)`,
          [child,JSON.stringify(childInput),parent,JSON.stringify(parentInput)])).rows[0].current);
        const discoveryParent={...parentSnapshot,guides:[],discovery_population:{contract_version:'signal-discovery-population-v1'}};
        const discoveryChild={...childSnapshot,guides:[],discovery_population:{contract_version:'signal-discovery-population-v1'},
          context_digest:fixtureSha('renewed governed alias and competitor context'),discovery_context_revision:fixtureSha('new context source revision')};
        assert.notEqual(discoveryChild.context_digest,discoveryParent.context_digest);
        assert.equal(await evaluate(discoveryParent,discoveryChild),true,'new governed discovery context does not mutate the frozen numeric model');
        assert.equal(await evaluate(parentSnapshot,{...childSnapshot,context_digest:discoveryChild.context_digest}),false,'legacy guided history still requires identical context');
        assert.equal(await evaluate(parentSnapshot,discoveryChild),false,'discovery cannot inherit a legacy parent');
        assert.equal(await evaluate({...discoveryParent,guides:[{}]},discoveryChild),false,'guided parent is not open discovery');
        assert.equal(await evaluate(discoveryParent,{...discoveryChild,guides:[{}]}),false,'guided child cannot bypass context equality');
        const descriptor=discoveryChild.numeric_descriptor;
        assert.equal(await evaluate(discoveryParent,{...discoveryChild,numeric_descriptor:{...descriptor,
          compatibility:{...descriptor.compatibility,context_digest:discoveryChild.context_digest}}}),false,'frozen compatibility context cannot be replaced by renewed context');
        assert.equal(await evaluate(discoveryParent,{...discoveryChild,numeric_descriptor:{...descriptor,
          compatibility:{...descriptor.compatibility,input_interest_catalog_digest:fixtureSha('foreign frozen interest catalog')}}}),false);
        assert.equal(await evaluate(discoveryParent,{...discoveryChild,numeric_descriptor:{...descriptor,
          editorial_cut:{...descriptor.editorial_cut,unit_digest:fixtureSha('mutated paid history')}}}),false,'editorial history remains fenced');
        await query('SAVEPOINT revoked_history');
        await query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1::uuid",[workspace]);
        assert.equal(await current(),false);
        assert.equal(await evaluate(discoveryParent,discoveryChild),false,'renewed context cannot restore revoked provenance');
        await query('ROLLBACK TO SAVEPOINT revoked_history');await query('RELEASE SAVEPOINT revoked_history');
        assert.equal(await current(),true);
        // No other history or serving guard is replaced by this migration.
        const old=(await readFile(new URL('./0146_signal_workspace_incremental_projection.sql',import.meta.url),'utf8'))
          .match(/CREATE FUNCTION signal_workspace_incremental_projection_history_current_v1[\s\S]*?AS \$\$([\s\S]*?)\$\$;/u)![1]!;
        const oldPredicate="parent.input_snapshot->>'context_digest'=child.input_snapshot->>'context_digest'";
        const changed=body.match(/CASE WHEN jsonb_typeof\(child.input_snapshot->'discovery_population'\)[\s\S]*? END/u)?.[0];
        assert.ok(changed);
        assert.equal(body.replace(changed,oldPredicate).trim(),old.trim(),'only the context compatibility predicate changes');
        checked=true;throw done;
      },
    }}),error=>error===done);
    assert.equal(checked,true);
  }finally{await raw.query('ROLLBACK');raw.release();await pool.end();}
});
