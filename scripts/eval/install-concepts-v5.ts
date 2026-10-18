/** Installs founder-confirmed data via product writes; acceptance executes the same writes then rolls back. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {conceptInputV3,unchangedConceptV3,assertCatalogPreservedV3,catalogDefinitionV3,confirmedConceptsV3} from './concepts-v3';
import {loadSignalTopicCatalogStoreV1,updateSignalTopicStoreV1} from '../../infrastructure/db/signal-topic-catalog';
const directory='.data/dev-corpus/voyage-real/standard-v3-r12';
void main(async()=>{
 if(!process.argv.includes('--real'))throw new Error('mfp_v5_real_required');
 const acceptance=process.argv.includes('--acceptance');
 if(!acceptance&&!process.argv.includes('--execute'))throw new Error('mfp_v5_stage_invalid');
 const bytes=await readFile(new URL('../../docs/product/PROMPT_LOOPING/CONFIRMED_MFP_CONCEPTS_V5_2026-10-18.json',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
 if(!process.argv.includes(`--confirmed-definitions-sha256=${hash}`))throw new Error('mfp_v5_confirmation_required');
 const proposal=JSON.parse(bytes.toString('utf8'));assert.equal(proposal.version,5);assert.equal(proposal.status,'confirmed_founder_audit_17_7');
 const concepts=confirmedConceptsV3(proposal),identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{
  const actor=(await pool.query(`SELECT w.id FROM signal_workspaces w JOIN organizations o ON o.id=w.organization_id
   JOIN users u ON u.id=$4::uuid AND u.user_type='noisia_internal' AND u.primary_role='noisia_admin' AND u.status='active'
   WHERE w.id=$1 AND w.organization_id=$2 AND w.brand_id=$3 AND o.slug=$5`,[identity.workspace_id,identity.organization_id,identity.brand_id,identity.internal_user_id,`mfp-${identity.fixture_key}`])).rows;
  assert.equal(actor.length,1,'exact_private_fixture_identity');
  const census=async(db:any)=>(await db.query(`SELECT
   (SELECT coalesce(jsonb_agg(w ORDER BY kind),'[]') FROM signal_workspace_labelers w WHERE workspace_id=$1) selectors,
   (SELECT count(*)::int FROM signal_labeling_calls WHERE workspace_id=$1) calls,
   (SELECT count(*)::int FROM signal_labeling_runs WHERE workspace_id=$1 AND status IN('queued','running')) active`,[identity.workspace_id])).rows[0];
  const beforeCensus=await census(pool);assert.equal(beforeCensus.active,0);
  const before=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
  const mutate=async(db:any)=>{
   let catalog=await loadSignalTopicCatalogStoreV1({queryable:db,workspace_id:identity.workspace_id});let updated=0;
   const item=concepts.find(c=>c.concept_key==='cobros_depositos_devoluciones')!,current=catalog.topics.find(t=>t.term_key===item.concept_key);assert.ok(current);
   const input=conceptInputV3(item,current.scope);
   if(!unchangedConceptV3(current,input)){
    await updateSignalTopicStoreV1({pool:db,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,term_key:item.concept_key,
     idempotency_key:`mfp-v5-${hash.slice(0,20)}-update`,input:{...input,expected_definition_digest:current.definition_digest,expected_definition_revision:current.definition_revision}});updated++;
   }
   catalog=await loadSignalTopicCatalogStoreV1({queryable:db,workspace_id:identity.workspace_id});
   assertCatalogPreservedV3(before.topics,catalog.topics,[item.concept_key],true);
   assert.ok(unchangedConceptV3(catalog.topics.find(t=>t.term_key===item.concept_key)!,input));
   assert.deepEqual(await census(db),beforeCensus);return {updated};
  };
  await mkdir(directory,{recursive:true,mode:0o700});
  let result;
  if(acceptance){
   const c=await pool.connect();let seq=0;const stack:string[]=[];
   const query=async(sql:string,args?:unknown[])=>{
    if(sql==='BEGIN'){const sp=`v5_${++seq}`;stack.push(sp);return c.query(`SAVEPOINT ${sp}`);}
    if(sql==='COMMIT')return c.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if(sql==='ROLLBACK'){const sp=stack.pop()!;await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);return c.query(`RELEASE SAVEPOINT ${sp}`);}
    return c.query(sql,args);
   };
   await c.query('BEGIN');const db={query,connect:async()=>({query,release(){}})};
   try{result=await mutate(db);assert.deepEqual(await mutate(db),{updated:0});}finally{await c.query('ROLLBACK');c.release();}
   const after=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
   assert.deepEqual(after.topics.map(catalogDefinitionV3),before.topics.map(catalogDefinitionV3));assert.deepEqual(await census(pool),beforeCensus);
  }else{
   const proof=JSON.parse(await readFile(`${directory}/v5-acceptance.json`,'utf8'));assert.equal(proof.passed,true);assert.equal(proof.input_sha256,hash);
   result=await mutate(pool);assert.deepEqual(await mutate(pool),{updated:0});
  }
  const receipt={stage:acceptance?'v5_postgres_acceptance':'v5_data_installed',passed:true,input_sha256:hash,...result,provider_calls:0,default_changed:false,checks:['exact_private_identity','product_authorization','same_scope_and_provenance','unrelated_catalog_unchanged','idempotent','zero_provider_calls',...(acceptance?['rollback']:[])],at:new Date().toISOString()};
  await writeFile(`${directory}/${acceptance?'v5-acceptance':'v5-data-installed'}.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
 }finally{await pool.end();}
});
