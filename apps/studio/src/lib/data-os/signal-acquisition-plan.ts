import { createHash } from "node:crypto";

import {
  QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
  SIGNAL_ACQUISITION_PLAN_CONTRACT_VERSION,
  queryComposerAcquisitionBriefDigestV1,
  signalAcquisitionPlanDigestV1,
  signalAcquisitionQueryDigestV1,
  signalAcquisitionSlotDigestV1,
  validateQueryComposerAcquisitionBriefV1,
  validateQueryComposerGenerationLineageV1,
  type QueryComposerAcquisitionBriefV1,
  type QueryComposerGenerationLineageV1,
  type SignalAcquisitionPlanDefinitionV1,
  type SignalAcquisitionQueryDefinitionV1,
  type SignalAcquisitionSlotDefinitionV1
} from "@noisia/query-engine";

import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import { loadSignalAcquisitionKnowledgeContextV1 } from "@/lib/data-os/signal-acquisition-brief";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";

type PlanRow = {
  id: string; plan_version: number; status: "draft" | "current" | "retired";
  brand_os_profile_id: string; brand_os_profile_version: number; brand_os_digest: string;
  identity_catalog_digest: string; draft_revision: number; draft_digest: string;
  acquisition_brief_contract_version: string | null;
  acquisition_brief: QueryComposerAcquisitionBriefV1 | null;
  acquisition_brief_digest: string | null;
  definition_hash: string | null; effective_from: string | null; effective_to: string | null;
};
type SlotRow = {
  id: string; plan_id: string; slot_key: string; slot_version: number;
  scope: "primary_brand" | "competitor" | "category" | "reference";
  entity_type: "brand" | "competitor" | "category" | "reference";
  entity_id: string; entity_revision_digest: string; label: string;
  desired_state: "active" | "retired"; position: number;
  reference_decision_id: string | null; reference_decision_hash: string | null;
  definition_hash: string;
};
type QueryRow = {
  id: string; plan_id: string; slot_id: string; slot_key: string;
  query_key: string; query_version: number; source_key: string; provider_key: "sentione";
  provider_syntax_version: string; provider_schema_version: "sentione-csv-47-v1";
  query_hash: string; structured_terms: { include: string[]; exclude: string[]; aliases: string[] };
  cadence: "manual" | "ad-hoc" | "daily" | "weekly" | "monthly";
  default_period_start: string | null; default_period_end: string | null; timezone: string;
  status: string; definition_hash: string; source_status: string; source_contract_version: string;
  origin_kind: "operator" | "legacy-query-pack" | "engine-generated";
  generation_fallback_used: boolean | null;
  generation_fallback_reason: string | null;
  review_status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
};

export type SignalAcquisitionQueryVersionInputV1 = {
  source_key: string; provider: "sentione"; provider_syntax_version: string;
  provider_schema_version: "sentione-csv-47-v1"; query_text: string;
  structured_terms: { include: string[]; exclude: string[]; aliases: string[] };
  cadence: "manual" | "ad-hoc" | "daily" | "weekly" | "monthly";
  default_period: { start: string | null; end: string | null; timezone: string } | null;
};

