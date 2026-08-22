import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  appendSignalSemanticContextProposalsV1,
  bulkApproveSignalSemanticContextElementsV1,
  createSignalSemanticContextDraftV1,
  decideSignalSemanticContextElementV1,
  loadSignalSemanticContextProposalPreflightV1,
  loadSignalSemanticContextReadinessV1,
  publishSignalSemanticContextGenerationV1,
  reconcileSignalSemanticContextGenerationV1
} from "@/lib/data-os/signal-semantic-context-pack";
import { withSignalAcquisitionTransactionV1 } from "@/lib/data-os/signal-acquisition-plan";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { pool } from "@/lib/db";

const DB_URL=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_URL;
const APPROVED=process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_INTEGRATION_APPROVED==="true";
const digest=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;

test("0091 semantic context authority is append-only, drift-aware, idempotent, and confidence-neutral",{
  skip:!DB_URL||!APPROVED,timeout:180_000
},async()=>{
  assert.ok(DB_URL);requireLocal(DB_URL);
  const admin=new pg.Client({connectionString:DB_URL,ssl:false});await admin.connect();
  try{await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory=resolve(process.cwd(),"../../infrastructure/db/migrations");
    const files=(await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for(const file of files)await admin.query(await readFile(join(directory,file),"utf8"));
  }finally{await admin.end();}

  const fixture=await seedFixture();
  const protectedBefore=await protectedCounts(fixture.workspace.id);
  const legacyDraft=await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-idempotent"}));
  assert.deepEqual(await transaction((queryable)=>createSignalSemanticContextDraftV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-idempotent"})),legacyDraft);
  const lineage={model:"fixture-model",model_version:"immutable-v1",prompt_digest:digest("prompt"),
    pricing_version:"pricing-v1"};
  const reconciledLegacy=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-lineage-idempotent",
    reason:"provider_lineage_missing",proposalLineage:lineage}));
  assert.equal(reconciledLegacy.outcome,"created");
  assert.deepEqual(await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-lineage-idempotent",
    reason:"provider_lineage_missing",proposalLineage:lineage})),reconciledLegacy);
  const currentNoop=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-current-draft",
    reason:"operator_requested_reconciliation",proposalLineage:lineage}));
  assert.equal(currentNoop.outcome,"noop");
  assert.equal(currentNoop.generation_key,reconciledLegacy.generation_key);
  const draft={generation_key:reconciledLegacy.generation_key,
    generation_version:reconciledLegacy.generation_version,status:"draft" as const};

  const proposals=[
    proposal("identity-main","identity_term","assistant-brand","Assistant brand",1,fixture.profileId),
    proposal("product-main","product","smart-speaker","Smart speaker",0.99,fixture.productId),
    proposal("need-main","need","hands-free-help","Hands-free help",0.8,fixture.chunkId),
    proposal("friction-main","friction","privacy-friction","Privacy concern",0.7,fixture.sourceId)
  ];
  const appended=await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-proposals-idempotent",
    generationKey:draft.generation_key,proposals}));
  assert.equal(appended.created,4);
  assert.deepEqual(await transaction((queryable)=>appendSignalSemanticContextProposalsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-proposals-idempotent",
    generationKey:draft.generation_key,proposals})),appended);
  let readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.deepEqual(readiness.counts,{pending:4,approved:0,rejected:0});
  assert.equal(readiness.ready_for_context_aware_discovery,false);
  assert.equal(readiness.counts.approved,0,"confidence=1.0 never approves a proposal");

  const concurrentApprovals=await Promise.all([1,2].map(()=>transaction((queryable)=>
    decideSignalSemanticContextElementV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:"approve-identity-idempotent",generationKey:draft.generation_key,
      elementKey:"identity-main",action:"approve"}))));
  assert.deepEqual(concurrentApprovals[0],concurrentApprovals[1],"concurrent same-key replay is exact");
  const edited=await transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"edit-product-idempotent",
    generationKey:draft.generation_key,elementKey:"product-main",action:"edit",
    edit:{canonical_key:"smart-speaker-current",display_text:"Current smart speaker",locale:"es-MX",
      relation_kind:null,relation_target_key:null}}));
  assert.equal(edited.disposition,"pending","an operator edit remains pending");
  await transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"approve-product-idempotent",
    generationKey:draft.generation_key,elementKey:"product-main",action:"approve"}));
  const bulk=await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"bulk-approve-idempotent",
    generationKey:draft.generation_key,elementKeys:["need-main","friction-main"]}));
  assert.equal(bulk.approved,2);
  assert.deepEqual(await transaction((queryable)=>bulkApproveSignalSemanticContextElementsV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"bulk-approve-idempotent",
    generationKey:draft.generation_key,elementKeys:["need-main","friction-main"]})),bulk);

  const published=await transaction((queryable)=>publishSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent",
    generationKey:draft.generation_key}));
  assert.deepEqual(await transaction((queryable)=>publishSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"publish-context-idempotent",
    generationKey:draft.generation_key})),published);
  readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.equal(readiness.ready_for_context_aware_discovery,true);
  assert.deepEqual(readiness.counts,{pending:0,approved:4,rejected:0});
  const publishedNoop=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({
    queryable,workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-current-published",
    reason:"operator_requested_reconciliation",proposalLineage:lineage}));
  assert.equal(publishedNoop.outcome,"noop");
  assert.equal(publishedNoop.generation_key,published.generation_key);

  await assert.rejects(pool.query(`UPDATE signal_semantic_context_generations SET pack_digest=$2
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id,digest("tamper")]),hasCode("55000"));
  await assert.rejects(pool.query(`UPDATE signal_semantic_context_element_versions SET confidence=1
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),hasCode("55000"));
  const historyBefore=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);

  await pool.query(`UPDATE brand_os_profiles SET status='retired' WHERE id=$1::uuid`,[fixture.profileId]);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile v2','active',2,jsonb_build_object('snapshot_hash',$4::text))`,
  [randomUUID(),fixture.workspace.organizationId,fixture.workspace.subject.id,digest("brand-os-v2")]);
  readiness=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.equal(readiness.ready_for_context_aware_discovery,false);
  assert.ok(readiness.drift_reasons.includes("brand_os_drift"));
  const historyAfter=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  assert.deepEqual(historyAfter.rows,historyBefore.rows,"Brand OS drift does not reinterpret history");
  const nextDraft=await transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"context-draft-v3-idempotent",
    reason:"brand_os_drift",proposalLineage:lineage}));
  assert.equal(nextDraft.outcome,"created");
  const supersession=await pool.query<{supersedes:string}>(`SELECT supersedes_generation_id::text supersedes
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,nextDraft.generation_key]);
  const originalGeneration=await pool.query<{id:string}>(`SELECT id::text FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND generation_key=$2`,[fixture.workspace.id,draft.generation_key]);
  assert.equal(supersession.rows[0]!.supersedes,originalGeneration.rows[0]!.id);
  const beforeKnowledgeEdit=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid ORDER BY generation_version`,
  [fixture.workspace.id]);
  await pool.query(`UPDATE brand_knowledge_sources SET raw_text='Changed private fixture narrative'
    WHERE id=$1::uuid`,[fixture.sourceId]);
  const afterKnowledgeEdit=await pool.query(`SELECT brand_os_digest,knowledge_digest,pack_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid ORDER BY generation_version`,
  [fixture.workspace.id]);
  assert.deepEqual(afterKnowledgeEdit.rows,beforeKnowledgeEdit.rows,
    "Knowledge edits do not reinterpret historical generations");
  const driftedDraft=await loadSignalSemanticContextReadinessV1({queryable:pool,workspace:fixture.workspace,
    actor:fixture.actor});
  assert.ok(driftedDraft.drift_reasons.includes("knowledge_drift"));

  await seedQueuedProposalRun(fixture,nextDraft.generation_key,lineage);
  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:fixture.workspace,actor:fixture.actor,idempotencyKey:"reconcile-active-run-blocked",
    reason:"knowledge_drift",proposalLineage:lineage})),/semantic_context_proposal_run_active/u);
  await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',
    stale_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND generation_id=(SELECT id FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2)`,[fixture.workspace.id,nextDraft.generation_key]);
  const concurrent=await Promise.all(["a","b"].map((suffix)=>transaction((queryable)=>
    reconcileSignalSemanticContextGenerationV1({queryable,workspace:fixture.workspace,actor:fixture.actor,
      idempotencyKey:`reconcile-knowledge-${suffix}`,reason:"knowledge_drift",proposalLineage:lineage}))));
  assert.equal(concurrent.filter((result)=>result.outcome==="created").length,1);
  assert.equal(concurrent.filter((result)=>result.outcome==="noop").length,1);
  assert.equal(concurrent[0]!.generation_key,concurrent[1]!.generation_key);
  const effectiveDrafts=await scalar(`SELECT count(*)::int count
    FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.status='draft' AND NOT EXISTS(
      SELECT 1 FROM signal_semantic_context_generations successor
      WHERE successor.supersedes_generation_id=generation.id)`,[fixture.workspace.id]);
  assert.equal(effectiveDrafts,1,"different concurrent keys converge on one effective draft");

  await assert.rejects(transaction((queryable)=>decideSignalSemanticContextElementV1({queryable,
    workspace:fixture.otherWorkspace,actor:fixture.actor,idempotencyKey:"cross-workspace-rejected",
    generationKey:draft.generation_key,elementKey:"identity-main",action:"approve"})),/not_found/u);

  await assert.rejects(transaction((queryable)=>reconcileSignalSemanticContextGenerationV1({queryable,
    workspace:{...fixture.workspace,organizationId:fixture.otherWorkspace.organizationId},actor:fixture.actor,
    idempotencyKey:"reconcile-cross-workspace",reason:"operator_requested_reconciliation",
    proposalLineage:lineage})),/cross-workspace|unauthorized/u);

  const operationsBefore=await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]);
  const preflight=await loadSignalSemanticContextProposalPreflightV1({queryable:pool,
    workspace:fixture.workspace,actor:fixture.actor,configuration:{available:true,provider:"fixture",
      model:"fixture-model",model_version:"immutable-v1",pricing_version:"pricing-v1",
      prompt_template_digest:digest("prompt"),max_input_tokens:1000,max_output_tokens:500,
      input_usd_per_million_tokens:1,output_usd_per_million_tokens:2,hard_cap_usd:1}});
  assert.equal(preflight.provider_calls,0);assert.equal(preflight.writes_performed,false);
  assert.equal(await scalar(`SELECT count(*)::int count FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid`,[fixture.workspace.id]),operationsBefore,"preflight is read-only");
  assert.deepEqual(await protectedCounts(fixture.workspace.id),protectedBefore);

  const canonical='{"a":1,"b":[2,3]}';
  const postgresDigest=(await pool.query<{digest:string}>(
    `SELECT signal_semantic_context_digest_v1($1) digest`,[canonical])).rows[0]!.digest;
  assert.equal(postgresDigest,digest(canonical),"TypeScript and PostgreSQL hash identical canonical bytes");
  await pool.end();
});

function proposal(elementKey:string,kind:"identity_term"|"product"|"need"|"friction",
  canonicalKey:string,displayText:string,confidence:number,sourceId:string){
  const sourceType=kind==="identity_term"?"brand_os_profile":kind==="product"?"brand_os_product":
    kind==="need"?"knowledge_chunk":"knowledge_source";
  return{element_key:elementKey,element_kind:kind,canonical_key:canonicalKey,display_text:displayText,
    scope:"primary_brand",entity_type:null,entity_id:null,locale:"es-MX",relation_kind:null,
    relation_target_key:null,confidence,origin_kind:"server_projection" as const,
    source_refs:[{source_type:sourceType as "brand_os_profile"|"brand_os_product"|"knowledge_chunk"|"knowledge_source",
      source_id:sourceId,relation_type:"supports" as const}]};
}

async function seedQueuedProposalRun(fixture:Awaited<ReturnType<typeof seedFixture>>,
  generationKey:string,lineage:{model:string;model_version:string;prompt_digest:string;pricing_version:string}){
  const generation=await pool.query<{id:string;brand_os_digest:string;knowledge_digest:string;
    locale_context_digest:string}>(`SELECT id::text,brand_os_digest,knowledge_digest,locale_context_digest
    FROM signal_semantic_context_generations WHERE workspace_id=$1::uuid AND generation_key=$2`,
  [fixture.workspace.id,generationKey]);
  const operation=await pool.query<{id:string}>(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,'start-semantic-context-proposal-run',$3,$4,'in_progress')
    RETURNING id::text`,[fixture.workspace.id,fixture.actor.id,digest("queued-run-request"),
    digest("queued-run-key")]);
  const row=generation.rows[0]!;
  await pool.query(`INSERT INTO signal_semantic_context_proposal_runs(
    workspace_id,generation_id,operation_id,run_key,status,preflight_digest,brand_os_digest,
    knowledge_digest,locale_context_digest,prompt_digest,context_input_digest,provider,model,
    model_version,pricing_version,max_input_tokens,max_output_tokens,input_usd_per_million_tokens,
    output_usd_per_million_tokens,hard_cap_micro_usd,reservation_micro_usd,
    provider_request_identity,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4,'queued',$5,$6,$7,$8,$9,$10,'fixture',$11,$12,$13,
      1000,500,1,2,1000000,2000,$14,$15::uuid)`,[fixture.workspace.id,row.id,operation.rows[0]!.id,
    `semantic-context-proposal-${randomUUID().replaceAll("-","").slice(0,16)}`,digest("preflight"),
    row.brand_os_digest,row.knowledge_digest,row.locale_context_digest,lineage.prompt_digest,
    digest("context-input"),lineage.model,lineage.model_version,lineage.pricing_version,
    digest("provider-request"),fixture.actor.id]);
}

