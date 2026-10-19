import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readdir,readFile } from "node:fs/promises";
import { resolve,join } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  createSignalAcquisitionQueryVersionV1,
  decideSignalAcquisitionReferenceV1,
  loadSignalAcquisitionPlanV1,
  promoteSignalAcquisitionPlanV1,
  reconcileSignalAcquisitionPlanDraftV1,
  reviewSignalAcquisitionQueryVersionV1,
  withSignalAcquisitionTransactionV1
} from "@/lib/data-os/signal-acquisition-plan";
import {
  loadSignalAcquisitionBriefContextV1
} from "@/lib/data-os/signal-acquisition-brief-management";
import {
  generateSignalAcquisitionQueryDraftsV1,
  generateSignalAcquisitionQueryDraftsProductV1,
  loadSignalAcquisitionQueryDraftDetailV1,
  loadSignalAcquisitionQueryGenerationPreflightV1
} from "@/lib/data-os/signal-acquisition-query-composer";
import {
  createOrReactivateSignalCompetitorsV1,
  retireSignalCompetitorsV1
} from "@/lib/data-os/signal-competitor-lifecycle";
import {
  authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1
} from "@/lib/data-os/signal-acquisition-strategic-authority";
import {
  preflightSignalSemanticBenchmarkExportV2,
  type SignalSemanticBenchmarkFrozenCorpusV2
} from "@/lib/data-os/signal-semantic-benchmark-export";
import {
  createWorkspaceConnectorSourceProductInTransactionV1
} from "@/lib/data-os/workspace-ingestion";
import {
  createWorkspaceImportUploadV1,
  loadWorkspaceImportV1
} from "@/lib/data-os/workspace-async-import";
import { pool } from "@/lib/db";

const DB_URL=process.env.NOISIA_SIGNAL_ACQUISITION_PLAN_INTEGRATION_URL;
const APPROVED=process.env.NOISIA_SIGNAL_ACQUISITION_PLAN_INTEGRATION_APPROVED==="true";
const digest=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;