export class SignalAcquisitionPlanError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export async function loadSignalAcquisitionPlanV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
}) {
  assertAuthority(args.workspace, args.actor);
  const plans = await args.queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text
    FROM signal_acquisition_plans WHERE workspace_id=$1::uuid AND status IN ('current','draft')
    ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END,plan_version DESC
  `,[args.workspace.id]);
  const current = plans.rows.find((row) => row.status === "current") ?? null;
  const draft = plans.rows.find((row) => row.status === "draft") ?? null;
  const planIds = plans.rows.map((row) => row.id);
  const slots = planIds.length ? await loadSlots(args.queryable,args.workspace.id,planIds) : [];
  const queries = planIds.length ? await loadQueries(args.queryable,args.workspace.id,planIds) : [];
  const live = await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const drift = current ? [
    ...acquisitionBlockers(current,slots,queries,live),
    ...await loadGovernanceBlockers(args.queryable,args.workspace.id,current.id)
  ] : [];
  const draftPolicyBlockers = draft
    ? await loadGovernanceBlockers(args.queryable,args.workspace.id,draft.id)
    : [];
  const blockers = [
    ...acquisitionBlockers(draft,slots,queries,live),
    ...draftPolicyBlockers
  ];
  const selectedPlan=draft??current;
  const selectedSlots=selectedPlan
    ? latestSlots(slots.filter((slot)=>slot.plan_id===selectedPlan.id)) : [];
  const selectedQueries=selectedPlan
    ? queries.filter((query)=>query.plan_id===selectedPlan.id) : [];
  const playbookWarnings=queryPlaybookWarnings(selectedSlots,selectedQueries);
  const connectorReadiness=await loadConnectorImportReadiness(args.queryable,args.workspace.id);
  const publicSlots = selectedSlots.map((slot) => {
    const owner = plans.rows.find((plan) => plan.id === slot.plan_id);
    const slotQueries = queries.filter((query) => query.slot_id === slot.id);
    return {
      slot_key: slot.slot_key,
      scope: slot.scope,
      label: slot.label,
      desired_state: slot.desired_state,
      plan_status: owner?.status ?? "retired",
      plan_version: owner?.plan_version ?? 0,
      query_versions: slotQueries.map((query) => ({
        provider: query.provider_key,
        version: query.query_version,
        source_key: query.source_key,
        cadence: query.cadence,
        status: query.status,
        origin: query.origin_kind,
        generation_state: query.origin_kind === "engine-generated"
          ? query.generation_fallback_used
            ? "generated_with_fallback"
            : "generated"
          : "generated",
        fallback: query.origin_kind === "engine-generated"
          ? {
              used: query.generation_fallback_used === true,
              reason: query.generation_fallback_reason
            }
          : null,
        review: {
          status: query.review_status,
          reviewed_at: query.reviewed_at,
          reviewed_by_user_id: query.reviewed_by_user_id
        },
        default_period: query.default_period_start && query.default_period_end
          ? {
              start: query.default_period_start,
              end: query.default_period_end,
              timezone: query.timezone
            }
          : null,
        timezone: query.timezone
      })),
      blockers: [],
      warnings: slot.desired_state === "active"
        && !slotQueries.some((query) => !["retired","superseded"].includes(query.status))
        ? ["query_playbook_incomplete"] : []
    };
  });
  return {
    contract_version: SIGNAL_ACQUISITION_PLAN_CONTRACT_VERSION,
    state: draft ? (blockers.length ? "draft" : "ready") : current ? (drift.length ? "stale" : "current") : "missing",
    current_plan: publicPlan(current,drift),
    draft_plan: publicPlan(draft,blockers),
    slots: publicSlots,
    reference_candidates: live.entities
      .filter((entity) => entity.entity_type === "reference")
      .map((entity) => ({
        identity_key: identityKey("reference",entity.id),
        label: entity.canonical_name,
        decision: live.decisions.find((decision) => decision.entity_id === entity.id)?.action ?? "undecided"
      })),
    readiness: {
      ready_to_promote: Boolean(draft) && blockers.length === 0,
      ready_for_import: Boolean(current) && drift.length===0 && connectorReadiness.ready,
      query_playbook_complete: selectedSlots.filter((slot)=>slot.desired_state==="active").length>0
        && playbookWarnings.length===0,
      blockers: [...new Set(blockers)].sort(),
      warnings:[...new Set([...playbookWarnings,...connectorReadiness.warnings])].sort()
    }
  };
}

export async function reconcileSignalAcquisitionPlanDraftV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; expectedCurrentVersion: number | null; expectedBrandOsRevision: number | null;
}) {
  assertAuthority(args.workspace,args.actor);
  const operation = await beginSignalProductOperationV1<Awaited<ReturnType<typeof loadSignalAcquisitionPlanV1>>>({
    ...args, action: "reconcile-acquisition-plan", input: {
      expected_current_version: args.expectedCurrentVersion,
      expected_brand_os_revision: args.expectedBrandOsRevision
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const live = await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  if (args.expectedBrandOsRevision !== null && args.expectedBrandOsRevision !== live.profile.version) {
    throw new SignalAcquisitionPlanError("brand_os_revision_conflict",409);
  }
  const plans = await args.queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text
    FROM signal_acquisition_plans WHERE workspace_id=$1::uuid AND status IN ('current','draft') FOR UPDATE
  `,[args.workspace.id]);
  const current = plans.rows.find((row) => row.status === "current") ?? null;
  if (args.expectedCurrentVersion !== null && current?.plan_version !== args.expectedCurrentVersion) {
    throw new SignalAcquisitionPlanError("current_plan_version_conflict",409);
  }
  let draft = plans.rows.find((row) => row.status === "draft") ?? null;
  if (!draft) {
    const emptyDigest = sha256(`signal-acquisition-empty-draft\u001f${args.workspace.id}\u001f${live.profile.digest}`);
    const inserted = await args.queryable.query<PlanRow>(`
      INSERT INTO signal_acquisition_plans(
        workspace_id,plan_version,status,brand_os_profile_id,brand_os_profile_version,
        brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
        acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
        supersedes_plan_id,created_by_user_id,creation_idempotency_key,request_digest
      ) VALUES($1::uuid,$2,'draft',$3::uuid,$4,$5,$6,$7,$8::jsonb,$9,0,$10,NULL,$11::uuid,$12::uuid,$13,$14)
      RETURNING id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
        brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
        acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
        effective_from::text,effective_to::text
    `,[args.workspace.id,(current?.plan_version ?? 0)+1,live.profile.id,live.profile.version,
      live.profile.digest,live.catalogDigest,current?.acquisition_brief_contract_version ?? null,
      current?.acquisition_brief ? JSON.stringify(current.acquisition_brief) : null,
      current?.acquisition_brief_digest ?? null,emptyDigest,current?.id ?? null,args.actor.id,
      operation.key,sha256(stable({ workspace: args.workspace.id, profile: live.profile.digest,
        catalog: live.catalogDigest }))]);
    draft = inserted.rows[0] ?? null;
  }
  if (!draft) throw new Error("Acquisition draft could not be created.");
  const existing = await loadSlots(args.queryable,args.workspace.id,[draft.id]);
  const currentSlots = current ? await loadSlots(args.queryable,args.workspace.id,[current.id]) : [];
  const desired = buildDesiredSlots(args.workspace,live,[...currentSlots,...existing],draft.id);
  let eventIndex = 0;
  for (const slot of desired) {
    if (existing.some((row) => row.slot_key === slot.slot_key && row.slot_version === slot.slot_version)) continue;
    const inserted = await args.queryable.query<{ id: string }>(`
      INSERT INTO signal_acquisition_slots(
        workspace_id,plan_id,slot_key,slot_version,scope,entity_type,entity_id,
        entity_revision_digest,label,desired_state,position,supersedes_slot_id,
        reference_decision_id,definition_hash,created_by_user_id
      ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,$10,$11,$12::uuid,$13::uuid,$14,$15::uuid)
      RETURNING id::text
    `,[args.workspace.id,draft.id,slot.slot_key,slot.slot_version,slot.scope,slot.entity_type,
      slot.entity_id,slot.entity_revision_digest,slot.label,slot.desired_state,slot.position,
      slot.supersedes_slot_id,slot.reference_decision_id,slot.definition_hash,args.actor.id]);
    await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
      eventIndex: eventIndex++,eventKind: existing.length || current ? "draft-reconciled" : "draft-created",
      planId: draft.id,slotId: inserted.rows[0]!.id,nextDigest: slot.definition_hash });
  }
  const carriedQueries=await carryForwardQueries(args.queryable,args.workspace.id,current?.id ?? null,
    draft.id,args.actor.id,operation.key);
  for(const query of carriedQueries){
    await insertEvent(args.queryable,{workspaceId:args.workspace.id,operationId:operation.operationId,
      eventIndex:eventIndex++,eventKind:"query-carried-forward",planId:draft.id,
      slotId:query.slot_id,queryId:query.id,nextDigest:query.definition_hash});
  }
  const authorityPlan: PlanRow = { ...draft,brand_os_profile_id: live.profile.id,
    brand_os_profile_version: live.profile.version,brand_os_digest: live.profile.digest,
    identity_catalog_digest: live.catalogDigest };
  const digest = await recomputeDraftDigest(args.queryable,args.workspace,authorityPlan);
  const changed=digest!==draft.draft_digest||draft.brand_os_profile_id!==live.profile.id
    ||draft.brand_os_profile_version!==live.profile.version||draft.brand_os_digest!==live.profile.digest
    ||draft.identity_catalog_digest!==live.catalogDigest;
  if(changed){
    await args.queryable.query(`
      UPDATE signal_acquisition_plans SET draft_revision=draft_revision+1,draft_digest=$3,
        brand_os_profile_id=$4::uuid,brand_os_profile_version=$5,brand_os_digest=$6,
        identity_catalog_digest=$7
      WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'
    `,[draft.id,args.workspace.id,digest,live.profile.id,live.profile.version,
      live.profile.digest,live.catalogDigest]);
    await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
      eventIndex,eventKind: "draft-reconciled",planId: draft.id,
      previousDigest:draft.draft_digest,nextDigest: digest });
  }
  const result = await loadSignalAcquisitionPlanV1(args);
  await completeSignalProductOperationV1({ queryable: args.queryable,workspaceId: args.workspace.id,
    key: operation.key,result });
  return result;
}

