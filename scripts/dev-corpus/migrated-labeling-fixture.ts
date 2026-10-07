import {randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {createProcessingPolicyIdentitiesV1} from "../../infrastructure/db/migrations/signal-processing-policy.fixture";

/** Caller starts a transaction and rolls it back. All rows use production tables. */
export async function createMigratedLabelingFixture(pool:Pool,client:PoolClient,kind:"facets"|"membership"="facets"){
 const identity=await createProcessingPolicyIdentitiesV1({database:pool,scoped:client});
 const workspaceId=identity.first.workspace_id,organizationId=identity.first.organization_id;
 const actorId=identity.actors.firstAdmin,preparationId=randomUUID(),labelerId=randomUUID(),runId=randomUUID(),lease=randomUUID();
 await client.query(`INSERT INTO signal_corpus_preparation_runs
  (id,workspace_id,actor_user_id,worker_job_id,status,phase,input_revision,completed_at)
  VALUES($1,$2,$3,$4,'completed','complete',1,now())`,
  [preparationId,workspaceId,actorId,`ci-${preparationId}`]);
 await client.query(`INSERT INTO signal_entity_context_versions
  (workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
  VALUES($1,1,$2,'{"entities":[]}'::jsonb,'{}'::jsonb,'targeted',0)`,
  [workspaceId,`sha256:${"1".repeat(64)}`]);
 await client.query(`INSERT INTO signal_labeler_versions
  (id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
  VALUES($1,$2,'anthropic','claude-sonnet-5-5',$3,$4,$5,'{}'::jsonb)`,
  [labelerId,kind,`sha256:${"2".repeat(64)}`,`sha256:${"3".repeat(64)}`,`sha256:${"4".repeat(64)}`]);
 await client.query(`INSERT INTO signal_labeling_runs
  (id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,
   entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,
   actor_user_id,lease_token,lease_until)
  VALUES($1,$2,$3,$4,$5,$6,1,'running',100,$7,$8,$9,$10,now()+interval '5 minutes')`,
  [runId,workspaceId,kind,labelerId,preparationId,`sha256:${"1".repeat(64)}`,
   randomUUID(),`sha256:${"5".repeat(64)}`,actorId,lease]);
 return{workspaceId,organizationId,actorId,preparationId,labelerId,runId,lease};
}