async function seedFixture(){const suffix=randomUUID().slice(0,8);const orgId=randomUUID(),otherOrgId=randomUUID();
  const brandId=randomUUID(),otherBrandId=randomUUID(),userId=randomUUID();
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status) VALUES
    ($1::uuid,$2,$3,$3,'active'),($4::uuid,$5,$6,$6,'active')`,[orgId,`context-${suffix}`,
    `Context ${suffix}`,otherOrgId,`other-${suffix}`,`Other ${suffix}`]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin','active')`,[userId,`context-${suffix}@example.test`,
    `Context operator ${suffix}`]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status) VALUES
    ($1::uuid,$2::uuid,$3,$4,$4,ARRAY['MX']::char(2)[],'active'),
    ($5::uuid,$6::uuid,$7,$8,$8,ARRAY['US']::char(2)[],'active')`,[brandId,orgId,`brand-${suffix}`,
    `Brand ${suffix}`,otherBrandId,otherOrgId,`other-brand-${suffix}`,`Other brand ${suffix}`]);
  const workspaces=await pool.query<{id:string;brand_id:string;slug:string;timezone:string}>(`
    SELECT id::text,brand_id::text,slug,timezone FROM signal_workspaces WHERE brand_id=ANY($1::uuid[])`,
  [[brandId,otherBrandId]]);const workspaceRow=workspaces.rows.find((row)=>row.brand_id===brandId)!;
  const otherRow=workspaces.rows.find((row)=>row.brand_id===otherBrandId)!;
  await pool.query(`UPDATE signal_workspaces SET timezone='America/Mexico_City' WHERE id=$1::uuid`,[workspaceRow.id]);
  const profileId=randomUUID(),productId=randomUUID();const brandOsDigest=digest("brand-os-v1");
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile v1','active',1,jsonb_build_object('snapshot_hash',$4::text))`,
  [profileId,orgId,brandId,brandOsDigest]);
  await pool.query(`INSERT INTO brand_os_products(id,brand_os_profile_id,name,status)
    VALUES($1::uuid,$2::uuid,'Smart speaker','active')`,[productId,profileId]);
  const sourceId=randomUUID(),chunkId=randomUUID();
  await pool.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,
    raw_text,extracted_payload,status) VALUES($1::uuid,$2::uuid,$3::uuid,'operator-note','Knowledge fixture',
      'Private fixture narrative','{}'::jsonb,'active')`,[sourceId,orgId,brandId]);
  await pool.query(`INSERT INTO knowledge_chunks(id,knowledge_source_id,chunk_index,chunk_text)
    VALUES($1::uuid,$2::uuid,0,'Private fixture block')`,[chunkId,sourceId]);
  const planId=randomUUID(),planDigest=digest("plan"),identityDigest=digest("identity");
  const planOperationKey=digest("plan-operation-key");
  const brief={contract_version:"signal-acquisition-brief-v1",objective:"Understand governed context",
    purpose:"Local integration",market:"MX",countries:["MX"],languages:["es-MX"],
    timezone:"America/Mexico_City",default_capture_period:null,target_window_months:null,
    construction_mode:"exploratory",brand_os_profile_version:1,brand_os_digest:brandOsDigest,
    identity_catalog_digest:identityDigest,knowledge_context_digest:digest("brief-knowledge"),
    knowledge_context_refs:[],provider_key:"sentione",provider_syntax_version:"v1",
    provider_schema_version:"csv-v1",optional_study_context:null};
  await pool.query(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,
      'reconcile-acquisition-plan',$3,$4,'in_progress')`,[workspaceRow.id,userId,
      digest("plan-operation-request"),planOperationKey]);
  await pool.query(`INSERT INTO signal_acquisition_plans(id,workspace_id,plan_version,status,
    brand_os_profile_id,brand_os_profile_version,brand_os_digest,identity_catalog_digest,
    acquisition_brief_contract_version,acquisition_brief,acquisition_brief_digest,draft_revision,
    draft_digest,definition_hash,effective_from,created_by_user_id,promoted_by_user_id,promoted_at,
    creation_idempotency_key,request_digest)
    VALUES($1::uuid,$2::uuid,1,'current',$3::uuid,1,$4,$5,'signal-acquisition-brief-v1',$6::jsonb,
      $7,1,$8,$8,clock_timestamp(),$9::uuid,$9::uuid,clock_timestamp(),$10,$11)`,[planId,
      workspaceRow.id,profileId,brandOsDigest,identityDigest,JSON.stringify(brief),digest("brief"),planDigest,
      userId,planOperationKey,digest("request")]);
  const workspace={contractVersion:"signal-backend-v1" as const,id:workspaceRow.id,organizationId:orgId,
    slug:workspaceRow.slug,name:`Brand ${suffix}`,subject:{type:"brand" as const,id:brandId},
    timezone:"America/Mexico_City",status:"active" as const,corpora:[]};
  const otherWorkspace={contractVersion:"signal-backend-v1" as const,id:otherRow.id,organizationId:otherOrgId,
    slug:otherRow.slug,name:`Other ${suffix}`,subject:{type:"brand" as const,id:otherBrandId},
    timezone:otherRow.timezone,status:"active" as const,corpora:[]};
  const actor={id:userId,userType:"noisia_internal" as const,primaryRole:"noisia_admin",organizationId:null};
  return{workspace,otherWorkspace,actor,profileId,productId,sourceId,chunkId};}

async function transaction<T>(fn:(queryable:SignalBrandPolicyQueryable)=>Promise<T>){return withSignalAcquisitionTransactionV1(fn);}
async function scalar(sql:string,params:unknown[]){return(await pool.query<{count:number}>(sql,params)).rows[0]!.count;}
async function protectedCounts(workspaceId:string){return{
  assignments:await scalar(`SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`,[workspaceId]),
  record_tags:await scalar(`SELECT count(*)::int count FROM record_tags`,[]),
  pointers:await scalar(`SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`,[workspaceId]),
  bindings:await scalar(`SELECT count(*)::int count FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid`,[workspaceId])};}
function hasCode(code:string){return(error:unknown)=>(error as {code?:string}).code===code;}
function requireLocal(url:string){const host=new URL(url).hostname;if(!["localhost","127.0.0.1","::1"].includes(host))
  throw new Error(`Refusing non-local PostgreSQL target: ${host}`);}
