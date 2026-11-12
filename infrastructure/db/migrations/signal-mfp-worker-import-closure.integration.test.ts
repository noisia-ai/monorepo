import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {createMassLabelingProductDatabaseFixtureV1} from "./signal-mass-labeling-product-database.synthetic.fixture";
import {seed,processingBatch,scalar,sha} from "./signal-import-finalization.synthetic.fixture";
import {createSignalSentioneCsvIngester,SENTIONE_CSV_47_HEADERS_V1} from "../sentione-csv-ingest";
import {completeWorkspaceImport,WorkspaceImportClosureReconciledError,type WorkspaceImportClosureRequest} from "../../../services/workers/src/workers/workspace-import-completion";

test("worker large closure has local budgets, native FK locks and durable COMMIT reconciliation",{
  skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:180_000
},async context=>{
  const {database,cleanup}=await createMassLabelingProductDatabaseFixtureV1();
  const setup=await database.connect();
  // pg-pool intentionally makes options.password non-enumerable. Copy the
  // verified fixture's endpoint and credential explicitly, never via spread.
  const closurePool=new pg.Pool({
    host:database.options.host,port:database.options.port,database:database.options.database,
    user:database.options.user,password:database.options.password,ssl:database.options.ssl,
    connectionTimeoutMillis:database.options.connectionTimeoutMillis,
    max:1,statement_timeout:50,lock_timeout:0
  });
  try{
    assert.ok(typeof database.options.password==='string' && database.options.password.length>0,
      'the guarded fixture must provide its SCRAM credential');
    const fixture=await seed(setup);
    await setup.query(`CREATE FUNCTION synthetic_closure_delay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='completed' AND NEW.source_file_name LIKE 'slow-%' THEN
        PERFORM pg_sleep(0.15); END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_closure_delay BEFORE UPDATE OF status ON import_batches
      FOR EACH ROW EXECUTE FUNCTION synthetic_closure_delay()`);
    const ingester=createSignalSentioneCsvIngester(database);
    async function prepare(name:string,records=50_000,typed=false){
      const text=`Synthetic valid content for ${name} with enough words to qualify for inclusion.`;
      const cells=(values:string[])=>values.map(value=>'"'+value.replaceAll('"','""')+'"').join(';');
      let content:string;
      if(typed){
        const row:Record<string,string>={id:name,text,Created:'2026-08-01T12:00:00Z'};
        content=cells([...SENTIONE_CSV_47_HEADERS_V1])+'\r\n'+cells(SENTIONE_CSV_47_HEADERS_V1.map(key=>row[key]??''))+'\r\n';
      }else{
        const included=cells([name,text,'2026-08-01T12:00:00Z','web']);
        content='id;text;date;platform\r\n'+included+'\r\n\r\n; ; ;\r\n';
        if(records>1){
          content+=cells([name+'-excluded',sha(name).slice(7,15),'2026-08-01T12:00:00Z','web'])+'\r\n';
          content+=cells([name+'-multiline',text+'\nA second quoted line.','2026-08-01T12:00:00Z','web'])+'\r\n';
          content+=(included+'\r\n').repeat(records-3);
        }
      }
      const batch=await processingBatch(setup,fixture,content,name+'.csv');
      const verified=await ingester.inspectSentioneCsvStream({stream:new Blob([content]).stream()});
      assert.equal(verified.validationError,null);
      let progressRecords=0,processedBytes=0;
      const parsed=await ingester.ingestSentioneCsvStream({workspaceId:fixture.workspace,dataSourceId:fixture.source,
        importBatchId:batch.id,sourceFileName:name+'.csv',stream:new Blob([content]).stream(),tuning:{insertConcurrency:1},
        onProgress(stats,bytes){progressRecords=stats.record_count;processedBytes=bytes;}});
      assert.equal(parsed.stats.record_count,records,"logical CSV records, not physical lines");
      if(records===50_000)assert.deepEqual(parsed.stats,{record_count:50_000,included_count:2,excluded_count:1,duplicate_count:49_997});
      const request:WorkspaceImportClosureRequest={workspaceId:fixture.workspace,dataSourceId:fixture.source,
        importBatchId:batch.id,workerJobId:batch.job,fileHash:parsed.fileHash,verifiedHash:verified.fileHash,
        verifiedBytes:verified.sizeBytes,expectedBytes:Buffer.byteLength(content),processedBytes,progressRecords,stats:parsed.stats};
      return{batch,request,content};
    }
    const baseline=(await closurePool.query("SELECT pg_backend_pid() pid,current_database() database,current_user role,current_setting('statement_timeout') statement,current_setting('lock_timeout') lock")).rows[0];

    assert.ok(baseline.database===database.options.database && baseline.role===database.options.user,
      'closure pool must use the guarded fixture database and role');

    await context.test('small typed CSV keeps the original role timeout',async()=>{
      const small=await prepare('slow-small-typed',1,true);
      await assert.rejects(completeWorkspaceImport(closurePool,small.request),{code:'57014'});
      assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[small.batch.id]),'processing');
    });
    await context.test('verified 50k logical records close beyond the role timeout and reset LOCAL settings',async()=>{
      const large=await prepare('slow-large');
      const before=(await closurePool.query('SELECT pg_backend_pid() pid')).rows[0];
      const result=await completeWorkspaceImport(closurePool,large.request,{statementTimeoutMs:2000});
      assert.equal(result.rows[0]?.accepted,true);
      const after=(await closurePool.query("SELECT pg_backend_pid() pid,current_setting('statement_timeout') statement,current_setting('lock_timeout') lock")).rows[0];
      assert.equal(after.pid,before.pid,"successful closure returns the same clean backend to the pool");
      assert.equal(after.statement,baseline.statement);assert.equal(after.lock,baseline.lock);
      const replay=await completeWorkspaceImport(closurePool,large.request,{statementTimeoutMs:2000});
      assert.equal(replay.replayed,true);
      assert.equal(await scalar(setup,'SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1',[large.batch.id]),1);
    });
    await context.test('short local statement budget rolls back all publication',async()=>{
      const slow=await prepare('slow-timeout');
      await assert.rejects(completeWorkspaceImport(closurePool,slow.request,{statementTimeoutMs:25}),error=>error instanceof WorkspaceImportClosureReconciledError && (error.cause as {code:string}).code==='57014');
      assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[slow.batch.id]),'failed');
      assert.equal(await scalar(setup,'SELECT count(*)::int FROM signal_mention_attributions WHERE import_batch_id=$1',[slow.batch.id]),0);
      assert.equal(await scalar(setup,'SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1',[slow.batch.id]),0);
      assert.equal((await closurePool.query("SHOW statement_timeout")).rows[0].statement_timeout,baseline.statement);
    });
    await context.test('native parent FK remains enforced with a prudent local lock timeout',async()=>{
      const blocked=await prepare('blocked-fk');
      await setup.query('BEGIN');
      await setup.query('SELECT id FROM mentions WHERE source_file_id=$1 FOR UPDATE',[blocked.batch.id]);
      try{await assert.rejects(completeWorkspaceImport(closurePool,blocked.request,{statementTimeoutMs:2000,lockTimeoutMs:25}),error=>error instanceof WorkspaceImportClosureReconciledError && (error.cause as {code:string}).code==='55P03');}
      finally{await setup.query('ROLLBACK');}
      assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[blocked.batch.id]),'failed');
    });
    await context.test('failed initial checkout is reconciled without sending completion SQL',async()=>{
      const pending=await prepare('checkout-failed');
      const checkoutError=new Error('timeout exceeded when trying to connect');
      let acquisitions=0,nativeCalls=0;
      const intercepted=Object.assign(Object.create(closurePool) as pg.Pool,{connect:async()=>{
        if(++acquisitions===1)throw checkoutError;
        const client=await closurePool.connect();
        return{release:client.release.bind(client),query:(sql:string,params?:unknown[])=>{
          if(sql.includes('FROM complete_signal_workspace_import_v1'))nativeCalls++;
          return client.query(sql,params);
        }} as pg.PoolClient;
      }});
      await assert.rejects(completeWorkspaceImport(intercepted,pending.request,{statementTimeoutMs:2000}),error=>
        error instanceof WorkspaceImportClosureReconciledError && error.cause===checkoutError);
      assert.equal(nativeCalls,0);assert.equal(acquisitions,2);
      assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[pending.batch.id]),'failed');
      assert.equal(await scalar(setup,'SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1',[pending.batch.id]),0);
    });
    await context.test('same-batch native completion keeps advisory-before-row lock order',async()=>{
      const pending=await prepare('concurrent-close');
      const pid=(await closurePool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      let nativeCalls=0;
      const observed=Object.assign(Object.create(closurePool) as pg.Pool,{connect:async()=>{
        const client=await closurePool.connect();
        return{release:client.release.bind(client),query:(sql:string,params?:unknown[])=>{
          if(sql.includes('FROM complete_signal_workspace_import_v1'))nativeCalls++;
          return client.query(sql,params);
        }} as pg.PoolClient;
      }});
      await setup.query('BEGIN');
      await setup.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace-import:'||$1::text,0))",[pending.batch.id]);
      const competing=completeWorkspaceImport(observed,pending.request,{statementTimeoutMs:5000}).then(
        value=>({value,error:null}),error=>({value:null,error}));
      try{
        const until=performance.now()+3000;
        while(await scalar<number>(setup,'SELECT cardinality(pg_blocking_pids($1))',[pid])===0){
          assert.ok(performance.now()<until,'competing closure must wait on the native batch advisory');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        const stats=pending.request.stats;
        await setup.query('SELECT * FROM complete_signal_workspace_import_v1($1,$2,$3,$4,$5,$6,$7,$8)',[
          pending.batch.id,pending.batch.job,pending.request.fileHash,stats.record_count,
          stats.included_count,stats.excluded_count,stats.duplicate_count,pending.request.processedBytes]);
        await setup.query('COMMIT');
        const result=await competing;
        assert.equal(result.error,null);assert.equal(result.value?.replayed,true);
        assert.equal(nativeCalls,0,'the waiting worker reads the durable receipt instead of running closure twice');
      }finally{await setup.query('ROLLBACK');await competing;}
    });
    for(const commitApplied of [true,false])await context.test(`lost COMMIT acknowledgement, server applied=${commitApplied}`,async()=>{
      const pending=await prepare(commitApplied?'commit-applied':'commit-not-sent');
      let closures=0,failedOnce=false;
      const intercepted=Object.assign(Object.create(closurePool) as pg.Pool,{connect:async()=>{
        const client=await closurePool.connect();
        return {release:client.release.bind(client),query:async(sql:string,params?:unknown[])=>{
          if(sql.includes('FROM complete_signal_workspace_import_v1'))closures++;
          if(sql==='COMMIT'&&!failedOnce){
            failedOnce=true;
            if(commitApplied){await client.query(sql);return new Promise(()=>undefined);}
            throw Object.assign(new Error('COMMIT acknowledgement lost'),{code:'ECONNRESET'});
          }
          return client.query(sql,params);
        }} as pg.PoolClient;
      }});
      if(commitApplied){
        const result=await completeWorkspaceImport(intercepted,pending.request,{statementTimeoutMs:2000,operationTimeoutMs:300,reconciliationRetryDelayMs:0});
        assert.equal(result.replayed,true);assert.equal(result.rows[0]?.accepted,true);
        assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[pending.batch.id]),'completed');
        assert.equal(await scalar(setup,"SELECT count(*)::int FROM signal_workspace_import_events WHERE import_batch_id=$1 AND event_type='failed'",[pending.batch.id]),0);
      }else{
        await assert.rejects(completeWorkspaceImport(intercepted,pending.request,{statementTimeoutMs:2000,operationTimeoutMs:300,reconciliationRetryDelayMs:0}),WorkspaceImportClosureReconciledError);
        assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[pending.batch.id]),'failed');
        const recovered=(await setup.query(`SELECT import_batch_id FROM create_signal_workspace_import_storage_recovery_v1($1,$2,$3,$4,NULL)`,
          [pending.batch.id,fixture.actor,sha(randomUUID()),sha(randomUUID())])).rows[0];
        assert.ok(recovered.import_batch_id,"normal UI storage recovery remains available");
      }
      assert.equal(closures,1,"only the CAS/read fence may be retried");
      assert.equal((await closurePool.query('SHOW statement_timeout')).rows[0].statement_timeout,baseline.statement);
    });
    await context.test('confirmed worker closure survives auxiliary progress and metrics failures',async()=>{
      const originalFetch=globalThis.fetch;
      const originalUrl=process.env.SUPABASE_URL,originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
      const originalWorkerPool=globalThis.noisiaWorkerPgPool,originalNumericPool=globalThis.noisiaWorkerNumericPgPool;
      const nativeConnect=closurePool.connect.bind(closurePool);
      globalThis.noisiaWorkerPgPool=closurePool;globalThis.noisiaWorkerNumericPgPool=closurePool;
      process.env.SUPABASE_URL='https://synthetic-storage.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
      try{
        const {ingestMentionsCsvJob}=await import('../../../services/workers/src/workers/mentions-csv-ingest');
        for(const fault of ['progress','metrics','closure-sql','commit-applied','commit-not-sent']){
          const pending=await prepare('worker-'+fault);
          globalThis.fetch=async url=>{assert(String(url).startsWith('https://synthetic-storage.invalid/storage/'));return new Response(pending.content);};
          let nativeCalls=0,metricsFailed=false,ackLost=false,failureFenceAttempts=0;
          closurePool.connect=(async()=>{
            const client=await nativeConnect();
            let closingClient=false;
            return{release:client.release.bind(client),query:async(sql:string,params?:unknown[])=>{
              if(sql.includes('FROM complete_signal_workspace_import_v1')){
                nativeCalls++;closingClient=true;
                if(fault==='closure-sql')throw Object.assign(new Error('synthetic closure SQL timeout'),{code:'57014'});
              }
              if(fault==='closure-sql'&&sql.includes('fail_signal_workspace_import_v1')&&++failureFenceAttempts===1){
                throw Object.assign(new Error('synthetic failure fence connection loss'),{code:'ECONNRESET'});
              }
              if(sql==='COMMIT'&&closingClient&&!ackLost&&fault.startsWith('commit-')){
                ackLost=true;
                if(fault==='commit-applied')await client.query(sql,params);
                throw Object.assign(new Error('synthetic COMMIT acknowledgement lost'),{code:'ECONNRESET'});
              }
              if(fault==='metrics'&&sql.includes('record_signal_workspace_import_metrics_v1')&&!metricsFailed){
                metricsFailed=true;throw new Error('synthetic metrics transport failure');
              }
              return client.query(sql,params);
            }} as pg.PoolClient;
          }) as typeof closurePool.connect;
          const operation=ingestMentionsCsvJob({id:pending.batch.job,data:{importBatchId:pending.batch.id,
            workspaceId:fixture.workspace,dataSourceId:fixture.source,sourceFileName:'worker-'+fault+'.csv'},
            updateProgress:async(value:number)=>{if(fault==='progress'&&value===100)throw new Error('synthetic progress failure');}} as never);
          const failed=fault==='closure-sql'||fault==='commit-not-sent';
          if(fault==='closure-sql')await assert.rejects(operation,error=>error instanceof WorkspaceImportClosureReconciledError && (error.cause as {code:string}).code==='57014');
          else if(failed)await assert.rejects(operation);
          else assert.equal((await operation).accepted,true);
          assert.equal(nativeCalls,1);
          if(fault==='closure-sql'){
            assert.equal(failureFenceAttempts,2,'only durable failure reconciliation retries after SQL rollback');
            assert.equal(await scalar(setup,"SELECT failure_detail->>'sqlstate' FROM import_batches WHERE id=$1",[pending.batch.id]),'57014');
          }
          assert.equal(await scalar(setup,'SELECT status FROM import_batches WHERE id=$1',[pending.batch.id]),failed?'failed':'completed');
          assert.equal(await scalar(setup,"SELECT count(*)::int FROM signal_workspace_import_events WHERE import_batch_id=$1 AND event_type='failed'",[pending.batch.id]),failed?1:0);
          closurePool.connect=nativeConnect as typeof closurePool.connect;
        }
      }finally{
        globalThis.fetch=originalFetch;closurePool.connect=nativeConnect as typeof closurePool.connect;
        globalThis.noisiaWorkerPgPool=originalWorkerPool;globalThis.noisiaWorkerNumericPgPool=originalNumericPool;
        if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;
        if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
      }
    });
  }finally{setup.release();await closurePool.end();await cleanup();}
});
