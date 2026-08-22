import { createHash } from "node:crypto";

import type { Pool } from "pg";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
  buildSignalSemanticContextProposalPromptV1,
  parseSignalSemanticContextProposalResponseV1,
  signalSemanticContextProposalCostMicroUsdV1,
  signalSemanticContextProposalDigestV1,
  signalSemanticContextProposalInputSchemaV1,
  type SignalSemanticContextProposalInputV1,
  type SignalSemanticContextProposalProviderV1
} from "@noisia/query-engine";

export type SignalSemanticContextQueryable = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type SignalSemanticContextProposalRuntimeConfigurationV1 = {
  available: boolean;
  provider: "anthropic";
  model: string;
  model_version: string;
  pricing_version: string;
  max_input_tokens: number;
  max_output_tokens: number;
  input_usd_per_million_tokens: string;
  output_usd_per_million_tokens: string;
  platform_hard_cap_micro_usd: bigint;
};

export type SignalSemanticContextProposalWorkspaceV1 = {
  id: string;
  organization_id: string;
  brand_id: string;
};

export type SignalSemanticContextProposalActorV1 = {
  id: string;
  user_type: "noisia_internal";
};

type GenerationRow = {
  id: string; generation_key: string; status: "draft" | "published";
  brand_os_profile_id: string; brand_os_digest: string; knowledge_digest: string;
  locale_context_digest: string; primary_locale: string; locale_variants: string[];
  markets: string[]; timezone: string; proposal_model: string | null;
  proposal_model_version: string | null; proposal_prompt_digest: string | null;
  proposal_pricing_version: string | null;
};

type SourceAuthorityRef = {
  source_alias: string;
  source_type: "brand_os_profile" | "brand_os_product" | "brand_os_competitor"
    | "brand_os_seed_term" | "knowledge_source" | "knowledge_chunk" | "knowledge_assertion";
  source_id: string;
};

type PreparedContext = {
  input: SignalSemanticContextProposalInputV1;
  prompt: string;
  input_digest: string;
  source_refs: Map<string, SourceAuthorityRef>;
  entity_refs: Map<string, { entity_type: string; entity_id: string }>;
  generation: GenerationRow;
};

type RunRow = {
  id: string; workspace_id: string; generation_id: string; run_key: string;
  status: "queued" | "processing" | "validating" | "completed" | "failed" | "stale" | "dead_letter";
  preflight_digest: string; brand_os_digest: string; knowledge_digest: string;
  locale_context_digest: string; prompt_digest: string; context_input_digest: string;
  provider: string; model: string; model_version: string; pricing_version: string;
  max_input_tokens: number; max_output_tokens: number;
  input_usd_per_million_tokens: string; output_usd_per_million_tokens: string;
  hard_cap_micro_usd: string; reservation_micro_usd: string;
  provider_request_identity: string; provider_request_id: string | null;
  provider_call_state: "not_started" | "in_flight" | "response_persisted" | "outcome_unknown" | "settled";
  provider_call_count: number; provider_response_private: string | null;
  provider_response_digest: string | null; input_tokens: string | null; output_tokens: string | null;
  settled_micro_usd: string | null; proposal_count: number | null; result_digest: string | null;
  attempt_count: number; lease_token: string | null; lease_expires_at: Date | string | null;
  error_code: string | null; error_summary: string | null; created_by_user_id: string;
  queued_at: Date | string; started_at: Date | string | null; validating_at: Date | string | null;
  completed_at: Date | string | null; failed_at: Date | string | null;
  stale_at: Date | string | null; dead_lettered_at: Date | string | null;
};

export class SignalSemanticContextProposalExecutionError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export class SignalSemanticContextProviderCallError extends Error {
  constructor(message: string, public readonly definitelyNotSent: boolean) { super(message); }
}

export function signalSemanticContextProposalRuntimeConfigurationFromEnvV1(
  env: Record<string, string | undefined> = process.env
): SignalSemanticContextProposalRuntimeConfigurationV1 {
  const positiveInteger = (key: string) => {
    const value = Number(env[key]);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
  const price = (key: string) => /^\d+(?:\.\d{1,6})?$/u.test(env[key]?.trim() ?? "")
    ? env[key]!.trim() : "";
  const model = env.NOISIA_SEMANTIC_CONTEXT_MODEL?.trim() ?? "";
  const modelVersion = env.NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION?.trim() ?? "";
  const pricingVersion = env.NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION?.trim() ?? "";
  const maxInput = positiveInteger("NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS");
  const maxOutput = positiveInteger("NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS");
  const inputPrice = price("NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS");
  const outputPrice = price("NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS");
  const explicitHardCap = positiveInteger("NOISIA_SEMANTIC_CONTEXT_HARD_CAP_MICRO_USD");
  const legacyUsdCap = Number(env.NOISIA_SEMANTIC_CONTEXT_HARD_CAP_USD);
  const hardCap = explicitHardCap || (Number.isFinite(legacyUsdCap) && legacyUsdCap > 0
    ? Math.ceil(legacyUsdCap * 1_000_000) : 0);
  return {
    available: Boolean(model && modelVersion && pricingVersion && maxInput && maxOutput
      && inputPrice && outputPrice && hardCap),
    provider: "anthropic", model, model_version: modelVersion, pricing_version: pricingVersion,
    max_input_tokens: maxInput, max_output_tokens: maxOutput,
    input_usd_per_million_tokens: inputPrice || "0",
    output_usd_per_million_tokens: outputPrice || "0",
    platform_hard_cap_micro_usd: BigInt(hardCap)
  };
}

export async function loadSignalSemanticContextProposalPreflightRuntimeV1(args: {
  queryable: SignalSemanticContextQueryable;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  actor: SignalSemanticContextProposalActorV1;
  generation_key?: string;
  configuration: SignalSemanticContextProposalRuntimeConfigurationV1;
  runtime: { queue_configured: boolean; worker_alive: boolean; recovery_alive: boolean };
}) {
  assertActor(args.actor);
  const generation = await loadGeneration(args.queryable, args.workspace.id, args.generation_key);
  const blockers: string[] = [];
  if (!generation) blockers.push("semantic_context_draft_required");
  if (generation?.status !== "draft") blockers.push("semantic_context_draft_required");
  if (!args.configuration.available) blockers.push("provider_configuration_unavailable");
  if (!args.runtime.queue_configured) blockers.push("proposal_queue_unavailable");
  if (!args.runtime.worker_alive) blockers.push("proposal_worker_unavailable");
  if (!args.runtime.recovery_alive) blockers.push("proposal_recovery_unavailable");
  let prepared: PreparedContext | null = null;
  if (generation?.status === "draft") {
    try { prepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: args.queryable, workspace: args.workspace, generation_key: generation.generation_key
    }); } catch (error) {
      blockers.push(error instanceof SignalSemanticContextProposalExecutionError
        ? error.code : "semantic_context_authority_unavailable");
    }
  }
  if (generation && !lineageMatches(generation, args.configuration)) blockers.push("provider_lineage_drift");
  const inputTokenUpperBound = prepared ? Buffer.byteLength(prepared.prompt, "utf8") : null;
  if (inputTokenUpperBound !== null && inputTokenUpperBound > args.configuration.max_input_tokens) {
    blockers.push("semantic_context_input_token_budget_exceeded");
  }
  const reservation = configurationReservation(args.configuration);
  if (reservation > args.configuration.platform_hard_cap_micro_usd) blockers.push("platform_hard_cap_insufficient");
  const payload = {
    contract_version: "signal-semantic-context-proposal-preflight-v2",
    generation_key: generation?.generation_key ?? null,
    authority: generation ? { brand_os_digest: generation.brand_os_digest,
      knowledge_digest: generation.knowledge_digest,
      locale_context_digest: generation.locale_context_digest } : null,
    context_input_digest: prepared?.input_digest ?? null,
    provider: { key: args.configuration.provider, model: args.configuration.model,
      model_version: args.configuration.model_version, pricing_version: args.configuration.pricing_version,
      prompt_digest: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1 },
    maximum_provider_calls: 1,
    estimated_input_tokens_upper_bound: inputTokenUpperBound,
    max_input_tokens: args.configuration.max_input_tokens,
    max_output_tokens: args.configuration.max_output_tokens,
    estimated_max_cost_micro_usd: reservation.toString(),
    platform_hard_cap_micro_usd: args.configuration.platform_hard_cap_micro_usd.toString(),
    runtime: args.runtime,
    drift: blockers.some((value) => value.includes("drift")) ? "stale" : "current",
    readiness: blockers.length === 0 ? "ready" : "blocked",
    blockers: [...new Set(blockers)], writes_performed: false, provider_calls: 0
  } as const;
  return { ...payload, preflight_digest: signalSemanticContextProposalDigestV1(payload) };
}

