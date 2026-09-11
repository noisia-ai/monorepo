import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';

export type ProcessingPolicyFixtureTransactionV1={database:Pool;scoped:PoolClient};

/** Invented identities only. The caller owns the sealed local connection,
 * migrations, transaction and physical rollback. No provider, import, ready
 * result, money history or authorization policy is fabricated here. */
export async function createProcessingPolicyIdentitiesV1(tx:ProcessingPolicyFixtureTransactionV1){
 const query:PoolClient['query']=tx.scoped.query.bind(tx.scoped);
 const organization=async()=>{
  const id=randomUUID();
  await query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,'Synthetic processing policy organization','active')",[id,`processing-policy-${id}`]);
  return id;
 };
 const primaryOrganization=await organization(),foreignOrganization=await organization();
 const workspace=async(organization_id:string)=>{
  const brand_id=randomUUID();
  await query("INSERT INTO brands(id,organization_id,slug,name,description,status) VALUES($1,$2,$3,'Synthetic processing policy brand','Invented policy test identity','active')",[brand_id,organization_id,`processing-policy-${brand_id}`]);
  const row=(await query<{id:string}>('SELECT id FROM signal_workspaces WHERE organization_id=$1 AND brand_id=$2',[organization_id,brand_id])).rows[0];
  assert.ok(row,'the real brand provisioning trigger creates the workspace');
  return{organization_id,brand_id,workspace_id:row.id};
 };
 const first=await workspace(primaryOrganization),second=await workspace(primaryOrganization),foreign=await workspace(foreignOrganization);
 const actor=async(args:{organization_id?:string;role?:string;user_type?:string;grant?:'admin'|'comment'|'read'|null;brand_ids?:string[];status?:string}={})=>{
  const id=randomUUID();
  await query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
   VALUES($1,$2,'Synthetic processing policy actor',$3,$4,$5,$6)`,[id,`${id}@${args.user_type==='noisia_internal'?'example.test':'processing-policy.example.test'}`,args.user_type??'client',args.role??'client_admin',args.organization_id??primaryOrganization,args.status??'active']);
  if(args.grant)for(const brand_id of args.brand_ids??[first.brand_id])
   await query('INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,$3)',[id,brand_id,args.grant]);
  return id;
 };
 const internal=await actor({user_type:'noisia_internal',role:'noisia_admin'});
 const firstAdmin=await actor({grant:'admin'}),secondAdmin=await actor({grant:'admin',brand_ids:[second.brand_id]});
 const foreignAdmin=await actor({organization_id:foreignOrganization,grant:'admin',brand_ids:[foreign.brand_id]});
 const noGrant=await actor(),readGrant=await actor({grant:'read'}),commentGrant=await actor({grant:'comment'});
 const alias=await actor({role:'client_owner',grant:'admin'}),manager=await actor({role:'brand_manager',grant:'comment'}),viewer=await actor({role:'client_viewer',grant:'admin'});
 const suspended=await actor({grant:'admin',status:'suspended'});
 return{...tx,query,first,second,foreign,actors:{internal,firstAdmin,secondAdmin,foreignAdmin,noGrant,readGrant,commentGrant,alias,manager,viewer,suspended}};
}
