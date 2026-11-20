import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {entityContextDigestV1} from '@noisia/query-engine';
import {pendingSignalListeningDiscoveryRoundsV1} from '../signal-listening-discovery-money';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={entities:[{entity_id:id(90),kind:'primary_brand' as const,name:'Synthetic',aliases:[],disambiguation:null}]};
const contextDigest=entityContextDigestV1(context);

test('the real selector pages past reconciled revoked reviews and queued work without mutating history',async()=>{
 const stamp='2026-11-15T02:00:00.123456Z';
 const candidates=[1,2,3,4].map(n=>({round_id:id(n),workspace_id:id(80),actor_user_id:id(81),
  status:n<3?'reviewed':'queued',created_at:stamp,financial_pending:false}));
 const cursors:Array<unknown[]>=[],sqls:string[]=[];
 const query=async(sql:string,values?:unknown[])=>{
  sqls.push(sql);
  if(sql.includes('to_char(r.created_at')){
   assert.equal(values?.[0],1);assert.equal(values?.[1],true);
   cursors.push(values??[]);
   const cursor=values?.[3];const after=cursor?candidates.findIndex(r=>r.round_id===cursor)+1:0;
   return{rows:candidates.slice(after,after+1)};
  }
  if(sql.includes('SELECT r.workspace_id,p.actor_user_id,p.map_id'))return{rows:values?.[0]===id(4)?[{workspace_id:id(80),actor_user_id:id(81),map_id:id(82)}]:[]};
  if(sql.includes('workspace.status workspace_status'))return{rows:[{workspace_status:'active',brand_status:'active',organization_status:'active',brand_same_organization:true,
   actor_status:'active',user_type:'noisia_internal',primary_role:'founder',same_organization:true,brand_access_level:null}]};
  if(sql.includes('FROM signal_workspace_features'))return{rows:[{enabled:true}]};
  if(sql.includes('SELECT map.* FROM signal_mass_labeling_maps'))return{rows:[{id:id(82),entity_context_digest:contextDigest}]};
  if(sql.includes('AS brand_name'))return{rows:[{workspace_id:id(80),brand_id:id(90),brand_name:'Synthetic',brand_slug:'synthetic'}]};
  if(sql.includes("'primary_brand'::text AS scope"))return{rows:[{scope:'primary_brand',entity_id:id(90),entity_label:'Synthetic',aliases:[],disambiguation:null}]};
  if(sql.includes('SELECT context,digest,version_no'))return{rows:[{context,digest:contextDigest,version_no:1}]};
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
  // Other governed-context readers have no optional facts in this fixture.
  return{rows:[]};
 };
 const database={query,connect:async()=>({query,release(){}})} as unknown as Pick<Pool,'query'|'connect'>;
 assert.deepEqual(await pendingSignalListeningDiscoveryRoundsV1({database,enabled:true,limit:1}),
  [{round_id:id(4),workspace_id:id(80),actor_user_id:id(81),status:'queued'}]);
 assert.equal(cursors.length,4);
 for(let n=1;n<cursors.length;n++)assert.deepEqual(cursors[n]?.slice(2),[stamp,id(n)],'retain microseconds and unique ID across full skipped pages');
 assert.ok(sqls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/iu.test(sql)),'scheduling does not mutate history or authority');
});

test('pending receipt custody bypasses analysis eligibility even with analysis disabled',async()=>{
 const row={round_id:id(1),workspace_id:id(80),actor_user_id:id(81),status:'reviewed',created_at:'2026-11-15T02:00:00.123456Z',financial_pending:true};
 const query=async(sql:string,values?:unknown[])=>{
  assert.ok(sql.includes('to_char(r.created_at'),'financial recovery must not enter authority or publication reads');
  assert.equal(values?.[1],false);return{rows:[row]};
 };
 const database={query,connect:async()=>{throw Error('analysis authority is revoked');}} as unknown as Pick<Pool,'query'|'connect'>;
 assert.deepEqual(await pendingSignalListeningDiscoveryRoundsV1({database,enabled:false,limit:1}),
  [{round_id:id(1),workspace_id:id(80),actor_user_id:id(81),status:'reviewed'}]);
});
