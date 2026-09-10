import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {workspaceProjectionFixtureV1,fixtureSha} from './signal-workspace-topic-projection.fixture';
import {loadSignalWorkspaceCapabilitiesStoreV1,listSignalBrandWorkspaceEntriesStoreV1} from '../signal-workspace-capabilities';
import * as selection from '../signal-workspace-topic-selection';
import * as projection from '../signal-workspace-topic-projection';
import * as classification from '../signal-workspace-classification';
import {loadSignalWorkspaceTopicsOverviewV1} from '../signal-workspace-topics-serving';
import {loadSignalTopicCatalogStoreV1} from '../signal-topic-catalog';
import {beginSignalWorkspaceEngineV1,loadSignalWorkspaceEnginePreflightV1} from '../signal-workspace-engine';
import {requestSignalWorkspaceEmbeddingsStoreV1} from '../signal-workspace-embeddings-management';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1} from '@noisia/query-engine';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';

const enabled=process.env.NOISIA_CLIENT_WORKSPACE_ENTRY_PG_APPROVED==='true';
const forbidden=(error:unknown)=>error instanceof Error && 'status' in error && error.status===403;

test('assigned clients enter without a report and select current Signal Topics independently of execution authority',{
  skip:!enabled,timeout:90_000,
},async t=>{
  // Existing complete 3-root/133-chunk local fixture; no Python or provider.
  // Synthetic baseline receipts belong to the internal fixture actor, not clients.
  let applied=false;
  const f=await workspaceProjectionFixtureV1({migrations:[
    '0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql',
    '0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql',
    '0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql',
    '0147_signal_workspace_interpretation_admission.sql',
  ],onCheckpoint:async({query})=>{
    if(applied)return;applied=true;
    for(const file of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql',
      '0150_signal_workspace_incremental_editorial_preparation.sql','0151_signal_workspace_incremental_editorial_serving.sql',
      '0152_signal_workspace_incremental_editorial_renewal.sql']) await query(await readFile(new URL(file,import.meta.url),'utf8'));
  }});
  try{
    const request=await projection.requestSignalWorkspaceTopicProjectionV1({...f.access,engine_execution_id:f.engine_execution_id,
      idempotency_key:`workspace-projection:${f.engine_execution_id}`});
    await signalWorkspaceTopicProjectionJobV1({id:request.worker_job_id,data:{execution_id:request.execution_id},updateProgress:async()=>{}},{
      database:f.database,stores:{claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,
        readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,
        readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,
        commitPage:classification.commitSignalWorkspaceClassificationPageV1,finish:classification.finishSignalWorkspaceClassificationV1,
        fail:classification.failSignalWorkspaceClassificationV1},
      storage:{put:async()=>{throw Error('No projection upload');},get:async({stored,destination})=>{
        const body=f.bodies.get(stored.storage_key);assert.notEqual(body,undefined);await writeFile(destination,body!);
      }},
    });
    const workspace=(await f.query('SELECT brand_id,organization_id,slug FROM signal_workspaces WHERE id=$1::uuid',[f.workspace_id])).rows[0]!;
    const foreignOrg=randomUUID(),foreignBrand=randomUUID();
    await f.query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Local client entry test','active')",[foreignOrg,`client-entry-${foreignOrg}`]);
    await f.query("INSERT INTO brands(id,organization_id,slug,name,status) VALUES($1,$2,$3,'Local other tenant','active')",[foreignBrand,foreignOrg,`brand-${foreignBrand}`]);
    // Brand insertion provisions its workspace through the existing DB trigger.
    const foreignWorkspace=(await f.query('UPDATE signal_workspaces SET slug=$3 WHERE organization_id=$1 AND brand_id=$2 RETURNING id',[foreignOrg,foreignBrand,workspace.slug])).rows[0]!.id as string;
    const createActor=async(role:string,grant:string|null,organization=workspace.organization_id)=>{
      const id=randomUUID();await f.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
        VALUES($1,$2,'Local rollback-only client','client',$3,$4,'active')`,[id,`${id}@client-entry.example.test`,role,organization]);
      if(grant)await f.query('INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,$3)',[id,workspace.brand_id,grant]);
      return id;
    };
    const admin=await createActor('client_admin','admin'),comment=await createActor('brand_manager','comment'),owner=await createActor('client_owner','admin');
    const reader=await createActor('client_admin','read'),viewer=await createActor('client_viewer','admin'),agency=await createActor('agency_insights','comment');
    const noGrant=await createActor('client_admin',null),foreign=await createActor('client_admin','admin',foreignOrg);
    await f.query('INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,$3)',[foreign,foreignBrand,'admin']);
    const access=(actor_user_id:string)=>({...f.access,actor_user_id});
    const entries=(actor_user_id:string,workspace_slug?:string)=>listSignalBrandWorkspaceEntriesStoreV1({queryable:f.database,actor_user_id,workspace_slug});
    const caps=(actor_user_id:string)=>loadSignalWorkspaceCapabilitiesStoreV1({queryable:f.database,...access(actor_user_id)});
    const input=await classification.loadSignalWorkspaceClassificationInputV1({queryable:f.database,...f.access});
    const topic=input.topics[0]!.definition;
    const select={...access(admin),term_key:topic.term_key,selected:true,expected_selection_revision:0,
      expected_definition_revision:topic.definition_revision,expected_definition_digest:topic.definition_digest,
      generation_id:request.generation_id,idempotency_key:randomUUID()};
    const isolated=async(work:()=>Promise<void>)=>{await f.query('BEGIN');try{await work();}finally{await f.query('ROLLBACK');}};
    const snapshot=async()=>{
      const state:Record<string,unknown>={};
      for(const table of ['signal_topic_catalog_executions','signal_topic_classification_outbox','engine_cost_events',
        'signal_classification_assignments','signal_classification_generation_items','analysis_artifacts']){
        state[table]=(await f.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(to_jsonb(row)::text,'' ORDER BY row.id),'')) digest
          FROM ${table} row WHERE workspace_id=$1::uuid`,[f.workspace_id])).rows[0];
      }
      return state;
    };
    const before=await snapshot();
    await t.test('bulk entry exists without published output; identical slug cannot cross the tenant boundary',async()=>{
      assert.equal((await f.query('SELECT count(*)::int n FROM published_outputs WHERE brand_id=$1',[workspace.brand_id])).rows[0]!.n,0);
      const own=await entries(admin);assert.deepEqual(own.map(row=>row.workspace_id),[f.workspace_id]);
      assert.equal(own[0]!.capabilities.can_select_signal,true);assert.equal(own[0]!.capabilities.can_execute_topics,false);
      assert.deepEqual((await entries(admin,workspace.slug)).map(row=>row.workspace_id),[f.workspace_id]);
      assert.deepEqual((await entries(foreign,workspace.slug)).map(row=>row.workspace_id),[foreignWorkspace]);
      assert.deepEqual(await entries(noGrant),[]);assert.deepEqual(await entries(admin,'../studio'),[]);
      assert.equal((await caps(admin)).can_view,true);
      assert.ok(await loadSignalTopicCatalogStoreV1({queryable:f.database,workspace_id:f.workspace_id}));
      await assert.rejects(selection.loadSignalWorkspaceTopicSelectionV1({...access(admin),workspace_id:foreignWorkspace}),forbidden);
    });
    await t.test('DB roles and live grants separate selection/import from model, adoption and spending',async()=>{
      for(const actor of [admin,comment,owner]){
        const value=await caps(actor);assert.equal(value.can_view,true);assert.equal(value.can_select_signal,true);
        assert.equal(value.can_import_mentions,true);assert.equal(value.can_execute_topics,false);assert.equal(value.can_adopt_topics,false);
      }
      for(const actor of [reader,viewer,agency]){
        const value=await caps(actor);assert.equal(value.can_view,true);assert.equal(value.can_select_signal,false);
        assert.equal(value.can_import_mentions,false);assert.equal(value.can_execute_topics,false);
        assert.equal((await entries(actor)).length,1);
        await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,actor_user_id:actor,idempotency_key:randomUUID()}),forbidden);
      }
      for(const actor of [foreign,noGrant])await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,actor_user_id:actor,idempotency_key:randomUUID()}),forbidden);
      const preflight=await loadSignalWorkspaceEnginePreflightV1(f.access);
      await assert.rejects(beginSignalWorkspaceEngineV1({...access(admin),embedding_run_id:f.embedding_run_id,idempotency_key:randomUUID(),
        expected_catalog_digest:preflight.expected_catalog_digest,expected_context_digest:preflight.expected_context_digest,
        engine_config:{fixture:'client denied'},claude_cap_micro_usd:0}),forbidden);
      await assert.rejects(requestSignalWorkspaceEmbeddingsStoreV1({...access(admin),idempotency_key:randomUUID(),preparation_run_id:randomUUID(),
        quote_digest:fixtureSha('not an authority'),hard_cap_micro_usd:0,profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,provider_available:false}),forbidden);
    });
    await t.test('selection acknowledgement loss recovers the exact receipt and never replays another actor or body',async()=>{
      let lost=false;
      const ackDatabase=Object.assign(Object.create(f.database) as typeof f.database,{connect:async()=>{
        const client=await f.database.connect(),wrapped=Object.create(client) as typeof client;let committed=false;
        wrapped.query=(async(sql:string,params?:unknown[])=>{
          if(sql==='ROLLBACK'&&committed)throw Error('Transaction already committed');
          const result=await client.query(sql,params);
          if(sql==='COMMIT'&&!lost){committed=true;lost=true;throw Object.assign(Error('Local lost acknowledgement'),{code:'ECONNRESET'});}
          return result;
        }) as typeof client.query;return wrapped;
      }});
      await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,database:ackDatabase}),/Local lost acknowledgement/u);
      const receipt=await selection.loadSignalWorkspaceTopicSelectionV1({...access(admin),idempotency_key:select.idempotency_key});
      assert.equal(receipt.revision,1);assert.equal(receipt.request_receipt?.selection.selected,true);
      const replay=await selection.selectSignalWorkspaceTopicV1(select);assert.equal(replay.replayed,true);
      assert.equal(replay.operation_id,receipt.request_receipt?.operation_id);assert.equal(replay.revision,1);
      assert.equal((await selection.loadSignalWorkspaceTopicSelectionV1({...access(comment),idempotency_key:select.idempotency_key})).request_receipt,null);
      await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,actor_user_id:comment}),/idempotency_conflict/u);
      await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,selected:false}),/idempotency_conflict/u);
      await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,idempotency_key:randomUUID()}),/revision_conflict/u);
      const overview=await loadSignalWorkspaceTopicsOverviewV1(access(admin));
      assert.equal(overview?.terms.find(row=>row.term_key===topic.term_key)?.mention_count,3);
    });
    await t.test('a stale generation or definition cannot be selected, while explicit removal remains available',async()=>{
      await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,expected_selection_revision:1,
        expected_definition_digest:fixtureSha('changed definition'),idempotency_key:randomUUID()}),/definition_changed/u);
      await isolated(async()=>{
        await f.query('UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1',[f.workspace_id]);
        await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,expected_selection_revision:1,idempotency_key:randomUUID()}),/projection_stale/u);
        const remove={...select,selected:false,expected_selection_revision:1,idempotency_key:randomUUID()};
        assert.equal((await selection.selectSignalWorkspaceTopicV1(remove)).selection.selected,false);
        assert.equal((await selection.selectSignalWorkspaceTopicV1(remove)).replayed,true);
      });
      const remove={...select,selected:false,expected_selection_revision:1,idempotency_key:randomUUID()};
      const result=await selection.selectSignalWorkspaceTopicV1(remove);assert.equal(result.revision,2);assert.equal(result.selection.selected,false);
      assert.equal((await selection.selectSignalWorkspaceTopicV1(remove)).operation_id,result.operation_id);
    });
    await t.test('revocation, suspended actors and inactive subjects deny reads and accepted-key replay',async()=>{
      for(const mutation of [
        ()=>f.query("UPDATE users SET status='suspended' WHERE id=$1",[admin]),
        ()=>f.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[admin,workspace.brand_id]),
        ()=>f.query("UPDATE signal_workspaces SET status='paused' WHERE id=$1",[f.workspace_id]),
        ()=>f.query("UPDATE brands SET status='archived' WHERE id=$1",[workspace.brand_id]),
      ])await isolated(async()=>{
        await mutation();assert.deepEqual(await entries(admin),[]);assert.equal((await caps(admin)).can_select_signal,false);
        await assert.rejects(selection.loadSignalWorkspaceTopicSelectionV1(access(admin)),forbidden);
        await assert.rejects(selection.selectSignalWorkspaceTopicV1(select),forbidden);
      });
      // Deterministic interleaving on the real transaction, not a two-connection stress claim.
      await isolated(async()=>{
        let revoked=false;
        const database=Object.assign(Object.create(f.database) as typeof f.database,{connect:async()=>{
          const client=await f.database.connect(),wrapped=Object.create(client) as typeof client;
          wrapped.query=(async(sql:string,params?:unknown[])=>{
            const result=await client.query(sql,params);
            if(!revoked&&sql.includes('pg_advisory_xact_lock')){revoked=true;await client.query('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=$2',[admin,workspace.brand_id]);}
            return result;
          }) as typeof client.query;return wrapped;
        }});
        await assert.rejects(selection.selectSignalWorkspaceTopicV1({...select,database}),forbidden);assert.equal(revoked,true);
      });
    });
    assert.deepEqual(await snapshot(),before,'client reads, selection, removal and denials create no execution/outbox/cost/artifact or membership changes');
    assert.equal((await f.query("SELECT count(*)::int n FROM signal_topic_catalog_operations WHERE workspace_id=$1 AND action='select_signal'",[f.workspace_id])).rows[0]!.n,2);
  }finally{await f.cleanup();}
});