export async function prepareSignalSemanticContextProposalInputV1(args: {
  queryable: SignalSemanticContextQueryable;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  generation_key: string;
}): Promise<PreparedContext> {
  const generation = await loadGeneration(args.queryable, args.workspace.id, args.generation_key);
  if (!generation || generation.status !== "draft") {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_draft_not_found", 404);
  }
  const [profileResult, productsResult, competitorsResult, seedTermsResult, knowledgeResult,
    knowledgeAuthorityResult] = await Promise.all([
    args.queryable.query<{ id: string; display_name: string; aliases: string[]; industry: string | null;
      industry_sub: string | null; metadata: Record<string, unknown> }>(`
      SELECT profile.id::text,COALESCE(brand.display_name,brand.name) display_name,
        CASE WHEN jsonb_typeof(profile.metadata->'aliases')='array'
          THEN ARRAY(SELECT jsonb_array_elements_text(profile.metadata->'aliases'))
          ELSE '{}'::text[] END aliases,brand.industry,brand.industry_sub,profile.metadata
      FROM brand_os_profiles profile JOIN brands brand ON brand.id=profile.brand_id
      WHERE profile.id=$1::uuid AND profile.brand_id=$2::uuid`, [generation.brand_os_profile_id, args.workspace.brand_id]),
    args.queryable.query<{ id: string; name: string; product_type: string | null; description: string | null }>(`
      SELECT id::text,name,product_type,description FROM brand_os_products
      WHERE brand_os_profile_id=$1::uuid AND status='active' ORDER BY name,id`, [generation.brand_os_profile_id]),
    args.queryable.query<{ id: string; competitor_name: string; role: string | null }>(`
      SELECT id::text,competitor_name,role FROM brand_os_competitors
      WHERE brand_os_profile_id=$1::uuid ORDER BY priority NULLS LAST,competitor_name,id`, [generation.brand_os_profile_id]),
    args.queryable.query<{ id: string; term: string; term_type: string }>(`
      SELECT term.id::text,term.term,term.term_type FROM brand_os_seed_terms term
      JOIN brand_os_seed_sets seed_set ON seed_set.id=term.seed_set_id
      WHERE seed_set.brand_os_profile_id=$1::uuid AND seed_set.status='active'
      ORDER BY term.term_type,term.term,term.id`, [generation.brand_os_profile_id]),
    args.queryable.query<{ source_type: SourceAuthorityRef["source_type"]; id: string;
      parent_id: string | null; content_kind: string; title: string; body: string }>(`
      SELECT 'knowledge_source'::text source_type,source.id::text id,NULL::text parent_id,
        source.source_kind content_kind,source.title,left(COALESCE(source.raw_text,''),4000) body
      FROM brand_knowledge_sources source
      WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
        AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
      UNION ALL
      SELECT 'knowledge_chunk',chunk.id::text,source.id::text,'chunk',source.title,
        left(chunk.chunk_text,4000)
      FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
      WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
        AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
      UNION ALL
      SELECT 'knowledge_assertion',assertion.id::text,source.id::text,assertion.assertion_type,
        source.title,left(assertion.assertion_text,4000)
      FROM knowledge_assertions assertion JOIN brand_knowledge_sources source ON source.id=assertion.knowledge_source_id
      WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
        AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
        AND assertion.status IN ('approved','active')
      ORDER BY source_type,id`, [args.workspace.organization_id, args.workspace.brand_id])
    ,args.queryable.query<{ record_kind: "source" | "chunk"; id: string; source_id: string | null;
      source_kind: string | null; authority_digest: string }>(`
      SELECT 'source'::text record_kind,source.id::text id,NULL::text source_id,
        source.source_kind,CASE WHEN source.file_hash ~ '^sha256:[0-9a-f]{64}$' THEN source.file_hash
          ELSE 'sha256:'||encode(digest(COALESCE(source.raw_text,'')||source.extracted_payload::text,
            'sha256'),'hex') END authority_digest
      FROM brand_knowledge_sources source
      WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
        AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
      UNION ALL
      SELECT 'chunk',chunk.id::text,source.id::text,NULL::text,
        'sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex')
      FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
      WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid
        AND source.study_corpus_id IS NULL AND source.status IN ('processed','profiled','active')
      ORDER BY record_kind,id`, [args.workspace.organization_id, args.workspace.brand_id])
  ]);
  const profile = profileResult.rows[0];
  if (!profile) throw new SignalSemanticContextProposalExecutionError("semantic_context_brand_os_snapshot_missing");
  if (profile.metadata?.snapshot_hash !== generation.brand_os_digest) {
    throw new SignalSemanticContextProposalExecutionError("brand_os_drift");
  }
  const liveKnowledgeDigest = signalSemanticContextProposalDigestV1({
    sources: knowledgeAuthorityResult.rows.filter((row) => row.record_kind === "source")
      .map((row) => ({ id: row.id, kind: row.source_kind, digest: row.authority_digest })),
    chunks: knowledgeAuthorityResult.rows.filter((row) => row.record_kind === "chunk")
      .map((row) => ({ id: row.id, source_id: row.source_id, content_digest: row.authority_digest }))
  });
  if (liveKnowledgeDigest !== generation.knowledge_digest) {
    throw new SignalSemanticContextProposalExecutionError("knowledge_drift");
  }
  const refs = ([
    { source_alias: "", source_type: "brand_os_profile" as const, source_id: profile.id },
    ...productsResult.rows.map((row) => ({ source_alias: "", source_type: "brand_os_product" as const, source_id: row.id })),
    ...competitorsResult.rows.map((row) => ({ source_alias: "", source_type: "brand_os_competitor" as const, source_id: row.id })),
    ...seedTermsResult.rows.map((row) => ({ source_alias: "", source_type: "brand_os_seed_term" as const, source_id: row.id })),
    ...knowledgeResult.rows.map((row) => ({ source_alias: "", source_type: row.source_type, source_id: row.id }))
  ] satisfies SourceAuthorityRef[]).sort((a, b) => a.source_type.localeCompare(b.source_type) || a.source_id.localeCompare(b.source_id))
    .map((ref, index) => ({ ...ref, source_alias: `src.${String(index + 1).padStart(4, "0")}` }));
  const sourceRefs = new Map(refs.map((ref) => [ref.source_alias, ref]));
  const aliasFor = (type: SourceAuthorityRef["source_type"], id: string) =>
    refs.find((ref) => ref.source_type === type && ref.source_id === id)!.source_alias;
  const entityRefs = new Map<string, { entity_type: string; entity_id: string }>();
  const primaryRef = "entity.primary";
  entityRefs.set(primaryRef, { entity_type: "brand", entity_id: args.workspace.brand_id });
  for (const row of productsResult.rows) entityRefs.set(`entity.product.${shortHash(row.id)}`,
    { entity_type: "product", entity_id: row.id });
  for (const row of competitorsResult.rows) entityRefs.set(`entity.competitor.${shortHash(row.id)}`,
    { entity_type: "competitor", entity_id: row.id });
  const profileAlias = aliasFor("brand_os_profile", profile.id);
  const namedTerm = (key: string, display: string, alias: string) =>
    ({ key, display_text: display, source_aliases: [alias] });
  const metadataList = (key: string) => Array.isArray(profile.metadata?.[key])
    ? (profile.metadata[key] as unknown[]).filter((entry): entry is string => typeof entry === "string") : [];
  const input = signalSemanticContextProposalInputSchemaV1.parse({
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
    generation_key: generation.generation_key,
    authority: { brand_os_digest: generation.brand_os_digest, knowledge_digest: generation.knowledge_digest,
      locale_context_digest: generation.locale_context_digest },
    locale_context: { primary_locale: generation.primary_locale,
      locale_variants: generation.locale_variants, markets: generation.markets,
      timezone: generation.timezone, code_switching: metadataList("code_switching") },
    identity: { primary: { entity_ref: primaryRef, entity_type: "brand", display_name: profile.display_name,
      aliases: profile.aliases ?? [], source_aliases: [profileAlias] },
      aliases: (profile.aliases ?? []).map((alias, index) => namedTerm(`alias.${index + 1}`, alias, profileAlias)) },
    products: productsResult.rows.map((row) => { const ref = `entity.product.${shortHash(row.id)}`; return {
      entity_ref: ref, entity_type: "product", display_name: row.name, aliases: [],
      source_aliases: [aliasFor("brand_os_product", row.id)] }; }),
    competitors: competitorsResult.rows.map((row) => { const ref = `entity.competitor.${shortHash(row.id)}`; return {
      entity_ref: ref, entity_type: "competitor", display_name: row.competitor_name, aliases: [],
      source_aliases: [aliasFor("brand_os_competitor", row.id)] }; }),
    category: { industry: profile.industry, subindustry: profile.industry_sub, source_aliases: [profileAlias] },
    structured_context: {
      features: [], surfaces: [], needs: [], benefits: [], frictions: [], usage_occasions: [],
      inclusions: [], exclusions: [], homonyms: [], ambiguities: [],
      strategic_questions: [], limitations: [],
      ...Object.fromEntries(["features", "surfaces", "needs", "benefits", "frictions",
        "usage_occasions", "inclusions", "exclusions", "homonyms", "ambiguities",
        "strategic_questions", "limitations"].map((key) => [key,
          metadataList(key).map((value, index) => namedTerm(`${key}.${index + 1}`, value, profileAlias))]))
    },
    knowledge_blocks: [
      { source_alias: profileAlias, source_kind: "brand_os_profile", content_kind: "identity",
        title: "Brand identity", text: [profile.display_name, profile.industry, profile.industry_sub]
          .filter(Boolean).join(" · ") },
      ...productsResult.rows.filter((row) => row.description).map((row) => ({
        source_alias: aliasFor("brand_os_product", row.id), source_kind: "brand_os_product",
        content_kind: row.product_type ?? "product", title: row.name, text: row.description! })),
      ...competitorsResult.rows.map((row) => ({ source_alias: aliasFor("brand_os_competitor", row.id),
        source_kind: "brand_os_competitor", content_kind: row.role ?? "competitor",
        title: row.competitor_name, text: row.competitor_name })),
      ...seedTermsResult.rows.map((row) => ({ source_alias: aliasFor("brand_os_seed_term", row.id),
        source_kind: "brand_os_seed_term", content_kind: row.term_type, title: "Governed term", text: row.term })),
      ...knowledgeResult.rows.filter((row) => row.body.trim()).map((row) => ({
        source_alias: aliasFor(row.source_type, row.id), source_kind: row.source_type,
        content_kind: row.content_kind || "knowledge", title: row.title, text: row.body }))
    ],
    limits: { maximum_proposals: 250, abstention_required_when_evidence_is_insufficient: true,
      mentions_included: false }
  });
  const prompt = buildSignalSemanticContextProposalPromptV1(input);
  return { input, prompt, input_digest: signalSemanticContextProposalDigestV1(input),
    source_refs: sourceRefs, entity_refs: entityRefs, generation };
}

