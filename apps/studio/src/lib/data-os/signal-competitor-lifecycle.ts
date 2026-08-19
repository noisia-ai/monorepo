import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import { beginSignalProductOperationV1,completeSignalProductOperationV1 } from "@/lib/data-os/signal-product-operation";
import { pool } from "@/lib/db";

type WorkspaceRow={id:string;organization_id:string;slug:string;name:string;timezone:string;status:string;brand_id:string};

export async function createOrReactivateSignalCompetitorsV1(args:{
  brandId:string;actor:SignalWorkspaceUser;idempotencyKey:string;names:string[];
  vertical:string|null;subVertical:string|null;country:string;
}){
 return transaction(async(client)=>{
  const workspace=await resolveWorkspace(client,args.brandId,args.actor);
  const operation=await beginSignalProductOperationV1<{created_count:number;reactivated_count:number}>({
    queryable:client,workspace,actor:args.actor,action:"create-competitor",idempotencyKey:args.idempotencyKey,
    input:{names:args.names.map((name)=>name.normalize("NFKC").trim()),vertical:args.vertical,sub_vertical:args.subVertical,country:args.country}
  });
  if(operation.replay)return operation.replay;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-competitors:${workspace.id}`]);
  await client.query("SELECT set_config('noisia.competitor_lifecycle_operation_id',$1,true)",[
    operation.operationId
  ]);
  let created=0;let reactivated=0;let eventIndex=0;
  for(const [index,name] of args.names.entries()){
    const seed=await client.query<{id:string}>(`
      INSERT INTO brand_seeds(canonical_name,aliases,detection_patterns,vertical,sub_vertical,country,active)
      VALUES($1,ARRAY[]::text[],ARRAY[$1]::text[],$2,$3,$4,true)
      ON CONFLICT(canonical_name) DO UPDATE SET vertical=EXCLUDED.vertical,
        sub_vertical=EXCLUDED.sub_vertical,active=true RETURNING id::text
    `,[name,args.vertical,args.subVertical,args.country]);
    const prior=await client.query<{id:string;status:string}>(`
      SELECT id::text,status FROM competitors WHERE brand_id=$1::uuid AND competitor_brand_seed_id=$2::uuid FOR UPDATE
    `,[args.brandId,seed.rows[0]!.id]);
    let competitorId=prior.rows[0]?.id;let kind:"created"|"reactivated";
    if(!competitorId){
      const inserted=await client.query<{id:string}>(`
        INSERT INTO competitors(brand_id,competitor_brand_seed_id,priority,notes,status,effective_from,updated_at)
        VALUES($1::uuid,$2::uuid,$3,'Created from Brand OS editor.','current',clock_timestamp(),clock_timestamp())
        RETURNING id::text
      `,[args.brandId,seed.rows[0]!.id,index+1]);competitorId=inserted.rows[0]!.id;created+=1;kind="created";
    }else if(prior.rows[0]!.status==="retired"){
      await client.query(`UPDATE competitors SET status='current',effective_from=clock_timestamp(),effective_to=NULL,
        retired_by_user_id=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[competitorId]);
      reactivated+=1;kind="reactivated";
    }else continue;
    const evidenceHash=sha256(`brand-os-competitor:${workspace.id}:${sha256(name)}`);
    await client.query(`INSERT INTO signal_competitor_lifecycle_events(
      workspace_id,competitor_id,operation_id,event_index,event_kind,actor_user_id,
      previous_status,next_status,evidence_hash,event_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,'current',$8,$9)`,[
      workspace.id,competitorId,operation.operationId,eventIndex++,kind,args.actor.id,
      kind==="reactivated"?"retired":null,evidenceHash,sha256(`${operation.operationId}:${kind}:${competitorId}`)]);
  }
  const result={created_count:created,reactivated_count:reactivated};
  await completeSignalProductOperationV1({queryable:client,workspaceId:workspace.id,key:operation.key,result});
  return result;
 });
}

export async function retireSignalCompetitorsV1(args:{
 brandId:string;actor:SignalWorkspaceUser;idempotencyKey:string;competitorIds:string[]|null;evidence:string;
}){
 return transaction(async(client)=>{
  const workspace=await resolveWorkspace(client,args.brandId,args.actor);
  const operation=await beginSignalProductOperationV1<{retired_count:number}>({queryable:client,workspace,actor:args.actor,
    action:"retire-competitor",idempotencyKey:args.idempotencyKey,input:{
      competitor_refs:args.competitorIds?.map(sha256).sort()??"all-current",evidence_hash:sha256(args.evidence)}});
  if(operation.replay)return operation.replay;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-competitors:${workspace.id}`]);
  await client.query("SELECT set_config('noisia.competitor_lifecycle_operation_id',$1,true)",[
    operation.operationId
  ]);
  const selected=await client.query<{id:string}>(`
    SELECT id::text FROM competitors WHERE brand_id=$1::uuid AND status='current'
      AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY id FOR UPDATE
  `,[args.brandId,args.competitorIds]);
  let index=0;for(const row of selected.rows){
    await client.query(`UPDATE competitors SET status='retired',effective_to=clock_timestamp(),
      retired_by_user_id=$2::uuid,updated_at=clock_timestamp() WHERE id=$1::uuid AND status='current'`,[row.id,args.actor.id]);
    await client.query(`INSERT INTO signal_competitor_lifecycle_events(
      workspace_id,competitor_id,operation_id,event_index,event_kind,actor_user_id,
      previous_status,next_status,evidence_hash,event_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'retired',$5::uuid,'current','retired',$6,$7)`,[
      workspace.id,row.id,operation.operationId,index++,args.actor.id,sha256(args.evidence),
      sha256(`${operation.operationId}:retired:${row.id}`)]);
  }
  const result={retired_count:selected.rows.length};await completeSignalProductOperationV1({queryable:client,
    workspaceId:workspace.id,key:operation.key,result});return result;
 });
}

async function resolveWorkspace(queryable:{query:<T=Record<string,unknown>>(text:string,values?:unknown[])=>Promise<{rows:T[];rowCount?:number|null}>},brandId:string,actor:SignalWorkspaceUser):Promise<ResolvedSignalWorkspace>{
 const result=await queryable.query<WorkspaceRow>(`SELECT workspace.id::text,workspace.organization_id::text,
   workspace.slug,brand.display_name AS name,workspace.timezone,workspace.status,workspace.brand_id::text
   FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
   WHERE workspace.brand_id=$1::uuid AND workspace.status='active'
   ORDER BY workspace.created_at,workspace.id LIMIT 1 FOR SHARE OF workspace`,[brandId]);
 const row=result.rows[0];if(!row||actor.userType!=="noisia_internal")throw new Error("Competitor lifecycle is unauthorized.");
 return{contractVersion:"signal-backend-v1",id:row.id,organizationId:row.organization_id,slug:row.slug,name:row.name,
   subject:{type:"brand",id:row.brand_id},timezone:row.timezone,status:row.status,corpora:[]};
}
async function transaction<T>(fn:(client:PoolClient)=>Promise<T>){const client=await pool.connect();try{
 await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");const result=await fn(client);await client.query("COMMIT");return result;
 }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}}
function sha256(value:string){return`sha256:${createHash("sha256").update(value).digest("hex")}`;}