test("0084-0089 Acquisition Plan supports query evidence and import-scoped strategic authority",{
  skip:!DB_URL||!APPROVED,timeout:120_000
},async()=>{
  assert.ok(DB_URL);requireLocal(DB_URL);
  const admin=new pg.Client({connectionString:DB_URL,ssl:false});await admin.connect();
  try{
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory=resolve(process.cwd(),"../../infrastructure/db/migrations");
    const files=(await readdir(directory)).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
    for(const file of files)await admin.query(await readFile(join(directory,file),"utf8"));
    await admin.query(await readFile(join(directory,"0088_signal_acquisition_query_evidence_v2.sql"),"utf8"));
    await admin.query(await readFile(join(directory,"0089_signal_acquisition_strategic_authority.sql"),"utf8"));
  }finally{await admin.end();}

  const userId=randomUUID();
  const otherOrgId=randomUUID(),otherUserId=randomUUID(),otherBrandId=randomUUID();
  const suffix=randomUUID().slice(0,8);
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status) VALUES
      ($1::uuid,$2,$3,$3,'active')`,[otherOrgId,`other-${suffix}`,`Other ${suffix}`]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
      ($1::uuid,$2,$3,'noisia_internal','noisia_admin',NULL,'active'),
      ($4::uuid,$5,$6,'noisia_internal','noisia_admin',$7::uuid,'active')`,[
    userId,`acq-${suffix}@example.test`,`Operator ${suffix}`,otherUserId,
    `other-${suffix}@example.test`,`Other operator ${suffix}`,otherOrgId]);
  process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE="true";
  process.env.NOISIA_LOCAL_AUTH_EMAIL=`acq-${suffix}@example.test`;
  process.env.NOISIA_DATA_OS_ENABLED="true";
  process.env.NOISIA_DATA_OS_SERVING_ENABLED="true";
  process.env.NOISIA_SIGNAL_WORKSPACE_API_ENABLED="true";
  const {POST:createBrand}=await import("@/app/api/brands/route");
  const brandResponse=await createBrand(new Request("http://localhost/api/brands",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      organization_name:`Acquisition ${suffix}`,slug:`brand-${suffix}`,
      name:`Synthetic acquisition ${suffix}`,display_name:`Synthetic acquisition ${suffix}`,
      industry:"Synthetic category",industry_sub:"Synthetic subcategory",countries:["MX"],
      description:"Greenfield brand creation route integration fixture.",brand_seed_handles:[`Alias ${suffix}`],
      competitors:[],timezone:"America/Mexico_City",status:"active"
    })
  }));
  assert.equal(brandResponse.status,201);
  const createdPayload=await brandResponse.json() as {data:{id:string};signal_workspace:{id:string}};
  const brandId=createdPayload.data.id;
  const orgId=(await pool.query<{organization_id:string}>(
    `SELECT organization_id::text FROM brands WHERE id=$1::uuid`,[brandId])).rows[0]!.organization_id;
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status) VALUES
      ($1::uuid,$2::uuid,$3,$4,$4,ARRAY['MX']::char(2)[],'active')`,[
    otherBrandId,otherOrgId,`other-brand-${suffix}`,`Other brand ${suffix}`]);
  const workspaceRow=(await pool.query<{id:string;slug:string;name:string;timezone:string;status:string}>(`
    SELECT workspace.id::text,workspace.slug,brand.display_name AS name,workspace.timezone,workspace.status
    FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
    WHERE workspace.brand_id=$1::uuid`,[brandId])).rows[0]!;
  const otherWorkspaceId=(await pool.query<{id:string}>(`
    SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid`,[otherBrandId])).rows[0]!.id;
  const profile=await pool.query<{version:number;snapshot_hash:string}>(`
    SELECT version,metadata->>'snapshot_hash' snapshot_hash
    FROM brand_os_profiles WHERE brand_id=$1::uuid AND status='active'
    ORDER BY version DESC LIMIT 1`,[brandId]);
  assert.equal(profile.rowCount,1);
  let profileVersion=profile.rows[0]!.version;
  let profileDigest=profile.rows[0]!.snapshot_hash;
  assert.match(profileDigest,/^sha256:[0-9a-f]{64}$/u);
  const categoryId=randomUUID(),referenceId=randomUUID();
  await pool.query(`INSERT INTO intelligence_entities(
    id,organization_id,brand_id,entity_type,canonical_name,status,metadata
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'category',$4,'active','{}'::jsonb),
    ($5::uuid,$2::uuid,$3::uuid,'reference',$6,'active','{}'::jsonb)`,[
    categoryId,orgId,brandId,`Category ${suffix}`,referenceId,`Reference ${suffix}`]);

  const workspace={contractVersion:"signal-backend-v1" as const,id:workspaceRow.id,organizationId:orgId,
    slug:workspaceRow.slug,name:workspaceRow.name,subject:{type:"brand" as const,id:brandId},
    timezone:workspaceRow.timezone,status:workspaceRow.status,corpora:[]};
  const actor={id:userId,userType:"noisia_internal",organizationId:orgId};
  const {GET:getPlanRoute}=await import("@/app/api/data-os/signal/[workspaceId]/acquisition-plan/route");
  const firstUsePlanResponse=await getPlanRoute(new Request("http://localhost/acquisition-plan"),{
    params:Promise.resolve({workspaceId:workspace.id})
  });
  assert.ok(firstUsePlanResponse);
  assert.equal(firstUsePlanResponse.status,200);
  const competitorNames=[`Competitor A ${suffix}`,`Competitor B ${suffix}`];
  const {POST:createCompetitors}=await import("@/app/api/brands/[id]/competitors/route");
  const competitorsResponse=await createCompetitors(new Request("http://localhost/competitors",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":`competitors-${suffix}`},
    body:JSON.stringify({competitors:competitorNames})
  }),{params:Promise.resolve({id:brandId})});
  assert.equal(competitorsResponse.status,201);
  const reconciledProfile=(await pool.query<{version:number;snapshot_hash:string}>(`
    SELECT version,metadata->>'snapshot_hash' snapshot_hash
    FROM brand_os_profiles WHERE brand_id=$1::uuid AND status='active'
    ORDER BY version DESC LIMIT 1`,[brandId])).rows[0]!;
  profileVersion=reconciledProfile.version;profileDigest=reconciledProfile.snapshot_hash;
  assert.equal(profileVersion,2);
  assert.match(profileDigest,/^sha256:[0-9a-f]{64}$/u);
  const connector=await createWorkspaceConnectorSourceProductInTransactionV1({workspace,actor,
    idempotencyKey:`connector-${suffix}`,input:{contract_version:"signal-data-source-connector-v1",
      name:`Shared SentiOne connector ${suffix}`,provider:"sentione",source_type:"social-listening",
      connection_method:"manual-csv"}});
  assert.match(connector.source_key,/^source-sha256-[0-9a-f]{64}$/u);
  assert.deepEqual(await createWorkspaceConnectorSourceProductInTransactionV1({workspace,actor,
    idempotencyKey:`connector-${suffix}`,input:{contract_version:"signal-data-source-connector-v1",
      name:`Shared SentiOne connector ${suffix}`,provider:"sentione",source_type:"social-listening",
      connection_method:"manual-csv"}}),connector);
  await assert.rejects(createWorkspaceConnectorSourceProductInTransactionV1({workspace,actor,
    idempotencyKey:`connector-${suffix}`,input:{contract_version:"signal-data-source-connector-v1",
      name:"Incompatible replay",provider:"sentione",source_type:"social-listening",
      connection_method:"manual-csv"}}));
  const concurrentInput={contract_version:"signal-data-source-connector-v1" as const,
    name:`Concurrent connector ${suffix}`,provider:"sentione",source_type:"social-listening",
    connection_method:"manual-csv"};
  const concurrent=await Promise.all([0,1].map(()=>createWorkspaceConnectorSourceProductInTransactionV1({
    workspace,actor,idempotencyKey:`connector-concurrent-${suffix}`,input:concurrentInput})));
  assert.deepEqual(concurrent[0],concurrent[1]);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM data_sources
    WHERE workspace_id=$1::uuid AND source_key=$2`,[workspace.id,concurrent[0]!.source_key])).rows[0]!.count,1);
  const sourceId=(await pool.query<{id:string}>(`SELECT id::text FROM data_sources
    WHERE workspace_id=$1::uuid AND source_key=$2`,[workspace.id,connector.source_key])).rows[0]!.id;
  const policy=await seedGovernance({workspaceId:workspace.id,organizationId:orgId,userId,sourceId,suffix});

  const refKey=`reference-sha256-${createHash("sha256").update(referenceId).digest("hex")}`;
  const decision=await withSignalAcquisitionTransactionV1((queryable)=>decideSignalAcquisitionReferenceV1({
    queryable,workspace,actor,idempotencyKey:`reference-${suffix}`,identityKey:refKey,
    action:"include",evidence:"Synthetic operator inclusion",effectiveFrom:new Date().toISOString()
  }));
  assert.equal(decision.action,"include");
  let plan=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`reconcile-${suffix}`,expectedCurrentVersion:null,
    expectedBrandOsRevision:profileVersion
  }));
  assert.equal(plan.state,"ready");
  assert.equal(plan.readiness.ready_to_promote,true);
  assert.equal(plan.readiness.query_playbook_complete,false);
  assert.ok(plan.readiness.warnings.filter(
    (warning)=>warning.startsWith("query_playbook_incomplete:")).length>=4);
  assert.equal(plan.slots.length,5);
  const zeroQueryDraft=plan.draft_plan!;
  await withSignalAcquisitionTransactionV1((queryable)=>promoteSignalAcquisitionPlanV1({
    queryable,workspace,actor,idempotencyKey:`promote-zero-query-${suffix}`,
    expectedDraftVersion:zeroQueryDraft.version,expectedDraftRevision:zeroQueryDraft.draft_revision,
    expectedDraftDigest:zeroQueryDraft.draft_digest,effectiveFrom:new Date().toISOString(),
    evidence:"Synthetic zero-query import-ready plan"
  }));
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.equal(plan.state,"current");
  assert.equal(plan.readiness.ready_for_import,true);
  assert.equal(plan.readiness.query_playbook_complete,false);
  plan=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`reconcile-query-playbook-${suffix}`,
    expectedCurrentVersion:1,expectedBrandOsRevision:profileVersion
  }));
  assert.equal(plan.draft_plan?.version,2);
  const {GET:getBriefRoute,POST:sealBriefRoute}=await import(
    "@/app/api/data-os/signal/[workspaceId]/acquisition-plan/brief/route"
  );
  const briefRouteContext={params:Promise.resolve({workspaceId:workspace.id})};
  const briefGetResponse=await getBriefRoute(new Request("http://localhost/acquisition-plan/brief"),briefRouteContext);
  assert.ok(briefGetResponse);
  assert.equal(briefGetResponse.status,200);
  const briefContext=await briefGetResponse.json() as Awaited<ReturnType<typeof loadSignalAcquisitionBriefContextV1>>;
  assert.equal(briefContext.status,"missing");
  const briefInput={revision_token:briefContext.revision_token,
    objective:"Acquire synthetic public listening data",purpose:"Acquisition Plan QA",
    market_country:"MX",countries:["MX"],languages:["es-MX"],
    default_capture_period:{start:"2026-01-01",end:"2026-12-31"},target_window_months:12,
    construction_mode:"exploratory" as const,include_knowledge_context:false};
  const briefRequest=()=>new Request("http://localhost/acquisition-plan/brief",{method:"POST",
    headers:{"Content-Type":"application/json","Idempotency-Key":`brief-${suffix}`},
    body:JSON.stringify(briefInput)});
  const briefPostResponse=await sealBriefRoute(briefRequest(),briefRouteContext);
  assert.ok(briefPostResponse);
  assert.equal(briefPostResponse.status,200);
  const sealedBrief=await briefPostResponse.json() as Awaited<ReturnType<typeof loadSignalAcquisitionBriefContextV1>>;
  assert.equal(sealedBrief.status,"sealed");
  const replayBriefResponse=await sealBriefRoute(briefRequest(),briefRouteContext);
  assert.ok(replayBriefResponse);
  assert.equal(replayBriefResponse.status,200);
  assert.deepEqual(await replayBriefResponse.json(),sealedBrief);
  const incompatibleBriefResponse=await sealBriefRoute(new Request("http://localhost/acquisition-plan/brief",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":`brief-${suffix}`},
    body:JSON.stringify({...briefInput,purpose:"Incompatible replay"})
  }),briefRouteContext);
  assert.ok(incompatibleBriefResponse);
  assert.equal(incompatibleBriefResponse.status,409);
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.equal(plan.draft_plan?.acquisition_brief_status,"sealed");
  const composerConfiguration={provider:"fixture",model:"fixture-composer-v1",
    pricing_version:"fixture-pricing-v1",max_input_tokens_per_call:1_000,
    max_output_tokens_per_call:500,input_usd_per_million_tokens:"3",
    output_usd_per_million_tokens:"15"};
  const capped=await loadSignalAcquisitionQueryGenerationPreflightV1({queryable:pool,workspace,actor,
    sourceKey:connector.source_key,hardCapUsd:"0.000000",configuration:composerConfiguration});
  assert.equal(capped.readiness,"blocked");
  assert.deepEqual(capped.blockers,["hard_cap_insufficient"]);
  const preflight=await loadSignalAcquisitionQueryGenerationPreflightV1({queryable:pool,workspace,actor,
    sourceKey:connector.source_key,hardCapUsd:"5.000000",configuration:composerConfiguration});
  assert.equal(preflight.readiness,"ready");
  assert.equal(preflight.slot_count,4);
  assert.equal(preflight.provider_calls,0);
  assert.equal(preflight.writes_performed,false);
  let fixtureProviderCalls=0;
  const generated=await withSignalAcquisitionTransactionV1((queryable)=>generateSignalAcquisitionQueryDraftsV1({
    queryable,workspace,actor,sourceKey:connector.source_key,hardCapUsd:"5.000000",
    configuration:composerConfiguration,idempotencyKey:`composer-${suffix}`,
    provider:{async generate(){fixtureProviderCalls+=1;return{text:"{}"};}},
    now:()=>new Date("2026-08-15T12:00:00.000Z")
  }));
  assert.equal(generated.query_drafts.length,4);
  assert.equal(generated.query_drafts.every((query)=>query.origin==="engine-generated"),true);
  assert.equal(generated.query_drafts.every((query)=>query.state==="generated_with_fallback"),true);
  assert.equal(generated.plan_promoted,false);
  assert.equal(fixtureProviderCalls,2);
  const replay=await withSignalAcquisitionTransactionV1((queryable)=>generateSignalAcquisitionQueryDraftsV1({
    queryable,workspace,actor,sourceKey:connector.source_key,hardCapUsd:"5.000000",
    configuration:composerConfiguration,idempotencyKey:`composer-${suffix}`,
    provider:{async generate(){fixtureProviderCalls+=1;throw new Error("replay must not call provider");}},
    now:()=>new Date("2026-08-15T12:00:00.000Z")
  }));
  assert.deepEqual(replay,generated);
  assert.equal(fixtureProviderCalls,2);
  const regenerated=await generateSignalAcquisitionQueryDraftsProductV1({
    workspace,actor,sourceKey:connector.source_key,hardCapUsd:"5.000000",
    configuration:composerConfiguration,idempotencyKey:`composer-regenerate-${suffix}`,
    provider:{async generate(){fixtureProviderCalls+=1;return{text:"{}"};}},
    now:()=>new Date("2026-08-15T12:05:00.000Z")
  });
  assert.equal(regenerated.query_drafts.every((query)=>query.query_version===2),true);
  assert.equal(fixtureProviderCalls,4);
  assert.deepEqual(await generateSignalAcquisitionQueryDraftsProductV1({
    workspace,actor,sourceKey:connector.source_key,hardCapUsd:"5.000000",
    configuration:composerConfiguration,idempotencyKey:`composer-regenerate-${suffix}`,
    provider:{async generate(){fixtureProviderCalls+=1;throw new Error("product replay must not call provider");}},
    now:()=>new Date("2026-08-15T12:05:00.000Z")
  }),regenerated);
  assert.equal(fixtureProviderCalls,4);
  const generatedPreflight=await loadSignalAcquisitionQueryGenerationPreflightV1({
    queryable:pool,workspace,actor,sourceKey:connector.source_key,hardCapUsd:"5.000000",
    configuration:composerConfiguration
  });
  assert.equal(generatedPreflight.required_slots.every(
    (slot)=>slot.state==="generated_with_fallback"),true);
  const generationRows=await pool.query<{id:string;scope:string;status:string;origin_kind:string;
    generation_model:string;generation_fallback_used:boolean}>(`
    SELECT query.id::text,slot.scope,query.status,query.origin_kind,query.generation_model,
      query.generation_fallback_used
    FROM signal_acquisition_query_versions query JOIN signal_acquisition_slots slot ON slot.id=query.slot_id
    WHERE query.workspace_id=$1::uuid AND query.origin_kind='engine-generated'
    ORDER BY slot.scope,slot.slot_key,query.query_version`,[workspace.id]);
  assert.equal(generationRows.rowCount,8);
  assert.equal(generationRows.rows.filter((row)=>row.status==="draft").length,4);
  assert.equal(generationRows.rows.filter((row)=>row.status==="superseded").length,4);
  assert.equal(generationRows.rows.some((row)=>row.scope==="reference"),false);
  assert.equal(generationRows.rows.every((row)=>row.generation_model==="fixture-composer-v1"
    &&row.generation_fallback_used),true);
  const focused=await loadSignalAcquisitionQueryDraftDetailV1({queryable:pool,workspace,actor,
    slotKey:generated.query_drafts[0]!.slot_key,queryVersion:1});
  assert.equal(focused.origin,"engine-generated");
  assert.equal(focused.generation_state,"generated_with_fallback");
  assert.ok(focused.query_text.length>0);
  await assert.rejects(pool.query(`UPDATE signal_acquisition_query_versions
    SET generation_model='mutated' WHERE id=$1::uuid`,[generationRows.rows[0]!.id]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  assert.equal((await pool.query<{status:string}>(`SELECT status FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND status='draft'`,[workspace.id])).rows[0]!.status,"draft");
  const {PATCH:updateBrand}=await import("@/app/api/brands/[id]/route");
  const updateBrandResponse=await updateBrand(new Request("http://localhost/brands",{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      organization_id:orgId,slug:`brand-${suffix}`,name:`Synthetic acquisition ${suffix}`,
      display_name:`Synthetic acquisition ${suffix}`,industry:"Synthetic category updated",
      industry_sub:"Synthetic subcategory",countries:["MX"],
      description:"Updated greenfield Brand OS context.",brand_seed_handles:[`Alias ${suffix}`],
      timezone:"America/Mexico_City",status:"active"
    })
  }),{params:Promise.resolve({id:brandId})});
  assert.equal(updateBrandResponse.status,200);
  const nextProfile=(await pool.query<{version:number;snapshot_hash:string}>(`
    SELECT version,metadata->>'snapshot_hash' snapshot_hash FROM brand_os_profiles
    WHERE brand_id=$1::uuid AND status='active' ORDER BY version DESC LIMIT 1`,[brandId])).rows[0]!;
  profileVersion=nextProfile.version;profileDigest=nextProfile.snapshot_hash;
  assert.equal(profileVersion,3);
  const staleBrief=await loadSignalAcquisitionBriefContextV1({queryable:pool,workspace,actor});
  assert.equal(staleBrief.status,"stale");
  const driftedPreflight=await loadSignalAcquisitionQueryGenerationPreflightV1({queryable:pool,workspace,actor,
    sourceKey:connector.source_key,hardCapUsd:"5.000000",configuration:composerConfiguration});
  assert.equal(driftedPreflight.readiness,"blocked");
  assert.ok(driftedPreflight.blockers.includes("acquisition_brief_drift"));
  plan=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`brief-drift-reconcile-${suffix}`,
    expectedCurrentVersion:1,expectedBrandOsRevision:null
  }));
  const refreshedBrief=await loadSignalAcquisitionBriefContextV1({queryable:pool,workspace,actor});
  assert.equal(refreshedBrief.status,"stale");
  const resealedBriefResponse=await sealBriefRoute(new Request("http://localhost/acquisition-plan/brief",{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":`brief-refresh-${suffix}`},
    body:JSON.stringify({...briefInput,revision_token:refreshedBrief.revision_token})
  }),briefRouteContext);
  assert.ok(resealedBriefResponse);
  assert.equal(resealedBriefResponse.status,200);
  const resealedBrief=await resealedBriefResponse.json() as Awaited<ReturnType<typeof loadSignalAcquisitionBriefContextV1>>;
  assert.equal(resealedBrief.status,"sealed");
  const readyAfterRefresh=await loadSignalAcquisitionQueryGenerationPreflightV1({queryable:pool,workspace,actor,
    sourceKey:connector.source_key,hardCapUsd:"5.000000",configuration:composerConfiguration});
  assert.equal(readyAfterRefresh.readiness,"ready");
  assert.deepEqual((await pool.query<{iterations:number;packs:number;corpora:number;imports:number}>(`
    SELECT (SELECT count(*)::int FROM query_iterations) iterations,
      (SELECT count(*)::int FROM query_packs) packs,
      (SELECT count(*)::int FROM study_corpora) corpora,
      (SELECT count(*)::int FROM import_batches) imports`)).rows[0],
    {iterations:0,packs:0,corpora:0,imports:0});
  const initialDraftRevision=plan.draft_plan!.draft_revision;
  for(const [index,slot] of plan.slots.entries()){
    await withSignalAcquisitionTransactionV1((queryable)=>createSignalAcquisitionQueryVersionV1({
      queryable,workspace,actor,idempotencyKey:`query-${suffix}-${index}`,slotKey:slot.slot_key,input:{
        source_key:connector.source_key,provider:"sentione",provider_syntax_version:"sentione-query-v1",
        provider_schema_version:"sentione-csv-47-v1",query_text:`synthetic query ${index}`,
        structured_terms:{include:[`term-${index}`],exclude:[],aliases:[]},cadence:"manual",
        default_period:{start:"2026-01-01",end:"2026-12-31",timezone:"America/Mexico_City"}
      }
    }));
  }
  const replaced=await withSignalAcquisitionTransactionV1((queryable)=>createSignalAcquisitionQueryVersionV1({
    queryable,workspace,actor,idempotencyKey:`query-replace-${suffix}`,slotKey:plan.slots[0]!.slot_key,input:{
      source_key:connector.source_key,provider:"sentione",provider_syntax_version:"sentione-query-v1",
      provider_schema_version:"sentione-csv-47-v1",query_text:"synthetic replacement query",
      structured_terms:{include:["replacement"],exclude:[],aliases:[]},cadence:"weekly",
      default_period:{start:"2026-01-01",end:"2026-12-31",timezone:"America/Mexico_City"}
    }
  }));
  assert.equal(replaced.query_version,4);
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.ok(plan.draft_plan!.draft_revision>initialDraftRevision);
  assert.equal(plan.readiness.ready_to_promote,false);
  assert.ok(plan.readiness.blockers.some((blocker)=>blocker.startsWith("query_review_required:")));
  const reviewTargets=(await pool.query<{slot_key:string;query_version:number}>(`
    SELECT DISTINCT ON(slot.slot_key) slot.slot_key,query.query_version
    FROM signal_acquisition_slots slot
    JOIN signal_acquisition_query_versions query ON query.slot_id=slot.id AND query.plan_id=slot.plan_id
    JOIN signal_acquisition_plans plan ON plan.id=slot.plan_id
    WHERE plan.workspace_id=$1::uuid AND plan.status='draft'
      AND query.status='draft' AND slot.desired_state='active'
    ORDER BY slot.slot_key,query.query_version DESC`,[workspace.id])).rows;
  assert.equal(reviewTargets.length,plan.slots.length);
  for(const target of reviewTargets){
    const reviewed=await withSignalAcquisitionTransactionV1((queryable)=>
      reviewSignalAcquisitionQueryVersionV1({queryable,workspace,actor,
        idempotencyKey:`review-${suffix}-${target.slot_key}`,slotKey:target.slot_key,
        queryVersion:target.query_version,decision:"approved",evidence:"Approved after operator QA"}));
    assert.equal(reviewed.decision,"approved");
  }
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.equal(plan.readiness.ready_to_promote,true);
  await assert.rejects(pool.query(`UPDATE signal_acquisition_query_review_events
    SET decision='rejected' WHERE workspace_id=$1::uuid`,[workspace.id]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  const stableRevision=plan.draft_plan!.draft_revision;
  const noOp=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`reconcile-noop-${suffix}`,expectedCurrentVersion:1,
    expectedBrandOsRevision:profileVersion
  }));
  assert.equal(noOp.draft_plan!.draft_revision,stableRevision);
  const draft=plan.draft_plan!;
  await withSignalAcquisitionTransactionV1((queryable)=>promoteSignalAcquisitionPlanV1({
    queryable,workspace,actor,idempotencyKey:`promote-${suffix}`,expectedDraftVersion:draft.version,
    expectedDraftRevision:draft.draft_revision,expectedDraftDigest:draft.draft_digest,
    effectiveFrom:new Date().toISOString(),evidence:"Synthetic explicit promotion"
  }));
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.equal(plan.state,"current");
  assert.equal(plan.current_plan?.blockers.length,0);
  const nextDraft=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`reconcile-next-${suffix}`,expectedCurrentVersion:2,
    expectedBrandOsRevision:profileVersion
  }));
  assert.equal(nextDraft.draft_plan?.version,3);
  assert.equal(nextDraft.readiness.ready_to_promote,true);
  await withSignalAcquisitionTransactionV1((queryable)=>promoteSignalAcquisitionPlanV1({
    queryable,workspace,actor,idempotencyKey:`promote-next-${suffix}`,
    expectedDraftVersion:nextDraft.draft_plan!.version,
    expectedDraftRevision:nextDraft.draft_plan!.draft_revision,
    expectedDraftDigest:nextDraft.draft_plan!.draft_digest,effectiveFrom:new Date().toISOString(),
    evidence:"Synthetic explicit forward rollback transition"
  }));
  plan=await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor});
  assert.equal(plan.current_plan?.version,3);
  await withSignalAcquisitionTransactionV1((queryable)=>decideSignalAcquisitionReferenceV1({
    queryable,workspace,actor,idempotencyKey:`reference-future-${suffix}`,identityKey:refKey,
    action:"exclude",evidence:"Synthetic future exclusion",
    effectiveFrom:new Date(Date.now()+86_400_000).toISOString()
  }));
  assert.equal((await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor})).state,"current");
  assert.deepEqual((await pool.query<{status:string;definition_hash:string|null;draft_digest:string}>(`
    SELECT status,definition_hash,draft_digest FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid ORDER BY plan_version`,[workspace.id])).rows.map((row)=>({
      status:row.status,sealed:row.definition_hash===row.draft_digest
    })),[{status:"retired",sealed:true},{status:"retired",sealed:true},{status:"current",sealed:true}]);

  const authority=(await pool.query<{
    plan_id:string;plan_version:number;slot_id:string;slot_key:string;query_id:string;query_version:number;
    plan_digest:string;slot_digest:string;query_digest:string;brand_os_digest:string;catalog_digest:string;
  }>(`SELECT plan.id::text plan_id,plan.plan_version,slot.id::text slot_id,query.id::text query_id,
    slot.slot_key,query.query_version,
    plan.definition_hash plan_digest,slot.definition_hash slot_digest,query.definition_hash query_digest,
    plan.brand_os_digest,plan.identity_catalog_digest catalog_digest
    FROM signal_acquisition_plans plan
    JOIN LATERAL(SELECT * FROM signal_acquisition_slots WHERE plan_id=plan.id AND slot_key='primary-brand'
      ORDER BY slot_version DESC LIMIT 1)slot ON true
    JOIN signal_acquisition_query_versions query ON query.plan_id=plan.id AND query.slot_id=slot.id
      AND query.status='current'
    WHERE plan.workspace_id=$1::uuid AND plan.status='current'`,[workspace.id])).rows[0]!;
  const fixtureStorage={
    resolve:()=>({bucket:"private-imports"}),
    createSignedUploads:async({objectPrefix,fileSizeBytes}:{objectPrefix:string;fileSizeBytes:number})=>({
      bucket:"private-imports",objectPrefix,expiresInSeconds:3600,partSizeBytes:fileSizeBytes,
      parts:[{partNumber:1,expectedSizeBytes:fileSizeBytes,
        objectKey:`${objectPrefix}.part-00001`,uploadUrl:"http://127.0.0.1.invalid/upload"}]
    })
  };
  const attested=await createWorkspaceImportUploadV1({workspace,actor,sourceId,
    fileName:"attested.csv",fileSizeBytes:10,contentType:"text/csv",
    contributedByStudyCorpusId:null,supersedesImportBatchId:null,
    idempotencyKey:`attested-${suffix}`,storage:fixtureStorage,
    acquisition:{sourceKey:connector.source_key,slotKey:authority.slot_key,
      queryEvidence:{class:"operator_attested",queryVersion:authority.query_version,reason:null},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}});
  assert.ok(attested.batch.acquisition);
  assert.equal(attested.batch.acquisition.query_evidence.class,"operator_attested");
  assert.equal(attested.batch.acquisition.query_version,authority.query_version);
  assert.deepEqual(await createWorkspaceImportUploadV1({workspace,actor,sourceId,
    fileName:"attested.csv",fileSizeBytes:10,contentType:"text/csv",
    contributedByStudyCorpusId:null,supersedesImportBatchId:null,
    idempotencyKey:`attested-${suffix}`,storage:fixtureStorage,
    acquisition:{sourceKey:connector.source_key,slotKey:authority.slot_key,
      queryEvidence:{class:"operator_attested",queryVersion:authority.query_version,reason:null},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}}),
  {...attested,replayed:true});
  const crossSlot=(await pool.query<{slot_key:string}>(`SELECT slot_key FROM signal_acquisition_slots
    WHERE plan_id=$1::uuid AND desired_state='active' AND slot_key<>$2 ORDER BY slot_key LIMIT 1`,[
    authority.plan_id,authority.slot_key])).rows[0]!.slot_key;
  await assert.rejects(createWorkspaceImportUploadV1({workspace,actor,sourceId,
    fileName:"cross-slot.csv",fileSizeBytes:10,contentType:"text/csv",
    contributedByStudyCorpusId:null,supersedesImportBatchId:null,
    idempotencyKey:`cross-slot-${suffix}`,storage:fixtureStorage,
    acquisition:{sourceKey:connector.source_key,slotKey:crossSlot,
      queryEvidence:{class:"operator_attested",queryVersion:authority.query_version,reason:null},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}}),
  /acquisition_authority_unavailable/);
  await assert.rejects(createWorkspaceImportUploadV1({workspace,actor,sourceId,
    fileName:"provider.csv",fileSizeBytes:10,contentType:"text/csv",
    contributedByStudyCorpusId:null,supersedesImportBatchId:null,
    idempotencyKey:`provider-${suffix}`,storage:fixtureStorage,
    acquisition:{sourceKey:connector.source_key,slotKey:authority.slot_key,
      queryEvidence:{class:"provider_verified",queryVersion:authority.query_version,reason:null,
        providerExecutionReferenceHash:"invalid",providerExecutionAdapterKey:"sentione-server-api-v1"},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}}),
  /provider_execution_evidence_required/);
  const unavailable=await createWorkspaceImportUploadV1({workspace,actor,sourceId,
    fileName:"unavailable.csv",fileSizeBytes:10,contentType:"text/csv",
    contributedByStudyCorpusId:null,supersedesImportBatchId:null,
    idempotencyKey:`unavailable-${suffix}`,storage:fixtureStorage,
    acquisition:{sourceKey:connector.source_key,slotKey:authority.slot_key,
      queryEvidence:{class:"unavailable",queryVersion:null,reason:"historical_export"},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}});
  assert.ok(unavailable.batch.acquisition);
  assert.deepEqual({class:unavailable.batch.acquisition.query_evidence.class,
    reason:unavailable.batch.acquisition.query_evidence.reason,
    query_version:unavailable.batch.acquisition.query_version},{
    class:"unavailable",reason:"historical_export",query_version:null});
  const unavailableDispatch=(await pool.query<{worker_job_id:string}>(`
    SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)`,[
    unavailable.batch.id,userId])).rows[0]!;
  await pool.query(`SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)`,[
    unavailable.batch.id,unavailableDispatch.worker_job_id]);
  const unavailableMentionId=randomUUID();
  await pool.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
    provider_record_id,external_id,source_system,source_file_id,text_hash,text_clean,text_length,
    published_at,platform,resolved_platform,inclusion_status)
    VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,'sentione',$5::uuid,$6,$7,length($7),
      '2026-01-20T12:00:00Z','web','web','included')`,[
    unavailableMentionId,workspace.id,sourceId,`unavailable-record-${suffix}`,unavailable.batch.id,
    digest(`unavailable-text:${suffix}`).slice(7),"Synthetic unavailable-query mention content."]);
  await pool.query(`SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,'included')`,[
    unavailableMentionId,unavailable.batch.id]);
  await pool.query(`UPDATE import_batches SET provider_observation_projection_state='ready',
    provider_observation_header_hash=$2,provider_observation_count=1 WHERE id=$1::uuid`,[
    unavailable.batch.id,digest("headers-v2")]);
  await pool.query(`INSERT INTO signal_provider_mention_observations(
    workspace_id,data_source_id,import_batch_id,mention_id,provider_key,provider_record_key_hash,
    acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,acquisition_plan_digest,
    acquisition_slot_digest,acquisition_query_digest,provider_schema_version,provider_header_hash,
    observation_version,observation_hash,platform,language_code,country_code,published_at,
    provenance_binding_id,rights_definition_hash,retention_until
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'sentione',$5,$6::uuid,$7::uuid,NULL,$8,$9,NULL,
    'sentione-csv-47-v1',$10,1,$11,'web','es','MX','2026-01-01T00:30:00Z',
    $12::uuid,$13,'2030-01-01T00:00:00Z')`,[workspace.id,sourceId,unavailable.batch.id,
    unavailableMentionId,digest(`unavailable-record:${suffix}`),authority.plan_id,authority.slot_id,
    authority.plan_digest,authority.slot_digest,digest("headers-v2"),digest("observation-v2"),
    policy.bindingId,policy.bindingHash]);
  await pool.query(`SELECT * FROM complete_signal_workspace_import_v1(
    $1::uuid,$2,$3,1,1,0,0,10)`,[unavailable.batch.id,unavailableDispatch.worker_job_id,"b".repeat(64)]);
  const completedUnavailable=await loadWorkspaceImportV1({
    workspaceId:workspace.id,sourceId,importBatchId:unavailable.batch.id
  });
  assert.deepEqual(completedUnavailable?.observed,{
    period:{start:"2025-12-31",end:"2025-12-31"},languages:["es"],countries:["MX"],
    platforms:["web"],warnings:["observed_period_outside_declared_period"]
  });
  const unavailableIntent=(await pool.query<{review_status:string;eligibility_status:string;
    evidence_class:string;query_id:string|null;actor_id:string;confidence:string|null}>(`SELECT review_status,eligibility_status,
      acquisition_query_evidence_class evidence_class,acquisition_query_version_id::text query_id,
      acquisition_query_evidence_actor_user_id::text actor_id,confidence::text
    FROM signal_mention_attributions WHERE workspace_id=$1::uuid AND import_batch_id=$2::uuid`,[
    workspace.id,unavailable.batch.id])).rows[0]!;
  assert.deepEqual(unavailableIntent,{review_status:"pending",eligibility_status:"not_eligible",
    evidence_class:"unavailable",query_id:null,actor_id:userId,confidence:null});
  const strategicBatchIds=[unavailable.batch.id];
  const firstStrategicObservation=(await pool.query<{id:string}>(`SELECT id::text
    FROM signal_provider_mention_observations WHERE workspace_id=$1::uuid
      AND import_batch_id=$2::uuid AND observation_version=1`,[
    workspace.id,unavailable.batch.id])).rows[0]!.id;
  await pool.query(`INSERT INTO signal_provider_mention_observation_terms(
    observation_id,workspace_id,term_kind,ordinal,term_private,term_hash,normalized_term
  ) VALUES($1::uuid,$2::uuid,'provider-tag',0,'private-fixture-tag',$3,'private fixture tag')`,[
    firstStrategicObservation,workspace.id,digest("private-fixture-tag")]);
  for(let index=0;index<4;index+=1){
    const generated=await createCompletedStrategicFixtureImport({workspace,actor,sourceId,
      sourceKey:connector.source_key,slotKey:authority.slot_key,planId:authority.plan_id,
      slotId:authority.slot_id,planDigest:authority.plan_digest,slotDigest:authority.slot_digest,
      bindingId:policy.bindingId,bindingHash:policy.bindingHash,suffix:`${suffix}-${index}`,
      storage:fixtureStorage,userId});
    strategicBatchIds.push(generated.batchId);
  }
  const fixturePartition=(key:string):SignalSemanticBenchmarkFrozenCorpusV2["partitions"][number]=>({
    key,scope:"primary_brand",entity_ref:digest(`entity:${key}`),declared_market:"MX",
    total:5,included:5,excluded:0,population_digest:digest(`population:${key}`),
    modeling_digest:digest(`modeling:${key}`),plan_version:authority.plan_version,
    plan_digest:authority.plan_digest as `sha256:${string}`,
    slot_digest:authority.slot_digest as `sha256:${string}`
  });
  const frozenStrategicCorpus:SignalSemanticBenchmarkFrozenCorpusV2={
    identity:`generic-strategic-fixture-${suffix}`,acquisition_denominator:5,
    included_modeling_population:5,quality_excluded_roots:0,
    population_digest:digest(`strategic-population:${suffix}`),
    content_digest:digest(`strategic-content:${suffix}`),
    provenance_digest:digest(`strategic-provenance:${suffix}`),
    watermark_digest:digest(`strategic-watermark:${suffix}`),timezone:"America/Mexico_City",
    observed_period_local:{from:"2026-01-01",to:"2026-01-31"},
    partitions:[fixturePartition("primary"),fixturePartition("category"),
      fixturePartition("competitor-a"),fixturePartition("competitor-b")]
  };
  const preflightClient=await pool.connect();
  try{
    const denied=await preflightSignalSemanticBenchmarkExportV2({client:preflightClient,
      workspaceId:workspace.id,frozenCorpus:frozenStrategicCorpus});
    assert.equal(denied.ready,false);
    assert.deepEqual(denied.blockers,["strategic_authority_blocked:strategic_analysis_denied"]);
  }finally{preflightClient.release();}
  const strategic=await authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
    workspace,actor,idempotencyKey:`strategic-authority-${suffix}`,
    approvalEvidence:"Synthetic operator approval for local strategic analysis only.",
    frozenCorpus:frozenStrategicCorpus
  });
  assert.equal(strategic.import_count,5);
  assert.equal(strategic.import_bindings_created,5);
  assert.equal(strategic.observation_versions_created,5);
  assert.equal(strategic.observation_terms_copied,1);
  assert.equal(strategic.llm_processing_allowed,false);
  assert.equal(strategic.future_imports_authorized,false);
  assert.ok(Date.parse(strategic.effective_to)-Date.parse(strategic.effective_from)<=30*86_400_000);
  assert.deepEqual(await authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
    workspace,actor,idempotencyKey:`strategic-authority-${suffix}`,
    approvalEvidence:"Synthetic operator approval for local strategic analysis only.",
    frozenCorpus:frozenStrategicCorpus
  }),strategic);
  await assert.rejects(authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
    workspace,actor,idempotencyKey:`strategic-authority-${suffix}`,
    approvalEvidence:"Different operator evidence must reject incompatible replay.",
    frozenCorpus:frozenStrategicCorpus
  }),/incompatible product input/u);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid
      AND import_batch_id=ANY($2::uuid[]) AND status='active'`,[
    workspace.id,strategicBatchIds])).rows[0]!.count,5);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_provider_mention_observations successor
    WHERE successor.workspace_id=$1::uuid AND successor.observation_version=2
      AND successor.import_batch_id=ANY($2::uuid[])`,[
    workspace.id,strategicBatchIds])).rows[0]!.count,5);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_licensing_policy_usages usage
    JOIN signal_licensing_policies policy ON policy.id=usage.licensing_policy_id
    WHERE policy.workspace_id=$1::uuid AND policy.policy_key LIKE 'acquisition-strategic-%'
      AND usage.usage_purpose='llm-processing' AND usage.decision='allowed'`,[
    workspace.id])).rows[0]!.count,0);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid
      AND import_batch_id=$2::uuid`,[workspace.id,attested.batch.id])).rows[0]!.count,0);
  await assert.rejects(authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
    workspace,actor,idempotencyKey:`strategic-expired-${suffix}`,
    approvalEvidence:"Synthetic expired authority decision.",frozenCorpus:frozenStrategicCorpus,
    requestedEffectiveTo:"2020-01-01T00:00:00.000Z"
  }),/does not cover/u);
  const otherWorkspace={...workspace,id:otherWorkspaceId,organizationId:otherOrgId,
    subject:{type:"brand" as const,id:otherBrandId}};
  const otherActor={id:otherUserId,userType:"noisia_internal" as const,organizationId:otherOrgId};
  await assert.rejects(authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
    workspace:otherWorkspace,actor:otherActor,idempotencyKey:`strategic-cross-${suffix}`,
    approvalEvidence:"Synthetic cross-workspace decision must fail.",
    frozenCorpus:frozenStrategicCorpus
  }),/Frozen acquisition corpus drifted/u);
  const readyClient=await pool.connect();
  try{
    const ready=await preflightSignalSemanticBenchmarkExportV2({client:readyClient,
      workspaceId:workspace.id,frozenCorpus:frozenStrategicCorpus});
    assert.equal(ready.ready,true);
    assert.equal(ready.authority_digest!==null,true);
    assert.deepEqual(ready.blockers,[]);
    assert.equal(ready.provider_calls,0);
    assert.equal(ready.jobs_enqueued,0);
    assert.equal(ready.writes_performed,false);
  }finally{readyClient.release();}
  await assert.rejects(pool.query(`UPDATE signal_provider_mention_observations SET platform='mutated'
    WHERE workspace_id=$1::uuid AND observation_version=2`,[workspace.id]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  const supersededObservation=(await pool.query<{id:string}>(`SELECT id::text FROM signal_provider_mention_observations
    WHERE workspace_id=$1::uuid AND import_batch_id=$2::uuid AND observation_version=1`,[
    workspace.id,strategicBatchIds[0]])).rows[0]!.id;
  await assert.rejects(pool.query(`WITH source AS (
      SELECT observation.* FROM signal_provider_mention_observations observation WHERE id=$1::uuid
    ), payload AS (
      SELECT to_jsonb(source)||jsonb_build_object('id',gen_random_uuid(),
        'observation_version',source.observation_version+1,'supersedes_observation_id',source.id,
        'created_at',clock_timestamp()) value FROM source
    ) INSERT INTO signal_provider_mention_observations
      SELECT (jsonb_populate_record(NULL::signal_provider_mention_observations,value)).* FROM payload`,[
    supersededObservation]),
  (error:unknown)=>["23514","23505"].includes((error as {code?:string}).code??""));
  const attestedDispatch=(await pool.query<{worker_job_id:string}>(`
    SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)`,[
    attested.batch.id,userId])).rows[0]!;
  await pool.query(`SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)`,[
    attested.batch.id,attestedDispatch.worker_job_id]);
  await pool.query(`SELECT fail_signal_workspace_import_v1($1::uuid,$2,'synthetic_abort','{}'::jsonb,0,0)`,[
    attested.batch.id,attestedDispatch.worker_job_id]);
  const attestedRecovery=(await pool.query<{import_batch_id:string}>(`
    SELECT import_batch_id::text FROM create_signal_workspace_import_storage_recovery_v1(
      $1::uuid,$2::uuid,$3,$4,NULL)`,[attested.batch.id,userId,digest(`v2-recovery-key:${suffix}`),
      digest(`v2-recovery-request:${suffix}`)])).rows[0]!;
  assert.equal((await pool.query<{equal:boolean}>(`SELECT ROW(
      original.acquisition_contract_version,original.acquisition_plan_id,original.acquisition_slot_id,
      original.acquisition_query_version_id,original.acquisition_query_evidence_class,
      original.acquisition_query_evidence_reason,original.acquisition_query_evidence_actor_user_id,
      original.acquisition_query_evidence_attested_at,original.acquisition_import_seal_digest
    ) IS NOT DISTINCT FROM ROW(
      recovery.acquisition_contract_version,recovery.acquisition_plan_id,recovery.acquisition_slot_id,
      recovery.acquisition_query_version_id,recovery.acquisition_query_evidence_class,
      recovery.acquisition_query_evidence_reason,recovery.acquisition_query_evidence_actor_user_id,
      recovery.acquisition_query_evidence_attested_at,recovery.acquisition_import_seal_digest) equal
    FROM import_batches original CROSS JOIN import_batches recovery
    WHERE original.id=$1::uuid AND recovery.id=$2::uuid`,[
    attested.batch.id,attestedRecovery.import_batch_id])).rows[0]!.equal,true);
  const importId=randomUUID(),mentionId=randomUUID(),failedId=randomUUID();
  await pool.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,
    storage_bucket,storage_object_key,upload_protocol,expected_file_size_bytes,storage_part_count,
    storage_part_size_bytes,processed_bytes,progress_record_count,worker_job_id,imported_by_user_id,
    product_idempotency_key,product_request_digest,acquisition_contract_version,acquisition_plan_id,
    acquisition_slot_id,acquisition_query_version_id,capture_period_start,capture_period_end,
    capture_timezone,acquisition_plan_digest,acquisition_slot_digest,acquisition_query_digest,
    acquisition_brand_os_digest,acquisition_identity_catalog_digest,provider_schema_version,
    provider_observation_projection_state,provider_observation_count,acquisition_sealed_at
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'sentione','synthetic.csv','processing','processing',
    'private-imports',$4,'supabase-multipart-tus',10,1,10,0,0,$5,$6::uuid,$7,$8,
    'signal-acquisition-import-v1',$9::uuid,$10::uuid,$11::uuid,'2026-01-01','2026-01-31',
    'America/Mexico_City',$12,$13,$14,$15,$16,'sentione-csv-47-v1','pending',0,clock_timestamp())`,[
    importId,workspace.id,sourceId,`workspace-imports/${workspace.id}/${importId}/synthetic.csv`,
    `job-${suffix}`,userId,digest(`import-key:${suffix}`),digest(`import-request:${suffix}`),
    authority.plan_id,authority.slot_id,authority.query_id,authority.plan_digest,authority.slot_digest,
    authority.query_digest,authority.brand_os_digest,authority.catalog_digest]);
  await pool.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,storage_bucket,
    storage_object_key,upload_protocol,expected_file_size_bytes,storage_part_count,storage_part_size_bytes,
    processed_bytes,progress_record_count,failed_at,failure_code,imported_by_user_id,
    acquisition_contract_version,acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,
    capture_period_start,capture_period_end,capture_timezone,acquisition_plan_digest,
    acquisition_slot_digest,acquisition_query_digest,acquisition_brand_os_digest,
    acquisition_identity_catalog_digest,provider_schema_version,provider_observation_projection_state,
    provider_observation_header_hash,provider_observation_count,acquisition_sealed_at
  ) SELECT $1::uuid,workspace_id,data_source_id,source_system,'synthetic-failed.csv','failed','failed',
    storage_bucket,$2,upload_protocol,expected_file_size_bytes,storage_part_count,storage_part_size_bytes,
    5,1,clock_timestamp(),'synthetic_abort',imported_by_user_id,acquisition_contract_version,
    acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,capture_period_start,
    capture_period_end,capture_timezone,acquisition_plan_digest,acquisition_slot_digest,
    acquisition_query_digest,acquisition_brand_os_digest,acquisition_identity_catalog_digest,
    provider_schema_version,provider_observation_projection_state,provider_observation_header_hash,
    provider_observation_count,acquisition_sealed_at FROM import_batches WHERE id=$3::uuid`,[
    failedId,`workspace-imports/${workspace.id}/${failedId}/synthetic.csv`,importId]);
  const laterDraft=await withSignalAcquisitionTransactionV1((queryable)=>reconcileSignalAcquisitionPlanDraftV1({
    queryable,workspace,actor,idempotencyKey:`reconcile-after-seal-${suffix}`,
    expectedCurrentVersion:3,expectedBrandOsRevision:profileVersion
  }));
  await withSignalAcquisitionTransactionV1((queryable)=>promoteSignalAcquisitionPlanV1({
    queryable,workspace,actor,idempotencyKey:`promote-after-seal-${suffix}`,
    expectedDraftVersion:laterDraft.draft_plan!.version,
    expectedDraftRevision:laterDraft.draft_plan!.draft_revision,
    expectedDraftDigest:laterDraft.draft_plan!.draft_digest,
    effectiveFrom:new Date().toISOString(),evidence:"Synthetic plan supersession after import seal"
  }));
  assert.equal((await pool.query<{status:string}>(`SELECT status FROM signal_acquisition_plans
    WHERE id=$1::uuid`,[authority.plan_id])).rows[0]!.status,"retired");
  await pool.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
    provider_record_id,external_id,source_system,source_file_id,text_hash,text_clean,text_length,
    published_at,platform,resolved_platform,inclusion_status)
    VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,'sentione',$5::uuid,$6,$7,length($7),
      '2026-01-15T12:00:00Z','web','web','included')`,[
    mentionId,workspace.id,sourceId,`record-${suffix}`,importId,digest(`text:${suffix}`).slice(7),
    "Synthetic mention content long enough for inclusion."]);
  await pool.query(`SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,'included')`,[
    mentionId,importId]);
  await pool.query(`UPDATE import_batches SET provider_observation_projection_state='ready',
    provider_observation_header_hash=$2,provider_observation_count=0 WHERE id=$1::uuid`,[
    importId,digest("headers")]);
  const observationId=randomUUID();
  await pool.query(`INSERT INTO signal_provider_mention_observations(
    id,workspace_id,data_source_id,import_batch_id,mention_id,provider_key,provider_record_key_hash,
    acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,acquisition_plan_digest,
    acquisition_slot_digest,acquisition_query_digest,provider_schema_version,provider_header_hash,
    observation_version,observation_hash,platform,published_at,provenance_binding_id,
    rights_definition_hash,retention_until
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'sentione',$6,$7::uuid,$8::uuid,$9::uuid,
    $10,$11,$12,'sentione-csv-47-v1',$13,1,$14,'web','2026-01-15T12:00:00Z',$15::uuid,$16,
    '2030-01-01T00:00:00Z'::timestamptz)`,[observationId,workspace.id,sourceId,importId,mentionId,
    digest(`record:${suffix}`),authority.plan_id,authority.slot_id,authority.query_id,
    authority.plan_digest,authority.slot_digest,authority.query_digest,digest("headers"),digest("observation"),
    policy.bindingId,policy.bindingHash]);
  assert.equal((await pool.query<{accepted:boolean}>(`SELECT signal_provider_observation_is_accepted_v1($1::uuid) accepted`,[
    observationId])).rows[0]!.accepted,false);
  await assert.rejects(pool.query(`SELECT * FROM complete_signal_workspace_import_v1(
    $1::uuid,$2,$3,1,1,0,0,10)`,[importId,`job-${suffix}`,"a".repeat(64)]),
  (error:unknown)=>(error as {code?:string}).code==="23514");
  await pool.query(`UPDATE import_batches SET provider_observation_count=1 WHERE id=$1::uuid`,[importId]);
  await pool.query(`SELECT * FROM complete_signal_workspace_import_v1(
    $1::uuid,$2,$3,1,1,0,0,10)`,[importId,`job-${suffix}`,"a".repeat(64)]);
  assert.equal((await pool.query<{accepted:boolean}>(`SELECT signal_provider_observation_is_accepted_v1($1::uuid) accepted`,[
    observationId])).rows[0]!.accepted,true);
  const termId=randomUUID();
  await pool.query(`INSERT INTO signal_provider_mention_observation_terms(
    id,observation_id,workspace_id,term_kind,ordinal,term_private,term_hash,normalized_term
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'provider-tag',0,'synthetic-tag',$4,'synthetic tag')`,[
    termId,observationId,workspace.id,digest("synthetic-tag")]);
  await assert.rejects(pool.query(`UPDATE signal_provider_mention_observation_terms
    SET normalized_term='mutated' WHERE id=$1::uuid`,[termId]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  const intent=(await pool.query<{review_status:string;eligibility_status:string;attribution_basis:string}>(`
    SELECT review_status,eligibility_status,attribution_basis FROM signal_mention_attributions
    WHERE workspace_id=$1::uuid AND import_batch_id=$2::uuid`,[workspace.id,importId])).rows[0]!;
  assert.deepEqual(intent,{review_status:"pending",eligibility_status:"not_eligible",attribution_basis:"source_intent"});
  await assert.rejects(pool.query(`UPDATE data_sources SET governed_scope='primary_brand',
    governed_entity_type='brand',governed_entity_id=$2::uuid,scope_review_status='approved'
    WHERE id=$1::uuid`,[sourceId,brandId]),(error:unknown)=>(error as {code?:string}).code==="23514");
  assert.deepEqual((await pool.query<{review_status:string;eligibility_status:string}>(`
    SELECT review_status,eligibility_status FROM signal_mention_attributions
    WHERE workspace_id=$1::uuid AND import_batch_id=$2::uuid`,[workspace.id,importId])).rows[0],{
    review_status:"pending",eligibility_status:"not_eligible"});

  const recovery=(await pool.query<{import_batch_id:string;created:boolean}>(`
    SELECT import_batch_id::text,created FROM create_signal_workspace_import_storage_recovery_v1(
      $1::uuid,$2::uuid,$3,$4,NULL)`,[failedId,userId,digest(`recovery-key:${suffix}`),
      digest(`recovery-request:${suffix}`)])).rows[0]!;
  assert.equal(recovery.created,true);
  const recoveryReplay=(await pool.query<{import_batch_id:string;created:boolean}>(`
    SELECT import_batch_id::text,created FROM create_signal_workspace_import_storage_recovery_v1(
      $1::uuid,$2::uuid,$3,$4,NULL)`,[failedId,userId,digest(`recovery-key:${suffix}`),
      digest(`recovery-request:${suffix}`)])).rows[0]!;
  assert.deepEqual(recoveryReplay,{import_batch_id:recovery.import_batch_id,created:false});
  await assert.rejects(pool.query(`SELECT * FROM create_signal_workspace_import_storage_recovery_v1(
    $1::uuid,$2::uuid,$3,$4,NULL)`,[failedId,userId,digest(`recovery-key:${suffix}`),
    digest(`recovery-incompatible:${suffix}`)]),(error:unknown)=>(error as {code?:string}).code==="23514");
  const sealEquality=(await pool.query<{equal:boolean}>(`SELECT ROW(f.acquisition_contract_version,
    f.acquisition_plan_id,f.acquisition_slot_id,f.acquisition_query_version_id,f.capture_period_start,
    f.capture_period_end,f.capture_timezone,f.acquisition_plan_digest,f.acquisition_slot_digest,
    f.acquisition_query_digest,f.acquisition_brand_os_digest,f.acquisition_identity_catalog_digest,
    f.provider_schema_version,f.acquisition_sealed_at) IS NOT DISTINCT FROM ROW(r.acquisition_contract_version,
    r.acquisition_plan_id,r.acquisition_slot_id,r.acquisition_query_version_id,r.capture_period_start,
    r.capture_period_end,r.capture_timezone,r.acquisition_plan_digest,r.acquisition_slot_digest,
    r.acquisition_query_digest,r.acquisition_brand_os_digest,r.acquisition_identity_catalog_digest,
    r.provider_schema_version,r.acquisition_sealed_at) equal FROM import_batches f CROSS JOIN import_batches r
    WHERE f.id=$1::uuid AND r.id=$2::uuid`,[failedId,recovery.import_batch_id])).rows[0]!.equal;
  assert.equal(sealEquality,true);

  await pool.query(`UPDATE data_sources SET status='paused' WHERE id=$1::uuid`,[sourceId]);
  assert.equal((await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor})).state,"stale");
  await pool.query(`UPDATE data_sources SET status='active' WHERE id=$1::uuid`,[sourceId]);
  assert.equal((await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor})).state,"current");

  const historicalId=randomUUID();
  await pool.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,imported_by_user_id
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'sentione','historical-unplanned.csv','completed','legacy',$4::uuid)`,[
    historicalId,workspace.id,sourceId,userId]);
  assert.deepEqual((await pool.query<{contract:string|null;plan_id:string|null;slot_id:string|null;query_id:string|null}>(`
    SELECT acquisition_contract_version contract,acquisition_plan_id::text plan_id,
      acquisition_slot_id::text slot_id,acquisition_query_version_id::text query_id
    FROM import_batches WHERE id=$1::uuid`,[historicalId])).rows[0],{
      contract:null,plan_id:null,slot_id:null,query_id:null
    });
  const legacyFailedId=randomUUID();
  await pool.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,
    failed_at,failure_code,imported_by_user_id
  ) VALUES($1::uuid,$2::uuid,$3::uuid,'sentione','legacy-failed.csv','failed','failed',
    clock_timestamp(),'synthetic_legacy_failure',$4::uuid)`,[legacyFailedId,workspace.id,sourceId,userId]);
  await assert.rejects(pool.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,
    imported_by_user_id,supersedes_import_batch_id,acquisition_contract_version,
    acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,capture_period_start,
    capture_period_end,capture_timezone,acquisition_plan_digest,acquisition_slot_digest,
    acquisition_query_digest,acquisition_brand_os_digest,acquisition_identity_catalog_digest,
    provider_schema_version,provider_observation_projection_state,provider_observation_count,
    acquisition_sealed_at
  ) VALUES(gen_random_uuid(),$1::uuid,$2::uuid,'sentione','fabricated-recovery.csv','queued','queued',
    $3::uuid,$4::uuid,'signal-acquisition-import-v1',$5::uuid,$6::uuid,$7::uuid,
    '2026-01-01','2026-01-31','America/Mexico_City',$8,$9,$10,$11,$12,
    'sentione-csv-47-v1','pending',0,clock_timestamp())`,[
    workspace.id,sourceId,userId,legacyFailedId,authority.plan_id,authority.slot_id,authority.query_id,
    authority.plan_digest,authority.slot_digest,authority.query_digest,authority.brand_os_digest,
    authority.catalog_digest]),(error:unknown)=>(error as {code?:string}).code==="23514");

  const competitor=(await pool.query<{id:string}>(`SELECT id::text FROM competitors
    WHERE brand_id=$1::uuid AND status='current' ORDER BY priority LIMIT 1`,[brandId])).rows[0]!.id;
  await retireSignalCompetitorsV1({brandId,actor,idempotencyKey:`retire-${suffix}`,
    competitorIds:[competitor],evidence:"Synthetic retirement"});
  assert.equal((await loadSignalAcquisitionPlanV1({queryable:pool,workspace,actor})).state,"stale");
  await assert.rejects(pool.query(`DELETE FROM competitors WHERE id=$1::uuid`,[competitor]),
    (error:unknown)=>(error as {code?:string}).code==="55000");
  await createOrReactivateSignalCompetitorsV1({brandId,actor,idempotencyKey:`reactivate-${suffix}`,
    names:[competitorNames[0]!],vertical:"synthetic",subVertical:null,country:"MX"});
  assert.deepEqual((await pool.query<{event_kind:string}>(`SELECT event_kind FROM signal_competitor_lifecycle_events
    WHERE competitor_id=$1::uuid ORDER BY created_at,id`,[competitor])).rows.map((row)=>row.event_kind),[
    "created","retired","reactivated"]);
  assert.deepEqual((await pool.query<{event_index:number}>(`
    SELECT event.event_index FROM signal_competitor_lifecycle_events event
    JOIN signal_governance_control_operations operation ON operation.id=event.operation_id
    WHERE operation.workspace_id=$1::uuid AND operation.action='create-competitor'
      AND event.event_kind='created'
    ORDER BY event.event_index`,[workspace.id])).rows.map((row)=>row.event_index),[0,1]);
  assert.deepEqual(await retireSignalCompetitorsV1({brandId,actor,
    idempotencyKey:`retire-all-${suffix}`,competitorIds:null,evidence:"Synthetic bulk retirement"}),{
    retired_count:2
  });
  assert.deepEqual((await pool.query<{event_index:number}>(`
    SELECT event.event_index FROM signal_competitor_lifecycle_events event
    JOIN signal_governance_control_operations operation ON operation.id=event.operation_id
    WHERE operation.workspace_id=$1::uuid AND operation.idempotency_key=$2
    ORDER BY event.event_index`,[workspace.id,
    digest(`signal-product-operation-v1\u001fretire-all-${suffix}`)])).rows.map((row)=>row.event_index),[0,1]);
  await assert.rejects(pool.query(`DELETE FROM signal_acquisition_reference_decisions
    WHERE workspace_id=$1::uuid`,[workspace.id]),(error:unknown)=>(error as {code?:string}).code==="55000");
  assert.equal((await pool.query<{valid:boolean}>(`
    SELECT EXISTS(SELECT 1 FROM signal_acquisition_plan_events event
      JOIN signal_acquisition_reference_decisions decision ON decision.id=event.reference_decision_id
        AND decision.operation_id=event.operation_id AND decision.workspace_id=event.workspace_id
      WHERE event.workspace_id=$1::uuid AND event.event_kind='reference-decided') valid`,[workspace.id])).rows[0]!.valid,true);
  await assert.rejects(pool.query(`UPDATE signal_acquisition_plans SET draft_digest=$2
    WHERE workspace_id=$1::uuid AND status='current'`,[workspace.id,digest("mutated-plan")]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  await assert.rejects(pool.query(`UPDATE signal_acquisition_query_versions SET query_text_private='mutated'
    WHERE id=$1::uuid`,[authority.query_id]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  await assert.rejects(pool.query(`UPDATE competitors SET status='retired',effective_to=clock_timestamp(),
    retired_by_user_id=$2::uuid WHERE id=$1::uuid`,[competitor,userId]),
  (error:unknown)=>(error as {code?:string}).code==="55000");
  await assert.rejects(pool.query(`INSERT INTO import_batches(
    workspace_id,data_source_id,source_system,source_file_name,status,ingestion_phase,imported_by_user_id,
    acquisition_plan_id) VALUES($1::uuid,$2::uuid,'sentione','invalid-history.csv','queued','uploading',
      $3::uuid,$4::uuid)`,[workspace.id,sourceId,userId,authority.plan_id]),
  (error:unknown)=>(error as {code?:string}).code==="23514");

  await assert.rejects(pool.query(`INSERT INTO signal_acquisition_query_versions(
    workspace_id,plan_id,slot_id,query_key,query_version,data_source_id,provider_key,
    provider_syntax_version,provider_schema_version,query_text_private,structured_terms,query_hash,
    definition_hash,cadence,timezone,status,origin_kind,created_by_user_id,creation_idempotency_key,request_digest
  ) SELECT $1::uuid,plan_id,slot_id,query_key,query_version+1,data_source_id,provider_key,
    provider_syntax_version,provider_schema_version,query_text_private,structured_terms,query_hash,
    definition_hash,cadence,timezone,'draft',origin_kind,$2::uuid,$3,$4
    FROM signal_acquisition_query_versions WHERE id=$5::uuid`,[otherWorkspaceId,otherUserId,
    digest("cross-key"),digest("cross-request"),authority.query_id]));
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM signal_acquisition_plan_events
    WHERE workspace_id=$1::uuid`,[workspace.id])).rows[0]!.count>5,true);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM signal_provider_mention_observations
    WHERE workspace_id=$1::uuid AND (to_jsonb(signal_provider_mention_observations) ?| ARRAY['text','title','url','raw_metadata'])`,[
    workspace.id])).rows[0]!.count,0);
  await pool.end();
});

async function seedGovernance(input:{workspaceId:string;organizationId:string;userId:string;sourceId:string;suffix:string}){
  const qualityId=randomUUID(),retentionId=randomUUID(),licensingId=randomUUID(),bindingId=randomUUID();
  const separator="\x1f";
  const retentionEvidence=digest("retention-evidence");
  const licensingEvidence=digest("licensing-evidence");
  const qualityHash=digest(["quality-policy-v1",input.workspaceId,"acquisition-quality","1","1","","","evaluate"].join(separator));
  const retentionHash=digest(["retention-policy-v1",input.workspaceId,"acquisition-retention","1","allowed","until",
    "2030-01-01T00:00:00Z","block_use",retentionEvidence].join(separator));
  const licensingHash=digest(["licensing-policy-v1",input.workspaceId,"acquisition-licensing","1",licensingEvidence,
    "client-derived-metrics:allowed,client-mention-list:allowed,client-text-or-excerpt:allowed,internal-qa:prohibited,llm-processing:prohibited,strategic-analysis:prohibited"].join(separator));
  const bindingHash=digest(["signal-provenance-policy-binding-v1",input.workspaceId,input.sourceId,"∅","1",
    qualityId,retentionId,licensingId].join(separator));
  await pool.query(`INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,
    policy_version,status,min_quality_score,canonical_root_disposition,definition_hash,created_by_user_id,
    activated_by_user_id,activated_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,'acquisition-quality',1,'active',1,'evaluate',$4,$5::uuid,$5::uuid,
      clock_timestamp(),$6)`,[qualityId,input.organizationId,input.workspaceId,qualityHash,input.userId,
    digest(`quality-key:${input.suffix}`)]);
  await pool.query(`INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
      retention_state,retention_mode,retain_until,expiry_action,approval_evidence_hash,definition_hash,
      created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,'acquisition-retention',1,'active','allowed','until',
      '2030-01-01T00:00:00Z'::timestamptz,'block_use',$4,$5,$6::uuid,$6::uuid,clock_timestamp(),$7)`,[
    retentionId,input.organizationId,input.workspaceId,retentionEvidence,retentionHash,input.userId,
    digest(`retention-key:${input.suffix}`)]);
  await pool.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
      approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,'acquisition-licensing',1,'draft',$4,$5,$6::uuid,NULL,NULL,$7)`,[
    licensingId,input.organizationId,input.workspaceId,licensingEvidence,licensingHash,input.userId,
    digest(`licensing-key:${input.suffix}`)]);
  await pool.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
    VALUES($1::uuid,$2::uuid,'client-derived-metrics','allowed'),
      ($1::uuid,$2::uuid,'client-mention-list','allowed'),
      ($1::uuid,$2::uuid,'client-text-or-excerpt','allowed'),
      ($1::uuid,$2::uuid,'internal-qa','prohibited'),
      ($1::uuid,$2::uuid,'llm-processing','prohibited'),
      ($1::uuid,$2::uuid,'strategic-analysis','prohibited')`,[input.workspaceId,licensingId]);
  await pool.query(`UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2::uuid,
    approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[licensingId,input.userId]);
  await pool.query(`INSERT INTO signal_provenance_policy_bindings(id,workspace_id,data_source_id,binding_version,status,
      quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,
      activated_by_user_id,activated_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,1,'active',$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid,$8::uuid,
      clock_timestamp(),$9)`,[bindingId,input.workspaceId,input.sourceId,qualityId,retentionId,
    licensingId,bindingHash,input.userId,digest(`binding-key:${input.suffix}`)]);
  return{bindingId,bindingHash};
}