export async function startSignalSemanticContextProposalRunV1(args: {
  pool: Pick<Pool, "connect">;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  actor: SignalSemanticContextProposalActorV1;
  idempotency_key: string;
  generation_key: string;
  preflight_digest: string;
  confirmation: string;
  hard_cap_micro_usd: bigint;
  configuration: SignalSemanticContextProposalRuntimeConfigurationV1;
  runtime: { queue_configured: boolean; worker_alive: boolean; recovery_alive: boolean };
}) {
  assertActor(args.actor);
  if (args.confirmation !== SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_confirmation_required", 422);
  }
  if (args.hard_cap_micro_usd <= 0n
      || args.hard_cap_micro_usd > args.configuration.platform_hard_cap_micro_usd) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_hard_cap_invalid", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const preflight = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: client, workspace: args.workspace, actor: args.actor,
      generation_key: args.generation_key, configuration: args.configuration, runtime: args.runtime
    });
    if (preflight.readiness !== "ready") {
      throw new SignalSemanticContextProposalExecutionError(preflight.blockers[0] ?? "semantic_context_preflight_blocked");
    }
    if (preflight.preflight_digest !== args.preflight_digest) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_preflight_drift", 409);
    }
    const reservation = BigInt(preflight.estimated_max_cost_micro_usd);
    if (reservation > args.hard_cap_micro_usd) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_hard_cap_insufficient", 422);
    }
    const prepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: client, workspace: args.workspace, generation_key: args.generation_key
    });
    const operation = await beginOperation(client, {
      workspace: args.workspace, actor: args.actor, action: "start-semantic-context-proposal-run",
      idempotency_key: args.idempotency_key,
      input: { generation_key: args.generation_key, preflight_digest: args.preflight_digest,
        confirmation: args.confirmation, hard_cap_micro_usd: args.hard_cap_micro_usd.toString() }
    });
    if (operation.replay) {
      await client.query("COMMIT");
      return operation.replay as ReturnType<typeof publicRun>;
    }
    const providerRequestIdentity = signalSemanticContextProposalDigestV1({
      contract_version: "signal-semantic-context-provider-request-v1",
      generation_key: args.generation_key, preflight_digest: args.preflight_digest,
      input_digest: prepared.input_digest, prompt_digest: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
      model: args.configuration.model, model_version: args.configuration.model_version
    });
    const runKey = `semantic-context-proposal-${providerRequestIdentity.slice(7, 23)}`;
    const inserted = await client.query<RunRow>(`WITH inserted AS (
      INSERT INTO signal_semantic_context_proposal_runs(
        workspace_id,generation_id,operation_id,run_key,status,preflight_digest,brand_os_digest,
        knowledge_digest,locale_context_digest,prompt_digest,context_input_digest,provider,model,
        model_version,pricing_version,max_input_tokens,max_output_tokens,input_usd_per_million_tokens,
        output_usd_per_million_tokens,hard_cap_micro_usd,reservation_micro_usd,
        provider_request_identity,created_by_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,'queued',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22::uuid) RETURNING *)
      ${runSelect} FROM inserted run`, [
      args.workspace.id, prepared.generation.id, operation.operation_id, runKey, args.preflight_digest,
      prepared.generation.brand_os_digest, prepared.generation.knowledge_digest,
      prepared.generation.locale_context_digest, SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
      prepared.input_digest, args.configuration.provider, args.configuration.model,
      args.configuration.model_version, args.configuration.pricing_version,
      args.configuration.max_input_tokens, args.configuration.max_output_tokens,
      args.configuration.input_usd_per_million_tokens, args.configuration.output_usd_per_million_tokens,
      args.hard_cap_micro_usd.toString(), reservation.toString(), providerRequestIdentity, args.actor.id
    ]);
    const run = inserted.rows[0]!;
    const reservationDigest = signalSemanticContextProposalDigestV1({ run_id: run.id,
      reservation_micro_usd: reservation.toString(), max_input_tokens: args.configuration.max_input_tokens,
      max_output_tokens: args.configuration.max_output_tokens });
    await client.query(`INSERT INTO signal_semantic_context_budget_reservations(
      workspace_id,run_id,reservation_micro_usd,reserved_input_tokens,reserved_output_tokens,reservation_digest)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)`, [args.workspace.id, run.id, reservation.toString(),
      args.configuration.max_input_tokens, args.configuration.max_output_tokens, reservationDigest]);
    await client.query(`INSERT INTO signal_semantic_context_proposal_outbox(
      workspace_id,run_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)`,
    [args.workspace.id, run.id, buildSignalSemanticContextProposalJobIdV1(run.id)]);
    await insertRunEvent(client, run, "queued", "queued", { provider_calls: 0 });
    const result = publicRun(run);
    await completeOperation(client, args.workspace.id, operation.key, result);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function loadSignalSemanticContextProposalRunV1(args: {
  queryable: SignalSemanticContextQueryable;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  actor: SignalSemanticContextProposalActorV1;
  run_key: string;
}) {
  assertActor(args.actor);
  const result = await args.queryable.query<RunRow>(`${runSelect}
    FROM signal_semantic_context_proposal_runs run
    WHERE run.workspace_id=$1::uuid AND run.run_key=$2`, [args.workspace.id, args.run_key]);
  const run = result.rows[0];
  if (!run) throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_run_not_found", 404);
  return publicRun(run);
}