export async function sealSignalAcquisitionBriefV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  expectedDraftVersion: number;
  expectedDraftRevision: number;
  expectedDraftDigest: string;
  brief: QueryComposerAcquisitionBriefV1;
}) {
  assertAuthority(args.workspace,args.actor);
  const brief = validateQueryComposerAcquisitionBriefV1(args.brief);
  const briefDigest = queryComposerAcquisitionBriefDigestV1(brief);
  const operation = await beginSignalProductOperationV1<{
    plan_version: number;draft_revision: number;brief_status: "sealed";brief_digest: string;
  }>({
    ...args,action: "seal-acquisition-brief",input: {
      expected_draft_version: args.expectedDraftVersion,
      expected_draft_revision: args.expectedDraftRevision,
      expected_draft_digest: args.expectedDraftDigest,
      brief_digest: briefDigest
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const result = await args.queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text
    FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND status='draft' FOR UPDATE
  `,[args.workspace.id]);
  const draft = result.rows[0];
  if (!draft || draft.plan_version!==args.expectedDraftVersion
      || draft.draft_revision!==args.expectedDraftRevision
      || draft.draft_digest!==args.expectedDraftDigest) {
    throw new SignalAcquisitionPlanError("draft_cas_conflict",409);
  }
  const live = await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const knowledge = await loadSignalAcquisitionKnowledgeContextV1({
    queryable:args.queryable,workspace:args.workspace,references:brief.knowledge_context_refs
  });
  if (brief.brand_os_profile_version!==live.profile.version
      || brief.brand_os_digest!==live.profile.digest
      || brief.identity_catalog_digest!==live.catalogDigest
      || brief.provider_key!=="sentione"
      || brief.provider_schema_version!=="sentione-csv-47-v1"
      || knowledge.missing||knowledge.digest!==brief.knowledge_context_digest) {
    throw new SignalAcquisitionPlanError("acquisition_brief_authority_drift",409);
  }
  if (draft.acquisition_brief_digest===briefDigest) {
    const replay = {
      plan_version:draft.plan_version,draft_revision:draft.draft_revision,
      brief_status:"sealed" as const,brief_digest:briefDigest
    };
    await completeSignalProductOperationV1({ queryable:args.queryable,workspaceId:args.workspace.id,
      key:operation.key,result:replay });
    return replay;
  }
  const nextPlan: PlanRow = {
    ...draft,acquisition_brief_contract_version:QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
    acquisition_brief:brief,acquisition_brief_digest:briefDigest
  };
  const nextDigest = await recomputeDraftDigest(args.queryable,args.workspace,nextPlan);
  await args.queryable.query(`
    UPDATE signal_acquisition_plans SET
      acquisition_brief_contract_version=$3,acquisition_brief=$4::jsonb,
      acquisition_brief_digest=$5,draft_revision=draft_revision+1,draft_digest=$6
    WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'
  `,[draft.id,args.workspace.id,QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
    JSON.stringify(brief),briefDigest,nextDigest]);
  await insertEvent(args.queryable,{ workspaceId:args.workspace.id,operationId:operation.operationId,
    eventIndex:0,eventKind:"brief-sealed",planId:draft.id,
    previousDigest:draft.draft_digest,nextDigest });
  const response = {
    plan_version:draft.plan_version,draft_revision:draft.draft_revision+1,
    brief_status:"sealed" as const,brief_digest:briefDigest
  };
  await completeSignalProductOperationV1({ queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result:response });
  return response;
}

export async function createSignalAcquisitionQueryVersionV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; slotKey: string; input: SignalAcquisitionQueryVersionInputV1;
}) {
  return createSignalAcquisitionQueryVersionInternalV1({
    ...args,origin: { kind: "operator",lineage: null }
  });
}

/** Server-owned entrypoint. HTTP validators never accept origin or generation lineage. */
export async function createSignalAcquisitionQueryVersionFromEngineV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; slotKey: string; input: SignalAcquisitionQueryVersionInputV1;
  lineage: QueryComposerGenerationLineageV1;
}) {
  return createSignalAcquisitionQueryVersionInternalV1({
    ...args,origin: {
      kind: "engine-generated",
      lineage: validateQueryComposerGenerationLineageV1(args.lineage)
    }
  });
}

async function createSignalAcquisitionQueryVersionInternalV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; slotKey: string; input: SignalAcquisitionQueryVersionInputV1;
  origin: {
    kind: "operator" | "engine-generated";
    lineage: QueryComposerGenerationLineageV1 | null;
  };
}) {
  assertAuthority(args.workspace,args.actor);
  const operation = await beginSignalProductOperationV1<{ query_version: number; slot_key: string; source_key: string }>({
    ...args,action: "create-acquisition-query",input: {
      slot_key: args.slotKey,...args.input,origin_kind: args.origin.kind,
      generation_lineage: args.origin.lineage
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const resolved = await args.queryable.query<{
    plan_id: string;slot_id: string;slot_version: number;source_id: string;query_version: number;
  }>(`
    SELECT plan.id::text plan_id,slot.id::text slot_id,slot.slot_version,source.id::text source_id,
      COALESCE((SELECT max(query_version)+1 FROM signal_acquisition_query_versions query
        WHERE query.workspace_id=plan.workspace_id AND query.query_key=
          'query-sha256-'||encode(digest(convert_to(slot.slot_key||E'\\x1f'||source.source_key||E'\\x1f'||$4,'UTF8'),'sha256'),'hex')),1)::int query_version
    FROM signal_acquisition_plans plan
    JOIN LATERAL (SELECT * FROM signal_acquisition_slots candidate WHERE candidate.plan_id=plan.id
      AND candidate.slot_key=$2 ORDER BY candidate.slot_version DESC LIMIT 1) slot ON true
    JOIN data_sources source ON source.workspace_id=plan.workspace_id AND source.source_key=$3
      AND source.status='active' AND source.source_contract_version='signal-data-source-connector-v1'
    WHERE plan.workspace_id=$1::uuid AND plan.status='draft'
    FOR SHARE OF plan,slot,source
  `,[args.workspace.id,args.slotKey,args.input.source_key,args.input.provider]);
  const target = resolved.rows[0];
  if (!target) throw new SignalAcquisitionPlanError("query_target_unavailable",409);
  const queryKey = `query-sha256-${createHash("sha256").update(`${args.slotKey}\u001f${args.input.source_key}\u001f${args.input.provider}`).digest("hex")}`;
  const queryHash = sha256(args.input.query_text.normalize("NFKC").trim().replace(/\s+/gu," "));
  const definition: SignalAcquisitionQueryDefinitionV1 = {
    slot_key: args.slotKey,query_key: queryKey,query_version: target.query_version,
    source_key: args.input.source_key,provider_key: args.input.provider,
    provider_syntax_version: args.input.provider_syntax_version,
    provider_schema_version: args.input.provider_schema_version,query_hash: queryHash,
    structured_terms: args.input.structured_terms,cadence: args.input.cadence,
    default_period_start: args.input.default_period?.start ?? null,
    default_period_end: args.input.default_period?.end ?? null,
    timezone: args.input.default_period?.timezone ?? args.workspace.timezone
  };
  const definitionHash = signalAcquisitionQueryDigestV1(definition);
  const prior = await args.queryable.query<{ id: string;definition_hash:string }>(`
    SELECT id::text,definition_hash FROM signal_acquisition_query_versions
    WHERE workspace_id=$1::uuid AND plan_id=$3::uuid AND slot_id=$4::uuid
      AND query_key=$2 AND status='draft'
    ORDER BY query_version DESC LIMIT 1 FOR UPDATE
  `,[args.workspace.id,queryKey,target.plan_id,target.slot_id]);
  if (prior.rows[0]) await args.queryable.query(`
    UPDATE signal_acquisition_query_versions SET status='superseded',effective_to=clock_timestamp()
    WHERE id=$1::uuid AND status IN ('draft','current')
  `,[prior.rows[0].id]);
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO signal_acquisition_query_versions(
      workspace_id,plan_id,slot_id,query_key,query_version,data_source_id,provider_key,
      provider_syntax_version,provider_schema_version,query_text_private,structured_terms,
      query_hash,definition_hash,cadence,default_period_start,default_period_end,timezone,
      status,effective_from,supersedes_query_version_id,origin_kind,
      generation_contract_version,generation_model,generation_pipeline_version,
      generation_prompt_template_digest,generation_context_digest,
      generation_construction_plan_digest,generation_validation_report_digest,
      generation_fallback_used,generation_fallback_reason,generation_study_reference_hash,
      generation_study_context_digest,generated_at,created_by_user_id,
      creation_idempotency_key,request_digest
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8,$9,$10,$11::jsonb,
      $12,$13,$14,$15::date,$16::date,$17,'draft',clock_timestamp(),$18::uuid,$19,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::timestamptz,
      $32::uuid,$33,$34) RETURNING id::text
  `,[args.workspace.id,target.plan_id,target.slot_id,queryKey,target.query_version,target.source_id,
    args.input.provider,args.input.provider_syntax_version,args.input.provider_schema_version,
    args.input.query_text,JSON.stringify(args.input.structured_terms),queryHash,definitionHash,
    args.input.cadence,args.input.default_period?.start ?? null,args.input.default_period?.end ?? null,
    args.input.default_period?.timezone ?? args.workspace.timezone,prior.rows[0]?.id ?? null,
    args.origin.kind,args.origin.lineage?.contract_version ?? null,args.origin.lineage?.model ?? null,
    args.origin.lineage?.pipeline_version ?? null,args.origin.lineage?.prompt_template_digest ?? null,
    args.origin.lineage?.context_digest ?? null,args.origin.lineage?.construction_plan_digest ?? null,
    args.origin.lineage?.validation_report_digest ?? null,args.origin.lineage?.fallback_used ?? null,
    args.origin.lineage?.fallback_reason ?? null,
    args.origin.lineage?.optional_study_context?.reference_hash ?? null,
    args.origin.lineage?.optional_study_context?.digest ?? null,args.origin.lineage?.generated_at ?? null,
    args.actor.id,operation.key,sha256(stable({ definition,origin: args.origin }))]);
  const plan = await loadPlanById(args.queryable,args.workspace.id,target.plan_id);
  const digest = await recomputeDraftDigest(args.queryable,args.workspace,plan);
  await args.queryable.query(`UPDATE signal_acquisition_plans
    SET draft_revision=draft_revision+1,draft_digest=$3 WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'`,
    [target.plan_id,args.workspace.id,digest]);
  let eventIndex=0;
  if(prior.rows[0]) await insertEvent(args.queryable,{ workspaceId: args.workspace.id,
    operationId: operation.operationId,eventIndex:eventIndex++,eventKind:"query-superseded",
    planId:target.plan_id,slotId:target.slot_id,queryId:prior.rows[0].id,
    previousDigest:prior.rows[0].definition_hash,nextDigest:definitionHash });
  await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
    eventIndex,eventKind: "query-created",planId: target.plan_id,slotId: target.slot_id,
    queryId: inserted.rows[0]!.id,previousDigest:plan.draft_digest,nextDigest: digest });
  const result = { query_version: target.query_version,slot_key: args.slotKey,source_key: args.input.source_key };
  await completeSignalProductOperationV1({ queryable: args.queryable,workspaceId: args.workspace.id,
    key: operation.key,result });
  return result;
}

