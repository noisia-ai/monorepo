import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {loadSignalWorkspaceEnginePreflightV1,loadSignalWorkspaceEngineInputIdentityV1} from './signal-workspace-engine';
import {loadSignalWorkspaceClassificationInputV1} from './signal-workspace-classification';
const workspace='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',profile='10000000-0000-4000-8000-000000000003';
for(const reader of ['preflight','identity','classification'] as const)test(`${reader}: missing bound operational profile fails without falling back to a working draft`,async()=>{
 let boundReads=0;
 const client={release(){},async query(sql:string,values:unknown[]=[]){
  if(/^(BEGIN|SET|ROLLBACK|COMMIT)/u.test(sql))return{rows:[]};
  if(sql.includes('workspace.status workspace_status'))return{rows:[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin',same_organization:true,brand_access_level:null}]};
  if(sql.includes('SELECT id,taxonomy_id FROM signal_taxonomy_profiles')){boundReads++;assert.deepEqual(values,[workspace,profile]);return{rows:[]};}
  throw Error('Unexpected lookup: a missing bound profile must not resolve current working context');
 }};
 const database={...client,connect:async()=>client} as unknown as Pool;
 const args={database,queryable:database,workspace_id:workspace,actor_user_id:actor,taxonomy_profile_id:profile};
 await assert.rejects(reader==='preflight'?loadSignalWorkspaceEnginePreflightV1(args):reader==='identity'?loadSignalWorkspaceEngineInputIdentityV1(args):loadSignalWorkspaceClassificationInputV1(args),
  {code:reader==='classification'?'workspace_classification_catalog_unavailable':'workspace_topic_catalog_required'});
 assert.equal(boundReads,1);
});