export async function retrySignalSemanticContextProposalRunV1(args: {
  pool: Pick<Pool, "connect">;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  actor: SignalSemanticContextProposalActorV1;
  idempotency_key: string;
  run_key: string;
}) {
  assertActor(args.actor);
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run
      WHERE run.workspace_id=$1::uuid AND run.run_key=$2 FOR UPDATE`, [args.workspace.id, args.run_key]);
    const run = selected.rows[0];
    if (!run) throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_run_not_found", 404);
    const operation = await beginOperation(client, { workspace: args.workspace, actor: args.actor,
      action: "retry-semantic-context-proposal-run", idempotency_key: args.idempotency_key,
      input: { run_key: args.run_key } });
    if (operation.replay) { await client.query("COMMIT"); return operation.replay; }
    if (run.status !== "failed" || run.provider_call_state !== "not_started") {
      throw new SignalSemanticContextProposalExecutionError(
        run.provider_call_state === "outcome_unknown"
          ? "semantic_context_provider_outcome_ambiguous" : "semantic_context_proposal_run_not_retryable", 409);
    }
    await client.query(`UPDATE signal_semantic_context_proposal_runs SET status='queued',failed_at=NULL,
      error_code=NULL,error_summary=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`, [run.id]);
    await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='pending',available_at=now(),
      error_summary=NULL,completed_at=NULL,updated_at=now() WHERE run_id=$1::uuid`, [run.id]);
    const updated = { ...publicRun(run), status: "queued" as const };
    await insertRunEvent(client, run, `recovery-${operation.operation_id}`, "recovery_queued", {});
    await completeOperation(client, args.workspace.id, operation.key, updated);
    await client.query("COMMIT"); return updated;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export function buildSignalSemanticContextProposalJobIdV1(runId: string) {
  return `semantic-context-proposal-${runId}`;
}

export async function processSignalSemanticContextProposalRunV1(args: {
  pool: Pick<Pool, "connect">;
  run_id: string;
  provider: SignalSemanticContextProposalProviderV1;
  lease_seconds?: number;
  crash_after_provider_response_for_test?: boolean;
}) {
  const leaseSeconds = Math.max(30, Math.min(args.lease_seconds ?? 180, 600));
  const lease = await claimRunLease(args.pool, args.run_id, leaseSeconds);
  if (!lease) return { status: "already_claimed_or_terminal" as const };
  let run: RunRow = lease.run;
  let prepared: PreparedContext;
  try {
    prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: lease.client,
      workspace: lease.workspace, generation_key: lease.generation_key });
    if (prepared.input_digest !== run.context_input_digest
        || prepared.generation.brand_os_digest !== run.brand_os_digest
        || prepared.generation.knowledge_digest !== run.knowledge_digest
        || prepared.generation.locale_context_digest !== run.locale_context_digest) {
      await markRunStale(lease.client, run, lease.token, "semantic_context_authority_drift");
      await lease.client.query("COMMIT");
      return { status: "stale" as const };
    }
    await lease.client.query("COMMIT");
  } catch (error) {
    await lease.client.query("ROLLBACK").catch(() => undefined);
    lease.client.release();
    if (isAuthorityDrift(error)) {
      await markRunStaleById(args.pool, run.id, error.code);
      return { status: "stale" as const };
    }
    throw error;
  }
  lease.client.release();

  if (!run.provider_response_private) {
    const startClient = await args.pool.connect();
    try {
      await startClient.query("BEGIN");
      const started = await startClient.query<RunRow>(`${runSelect}
        FROM signal_semantic_context_proposal_runs run WHERE run.id=$1::uuid
          AND run.lease_token=$2::uuid AND run.provider_call_state='not_started'
        FOR UPDATE`, [run.id, lease.token]);
      run = started.rows[0]!;
      if (!run) throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_lease_lost");
      await startClient.query(`UPDATE signal_semantic_context_proposal_runs SET
        provider_call_state='in_flight',provider_call_count=1,attempt_count=attempt_count+1,
        started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
        WHERE id=$1::uuid AND lease_token=$2::uuid`, [run.id, lease.token]);
      await insertRunEvent(startClient, run, `provider-started-${run.attempt_count + 1}`,
        "provider_started", { attempt: run.attempt_count + 1 });
      await startClient.query("COMMIT");
    } catch (error) { await startClient.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { startClient.release(); }

    let response: Awaited<ReturnType<SignalSemanticContextProposalProviderV1["generate"]>>;
    try {
      response = await args.provider.generate({ model: run.model, prompt: prepared.prompt,
        max_output_tokens: run.max_output_tokens, temperature: 0,
        request_identity: run.provider_request_identity });
    } catch (error) {
      await handleProviderFailure(args.pool, run.id, lease.token, error);
      throw error;
    }
    if (args.crash_after_provider_response_for_test) {
      throw new SignalSemanticContextProposalExecutionError("test_crash_after_provider_response");
    }
    const responseDigest = signalSemanticContextProposalDigestV1(response.text);
    const persist = await args.pool.connect();
    try {
      await persist.query("BEGIN");
      const updated = await persist.query(`UPDATE signal_semantic_context_proposal_runs SET
        provider_response_private=$3,provider_response_digest=$4,provider_request_id=$5,
        input_tokens=$6,output_tokens=$7,provider_call_state='response_persisted',status='validating',
        validating_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1::uuid AND lease_token=$2::uuid AND provider_call_state='in_flight'
          AND provider_call_count=1`, [run.id, lease.token, response.text, responseDigest,
        response.provider_request_id, response.usage.input_tokens, response.usage.output_tokens]);
      if (updated.rowCount !== 1) throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_lease_lost");
      await insertRunEvent(persist, run, `provider-response-${run.attempt_count + 1}`,
        "provider_response_persisted",
        { response_digest: responseDigest, input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens });
      await persist.query("COMMIT");
      run = { ...run, provider_response_private: response.text, provider_response_digest: responseDigest,
        provider_request_id: response.provider_request_id, input_tokens: String(response.usage.input_tokens),
        output_tokens: String(response.usage.output_tokens), provider_call_state: "response_persisted",
        status: "validating" };
    } catch (error) { await persist.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { persist.release(); }
  }

  const finish = await args.pool.connect();
  try {
    await finish.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const locked = await finish.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run
      WHERE run.id=$1::uuid AND run.lease_token=$2::uuid FOR UPDATE`, [run.id, lease.token]);
    const current = locked.rows[0];
    if (!current || !current.provider_response_private) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_lease_lost");
    }
    try { prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: finish,
      workspace: lease.workspace, generation_key: lease.generation_key }); }
    catch (error) {
      if (!isAuthorityDrift(error)) throw error;
      await markRunStale(finish, current, lease.token, error.code);
      await finish.query("COMMIT"); return { status: "stale" as const };
    }
    if (prepared.input_digest !== current.context_input_digest) {
      await markRunStale(finish, current, lease.token, "semantic_context_authority_drift_during_execution");
      await finish.query("COMMIT"); return { status: "stale" as const };
    }
    const output = parseSignalSemanticContextProposalResponseV1(current.provider_response_private);
    const proposals = output.proposals.map((proposal) => {
      const refs = proposal.evidence.map((evidence) => {
        const resolved = prepared.source_refs.get(evidence.source_alias);
        if (!resolved) throw new SignalSemanticContextProposalExecutionError("semantic_context_evidence_alias_unknown", 422);
        return { source_type: resolved.source_type, source_id: resolved.source_id,
          relation_type: evidence.relation_type };
      });
      const entity = proposal.entity_ref ? prepared.entity_refs.get(proposal.entity_ref) : null;
      if (proposal.entity_ref && (!entity || entity.entity_type !== proposal.entity_type)) {
        throw new SignalSemanticContextProposalExecutionError("semantic_context_entity_alias_unknown", 422);
      }
      return { element_key: proposal.element_key, element_kind: proposal.element_kind,
        canonical_key: proposal.canonical_key, display_text: proposal.display_text, scope: proposal.scope,
        entity_type: proposal.entity_type, entity_id: entity?.entity_id ?? null, locale: proposal.locale,
        relation_kind: proposal.relation_kind, relation_target_key: proposal.relation_target_key,
        confidence: proposal.confidence, origin_kind: "provider_proposal" as const, source_refs: refs };
    });
    const appended = await appendSignalSemanticContextProposalsV1({ queryable: finish,
      workspace: lease.workspace, actor: { id: current.created_by_user_id, user_type: "noisia_internal" },
      idempotency_key: `semantic-context-run-append:${current.id}`,
      generation_key: lease.generation_key, proposals });
    const inputTokens = Number(current.input_tokens ?? 0);
    const outputTokens = Number(current.output_tokens ?? 0);
    const actual = signalSemanticContextProposalCostMicroUsdV1({ input_tokens: inputTokens,
      output_tokens: outputTokens, input_usd_per_million_tokens: current.input_usd_per_million_tokens,
      output_usd_per_million_tokens: current.output_usd_per_million_tokens });
    if (actual > BigInt(current.reservation_micro_usd)) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_budget_settlement_exceeded", 500);
    }
    await finish.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',
      input_tokens=$2,output_tokens=$3,actual_micro_usd=$4,settled_at=clock_timestamp()
      WHERE run_id=$1::uuid AND status='reserved'`, [current.id, inputTokens, outputTokens, actual.toString()]);
    const resultDigest = signalSemanticContextProposalDigestV1({ run_key: current.run_key,
      generation_key: lease.generation_key, output_digest: current.provider_response_digest,
      proposal_count: proposals.length, draft_digest: appended.draft_digest, settled_micro_usd: actual.toString() });
    const updated = await finish.query(`UPDATE signal_semantic_context_proposal_runs SET
      status='completed',provider_call_state='settled',settled_micro_usd=$3,
      validated_output_digest=$4,appended_operation_id=$5::uuid,proposal_count=$6,result_digest=$7,
      lease_token=NULL,lease_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1::uuid AND lease_token=$2::uuid AND provider_call_state='response_persisted'`, [
      current.id, lease.token, actual.toString(), signalSemanticContextProposalDigestV1(output),
      appended.operation_id, proposals.length, resultDigest
    ]);
    if (updated.rowCount !== 1) throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_completion_conflict");
    await finish.query(`UPDATE signal_semantic_context_proposal_outbox SET status='completed',
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1::uuid`, [current.id]);
    await insertRunEvent(finish, current, "budget-settled", "budget_settled",
      { settled_micro_usd: actual.toString() });
    await insertRunEvent(finish, current, "completed", "completed",
      { proposal_count: proposals.length, result_digest: resultDigest });
    await finish.query("COMMIT");
    return { status: "completed" as const, run_key: current.run_key,
      proposal_count: proposals.length, result_digest: resultDigest };
  } catch (error) {
    await finish.query("ROLLBACK").catch(() => undefined);
    await markRunValidationFailed(args.pool, run.id, lease.token, error).catch(() => undefined);
    throw error;
  } finally { finish.release(); }
}