function requireLocal(value:string){const parsed=new URL(value);assert.ok(["127.0.0.1","localhost","::1"].includes(parsed.hostname));}

async function createCompletedStrategicFixtureImport(input:{
  workspace:{id:string};actor:{id:string};sourceId:string;sourceKey:string;slotKey:string;
  planId:string;slotId:string;planDigest:string;slotDigest:string;bindingId:string;
  bindingHash:string;suffix:string;storage:{resolve:()=>{bucket:string};createSignedUploads:(args:{
    objectPrefix:string;fileSizeBytes:number})=>Promise<{bucket:string;objectPrefix:string;
    expiresInSeconds:number;partSizeBytes:number;parts:Array<{partNumber:number;
    expectedSizeBytes:number;objectKey:string;uploadUrl:string}>}>};userId:string;
}){
  const upload=await createWorkspaceImportUploadV1({workspace:input.workspace as never,
    actor:input.actor as never,sourceId:input.sourceId,fileName:`strategic-${input.suffix}.csv`,
    fileSizeBytes:10,contentType:"text/csv",contributedByStudyCorpusId:null,
    supersedesImportBatchId:null,idempotencyKey:`strategic-import-${input.suffix}`,
    storage:input.storage,acquisition:{sourceKey:input.sourceKey,slotKey:input.slotKey,
      queryEvidence:{class:"unavailable",queryVersion:null,reason:"historical_export"},
      period:{start:"2026-01-01",end:"2026-01-31",timezone:"America/Mexico_City"}}});
  const dispatch=(await pool.query<{worker_job_id:string}>(`
    SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)`,[
    upload.batch.id,input.userId])).rows[0]!;
  await pool.query(`SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)`,[
    upload.batch.id,dispatch.worker_job_id]);
  const mentionId=randomUUID();
  await pool.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
    provider_record_id,external_id,source_system,source_file_id,text_hash,text_clean,text_length,
    published_at,platform,resolved_platform,inclusion_status)
    VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,'sentione',$5::uuid,$6,$7,length($7),
      '2026-01-20T12:00:00Z','web','web','included')`,[mentionId,input.workspace.id,input.sourceId,
    `strategic-record-${input.suffix}`,upload.batch.id,digest(`strategic-text:${input.suffix}`).slice(7),
    `Synthetic strategic fixture mention ${input.suffix} with sufficient content.`]);
  await pool.query(`SELECT record_signal_workspace_import_provenance_v1($1::uuid,$2::uuid,'included')`,[
    mentionId,upload.batch.id]);
  const header=digest("headers-v2");
  await pool.query(`UPDATE import_batches SET provider_observation_projection_state='ready',
    provider_observation_header_hash=$2,provider_observation_count=1 WHERE id=$1::uuid`,[
    upload.batch.id,header]);
  await pool.query(`INSERT INTO signal_provider_mention_observations(
    workspace_id,data_source_id,import_batch_id,mention_id,provider_key,provider_record_key_hash,
    acquisition_plan_id,acquisition_slot_id,acquisition_query_version_id,acquisition_plan_digest,
    acquisition_slot_digest,acquisition_query_digest,provider_schema_version,provider_header_hash,
    observation_version,observation_hash,platform,language_code,country_code,published_at,
    provenance_binding_id,rights_definition_hash,retention_until
  ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'sentione',$5,$6::uuid,$7::uuid,NULL,$8,$9,NULL,
    'sentione-csv-47-v1',$10,1,$11,'web','es','MX','2026-01-20T12:00:00Z',
    $12::uuid,$13,'2030-01-01T00:00:00Z')`,[input.workspace.id,input.sourceId,upload.batch.id,
    mentionId,digest(`strategic-record:${input.suffix}`),input.planId,input.slotId,input.planDigest,
    input.slotDigest,header,digest(`strategic-observation:${input.suffix}`),input.bindingId,input.bindingHash]);
  await pool.query(`SELECT * FROM complete_signal_workspace_import_v1(
    $1::uuid,$2,$3,1,1,0,0,10)`,[upload.batch.id,dispatch.worker_job_id,
    createHash("sha256").update(`strategic-${input.suffix}`).digest("hex")]);
  return{batchId:upload.batch.id,mentionId};
}
