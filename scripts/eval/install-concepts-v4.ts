/** Confirmed data only; real acceptance rolls back product mutations before loading. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import type {Pool,PoolClient} from '../../infrastructure/db/node_modules/@types/pg';
// @ts-expect-error private guarded runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {createSignalTopicStoreV1,loadSignalTopicCatalogStoreV1,updateSignalTopicStoreV1} from '../../infrastructure/db/signal-topic-catalog';
import {signalTopicTermKeyV1} from '../../packages/query-engine/src/signal-topic-catalog-v1';
import {loadMfpEvalIdentity} from './fixture-identity';
import {V3_KEYS,confirmedConceptsV3,conceptInputV3,unchangedConceptV3,assertCatalogPreservedV3,catalogDefinitionV3} from './concepts-v3';
import {confirmedConceptsV4,COBROS_KEY_V4} from './concepts-v4';

const proposalPath=new URL('../../docs/product/PROMPT_LOOPING/CONFIRMED_MFP_CONCEPTS_V4_2026-10-13.json',import.meta.url);
const evaluationWorkspace='ba454146-8c92-4f38-83f3-fea9827b7e31';
const originWorkspace='9a695132-238b-4ce4-aa97-73c6a02da9d8';
void main(async()=>{
  const acceptance=process.argv.includes('--acceptance');
  if(!process.argv.includes('--real')||(!acceptance&&!process.argv.includes('--execute')))throw new Error('mfp_v4_arguments_invalid');
  const bytes=await readFile(proposalPath),hash=createHash('sha256').update(bytes).digest('hex');
  if(process.argv.find(arg=>arg.startsWith('--confirmed-definitions-sha256='))?.split('=')[1]!==hash)
    throw new Error('mfp_v4_confirmation_required');
  const concepts=confirmedConceptsV4(JSON.parse(bytes.toString('utf8'))),identity=await loadMfpEvalIdentity();
  if(identity.workspace_id!==evaluationWorkspace)throw new Error('mfp_v4_eval_identity_invalid');
  const pool=await openDatabase() as Pool;
  try{
    const targets=(await pool.query<{id:string;organization_id:string;brand_id:string;slug:string;actor:string}>(`SELECT w.id,w.organization_id,w.brand_id,o.slug,u.id actor
      FROM signal_workspaces w JOIN organizations o ON o.id=w.organization_id
      JOIN users u ON u.id=$2::uuid AND u.user_type='noisia_internal' AND u.primary_role='noisia_admin' AND u.status='active'
      WHERE w.id=ANY($1::uuid[]) ORDER BY w.id,u.id`,[[evaluationWorkspace],identity.internal_user_id])).rows;
    const expected=new Map([[evaluationWorkspace,{org:identity.organization_id,brand:identity.brand_id,slug:`mfp-${identity.fixture_key}`}],
      [originWorkspace,{org:'6f6ff158-066d-471d-9532-643e2c4e26ac',brand:'38c31650-7512-497d-9836-2f39e1659fc8',slug:'mfp-qa-frente-5-2026-10-07'}]]);
    if(targets.length!==1||targets.some(row=>{const item=expected.get(row.id);return !item||row.organization_id!==item.org||row.brand_id!==item.brand||row.slug!==item.slug;}))
      throw new Error('mfp_v4_target_identity_invalid');
    const census=async(queryable:Pick<Pool,'query'>)=>(await queryable.query(`SELECT (SELECT count(*) FROM signal_labeling_calls)::text calls,
      (SELECT count(*) FROM signal_labeling_runs WHERE status IN('queued','running','submitting','submitted','reconciling'))::text active,
      (SELECT coalesce(jsonb_agg(w ORDER BY workspace_id,kind),'[]'::jsonb) FROM signal_workspace_labelers w) selected_labelers`)).rows[0];
    const providerBefore=await census(pool);
    if(providerBefore.active!=='0')throw new Error('mfp_v4_active_provider_runs');
    const before=await Promise.all(targets.map(row=>loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:row.id})));
    const mutate=async(database:Pool)=>{
      let created=0,updated=0;
      for(const [targetIndex,target]of targets.entries()){
        const items=concepts.filter(item=>item.concept_key===COBROS_KEY_V4);
        const keys=items.map(item=>item.concept_key);
        let catalog=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:target.id});
        for(const item of items){
          let current=catalog.topics.find(topic=>topic.term_key===item.concept_key);
          if(!current)throw new Error('mfp_v4_cobros_missing');
          const input=conceptInputV3(item,current.scope);
          if(!unchangedConceptV3(current,input)){
            await updateSignalTopicStoreV1({pool:database,workspace_id:target.id,actor_user_id:target.actor,term_key:item.concept_key,
              idempotency_key:`mfp-v4-${hash.slice(0,20)}-update-${item.concept_key}`,input:{...input,
                expected_definition_digest:current.definition_digest,expected_definition_revision:current.definition_revision}});
            updated++;
          }
          catalog=await loadSignalTopicCatalogStoreV1({queryable:database,workspace_id:target.id});
        }
        assertCatalogPreservedV3(before[targetIndex].topics,catalog.topics,keys,target.id===evaluationWorkspace);
        if(items.some(item=>{const current=catalog.topics.find(topic=>topic.term_key===item.concept_key)!;
          return !unchangedConceptV3(current,conceptInputV3(item,current.scope));}))throw new Error('mfp_v4_not_current');
      }
      return {created,updated};
    };
    const receiptPath='.data/dev-corpus/voyage-real/standard-v2-r11/v4-acceptance.json';
    if(acceptance){
      const client=await pool.connect();await client.query('BEGIN');
      // Every product BEGIN/COMMIT remains a savepoint inside this rollback-only acceptance.
      const query=async(sql:any,args?:any)=>{
        const command=typeof sql==='string'?sql.trim().toUpperCase():'';
        if(command==='BEGIN')return client.query('SAVEPOINT mfp_v4_product');
        if(command==='COMMIT')return client.query('RELEASE SAVEPOINT mfp_v4_product');
        if(command==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT mfp_v4_product');
        return client.query(sql,args);
      };
      const database={query,connect:async()=>({query,release(){}} as unknown as PoolClient)} as unknown as Pool;
      let result;
      try{
        result=await mutate(database);
        assert.deepEqual(await mutate(database),{created:0,updated:0},'replay must not create revisions');
        assert.deepEqual(await census(database),providerBefore);
      }finally{await client.query('ROLLBACK');client.release();}
      const after=await Promise.all(targets.map(row=>loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:row.id})));
      assert.deepEqual(after.map(catalog=>catalog.topics.map(catalogDefinitionV3)),before.map(catalog=>catalog.topics.map(catalogDefinitionV3)));
      assert.deepEqual(await census(pool),providerBefore);
      const receipt={stage:'v4_postgres_acceptance',passed:true,input_sha256:hash,created:result!.created,updated:result!.updated,
        checks:['exact_data','scopes','provenance','reservation_v2','unrelated_catalog','idempotent_replay','rollback','zero_provider_calls'],
        target_workspaces:targets.map(row=>row.id),at:new Date().toISOString()};
      await mkdir('.data/dev-corpus/voyage-real/standard-v2-r11',{recursive:true,mode:0o700});
      await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
    }else{
      const acceptanceReceipt=JSON.parse(await readFile(receiptPath,'utf8'));
      if(!acceptanceReceipt.passed||acceptanceReceipt.input_sha256!==hash)throw new Error('mfp_v4_acceptance_required');
      const result=await mutate(pool);assert.deepEqual(await mutate(pool),{created:0,updated:0});
      assert.deepEqual(await census(pool),providerBefore);
      const receipt={stage:'v4_data_installed',...result,input_sha256:hash,confirmed_by:'founder AUDIT §16.4.1',
        evaluation_equivalents:{workspace_id:evaluationWorkspace,origin:'manual',source_workspace_id:originWorkspace,concept_keys:[COBROS_KEY_V4]},
        origin_updates:[],provider_calls:0,at:new Date().toISOString()};
      await writeFile('.data/dev-corpus/voyage-real/standard-v2-r11/v4-data-installed.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
    }
  }finally{await pool.end();}
});