/** The sole server-owned append boundary used by both Studio and Workers. */
export async function appendSignalSemanticContextProposalsV1(args: {
  queryable: SignalSemanticContextQueryable;
  workspace: SignalSemanticContextProposalWorkspaceV1;
  actor: SignalSemanticContextProposalActorV1;
  idempotency_key: string;
  generation_key: string;
  proposals: Array<{
    element_key: string; element_kind: string; canonical_key: string; display_text: string;
    scope: string | null; entity_type: string | null; entity_id: string | null; locale: string | null;
    relation_kind: string | null; relation_target_key: string | null; confidence: number | null;
    origin_kind: "provider_proposal" | "server_projection";
    source_refs: Array<{ source_type: string; source_id: string; relation_type: string }>;
  }>;
}) {
  assertActor(args.actor);
  if (args.proposals.length < 1 || args.proposals.length > 250) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_scope_invalid", 422);
  }
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`signal-semantic-context:${args.workspace.id}`]);
  const operation = await beginOperation(args.queryable, { workspace: args.workspace, actor: args.actor,
    action: "append-semantic-context-proposals", idempotency_key: args.idempotency_key,
    input: { generation_key: args.generation_key, proposals: args.proposals } });
  if (operation.replay) return operation.replay as { generation_key: string; created: number;
    draft_digest: string; operation_id: string };
  const generation = await loadGeneration(args.queryable, args.workspace.id, args.generation_key);
  if (!generation || generation.status !== "draft") {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_draft_not_found", 404);
  }
  if (args.proposals.some((proposal) => proposal.origin_kind === "provider_proposal")
      && (!generation.proposal_model || !generation.proposal_model_version
      || !generation.proposal_prompt_digest || !generation.proposal_pricing_version)) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_provider_lineage_required", 422);
  }
  const uniqueKeys = new Set<string>();
  for (const proposal of args.proposals) {
    if (uniqueKeys.has(proposal.element_key)) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_duplicate_element_key", 422);
    }
    uniqueKeys.add(proposal.element_key);
    if (!(["provider_proposal", "server_projection"] as const).includes(proposal.origin_kind)
        || proposal.source_refs.length < 1
        || proposal.source_refs.length > 50 || proposal.confidence !== null
        && (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1)) {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_invalid", 422);
    }
  }
  await validateSourceRefs(args.queryable, args.workspace, generation, args.proposals.flatMap((p) => p.source_refs));
  let eventIndex = 0;
  for (const proposal of [...args.proposals].sort((a, b) => a.element_key.localeCompare(b.element_key))) {
    const exists = await args.queryable.query(`SELECT 1 FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=$1::uuid AND element.element_key=$2 AND NOT EXISTS(
        SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)`, [generation.id, proposal.element_key]);
    if (exists.rowCount) throw new SignalSemanticContextProposalExecutionError("semantic_context_element_exists", 409);
    const refs = canonicalRefs(proposal.source_refs);
    const sourceRefsDigest = signalSemanticContextProposalDigestV1(refs);
    const elementDigest = signalSemanticContextProposalDigestV1({
      contract_version: "signal-semantic-context-element-v1",
      element_key: proposal.element_key,
      element_kind: proposal.element_kind,
      canonical_key: proposal.canonical_key,
      display_text: proposal.display_text,
      scope: proposal.scope,
      entity_type: proposal.entity_type,
      entity_id: proposal.entity_id,
      locale: proposal.locale,
      relation_kind: proposal.relation_kind,
      relation_target_key: proposal.relation_target_key,
      confidence: proposal.confidence,
      element_version: 1,
      disposition: "pending", source_refs_digest: sourceRefsDigest,
      confidence_authoritative: false
    });
    const artifact = await args.queryable.query<{ id: string }>(`INSERT INTO analysis_artifacts(
      workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
      content,confidence,review_status,revision,metadata)
      VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_element',$4::jsonb,$5,'needs_review',1,$6::jsonb)
      RETURNING id::text`, [args.workspace.id, elementDigest, proposal.element_key,
      JSON.stringify({ element_kind: proposal.element_kind, canonical_key: proposal.canonical_key,
        display_text: proposal.display_text, scope: proposal.scope, locale: proposal.locale,
        relation_kind: proposal.relation_kind, relation_target_key: proposal.relation_target_key }),
      proposal.confidence === null ? null : String(proposal.confidence),
      JSON.stringify({ authority_only: true, confidence_authoritative: false })]);
    const group = await args.queryable.query<{ id: string }>(`INSERT INTO analysis_evidence_groups(
      artifact_id,group_key,role,label,summary,position,metadata)
      VALUES($1::uuid,'source-authority','supporting','Source authority',NULL,0,$2::jsonb) RETURNING id::text`,
    [artifact.rows[0]!.id, JSON.stringify({ source_refs_digest: sourceRefsDigest })]);
    await args.queryable.query(`INSERT INTO analysis_evidence_links(evidence_group_id,source_type,source_id,
      relation_type,evidence_role,quote,locator,position,metadata)
      SELECT $1::uuid,input.source_type,input.source_id,input.relation_type,'supporting',NULL,
        '{}'::jsonb,input.position,'{}'::jsonb FROM unnest($2::text[],$3::uuid[],$4::text[],$5::int[])
      AS input(source_type,source_id,relation_type,position)`, [group.rows[0]!.id,
      refs.map((ref) => ref.source_type), refs.map((ref) => ref.source_id),
      refs.map((ref) => ref.relation_type), refs.map((_, index) => index)]);
    const element = await args.queryable.query<{ id: string }>(`INSERT INTO signal_semantic_context_element_versions(
      workspace_id,generation_id,artifact_id,evidence_group_id,element_key,element_version,element_kind,
      canonical_key,display_text,scope,entity_type,entity_id,locale,relation_kind,relation_target_key,
      confidence,disposition,origin_kind,source_refs_digest,element_digest,operation_id,proposed_by_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,1,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,
        $15,'pending',$16,$17,$18,$19::uuid,$20::uuid) RETURNING id::text`, [
      args.workspace.id, generation.id, artifact.rows[0]!.id, group.rows[0]!.id, proposal.element_key,
      proposal.element_kind, proposal.canonical_key, proposal.display_text, proposal.scope,
      proposal.entity_type, proposal.entity_id, proposal.locale, proposal.relation_kind,
      proposal.relation_target_key, proposal.confidence, proposal.origin_kind, sourceRefsDigest,
      elementDigest, operation.operation_id, args.actor.id
    ]);
    await args.queryable.query(`INSERT INTO signal_semantic_context_events(workspace_id,generation_id,
      element_id,operation_id,event_index,event_kind,previous_state_digest,next_state_digest,actor_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'proposals_appended',$6,$7,$8::uuid)`, [
      args.workspace.id, generation.id, element.rows[0]!.id, operation.operation_id, eventIndex++,
      null, elementDigest, args.actor.id
    ]);
  }
  const elements = await args.queryable.query<{ element_key: string; element_version: number;
    element_digest: string; disposition: string }>(`SELECT element.element_key,element.element_version,
      element.element_digest,element.disposition FROM signal_semantic_context_element_versions element
      WHERE element.generation_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions s
        WHERE s.supersedes_element_id=element.id) ORDER BY element.element_key,element.element_version`, [generation.id]);
  const draftDigest = signalSemanticContextProposalDigestV1({
    contract_version: "signal-semantic-context-pack-v1", generation_key: generation.generation_key,
    source_authority: { brand_os_digest: generation.brand_os_digest,
      knowledge_digest: generation.knowledge_digest, locale_context_digest: generation.locale_context_digest },
    elements: elements.rows.map((row) => ({ key: row.element_key, version: row.element_version,
      digest: row.element_digest, disposition: row.disposition }))
  });
  const updated = await args.queryable.query(`UPDATE signal_semantic_context_generations
    SET draft_digest=$2 WHERE id=$1::uuid AND status='draft'`, [generation.id, draftDigest]);
  if (updated.rowCount !== 1) throw new SignalSemanticContextProposalExecutionError("semantic_context_draft_conflict");
  const result = { generation_key: generation.generation_key, created: args.proposals.length,
    draft_digest: draftDigest, operation_id: operation.operation_id };
  await completeOperation(args.queryable, args.workspace.id, operation.key, result);
  return result;
}