export async function promoteSignalAcquisitionPlanV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; expectedDraftVersion: number; expectedDraftRevision: number;
  expectedDraftDigest: string; effectiveFrom: string; evidence: string;
}) {
  const operation = await beginSignalProductOperationV1<{ plan_version: number; status: "current" }>({
    ...args,action: "promote-acquisition-plan",input: {
      expected_draft_version: args.expectedDraftVersion,expected_draft_revision: args.expectedDraftRevision,
      expected_draft_digest: args.expectedDraftDigest,effective_from: args.effectiveFrom,
      evidence_hash: sha256(args.evidence)
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const live = await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const draft = await args.queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND status='draft' FOR UPDATE
  `,[args.workspace.id]);
  const plan = draft.rows[0];
  if (!plan || plan.plan_version!==args.expectedDraftVersion
      || plan.draft_revision!==args.expectedDraftRevision || plan.draft_digest!==args.expectedDraftDigest) {
    throw new SignalAcquisitionPlanError("draft_cas_conflict",409);
  }
  const recomputed = await recomputeDraftDigest(args.queryable,args.workspace,plan);
  if (recomputed!==plan.draft_digest || live.profile.digest!==plan.brand_os_digest
      || live.catalogDigest!==plan.identity_catalog_digest) {
    throw new SignalAcquisitionPlanError("draft_authority_stale",409);
  }
  const slots = latestSlots(await loadSlots(args.queryable,args.workspace.id,[plan.id]));
  const queries = await loadQueries(args.queryable,args.workspace.id,[plan.id]);
  const blockers = acquisitionBlockers(plan,slots,queries,live);
  if (blockers.length) throw new SignalAcquisitionPlanError(`plan_blocked:${blockers.join(",")}`,409);
  const rights = await args.queryable.query<{ missing: number }>(`
    SELECT count(*)::int AS missing FROM signal_acquisition_query_versions query
    JOIN signal_acquisition_slots slot ON slot.id=query.slot_id AND slot.plan_id=query.plan_id
    WHERE query.plan_id=$1::uuid AND query.status IN ('draft','current') AND slot.desired_state='active'
      AND NOT EXISTS(
        SELECT 1 FROM signal_provenance_policy_bindings binding
        JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id AND quality.status='active'
          AND quality.effective_from<=$2::timestamptz
          AND (quality.effective_to IS NULL OR quality.effective_to>$2::timestamptz)
        JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
          AND retention.status='active' AND retention.effective_from<=$2::timestamptz
          AND (retention.effective_to IS NULL OR retention.effective_to>$2::timestamptz)
          AND (retention.retain_until IS NULL OR retention.retain_until>$2::timestamptz)
        JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id AND licensing.status='active'
          AND licensing.effective_from<=$2::timestamptz
          AND (licensing.effective_to IS NULL OR licensing.effective_to>$2::timestamptz)
        WHERE binding.workspace_id=query.workspace_id AND binding.data_source_id=query.data_source_id
          AND binding.import_batch_id IS NULL AND binding.status='active'
          AND binding.effective_from<=$2::timestamptz AND (binding.effective_to IS NULL OR binding.effective_to>$2::timestamptz)
      )
  `,[plan.id,args.effectiveFrom]);
  if ((rights.rows[0]?.missing ?? 1)>0) throw new SignalAcquisitionPlanError("governance_binding_required",409);
  const previousCurrent=await args.queryable.query<{id:string;definition_hash:string}>(`
    SELECT id::text,definition_hash FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND status='current' FOR UPDATE
  `,[args.workspace.id]);
  await args.queryable.query(`UPDATE signal_acquisition_query_versions SET status='current'
    WHERE plan_id=$1::uuid AND status='draft'`,[plan.id]);
  await args.queryable.query(`UPDATE signal_acquisition_plans SET status='retired',
    retired_by_user_id=$2::uuid,retired_at=clock_timestamp(),effective_to=$3::timestamptz
    WHERE workspace_id=$1::uuid AND status='current'`,[args.workspace.id,args.actor.id,args.effectiveFrom]);
  await args.queryable.query(`UPDATE signal_acquisition_plans SET status='current',definition_hash=draft_digest,
    promoted_by_user_id=$2::uuid,promoted_at=clock_timestamp(),effective_from=$3::timestamptz
    WHERE id=$1::uuid AND status='draft'`,[plan.id,args.actor.id,args.effectiveFrom]);
  let eventIndex=0;
  if(previousCurrent.rows[0])await insertEvent(args.queryable,{workspaceId:args.workspace.id,
    operationId:operation.operationId,eventIndex:eventIndex++,eventKind:"retired",
    planId:previousCurrent.rows[0].id,previousDigest:previousCurrent.rows[0].definition_hash,
    nextDigest:previousCurrent.rows[0].definition_hash});
  await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
    eventIndex,eventKind: "promoted",planId: plan.id,nextDigest: plan.draft_digest });
  const result = { plan_version: plan.plan_version,status: "current" as const };
  await completeSignalProductOperationV1({ queryable: args.queryable,workspaceId: args.workspace.id,
    key: operation.key,result });
  return result;
}

export async function reviewSignalAcquisitionQueryVersionV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; slotKey: string; queryVersion: number;
  decision: "approved" | "rejected"; evidence: string;
}) {
  assertAuthority(args.workspace,args.actor);
  const evidence = safeEvidence(args.evidence);
  if (!evidence) throw new SignalAcquisitionPlanError("query_review_evidence_required",422);
  const operation = await beginSignalProductOperationV1<{
    slot_key: string;query_version: number;decision: "approved" | "rejected";
  }>({ ...args,action: "review-acquisition-query",input: {
    slot_key: args.slotKey,query_version: args.queryVersion,decision: args.decision,
    evidence_hash: sha256(evidence)
  }});
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const target = await args.queryable.query<{ id:string }>(`
    SELECT query.id::text
    FROM signal_acquisition_query_versions query
    JOIN signal_acquisition_slots slot ON slot.id=query.slot_id AND slot.plan_id=query.plan_id
    JOIN signal_acquisition_plans plan ON plan.id=query.plan_id
    WHERE query.workspace_id=$1::uuid AND plan.status='draft' AND query.status='draft'
      AND slot.slot_key=$2 AND query.query_version=$3
    FOR SHARE OF query,slot,plan
  `,[args.workspace.id,args.slotKey,args.queryVersion]);
  if (!target.rows[0]) throw new SignalAcquisitionPlanError("query_review_target_unavailable",409);
  const decidedAt = new Date().toISOString();
  const eventHash = sha256(stable({
    contract_version:"signal-acquisition-query-review-v1",workspace_id:args.workspace.id,
    query_version_id:target.rows[0].id,decision:args.decision,evidence_hash:sha256(evidence),
    actor_id:args.actor.id,operation_id:operation.operationId
  }));
  await args.queryable.query(`
    INSERT INTO signal_acquisition_query_review_events(
      workspace_id,query_version_id,operation_id,decision,evidence,evidence_hash,
      decided_by_user_id,decided_at,event_hash
    ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8::timestamptz,$9)
  `,[args.workspace.id,target.rows[0].id,operation.operationId,args.decision,evidence,
    sha256(evidence),args.actor.id,decidedAt,eventHash]);
  const result={slot_key:args.slotKey,query_version:args.queryVersion,decision:args.decision};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:operation.key,result});
  return result;
}

export async function retireSignalAcquisitionSlotV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; slotKey: string; evidence: string;
}) {
  const operation = await beginSignalProductOperationV1<{ slot_key: string;desired_state: "retired" }>({
    ...args,action: "retire-acquisition-slot",input: {
      slot_key: args.slotKey,evidence_hash: sha256(args.evidence)
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const selected = await args.queryable.query<SlotRow>(`
    SELECT slot.id::text,slot.plan_id::text,slot.slot_key,slot.slot_version,slot.scope,slot.entity_type,
      slot.entity_id::text,slot.entity_revision_digest,slot.label,slot.desired_state,slot.position,
      slot.reference_decision_id::text,decision.decision_hash reference_decision_hash,slot.definition_hash
    FROM signal_acquisition_plans plan
    JOIN LATERAL (SELECT * FROM signal_acquisition_slots candidate WHERE candidate.plan_id=plan.id
      AND candidate.slot_key=$2 ORDER BY candidate.slot_version DESC LIMIT 1) slot ON true
    LEFT JOIN signal_acquisition_reference_decisions decision ON decision.id=slot.reference_decision_id
    WHERE plan.workspace_id=$1::uuid AND plan.status='draft' FOR SHARE OF plan,slot
  `,[args.workspace.id,args.slotKey]);
  const prior = selected.rows[0];
  if (!prior || prior.desired_state!=="active" || prior.scope==="primary_brand") {
    throw new SignalAcquisitionPlanError("slot_retirement_unavailable",409);
  }
  const definition: SignalAcquisitionSlotDefinitionV1 = {
    ...slotDefinition(prior),slot_version: prior.slot_version+1,desired_state: "retired"
  };
  const definitionHash = signalAcquisitionSlotDigestV1(definition);
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO signal_acquisition_slots(
      workspace_id,plan_id,slot_key,slot_version,scope,entity_type,entity_id,
      entity_revision_digest,label,desired_state,position,supersedes_slot_id,
      reference_decision_id,definition_hash,created_by_user_id
    ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,'retired',$10,$11::uuid,$12::uuid,$13,$14::uuid)
    RETURNING id::text
  `,[args.workspace.id,prior.plan_id,prior.slot_key,prior.slot_version+1,prior.scope,prior.entity_type,
    prior.entity_id,prior.entity_revision_digest,prior.label,prior.position,prior.id,
    prior.reference_decision_id,definitionHash,args.actor.id]);
  const plan = await loadPlanById(args.queryable,args.workspace.id,prior.plan_id);
  const digest = await recomputeDraftDigest(args.queryable,args.workspace,plan);
  await args.queryable.query(`UPDATE signal_acquisition_plans SET draft_revision=draft_revision+1,draft_digest=$3
    WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'`,[prior.plan_id,args.workspace.id,digest]);
  await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
    eventIndex: 0,eventKind: "slot-retired",planId: prior.plan_id,slotId: inserted.rows[0]!.id,
    previousDigest:plan.draft_digest,nextDigest: digest });
  const result = { slot_key: args.slotKey,desired_state: "retired" as const };
  await completeSignalProductOperationV1({ queryable: args.queryable,workspaceId: args.workspace.id,
    key: operation.key,result });
  return result;
}

export async function decideSignalAcquisitionReferenceV1(args: {
  queryable: SignalBrandPolicyQueryable; workspace: ResolvedSignalWorkspace; actor: SignalWorkspaceUser;
  idempotencyKey: string; identityKey: string; action: "include" | "exclude" | "revert";
  evidence: string; effectiveFrom: string;
}) {
  const operation = await beginSignalProductOperationV1<{ identity_key: string;action: string;decision_hash: string }>({
    ...args,action: "decide-acquisition-reference",input: {
      identity_key: args.identityKey,action: args.action,evidence_hash: sha256(args.evidence),
      effective_from: args.effectiveFrom
    }
  });
  if (operation.replay) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-reference:${args.workspace.id}:${args.identityKey}`
  ]);
  const refs = await args.queryable.query<{ id: string }>(`
    SELECT entity.id::text FROM intelligence_entities entity JOIN signal_workspaces workspace
      ON workspace.id=$1::uuid AND workspace.organization_id=entity.organization_id
        AND workspace.brand_id=entity.brand_id
    WHERE entity.entity_type='reference' AND entity.status='active'
  `,[args.workspace.id]);
  const entityId = refs.rows.find((row) => identityKey("reference",row.id)===args.identityKey)?.id;
  if (!entityId) throw new SignalAcquisitionPlanError("reference_identity_unavailable",404);
  const prior = await args.queryable.query<{ id: string;decision_hash: string }>(`
    SELECT id::text,decision_hash FROM signal_acquisition_reference_decisions
    WHERE workspace_id=$1::uuid AND intelligence_entity_id=$2::uuid
    ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE
  `,[args.workspace.id,entityId]);
  const decisionHash = sha256(stable({ workspace_ref: sha256(args.workspace.id),identity_key: args.identityKey,
    action: args.action,evidence_hash: sha256(args.evidence),effective_from: args.effectiveFrom,
    supersedes: prior.rows[0]?.decision_hash ?? null }));
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO signal_acquisition_reference_decisions(
      workspace_id,intelligence_entity_id,action,evidence_hash,evidence_reference,actor_user_id,
      operation_id,effective_from,decision_hash,supersedes_decision_id
    ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid,$8::timestamptz,$9,$10::uuid)
    RETURNING id::text
  `,[args.workspace.id,entityId,args.action,sha256(args.evidence),safeEvidence(args.evidence),
    args.actor.id,operation.operationId,args.effectiveFrom,decisionHash,prior.rows[0]?.id ?? null]);
  const draftResult=await args.queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text FROM signal_acquisition_plans
    WHERE workspace_id=$1::uuid AND status='draft' FOR UPDATE
  `,[args.workspace.id]);
  let nextDigest=decisionHash;
  const draft=draftResult.rows[0];
  if(draft){
    const live=await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
    const authorityPlan:PlanRow={...draft,brand_os_profile_id:live.profile.id,
      brand_os_profile_version:live.profile.version,brand_os_digest:live.profile.digest,
      identity_catalog_digest:live.catalogDigest};
    nextDigest=await recomputeDraftDigest(args.queryable,args.workspace,authorityPlan);
    if(nextDigest!==draft.draft_digest){
      await args.queryable.query(`UPDATE signal_acquisition_plans SET
        brand_os_profile_id=$3::uuid,brand_os_profile_version=$4,brand_os_digest=$5,
        identity_catalog_digest=$6,draft_revision=draft_revision+1,draft_digest=$7
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND status='draft'`,[
        draft.id,args.workspace.id,live.profile.id,live.profile.version,live.profile.digest,
        live.catalogDigest,nextDigest]);
    }
  }
  await insertEvent(args.queryable,{ workspaceId: args.workspace.id,operationId: operation.operationId,
    eventIndex: 0,eventKind: "reference-decided",planId:draft?.id,
    referenceDecisionId:inserted.rows[0]!.id,previousDigest:draft?.draft_digest,nextDigest });
  const result = { identity_key: args.identityKey,action: args.action,decision_hash: decisionHash };
  await completeSignalProductOperationV1({ queryable: args.queryable,workspaceId: args.workspace.id,
    key: operation.key,result });
  void inserted;
  return result;
}

export async function withSignalAcquisitionTransactionV1<T>(
  fn: (queryable: SignalBrandPolicyQueryable) => Promise<T>,serializationAttempt=0
) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isSerializationFailure(error)&&serializationAttempt<2) {
      return withSignalAcquisitionTransactionV1(fn,serializationAttempt+1);
    }
    throw error;
  } finally { client.release(); }
}

function isSerializationFailure(error:unknown){
  return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:unknown}).code==="40001";
}

export async function loadSignalAcquisitionPlanProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
}){
  const {pool}=await import("@/lib/db");
  return loadSignalAcquisitionPlanV1({queryable:pool,...args});
}

export async function loadSignalAcquisitionLiveAuthorityV1(
  queryable: SignalBrandPolicyQueryable,
  workspace: ResolvedSignalWorkspace
) {
  if (workspace.subject.type !== "brand") throw new SignalAcquisitionPlanError("brand_workspace_required",422);
  const profile = await queryable.query<{ id: string;version: number;digest: string }>(`
    SELECT id::text,version,metadata->>'snapshot_hash' AS digest FROM brand_os_profiles
    WHERE brand_id=$1::uuid AND organization_id=$2::uuid AND status='active'
      AND metadata->>'snapshot_hash' ~ '^sha256:[0-9a-f]{64}$'
    ORDER BY version DESC LIMIT 1
  `,[workspace.subject.id,workspace.organizationId]);
  if (!profile.rows[0]) throw new SignalAcquisitionPlanError("brand_os_profile_required",409);
  const competitors = await queryable.query<{ id: string;label: string;seed_id: string;aliases: string[];updated_at: string }>(`
    SELECT competitor.id::text,seed.canonical_name AS label,seed.id::text AS seed_id,
      COALESCE(seed.aliases,ARRAY[]::text[]) aliases,competitor.updated_at::text
    FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
    WHERE competitor.brand_id=$1::uuid AND competitor.status='current' AND seed.active=true
    ORDER BY lower(seed.canonical_name),competitor.id
  `,[workspace.subject.id]);
  const entities = await queryable.query<{ id: string;entity_type: "category" | "reference";canonical_name: string;updated_at: string;aliases: string[] }>(`
    SELECT entity.id::text,entity.entity_type,entity.canonical_name,entity.updated_at::text,
      COALESCE(array_agg(alias.alias ORDER BY lower(alias.alias)) FILTER(WHERE alias.id IS NOT NULL),ARRAY[]::text[]) aliases
    FROM intelligence_entities entity LEFT JOIN entity_aliases alias ON alias.entity_id=entity.id
    WHERE entity.organization_id=$1::uuid AND entity.brand_id=$2::uuid
      AND entity.entity_type IN ('category','reference') AND entity.status='active'
    GROUP BY entity.id ORDER BY entity.entity_type,lower(entity.canonical_name),entity.id
  `,[workspace.organizationId,workspace.subject.id]);
  const decisions = await queryable.query<{ id: string;entity_id: string;decision_hash: string;action: string }>(`
    SELECT DISTINCT ON(intelligence_entity_id) id::text,intelligence_entity_id::text entity_id,
      decision_hash,action FROM signal_acquisition_reference_decisions
    WHERE workspace_id=$1::uuid AND effective_from<=clock_timestamp()
      AND (effective_to IS NULL OR effective_to>clock_timestamp())
    ORDER BY intelligence_entity_id,effective_from DESC,created_at DESC,id DESC
  `,[workspace.id]);
  return {
    profile: profile.rows[0],competitors: competitors.rows,entities: entities.rows,decisions: decisions.rows,
    catalogDigest: sha256(stable({ competitors: competitors.rows.map((row) => ({
      ref: sha256(row.id),seed_ref: sha256(row.seed_id),label: row.label,aliases: row.aliases,updated_at: row.updated_at
    })),entities: entities.rows.map((row) => ({ ref: sha256(row.id),type: row.entity_type,
      name: row.canonical_name,aliases: row.aliases,updated_at: row.updated_at })),
      reference_decisions: decisions.rows.map((row) => ({ entity_ref: sha256(row.entity_id),
        decision_hash: row.decision_hash,action: row.action })) }))
  };
}

function buildDesiredSlots(workspace: ResolvedSignalWorkspace,live: Awaited<ReturnType<typeof loadSignalAcquisitionLiveAuthorityV1>>,
  existing: SlotRow[],draftPlanId: string) {
  const latest = new Map(latestSlots(existing).map((slot) => [slot.slot_key,slot]));
  const target: Array<Omit<SlotRow,"id"|"plan_id"|"reference_decision_hash"> & { supersedes_slot_id: string | null }> = [];
  const push = (input: { slotKey: string;scope: SlotRow["scope"];entityType: SlotRow["entity_type"];
    entityId: string;label: string;entityDigest: string;referenceDecisionId?: string | null;
    referenceDecisionHash?: string | null }) => {
    const prior = latest.get(input.slotKey);
    const unchanged = prior?.plan_id===draftPlanId && prior.scope===input.scope && prior.entity_type===input.entityType
      && prior.entity_id===input.entityId && prior.entity_revision_digest===input.entityDigest
      && prior.desired_state==="active" && prior.position===target.length
      && prior.reference_decision_id===(input.referenceDecisionId ?? null)
      && prior.reference_decision_hash===(input.referenceDecisionHash ?? null);
    if (unchanged) {
      target.push({ ...prior!,supersedes_slot_id: prior!.id });
      return;
    }
    const definition: SignalAcquisitionSlotDefinitionV1 = {
      slot_key: input.slotKey,slot_version: (prior?.slot_version ?? 0)+1,scope: input.scope,
      entity_type: input.entityType,entity_ref_hash: sha256(input.entityId),
      entity_revision_digest: input.entityDigest,desired_state: "active",position: target.length,
      reference_decision_hash: input.referenceDecisionHash ?? null
    };
    target.push({ slot_key: input.slotKey,slot_version: definition.slot_version,scope: input.scope,
      entity_type: input.entityType,entity_id: input.entityId,entity_revision_digest: input.entityDigest,
      label: input.label,desired_state: "active",position: target.length,
      reference_decision_id: input.referenceDecisionId ?? null,definition_hash: signalAcquisitionSlotDigestV1(definition),
      supersedes_slot_id: prior?.id ?? null });
  };
  push({ slotKey: "primary-brand",scope: "primary_brand",entityType: "brand",
    entityId: workspace.subject.id,label: "Primary brand",entityDigest: live.profile.digest });
  for (const competitor of live.competitors) push({
    slotKey: identityKey("competitor",competitor.id),scope: "competitor",entityType: "competitor",
    entityId: competitor.id,label: competitor.label,
    entityDigest: sha256(stable({ seed_ref: sha256(competitor.seed_id),aliases: competitor.aliases,updated_at: competitor.updated_at }))
  });
  const categories = live.entities.filter((entity) => entity.entity_type === "category");
  if (categories.length === 1) push({
    slotKey: identityKey("category",categories[0]!.id),scope: "category",entityType: "category",
    entityId: categories[0]!.id,label: categories[0]!.canonical_name,
    entityDigest: sha256(stable(categories[0]))
  });
  for (const decision of live.decisions.filter((row) => row.action === "include")) {
    const entity = live.entities.find((candidate) => candidate.id === decision.entity_id && candidate.entity_type === "reference");
    if (entity) push({ slotKey: identityKey("reference",entity.id),scope: "reference",entityType: "reference",
      entityId: entity.id,label: entity.canonical_name,entityDigest: sha256(stable(entity)),
      referenceDecisionId: decision.id,referenceDecisionHash: decision.decision_hash });
  }
  for (const old of latest.values()) if (!target.some((slot) => slot.slot_key === old.slot_key)) {
    const definition: SignalAcquisitionSlotDefinitionV1 = {
      slot_key: old.slot_key,slot_version: old.slot_version+1,scope: old.scope,entity_type: old.entity_type,
      entity_ref_hash: sha256(old.entity_id),entity_revision_digest: old.entity_revision_digest,
      desired_state: "retired",position: target.length,reference_decision_hash: old.reference_decision_hash
    };
    target.push({ ...old,slot_version: old.slot_version+1,desired_state: "retired",position: target.length,
      supersedes_slot_id: old.id,definition_hash: signalAcquisitionSlotDigestV1(definition) });
  }
  return target;
}

async function recomputeDraftDigest(queryable: SignalBrandPolicyQueryable,workspace: ResolvedSignalWorkspace,plan: PlanRow) {
  const slots = latestSlots(await loadSlots(queryable,workspace.id,[plan.id]));
  const queries = await loadQueries(queryable,workspace.id,[plan.id]);
  const definition: SignalAcquisitionPlanDefinitionV1 = {
    workspace_ref_hash: sha256(workspace.id),plan_version: plan.plan_version,
    brand_os_profile_version: plan.brand_os_profile_version,brand_os_digest: plan.brand_os_digest,
    identity_catalog_digest: plan.identity_catalog_digest,
    ...(plan.acquisition_brief_digest
      ? { acquisition_brief_digest: plan.acquisition_brief_digest }
      : {}),
    slots: slots.map(slotDefinition),queries: queries.filter((query) => query.status !== "superseded" && query.status !== "retired").map(queryDefinition)
  };
  return signalAcquisitionPlanDigestV1(definition);
}

async function loadSlots(queryable: SignalBrandPolicyQueryable,workspaceId: string,planIds: string[]) {
  const result = await queryable.query<SlotRow>(`
    SELECT slot.id::text,slot.plan_id::text,slot.slot_key,slot.slot_version,slot.scope,slot.entity_type,
      slot.entity_id::text,slot.entity_revision_digest,slot.label,slot.desired_state,slot.position,
      slot.reference_decision_id::text,decision.decision_hash AS reference_decision_hash,slot.definition_hash
    FROM signal_acquisition_slots slot LEFT JOIN signal_acquisition_reference_decisions decision
      ON decision.id=slot.reference_decision_id
    WHERE slot.workspace_id=$1::uuid AND slot.plan_id=ANY($2::uuid[])
    ORDER BY slot.plan_id,slot.position,slot.slot_version
  `,[workspaceId,planIds]);
  return result.rows;
}

async function loadQueries(queryable: SignalBrandPolicyQueryable,workspaceId: string,planIds: string[]) {
  const result = await queryable.query<QueryRow>(`
    SELECT query.id::text,query.plan_id::text,query.slot_id::text,slot.slot_key,query.query_key,
      query.query_version,source.source_key,query.provider_key,query.provider_syntax_version,
      query.provider_schema_version,query.query_hash,query.structured_terms,query.cadence,
      query.default_period_start::text,query.default_period_end::text,query.timezone,
      query.status,query.definition_hash,source.status AS source_status,
      source.source_contract_version,query.origin_kind,query.generation_fallback_used,
      query.generation_fallback_reason,
      COALESCE(review.decision,
        CASE WHEN query.status='current' THEN 'approved'
          WHEN carried.status='current' THEN COALESCE(carried_review.decision,'approved') END,
        'pending') AS review_status,
      COALESCE(review.decided_at,carried_review.decided_at)::text AS reviewed_at,
      COALESCE(review.decided_by_user_id,carried_review.decided_by_user_id)::text AS reviewed_by_user_id
    FROM signal_acquisition_query_versions query
    JOIN signal_acquisition_slots slot ON slot.id=query.slot_id
    JOIN data_sources source ON source.id=query.data_source_id
    LEFT JOIN LATERAL (
      SELECT decision,decided_at,decided_by_user_id
      FROM signal_acquisition_query_review_events event
      WHERE event.workspace_id=query.workspace_id AND event.query_version_id=query.id
      ORDER BY event.event_sequence DESC LIMIT 1
    ) review ON true
    LEFT JOIN signal_acquisition_query_versions carried
      ON carried.id=query.carried_from_query_version_id
      AND carried.workspace_id=query.workspace_id
      AND carried.definition_hash=query.definition_hash
    LEFT JOIN LATERAL (
      SELECT decision,decided_at,decided_by_user_id
      FROM signal_acquisition_query_review_events event
      WHERE event.workspace_id=carried.workspace_id AND event.query_version_id=carried.id
      ORDER BY event.event_sequence DESC LIMIT 1
    ) carried_review ON true
    WHERE query.workspace_id=$1::uuid AND query.plan_id=ANY($2::uuid[])
    ORDER BY query.plan_id,slot.slot_key,query.query_key,query.query_version
  `,[workspaceId,planIds]);
  return result.rows;
}

function latestSlots(rows: SlotRow[]) {
  const map = new Map<string,SlotRow>();
  for (const row of rows) {
    const key = `${row.plan_id}:${row.slot_key}`;
    const prior = map.get(key);
    if (!prior || prior.slot_version < row.slot_version) map.set(key,row);
  }
  return [...map.values()].sort((a,b) => a.position-b.position || a.slot_key.localeCompare(b.slot_key));
}

function slotDefinition(slot: SlotRow): SignalAcquisitionSlotDefinitionV1 {
  return { slot_key: slot.slot_key,slot_version: slot.slot_version,scope: slot.scope,
    entity_type: slot.entity_type,entity_ref_hash: sha256(slot.entity_id),
    entity_revision_digest: slot.entity_revision_digest,desired_state: slot.desired_state,
    position: slot.position,reference_decision_hash: slot.reference_decision_hash };
}
function queryDefinition(query: QueryRow): SignalAcquisitionQueryDefinitionV1 {
  return { slot_key: query.slot_key,query_key: query.query_key,query_version: query.query_version,
    source_key: query.source_key,provider_key: query.provider_key,
    provider_syntax_version: query.provider_syntax_version,provider_schema_version: query.provider_schema_version,
    query_hash: query.query_hash,structured_terms: query.structured_terms,cadence: query.cadence,
    default_period_start: query.default_period_start,default_period_end: query.default_period_end,
    timezone: query.timezone };
}

function acquisitionBlockers(plan: PlanRow | null,slots: SlotRow[],queries: QueryRow[],live: Awaited<ReturnType<typeof loadSignalAcquisitionLiveAuthorityV1>>) {
  const blockers: string[] = [];
  if (!plan) return ["draft_required"];
  if (plan.brand_os_digest!==live.profile.digest || plan.identity_catalog_digest!==live.catalogDigest) blockers.push("authority_drift");
  const latest = latestSlots(slots.filter((slot) => slot.plan_id===plan.id));
  if (!latest.some((slot) => slot.scope === "primary_brand" && slot.desired_state === "active")) blockers.push("primary_slot_required");
  const expectedKeys=new Set<string>(["primary-brand"]);
  for(const competitor of live.competitors)expectedKeys.add(identityKey("competitor",competitor.id));
  const categories=live.entities.filter((entity)=>entity.entity_type==="category");
  if(categories.length===1)expectedKeys.add(identityKey("category",categories[0]!.id));
  for(const decision of live.decisions.filter((item)=>item.action==="include")){
    if(live.entities.some((entity)=>entity.id===decision.entity_id&&entity.entity_type==="reference")){
      expectedKeys.add(identityKey("reference",decision.entity_id));
    }
  }
  for(const key of expectedKeys){
    if(!latest.some((slot)=>slot.slot_key===key&&slot.desired_state==="active"))blockers.push(`slot_reconcile_required:${key}`);
  }
  for(const slot of latest.filter((item)=>item.desired_state==="active")){
    if(!expectedKeys.has(slot.slot_key))blockers.push(`slot_authority_stale:${slot.slot_key}`);
  }
  for (const slot of latest.filter((row) => row.desired_state === "active")) {
    const activeQueries=queries.filter((query) => query.slot_id===slot.id && !["retired","superseded"].includes(query.status));
    for(const query of activeQueries){
      if(query.source_status!=="active"||query.source_contract_version!=="signal-data-source-connector-v1"){
        blockers.push(`query_source_unavailable:${slot.slot_key}`);
      }
      if(query.review_status==="pending")blockers.push(`query_review_required:${slot.slot_key}`);
      if(query.review_status==="rejected")blockers.push(`query_rejected:${slot.slot_key}`);
    }
  }
  if (categories.length===0) blockers.push("category_identity_required");
  if (categories.length>1) blockers.push("category_identity_ambiguous");
  return [...new Set(blockers)].sort();
}

function queryPlaybookWarnings(slots:SlotRow[],queries:QueryRow[]){
  return slots.filter((slot)=>slot.desired_state==="active").flatMap((slot)=>{
    const usable=queries.some((query)=>query.slot_id===slot.id
      && !["retired","superseded"].includes(query.status)
      && query.review_status==="approved" && query.source_status==="active"
      && query.source_contract_version==="signal-data-source-connector-v1");
    return usable?[]:[`query_playbook_incomplete:${slot.slot_key}`];
  });
}

async function loadConnectorImportReadiness(queryable:SignalBrandPolicyQueryable,workspaceId:string){
  const result=await queryable.query<{source_count:number;ready_count:number}>(`
    SELECT count(*)::int source_count,count(*) FILTER(WHERE EXISTS(
      SELECT 1 FROM signal_provenance_policy_bindings binding
      JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
        AND quality.workspace_id=binding.workspace_id AND quality.status='active'
        AND quality.effective_from<=clock_timestamp()
        AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
      JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
        AND retention.workspace_id=binding.workspace_id AND retention.status='active'
        AND retention.effective_from<=clock_timestamp()
        AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
        AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
      JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
        AND licensing.workspace_id=binding.workspace_id AND licensing.status='active'
        AND licensing.effective_from<=clock_timestamp()
        AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
      WHERE binding.workspace_id=source.workspace_id AND binding.data_source_id=source.id
        AND binding.import_batch_id IS NULL AND binding.status='active'
        AND binding.effective_from<=clock_timestamp()
        AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
    ))::int ready_count
    FROM data_sources source WHERE source.workspace_id=$1::uuid AND source.status='active'
      AND source.source_contract_version='signal-data-source-connector-v1'
  `,[workspaceId]);
  const row=result.rows[0]??{source_count:0,ready_count:0};
  return {ready:row.ready_count>0,warnings:row.source_count===0?["connector_required"]
    :row.ready_count===0?["connector_governance_required"]:[]};
}

async function loadGovernanceBlockers(queryable:SignalBrandPolicyQueryable,workspaceId:string,planId:string){
  const result=await queryable.query<{source_key:string}>(`
    SELECT DISTINCT source.source_key
    FROM signal_acquisition_query_versions query
    JOIN data_sources source ON source.id=query.data_source_id AND source.workspace_id=query.workspace_id
    WHERE query.workspace_id=$1::uuid AND query.plan_id=$2::uuid
      AND query.status IN ('draft','current')
      AND NOT EXISTS(
        SELECT 1 FROM signal_provenance_policy_bindings binding
        JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
          AND quality.workspace_id=binding.workspace_id AND quality.status='active'
          AND quality.effective_from<=clock_timestamp()
          AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
        JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
          AND retention.workspace_id=binding.workspace_id AND retention.status='active'
          AND retention.effective_from<=clock_timestamp()
          AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
          AND (retention.retain_until IS NULL OR retention.retain_until>clock_timestamp())
        JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
          AND licensing.workspace_id=binding.workspace_id AND licensing.status='active'
          AND licensing.effective_from<=clock_timestamp()
          AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
        WHERE binding.workspace_id=query.workspace_id AND binding.data_source_id=query.data_source_id
          AND binding.import_batch_id IS NULL AND binding.status='active'
          AND binding.effective_from<=clock_timestamp()
          AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
      )
    ORDER BY source.source_key
  `,[workspaceId,planId]);
  return result.rows.map((row)=>`governance_unavailable:${row.source_key}`);
}

async function carryForwardQueries(queryable: SignalBrandPolicyQueryable,workspaceId: string,currentPlanId: string | null,draftPlanId: string,
  actorId: string,operationKey: string) {
  if (!currentPlanId) return [];
  const inserted=await queryable.query<{id:string;slot_id:string;definition_hash:string}>(`
    INSERT INTO signal_acquisition_query_versions(
      workspace_id,plan_id,slot_id,query_key,query_version,data_source_id,provider_key,
      provider_syntax_version,provider_schema_version,query_text_private,structured_terms,
      query_hash,definition_hash,cadence,default_period_start,default_period_end,timezone,
      status,effective_from,carried_from_query_version_id,origin_kind,origin_reference_id,
      generation_contract_version,generation_model,generation_pipeline_version,
      generation_prompt_template_digest,generation_context_digest,
      generation_construction_plan_digest,generation_validation_report_digest,
      generation_fallback_used,generation_fallback_reason,generation_study_reference_hash,
      generation_study_context_digest,generated_at,created_by_user_id,
      creation_idempotency_key,request_digest
    ) SELECT prior.workspace_id,$3::uuid,draft_slot.id,prior.query_key,prior.query_version,
      prior.data_source_id,prior.provider_key,prior.provider_syntax_version,prior.provider_schema_version,
      prior.query_text_private,prior.structured_terms,prior.query_hash,prior.definition_hash,prior.cadence,
      prior.default_period_start,prior.default_period_end,prior.timezone,'draft',clock_timestamp(),prior.id,
      prior.origin_kind,prior.origin_reference_id,prior.generation_contract_version,prior.generation_model,
      prior.generation_pipeline_version,prior.generation_prompt_template_digest,
      prior.generation_context_digest,prior.generation_construction_plan_digest,
      prior.generation_validation_report_digest,prior.generation_fallback_used,
      prior.generation_fallback_reason,prior.generation_study_reference_hash,
      prior.generation_study_context_digest,prior.generated_at,$4::uuid,
      'sha256:'||encode(digest(convert_to($5||E'\\x1f'||prior.id::text,'UTF8'),'sha256'),'hex'),
      'sha256:'||encode(digest(convert_to(prior.definition_hash||E'\\x1f'||$3::text,'UTF8'),'sha256'),'hex')
    FROM signal_acquisition_query_versions prior
    JOIN signal_acquisition_slots old_slot ON old_slot.id=prior.slot_id AND old_slot.plan_id=$2::uuid
    JOIN LATERAL (SELECT * FROM signal_acquisition_slots candidate
      WHERE candidate.plan_id=$3::uuid AND candidate.slot_key=old_slot.slot_key
        AND candidate.desired_state='active' ORDER BY candidate.slot_version DESC LIMIT 1) draft_slot ON true
    JOIN data_sources source ON source.id=prior.data_source_id
      AND source.source_contract_version='signal-data-source-connector-v1' AND source.status='active'
    WHERE prior.workspace_id=$1::uuid AND prior.plan_id=$2::uuid AND prior.status='current'
    ON CONFLICT(workspace_id,creation_idempotency_key) DO NOTHING
    RETURNING id::text,slot_id::text,definition_hash
  `,[workspaceId,currentPlanId,draftPlanId,actorId,operationKey]);
  return inserted.rows;
}

async function loadPlanById(queryable: SignalBrandPolicyQueryable,workspaceId: string,planId: string) {
  const result = await queryable.query<PlanRow>(`
    SELECT id::text,plan_version,status,brand_os_profile_id::text,brand_os_profile_version,
      brand_os_digest,identity_catalog_digest,acquisition_brief_contract_version,
      acquisition_brief,acquisition_brief_digest,draft_revision,draft_digest,definition_hash,
      effective_from::text,effective_to::text FROM signal_acquisition_plans
    WHERE id=$1::uuid AND workspace_id=$2::uuid
  `,[planId,workspaceId]);
  if (!result.rows[0]) throw new Error("Acquisition plan is unavailable.");
  return result.rows[0];
}

async function insertEvent(queryable: SignalBrandPolicyQueryable,input: {
  workspaceId: string;operationId: string;eventIndex: number;eventKind: string;
  planId?: string;slotId?: string;queryId?: string;referenceDecisionId?:string;
  previousDigest?: string;nextDigest: string;
}) {
  const eventDigest = sha256(stable(input));
  await queryable.query(`
    INSERT INTO signal_acquisition_plan_events(
      workspace_id,operation_id,event_index,event_kind,plan_id,slot_id,query_version_id,reference_decision_id,
      previous_state_digest,next_state_digest,event_digest,detail
    ) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11,'{}'::jsonb)
  `,[input.workspaceId,input.operationId,input.eventIndex,input.eventKind,input.planId ?? null,
    input.slotId ?? null,input.queryId ?? null,input.referenceDecisionId??null,
    input.previousDigest ?? null,input.nextDigest,eventDigest]);
}

function publicPlan(plan: PlanRow | null,blockers: string[]) {
  return plan ? { version: plan.plan_version,status: plan.status,draft_revision: plan.draft_revision,
    draft_digest: plan.draft_digest,effective_from: plan.effective_from,
    brand_os_revision: plan.brand_os_profile_version,
    acquisition_brief_status: plan.acquisition_brief_digest ? "sealed" as const : "missing" as const,
    blockers } : null;
}
function assertAuthority(workspace: ResolvedSignalWorkspace,actor: SignalWorkspaceUser) {
  if (workspace.status!=="active" || workspace.subject.type!=="brand" || actor.userType!=="noisia_internal") {
    throw new SignalAcquisitionPlanError("acquisition_management_forbidden",403);
  }
}
function identityKey(scope: "competitor" | "category" | "reference",id: string) {
  return `${scope}-sha256-${createHash("sha256").update(id).digest("hex")}`;
}
function safeEvidence(value: string) { return value.trim().slice(0,500).replace(/[\r\n\t]+/gu," "); }
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>)
    .sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