async function claimRunLease(pool: Pick<Pool, "connect">, runId: string, leaseSeconds: number) {
  const client = await pool.connect();
  const tokenResult = await client.query<{ token: string }>("SELECT gen_random_uuid()::text token");
  const token = tokenResult.rows[0]!.token;
  try {
    await client.query("BEGIN");
    const selected = await client.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run
      WHERE run.id=$1::uuid FOR UPDATE`, [runId]);
    const run = selected.rows[0];
    if (!run || ["completed", "stale", "dead_letter"].includes(run.status)
        || run.lease_token && new Date(run.lease_expires_at!).getTime() > Date.now()) {
      await client.query("ROLLBACK"); client.release(); return null;
    }
    if (run.provider_call_state === "in_flight") {
      await client.query(`UPDATE signal_semantic_context_proposal_runs SET status='dead_letter',
        provider_call_state='outcome_unknown',error_code='provider_outcome_ambiguous',
        error_summary='A provider call started but no durable response was recorded; automatic retry is blocked.',
        lease_token=NULL,lease_expires_at=NULL,dead_lettered_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1::uuid`, [run.id]);
      await settleAmbiguousReservation(client, run.id);
      await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='dead_letter',
        lease_token=NULL,lease_expires_at=NULL,
        error_summary='Provider outcome is ambiguous; automatic retry is blocked.',
        dead_lettered_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE run_id=$1::uuid AND status NOT IN ('completed','dead_letter')`, [run.id]);
      await insertRunEvent(client, run, "ambiguous-dead-letter", "dead_letter", { reason: "provider_outcome_ambiguous" });
      await client.query("COMMIT"); client.release(); return null;
    }
    await client.query(`UPDATE signal_semantic_context_proposal_runs SET status=CASE
        WHEN provider_call_state='response_persisted' THEN 'validating' ELSE 'processing' END,
      lease_token=$2::uuid,lease_expires_at=now()+make_interval(secs=>$3),
      started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
      WHERE id=$1::uuid`, [run.id, token, leaseSeconds]);
    const workspaceResult = await client.query<SignalSemanticContextProposalWorkspaceV1 & { generation_key: string }>(`
      SELECT workspace.id::text,workspace.organization_id::text,workspace.brand_id::text,
        generation.generation_key FROM signal_workspaces workspace
      JOIN signal_semantic_context_generations generation ON generation.workspace_id=workspace.id
      WHERE workspace.id=$1::uuid AND generation.id=$2::uuid AND workspace.status='active'`,
    [run.workspace_id, run.generation_id]);
    const workspace = workspaceResult.rows[0];
    if (!workspace?.brand_id) throw new SignalSemanticContextProposalExecutionError("semantic_context_workspace_invalid");
    await insertRunEvent(client, run, `processing-${run.attempt_count + 1}`, "processing", {});
    return { client, token, run: { ...run, lease_token: token,
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000), status: "processing" as const },
      workspace: { id: workspace.id, organization_id: workspace.organization_id, brand_id: workspace.brand_id },
      generation_key: workspace.generation_key };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); client.release(); throw error; }
}

async function handleProviderFailure(pool: Pick<Pool, "connect">, runId: string, token: string, error: unknown) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const definitelyNotSent = error instanceof SignalSemanticContextProviderCallError && error.definitelyNotSent;
    await client.query(`UPDATE signal_semantic_context_proposal_runs SET status=$3,
      provider_call_state=$4,provider_call_count=CASE WHEN $5::boolean THEN 0 ELSE provider_call_count END,
      error_code=$6,error_summary=$7,lease_token=NULL,lease_expires_at=NULL,
      failed_at=CASE WHEN $3='failed' THEN clock_timestamp() ELSE NULL END,
      dead_lettered_at=CASE WHEN $3='dead_letter' THEN clock_timestamp() ELSE NULL END,
      updated_at=clock_timestamp() WHERE id=$1::uuid AND lease_token=$2::uuid`, [runId, token,
      definitelyNotSent ? "failed" : "dead_letter", definitelyNotSent ? "not_started" : "outcome_unknown",
      definitelyNotSent, definitelyNotSent ? "provider_not_started" : "provider_outcome_ambiguous",
      definitelyNotSent ? "The provider transport confirmed no request was sent."
        : "The provider outcome is ambiguous; automatic retry is blocked."]);
    if (!definitelyNotSent) {
      await settleAmbiguousReservation(client, runId);
      await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='dead_letter',
        lease_token=NULL,lease_expires_at=NULL,
        error_summary='Provider outcome is ambiguous; automatic retry is blocked.',
        dead_lettered_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE run_id=$1::uuid AND status NOT IN ('completed','dead_letter')`, [runId]);
    }
    const run = await client.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run WHERE run.id=$1::uuid`, [runId]);
    if (run.rows[0]) await insertRunEvent(client, run.rows[0], `provider-failure-${run.rows[0].attempt_count}`,
      definitelyNotSent ? "failed" : "dead_letter", { retry_safe: definitelyNotSent });
    await client.query("COMMIT");
  } catch (failure) { await client.query("ROLLBACK").catch(() => undefined); throw failure; }
  finally { client.release(); }
}

async function markRunValidationFailed(pool: Pick<Pool, "connect">, runId: string, token: string, error: unknown) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const safe = safeError(error);
    const selected = await client.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run
      WHERE run.id=$1::uuid AND run.lease_token=$2::uuid FOR UPDATE`, [runId, token]);
    const run = selected.rows[0];
    if (!run || run.provider_call_state !== "response_persisted") {
      throw new SignalSemanticContextProposalExecutionError("semantic_context_proposal_lease_lost");
    }
    const actual = runActualCost(run);
    await settleExactReservation(client, run.id, run, actual);
    await client.query(`UPDATE signal_semantic_context_proposal_runs SET status='failed',
      provider_call_state='settled',settled_micro_usd=$3,error_code=$4,error_summary=$5,
      lease_token=NULL,lease_expires_at=NULL,
      failed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1::uuid AND lease_token=$2::uuid AND status NOT IN ('completed','stale','dead_letter')`,
    [runId, token, actual.toString(), safe.code, safe.summary]);
    await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='dead_letter',
      lease_token=NULL,lease_expires_at=NULL,error_summary=$2,dead_lettered_at=clock_timestamp(),
      updated_at=clock_timestamp() WHERE run_id=$1::uuid AND status NOT IN ('completed','dead_letter')`,
    [runId, safe.summary]);
    await client.query("COMMIT");
  } catch (failure) { await client.query("ROLLBACK").catch(() => undefined); throw failure; }
  finally { client.release(); }
}

async function markRunStale(queryable: SignalSemanticContextQueryable, run: RunRow, token: string, code: string) {
  const actual = run.provider_call_state === "response_persisted" ? runActualCost(run) : null;
  if (actual !== null) await settleExactReservation(queryable, run.id, run, actual);
  await queryable.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',
    provider_call_state=CASE WHEN $4::bigint IS NULL THEN provider_call_state ELSE 'settled' END,
    settled_micro_usd=$4,
    error_code=$3,error_summary='Brand OS, Knowledge, or locale authority drifted.',
    lease_token=NULL,lease_expires_at=NULL,stale_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=$1::uuid AND lease_token=$2::uuid`, [run.id, token, code, actual?.toString() ?? null]);
  if (actual === null) await queryable.query(`UPDATE signal_semantic_context_budget_reservations SET status='released',
    released_at=clock_timestamp(),release_reason=$2 WHERE run_id=$1::uuid AND status='reserved'`, [run.id, code]);
  await queryable.query(`UPDATE signal_semantic_context_proposal_outbox SET status='completed',
    lease_token=NULL,lease_expires_at=NULL,error_summary=$2,completed_at=clock_timestamp(),
    updated_at=clock_timestamp() WHERE run_id=$1::uuid AND status NOT IN ('completed','dead_letter')`,
  [run.id, code]);
  await insertRunEvent(queryable, run, `stale-${code}`, "stale", { reason: code });
}

async function markRunStaleById(pool: Pick<Pool, "connect">, runId: string, code: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<RunRow>(`${runSelect} FROM signal_semantic_context_proposal_runs run
      WHERE run.id=$1::uuid FOR UPDATE`, [runId]);
    const run = result.rows[0];
    if (run && !["completed", "stale", "dead_letter"].includes(run.status)) {
      const actual = run.provider_call_state === "response_persisted" ? runActualCost(run) : null;
      if (actual !== null) await settleExactReservation(client, run.id, run, actual);
      await client.query(`UPDATE signal_semantic_context_proposal_runs SET status='stale',
        provider_call_state=CASE WHEN $3::bigint IS NULL THEN provider_call_state ELSE 'settled' END,
        settled_micro_usd=$3,
        error_code=$2,error_summary='Brand OS, Knowledge, or locale authority drifted.',
        lease_token=NULL,lease_expires_at=NULL,stale_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1::uuid`, [run.id, code, actual?.toString() ?? null]);
      if (actual === null) await client.query(`UPDATE signal_semantic_context_budget_reservations SET status='released',
        released_at=clock_timestamp(),release_reason=$2 WHERE run_id=$1::uuid AND status='reserved'`, [run.id, code]);
      await client.query(`UPDATE signal_semantic_context_proposal_outbox SET status='completed',
        lease_token=NULL,lease_expires_at=NULL,error_summary=$2,completed_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE run_id=$1::uuid AND status NOT IN ('completed','dead_letter')`,
      [run.id, code]);
      await insertRunEvent(client, run, `stale-${code}`, "stale", { reason: code });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function settleAmbiguousReservation(queryable: SignalSemanticContextQueryable, runId: string) {
  await queryable.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',
    input_tokens=reserved_input_tokens,output_tokens=reserved_output_tokens,
    actual_micro_usd=reservation_micro_usd,settled_at=clock_timestamp()
    WHERE run_id=$1::uuid AND status='reserved'`, [runId]);
}

function runActualCost(run: RunRow) {
  const actual = signalSemanticContextProposalCostMicroUsdV1({
    input_tokens: Number(run.input_tokens ?? 0), output_tokens: Number(run.output_tokens ?? 0),
    input_usd_per_million_tokens: run.input_usd_per_million_tokens,
    output_usd_per_million_tokens: run.output_usd_per_million_tokens
  });
  if (actual > BigInt(run.reservation_micro_usd)) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_budget_settlement_exceeded", 500);
  }
  return actual;
}

async function settleExactReservation(queryable: SignalSemanticContextQueryable, runId: string,
  run: RunRow, actual: bigint) {
  await queryable.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',
    input_tokens=$2,output_tokens=$3,actual_micro_usd=$4,settled_at=clock_timestamp()
    WHERE run_id=$1::uuid AND status='reserved'`, [runId, run.input_tokens ?? "0",
    run.output_tokens ?? "0", actual.toString()]);
}

async function validateSourceRefs(queryable: SignalSemanticContextQueryable,
  workspace: SignalSemanticContextProposalWorkspaceV1, generation: GenerationRow,
  refs: Array<{ source_type: string; source_id: string; relation_type: string }>) {
  const unique = [...new Map(refs.map((ref) => [`${ref.source_type}:${ref.source_id}`, ref])).values()];
  const result = await queryable.query<{ allowed: boolean }>(`WITH requested AS(
    SELECT * FROM unnest($1::text[],$2::uuid[]) AS input(source_type,source_id)
  ) SELECT CASE requested.source_type
    WHEN 'brand_os_profile' THEN EXISTS(SELECT 1 FROM brand_os_profiles p WHERE p.id=requested.source_id AND p.id=$3::uuid)
    WHEN 'brand_os_product' THEN EXISTS(SELECT 1 FROM brand_os_products x WHERE x.id=requested.source_id AND x.brand_os_profile_id=$3::uuid)
    WHEN 'brand_os_competitor' THEN EXISTS(SELECT 1 FROM brand_os_competitors x WHERE x.id=requested.source_id AND x.brand_os_profile_id=$3::uuid)
    WHEN 'brand_os_seed_term' THEN EXISTS(SELECT 1 FROM brand_os_seed_terms x JOIN brand_os_seed_sets s ON s.id=x.seed_set_id WHERE x.id=requested.source_id AND s.brand_os_profile_id=$3::uuid)
    WHEN 'knowledge_source' THEN EXISTS(SELECT 1 FROM brand_knowledge_sources s WHERE s.id=requested.source_id AND s.organization_id=$4::uuid AND s.brand_id=$5::uuid AND s.study_corpus_id IS NULL AND s.status IN ('processed','profiled','active'))
    WHEN 'knowledge_chunk' THEN EXISTS(SELECT 1 FROM knowledge_chunks x JOIN brand_knowledge_sources s ON s.id=x.knowledge_source_id WHERE x.id=requested.source_id AND s.organization_id=$4::uuid AND s.brand_id=$5::uuid AND s.study_corpus_id IS NULL AND s.status IN ('processed','profiled','active'))
    WHEN 'knowledge_assertion' THEN EXISTS(SELECT 1 FROM knowledge_assertions x JOIN brand_knowledge_sources s ON s.id=x.knowledge_source_id WHERE x.id=requested.source_id AND s.organization_id=$4::uuid AND s.brand_id=$5::uuid AND s.study_corpus_id IS NULL AND s.status IN ('processed','profiled','active'))
    ELSE false END allowed FROM requested`, [unique.map((ref) => ref.source_type),
    unique.map((ref) => ref.source_id), generation.brand_os_profile_id,
    workspace.organization_id, workspace.brand_id]);
  if (result.rows.length !== unique.length || result.rows.some((row) => !row.allowed)) {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_source_ref_forbidden", 422);
  }
}

async function loadGeneration(queryable: SignalSemanticContextQueryable, workspaceId: string,
  generationKey?: string) {
  const result = await queryable.query<GenerationRow>(`SELECT id::text,generation_key,status,
    brand_os_profile_id::text,brand_os_digest,knowledge_digest,locale_context_digest,primary_locale,
    locale_variants,markets,timezone,proposal_model,proposal_model_version,proposal_prompt_digest,
    proposal_pricing_version FROM signal_semantic_context_generations
    WHERE workspace_id=$1::uuid AND ($2::text IS NULL OR generation_key=$2)
    ORDER BY generation_version DESC LIMIT 1`, [workspaceId, generationKey ?? null]);
  return result.rows[0] ?? null;
}

async function beginOperation(queryable: SignalSemanticContextQueryable, args: {
  workspace: SignalSemanticContextProposalWorkspaceV1; actor: SignalSemanticContextProposalActorV1;
  action: "start-semantic-context-proposal-run" | "retry-semantic-context-proposal-run"
    | "append-semantic-context-proposals"; idempotency_key: string; input: unknown;
}) {
  const normalized = args.idempotency_key.trim();
  if (normalized.length < 8 || normalized.length > 500) {
    throw new SignalSemanticContextProposalExecutionError("idempotency_key_invalid", 422);
  }
  const key = sha256(`signal-product-operation-v1\u001f${normalized}`);
  const requestDigest = signalSemanticContextProposalDigestV1({
    contract_version: "signal-product-operation-v1", workspace_id: args.workspace.id,
    action: args.action, input: args.input
  });
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`signal-product-operation:${args.workspace.id}:${key}`]);
  const authority = await queryable.query<{ allowed: boolean }>(`SELECT
    workspace.organization_id=$2::uuid AND workspace.brand_id=$3::uuid AND workspace.status='active'
      AND signal_data_governance_actor_is_valid(workspace.id,$4::uuid) allowed
    FROM signal_workspaces workspace WHERE workspace.id=$1::uuid`, [args.workspace.id,
    args.workspace.organization_id, args.workspace.brand_id, args.actor.id]);
  if (!authority.rows[0]?.allowed) throw new SignalSemanticContextProposalExecutionError("semantic_context_forbidden", 403);
  await queryable.query(`INSERT INTO signal_governance_control_operations(
    workspace_id,actor_user_id,action,request_digest,idempotency_key,status)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,'in_progress')
    ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`, [args.workspace.id, args.actor.id,
    args.action, requestDigest, key]);
  const selected = await queryable.query<{ id: string; actor_user_id: string; action: string;
    request_digest: string; status: string; result: unknown }>(`SELECT id::text,actor_user_id::text,
    action,request_digest,status,result FROM signal_governance_control_operations
    WHERE workspace_id=$1::uuid AND idempotency_key=$2 FOR UPDATE`, [args.workspace.id, key]);
  const row = selected.rows[0];
  if (!row || row.actor_user_id !== args.actor.id || row.action !== args.action
      || row.request_digest !== requestDigest) {
    throw new SignalSemanticContextProposalExecutionError("idempotency_key_incompatible", 409);
  }
  if (row.status === "completed" && row.result) return { key, operation_id: row.id, replay: row.result };
  if (row.status !== "in_progress") throw new SignalSemanticContextProposalExecutionError("operation_state_invalid");
  return { key, operation_id: row.id, replay: null };
}

async function completeOperation(queryable: SignalSemanticContextQueryable, workspaceId: string,
  key: string, result: unknown) {
  const updated = await queryable.query(`UPDATE signal_governance_control_operations SET
    status='completed',result=$3::jsonb,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE workspace_id=$1::uuid AND idempotency_key=$2 AND status='in_progress'`,
  [workspaceId, key, JSON.stringify(result)]);
  if (updated.rowCount !== 1) throw new SignalSemanticContextProposalExecutionError("operation_completion_failed");
}

async function insertRunEvent(queryable: SignalSemanticContextQueryable, run: Pick<RunRow, "id" | "workspace_id">,
  transitionKey: string, eventKind: string, detail: Record<string, unknown>) {
  const stateDigest = signalSemanticContextProposalDigestV1({ run_id: run.id, transition_key: transitionKey,
    event_kind: eventKind, detail });
  await queryable.query(`INSERT INTO signal_semantic_context_proposal_run_events(
    workspace_id,run_id,transition_key,event_kind,state_digest,detail)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb) ON CONFLICT(run_id,transition_key) DO NOTHING`,
  [run.workspace_id, run.id, transitionKey, eventKind, stateDigest, JSON.stringify(detail)]);
}

function lineageMatches(generation: GenerationRow,
  configuration: SignalSemanticContextProposalRuntimeConfigurationV1) {
  return generation.proposal_model === configuration.model
    && generation.proposal_model_version === configuration.model_version
    && generation.proposal_prompt_digest === SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1
    && generation.proposal_pricing_version === configuration.pricing_version;
}

function configurationReservation(configuration: SignalSemanticContextProposalRuntimeConfigurationV1) {
  return signalSemanticContextProposalCostMicroUsdV1({ input_tokens: configuration.max_input_tokens,
    output_tokens: configuration.max_output_tokens,
    input_usd_per_million_tokens: configuration.input_usd_per_million_tokens,
    output_usd_per_million_tokens: configuration.output_usd_per_million_tokens });
}

function publicRun(run: RunRow) {
  return { contract_version: "signal-semantic-context-proposal-run-v1", run_key: run.run_key,
    status: run.status, progress: run.status === "queued" ? 0 : run.status === "processing" ? 35
      : run.status === "validating" ? 70 : run.status === "completed" ? 100 : null,
    generation_ref: sha256(run.generation_id), provider: { key: run.provider, model: run.model,
      model_version: run.model_version, pricing_version: run.pricing_version },
    budget: { hard_cap_micro_usd: run.hard_cap_micro_usd,
      reservation_micro_usd: run.reservation_micro_usd, settled_micro_usd: run.settled_micro_usd },
    provider_call_count: run.provider_call_count, proposal_count: run.proposal_count,
    result_digest: run.result_digest, error: run.error_code ? { code: run.error_code,
      message: run.error_summary } : null, queued_at: new Date(run.queued_at).toISOString(),
    started_at: run.started_at ? new Date(run.started_at).toISOString() : null,
    completed_at: run.completed_at ? new Date(run.completed_at).toISOString() : null };
}

function assertActor(actor: SignalSemanticContextProposalActorV1) {
  if (actor.user_type !== "noisia_internal") {
    throw new SignalSemanticContextProposalExecutionError("semantic_context_forbidden", 403);
  }
}

function canonicalRefs(refs: Array<{ source_type: string; source_id: string; relation_type: string }>) {
  return [...new Map(refs.map((ref) => [`${ref.source_type}:${ref.source_id}:${ref.relation_type}`, ref])).values()]
    .sort((a, b) => a.source_type.localeCompare(b.source_type)
      || a.source_id.localeCompare(b.source_id) || a.relation_type.localeCompare(b.relation_type));
}

function shortHash(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function safeError(error: unknown) {
  const code = error instanceof SignalSemanticContextProposalExecutionError ? error.code
    : error instanceof Error && error.name === "ZodError" ? "semantic_context_provider_response_invalid"
      : "semantic_context_proposal_validation_failed";
  return { code, summary: code.replaceAll("_", " ").slice(0, 300) };
}

function isAuthorityDrift(error: unknown): error is SignalSemanticContextProposalExecutionError {
  return error instanceof SignalSemanticContextProposalExecutionError
    && ["brand_os_drift", "knowledge_drift", "locale_market_drift"].includes(error.code);
}

const runSelect = `SELECT run.id::text,run.workspace_id::text,run.generation_id::text,run.run_key,
  run.status,run.preflight_digest,run.brand_os_digest,run.knowledge_digest,run.locale_context_digest,
  run.prompt_digest,run.context_input_digest,run.provider,run.model,run.model_version,run.pricing_version,
  run.max_input_tokens,run.max_output_tokens,run.input_usd_per_million_tokens::text,
  run.output_usd_per_million_tokens::text,run.hard_cap_micro_usd::text,
  run.reservation_micro_usd::text,run.provider_request_identity,run.provider_request_id,
  run.provider_call_state,run.provider_call_count,run.provider_response_private,
  run.provider_response_digest,run.input_tokens::text,run.output_tokens::text,run.settled_micro_usd::text,
  run.proposal_count,run.result_digest,run.attempt_count,run.lease_token::text,run.lease_expires_at,
  run.error_code,run.error_summary,run.created_by_user_id::text,run.queued_at,run.started_at,
  run.validating_at,run.completed_at,run.failed_at,run.stale_at,run.dead_lettered_at`;
