import type { Pool, PoolClient } from "pg";

import {
  buildSignalTopicEvaluationEnvelopeV1,
  parseSignalTopicEvaluationOutputV1,
  signalTopicEvaluationDigestV1,
  signalTopicEvaluationSucceededV1,
  stableSignalTopicEvaluationJsonV1,
  SIGNAL_TOPIC_EVALUATION_CONFIRMATION,
  SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION,
  SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
  type SignalTopicEvaluationEnvelopeV1,
  type SignalTopicEvaluationProviderV1
} from "@noisia/query-engine";

export type SignalTopicEvaluationActorV1 = { id: string; user_type: "noisia_internal" };
export type SignalTopicEvaluationConfigurationV1 = {
  enabled: boolean;
  credential_configured: boolean;
  pricing_configured: boolean;
  execution_configuration_complete: boolean;
  provider: "anthropic";
  model: string;
  pricing_version: string;
  max_input_tokens: number;
  max_output_tokens: number;
  input_usd_per_million_tokens: string;
  output_usd_per_million_tokens: string;
  hard_cap_micro_usd: bigint;
  estimated_input_tokens: number;
};
type Queryable = { query<T = Record<string, unknown>>(
  sql: string, values?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> };

export class SignalTopicEvaluationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export function signalTopicEvaluationConfigurationFromEnvV1(
  env: NodeJS.ProcessEnv = process.env
): SignalTopicEvaluationConfigurationV1 {
  const model=explicit(env.NOISIA_TOPIC_EVALUATION_MODEL);
  const pricingVersion=explicit(env.NOISIA_TOPIC_EVALUATION_PRICING_VERSION);
  const maxInputTokens=positiveInteger(env.NOISIA_TOPIC_EVALUATION_MAX_INPUT_TOKENS);
  const maxOutputTokens=positiveInteger(env.NOISIA_TOPIC_EVALUATION_MAX_OUTPUT_TOKENS);
  const inputRate=nonnegativeDecimal(env.NOISIA_TOPIC_EVALUATION_INPUT_USD_PER_MILLION);
  const outputRate=nonnegativeDecimal(env.NOISIA_TOPIC_EVALUATION_OUTPUT_USD_PER_MILLION);
  const hardCap=positiveBigInt(env.NOISIA_TOPIC_EVALUATION_HARD_CAP_MICRO_USD);
  const estimatedInputTokens=positiveInteger(env.NOISIA_TOPIC_EVALUATION_ESTIMATED_INPUT_TOKENS);
  const pricingConfigured=pricingVersion!==null&&inputRate!==null&&outputRate!==null;
  const executionConfigurationComplete=pricingConfigured&&model!==null&&maxInputTokens!==null
    &&maxOutputTokens!==null&&hardCap!==null&&estimatedInputTokens!==null;
  return {
    enabled: env.NOISIA_TOPIC_EVALUATION_ENABLED === "true",
    credential_configured: Boolean(env.ANTHROPIC_API_KEY),
    pricing_configured: pricingConfigured,
    execution_configuration_complete: executionConfigurationComplete,
    provider: "anthropic",
    model: model??"",
    pricing_version: pricingVersion??"",
    max_input_tokens: maxInputTokens??0,
    max_output_tokens: maxOutputTokens??0,
    input_usd_per_million_tokens: inputRate??"",
    output_usd_per_million_tokens: outputRate??"",
    hard_cap_micro_usd: hardCap??0n,
    estimated_input_tokens: estimatedInputTokens??0
  };
}

export async function prepareSignalTopicEvaluationDryRunV1(args: {
  queryable: Queryable; workspace_id: string; actor: SignalTopicEvaluationActorV1;
  configuration: SignalTopicEvaluationConfigurationV1;
}) {
  assertActor(args.actor);
  const envelope = await loadEnvelope(args.queryable, args.workspace_id, args.actor.id);
  const envelopeDigest = signalTopicEvaluationDigestV1(envelope);
  const complete=args.configuration.execution_configuration_complete;
  const estimated = complete?costMicroUsd(args.configuration.estimated_input_tokens,
    args.configuration.max_output_tokens, args.configuration):null;
  return {
    contract_version: "signal-topic-evaluation-preflight-v1" as const,
    execution_enabled: args.configuration.enabled,
    execution_configuration_complete: complete,
    credential_configured: args.configuration.credential_configured,
    product_provider_key_name: "ANTHROPIC_API_KEY" as const,
    provider: args.configuration.provider,
    model: complete?args.configuration.model:null,
    pricing_version: complete?args.configuration.pricing_version:null,
    input_usd_per_million_tokens: complete?args.configuration.input_usd_per_million_tokens:null,
    output_usd_per_million_tokens: complete?args.configuration.output_usd_per_million_tokens:null,
    envelope,
    envelope_digest: envelopeDigest,
    proposal_count: envelope.diagnostic_packet.proposal_count,
    historical_bertopic_proposals: 115 as const,
    one_call_max: 1 as const,
    retry_allowed: false as const,
    max_input_tokens: complete?args.configuration.max_input_tokens:null,
    max_output_tokens: complete?args.configuration.max_output_tokens:null,
    hard_cap_micro_usd: complete?args.configuration.hard_cap_micro_usd.toString():null,
    estimated_input_tokens: complete?args.configuration.estimated_input_tokens:null,
    estimated_max_cost_micro_usd: estimated?.toString()??null,
    success_minimum_candidates: 10 as const,
    topic_adoption: false as const,
    publication: false as const,
    serving: false as const
  };
}

export async function createSignalTopicEvaluationRunV1(args: {
  pool: Pick<Pool, "connect">; workspace_id: string; actor: SignalTopicEvaluationActorV1;
  idempotency_key: string; expected_envelope_digest: string; confirmation: string;
  hard_cap_micro_usd: bigint; configuration: SignalTopicEvaluationConfigurationV1;
}) {
  assertActor(args.actor);
  if (!args.configuration.enabled) throw new SignalTopicEvaluationError("topic_evaluation_disabled", 403);
  if(!args.configuration.pricing_configured){
    throw new SignalTopicEvaluationError("topic_evaluation_pricing_unconfigured",409);
  }
  if(!args.configuration.execution_configuration_complete){
    throw new SignalTopicEvaluationError("topic_evaluation_execution_configuration_incomplete",409);
  }
  if (!args.configuration.credential_configured) {
    throw new SignalTopicEvaluationError("topic_evaluation_product_provider_unavailable", 409);
  }
  if (args.confirmation !== SIGNAL_TOPIC_EVALUATION_CONFIRMATION) {
    throw new SignalTopicEvaluationError("topic_evaluation_confirmation_required", 422);
  }
  if (args.hard_cap_micro_usd <= 0n
      || args.hard_cap_micro_usd > args.configuration.hard_cap_micro_usd) {
    throw new SignalTopicEvaluationError("topic_evaluation_hard_cap_invalid", 422);
  }
  if (args.configuration.estimated_input_tokens > args.configuration.max_input_tokens) {
    throw new SignalTopicEvaluationError("topic_evaluation_input_token_ceiling_exceeded", 422);
  }
  const reservation = costMicroUsd(args.configuration.estimated_input_tokens,
    args.configuration.max_output_tokens, args.configuration);
  if (reservation > args.hard_cap_micro_usd) {
    throw new SignalTopicEvaluationError("topic_evaluation_hard_cap_insufficient", 422);
  }
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`signal-topic-evaluation:${args.workspace_id}`]);
    const duplicate = await client.query(`SELECT 1 FROM signal_topic_evaluation_runs
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`, [args.workspace_id, args.idempotency_key]);
    if ((duplicate.rowCount ?? 0) > 0) {
      throw new SignalTopicEvaluationError("topic_evaluation_idempotency_already_used", 409);
    }
    const envelope = await loadEnvelope(client, args.workspace_id, args.actor.id);
    const envelopeDigest = signalTopicEvaluationDigestV1(envelope);
    if (envelopeDigest !== args.expected_envelope_digest) {
      throw new SignalTopicEvaluationError("topic_evaluation_envelope_drift", 409);
    }
    const requestDigest = signalTopicEvaluationDigestV1({ envelope_digest: envelopeDigest,
      provider: args.configuration.provider, model: args.configuration.model,
      max_input_tokens: args.configuration.max_input_tokens,
      max_output_tokens: args.configuration.max_output_tokens,
      hard_cap_micro_usd: args.hard_cap_micro_usd.toString() });
    const requestIdentity = signalTopicEvaluationDigestV1({
      contract_version: "signal-topic-evaluation-provider-request-v1", request_digest: requestDigest
    });
    const runKey = `topic-evaluation-${requestIdentity.slice(7, 23)}`;
    const generation = await client.query<{ id: string }>(`SELECT id::text FROM signal_semantic_context_generations
      WHERE workspace_id=$1::uuid AND generation_key=$2`,
    [args.workspace_id, envelope.semantic_context.generation_key]);
    const inserted = await client.query<{ id: string }>(`INSERT INTO signal_topic_evaluation_runs(
      workspace_id,requested_by_user_id,idempotency_key,run_key,input_contract_version,
      output_contract_version,corpus_identity,discovery_run_digest,source_manifest_digest,
      rights_digest,modeling_count,packet_digest,packet_proposal_count,packet_evidence_count,
      semantic_context_generation_id,semantic_context_generation_key,semantic_context_authority_digest,
      brand_os_digest,knowledge_digest,locale_context_digest,candidate_pack_digest,approved_context_count,
      envelope_digest,request_digest,provider,model,pricing_version,max_input_tokens,max_output_tokens,
      input_usd_per_million_tokens,output_usd_per_million_tokens,
      hard_cap_micro_usd,reservation_micro_usd,provider_request_identity)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::uuid,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING id::text`, [
      args.workspace_id,args.actor.id,args.idempotency_key,runKey,SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION,
      SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,envelope.corpus.identity,
      envelope.corpus.discovery_run_digest,envelope.corpus.source_manifest_digest,envelope.corpus.rights_digest,
      envelope.corpus.modeling_count,envelope.diagnostic_packet.packet_digest,115,
      envelope.diagnostic_packet.evidence_count,generation.rows[0]!.id,
      envelope.semantic_context.generation_key,envelope.semantic_context.generation_authority_digest,
      envelope.semantic_context.brand_os_digest,envelope.semantic_context.knowledge_digest,
      envelope.semantic_context.locale_context_digest,envelope.semantic_context.candidate_pack_digest,
      envelope.semantic_context.approved_count,envelopeDigest,requestDigest,args.configuration.provider,
      args.configuration.model,args.configuration.pricing_version,args.configuration.max_input_tokens,
      args.configuration.max_output_tokens,args.configuration.input_usd_per_million_tokens,
      args.configuration.output_usd_per_million_tokens,args.hard_cap_micro_usd.toString(),
      reservation.toString(),requestIdentity
    ]);
    const runId = inserted.rows[0]!.id;
    const evidence = uniqueEvidence(envelope);
    for (const item of evidence) {
      await client.query(`INSERT INTO signal_topic_evaluation_input_evidence(
        run_id,workspace_id,evidence_ref_digest,mention_ref_digest,relation)
        VALUES($1::uuid,$2::uuid,$3,$4,$5)`, [runId,args.workspace_id,item.evidence_ref_digest,
      item.mention_ref_digest,item.relation]);
    }
    const reservationDigest = signalTopicEvaluationDigestV1({ run_id: runId,
      reservation_micro_usd: reservation.toString() });
    await client.query(`INSERT INTO signal_topic_evaluation_reservations(
      run_id,workspace_id,reserved_micro_usd,reservation_digest) VALUES($1::uuid,$2::uuid,$3,$4)`,
    [runId,args.workspace_id,reservation.toString(),reservationDigest]);
    await client.query(`INSERT INTO signal_topic_evaluation_outbox(
      run_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)`,
    [runId,args.workspace_id,`topic-evaluation-${runId}`]);
    await insertEvent(client,runId,args.workspace_id,0,"queued",{ provider_calls: 0 });
    await client.query("COMMIT");
    return { run_id: runId, run_key: runKey, status: "queued" as const,
      envelope_digest: envelopeDigest, provider_call_count: 0 as const };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function processSignalTopicEvaluationRunV1(args: {
  pool: Pick<Pool, "connect">; run_id: string; provider: SignalTopicEvaluationProviderV1;
  execution_enabled?: boolean;
}) {
  if (args.execution_enabled !== true) {
    throw new SignalTopicEvaluationError("topic_evaluation_disabled", 403);
  }
  const client = await args.pool.connect();
  let run: RunRow;
  let envelope: SignalTopicEvaluationEnvelopeV1;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const selected = await client.query<RunRow>(`SELECT * FROM signal_topic_evaluation_runs
      WHERE id=$1::uuid FOR UPDATE`, [args.run_id]);
    run = selected.rows[0]!;
    if (!run) throw new SignalTopicEvaluationError("topic_evaluation_run_not_found", 404);
    if (run.status !== "queued" || run.provider_call_count !== 0 || run.provider_call_state !== "not_started") {
      throw new SignalTopicEvaluationError("topic_evaluation_run_not_executable", 409);
    }
    envelope = await loadEnvelope(client,run.workspace_id,run.requested_by_user_id);
    if (signalTopicEvaluationDigestV1(envelope) !== run.envelope_digest) {
      throw new SignalTopicEvaluationError("topic_evaluation_envelope_drift", 409);
    }
    await client.query(`UPDATE signal_topic_evaluation_runs SET status='in_flight',
      provider_call_state='in_flight',provider_call_count=1,started_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=$1::uuid`, [run.id]);
    await client.query(`UPDATE signal_topic_evaluation_outbox SET status='dispatched',dispatch_count=1,
      dispatched_at=clock_timestamp() WHERE run_id=$1::uuid AND dispatch_count=0`, [run.id]);
    await insertEvent(client,run.id,run.workspace_id,1,"provider_started",{ provider_calls: 1 });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }

  let response: Awaited<ReturnType<SignalTopicEvaluationProviderV1["generate"]>>;
  try {
    response = await args.provider.generate({ model: run!.model,
      prompt: buildPrompt(envelope!), max_output_tokens: run!.max_output_tokens,
      request_identity: run!.provider_request_identity });
  } catch (error) {
    await markAmbiguous(args.pool,run!.id,"topic_evaluation_provider_outcome_unknown");
    throw new SignalTopicEvaluationError("topic_evaluation_provider_outcome_unknown", 409);
  }
  return persistAndFinalize(args.pool,run!,envelope!,response);
}

export async function recoverSignalTopicEvaluationRunV1(args: {
  pool: Pick<Pool, "connect">; run_id: string;
}) {
  const client = await args.pool.connect();
  try {
    const selected = await client.query<RunRow>(`SELECT * FROM signal_topic_evaluation_runs WHERE id=$1::uuid`,
    [args.run_id]);
    const run = selected.rows[0];
    if (!run) throw new SignalTopicEvaluationError("topic_evaluation_run_not_found",404);
    if (run.status === "outcome_unknown" || run.provider_call_state === "in_flight") {
      return { status: "blocked" as const, provider_call_count: run.provider_call_count,
        reason: "topic_evaluation_provider_outcome_unknown" as const };
    }
    if (run.status === "response_persisted" && run.provider_response_private) {
      const envelope = await loadEnvelope(client,run.workspace_id,run.requested_by_user_id);
      return persistFinalizedResponse(args.pool,run,envelope);
    }
    return { status: run.status, provider_call_count: run.provider_call_count };
  } finally { client.release(); }
}

async function persistAndFinalize(pool: Pick<Pool,"connect">,run: RunRow,
  envelope: SignalTopicEvaluationEnvelopeV1,response: Awaited<ReturnType<SignalTopicEvaluationProviderV1["generate"]>>) {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const digest=signalTopicEvaluationDigestV1(response.text);
    await client.query(`UPDATE signal_topic_evaluation_runs SET status='response_persisted',
      provider_call_state='response_persisted',provider_response_private=$2,provider_response_digest=$3,
      provider_request_id=$4,input_tokens=$5,output_tokens=$6,updated_at=clock_timestamp()
      WHERE id=$1::uuid AND provider_call_count=1 AND provider_call_state='in_flight'`,
    [run.id,response.text,digest,response.provider_request_id,response.usage.input_tokens,response.usage.output_tokens]);
    await insertEvent(client,run.id,run.workspace_id,2,"response_persisted",{ response_digest:digest });
    await client.query("COMMIT");
    run={...run,status:"response_persisted",provider_call_state:"response_persisted",
      provider_response_private:response.text,provider_response_digest:digest,
      input_tokens:response.usage.input_tokens,output_tokens:response.usage.output_tokens};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  return persistFinalizedResponse(pool,run,envelope);
}

async function persistFinalizedResponse(pool: Pick<Pool,"connect">,run: RunRow,
  envelope: SignalTopicEvaluationEnvelopeV1){
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const locked=await client.query<RunRow>(`SELECT * FROM signal_topic_evaluation_runs WHERE id=$1::uuid FOR UPDATE`,[run.id]);
    run=locked.rows[0]!;
    if(run.status!=="response_persisted"||!run.provider_response_private){
      throw new SignalTopicEvaluationError("topic_evaluation_response_not_recoverable",409);
    }
    const live=await loadEnvelope(client,run.workspace_id,run.requested_by_user_id);
    if(signalTopicEvaluationDigestV1(live)!==run.envelope_digest){
      throw new SignalTopicEvaluationError("topic_evaluation_envelope_drift",409);
    }
    let output;
    try{output=parseSignalTopicEvaluationOutputV1(run.provider_response_private,envelope);}
    catch(error){
      const actual=costMicroUsd(run.input_tokens??0,run.output_tokens??0,run);
      await settleFailure(client,run,actual,"topic_evaluation_provider_output_invalid");
      await client.query("COMMIT");
      throw new SignalTopicEvaluationError("topic_evaluation_provider_output_invalid",422);
    }
    for(const candidate of output.candidates){
      const candidateDigest=signalTopicEvaluationDigestV1(candidate);
      const inserted=await client.query<{id:string}>(`INSERT INTO signal_topic_evaluation_candidates(
        run_id,workspace_id,candidate_key,title,description,inclusion,exclusion,source_proposal_keys,candidate_digest)
        VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::jsonb,$8::text[],$9) RETURNING id::text`,
      [run.id,run.workspace_id,candidate.candidate_key,candidate.title,candidate.description,
      JSON.stringify(candidate.inclusion),JSON.stringify(candidate.exclusion),candidate.source_proposal_keys,candidateDigest]);
      for(const evidenceRef of candidate.evidence_refs){
        await client.query(`INSERT INTO signal_topic_evaluation_candidate_evidence(
          candidate_id,run_id,workspace_id,evidence_ref_digest) VALUES($1::uuid,$2::uuid,$3::uuid,$4)`,
        [inserted.rows[0]!.id,run.id,run.workspace_id,evidenceRef]);
      }
    }
    const actual=costMicroUsd(run.input_tokens??0,run.output_tokens??0,run);
    if(actual>BigInt(run.reservation_micro_usd))throw new SignalTopicEvaluationError("topic_evaluation_settlement_exceeds_reservation",500);
    const outputDigest=signalTopicEvaluationDigestV1(output);
    const rubricMet=signalTopicEvaluationSucceededV1(output);
    await client.query(`UPDATE signal_topic_evaluation_reservations SET status='settled',actual_micro_usd=$2,
      input_tokens=$3,output_tokens=$4,settled_at=clock_timestamp() WHERE run_id=$1::uuid`,
    [run.id,actual.toString(),run.input_tokens,run.output_tokens]);
    await client.query(`UPDATE signal_topic_evaluation_runs SET status='completed',provider_call_state='settled',
      settled_micro_usd=$2,output_digest=$3,candidate_count=$4,rubric_met=$5,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
    [run.id,actual.toString(),outputDigest,output.candidates.length,rubricMet]);
    await client.query(`UPDATE signal_topic_evaluation_outbox SET status='completed',completed_at=clock_timestamp()
      WHERE run_id=$1::uuid`,[run.id]);
    await insertEvent(client,run.id,run.workspace_id,3,"completed",{candidate_count:output.candidates.length,rubric_met:rubricMet});
    await client.query("COMMIT");
    return{status:"completed" as const,provider_call_count:1 as const,candidate_count:output.candidates.length,
      rubric_met:rubricMet,topic_adoption:false as const,publication:false as const,serving:false as const};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}

async function loadEnvelope(queryable: Queryable,workspaceId:string,actorId:string){
  const authority=await queryable.query<AuthorityRow>(`WITH packet AS(
    SELECT packet.*,artifact.artifact_key FROM signal_topic_discovery_review_packets packet
    JOIN analysis_artifacts artifact ON artifact.id=packet.artifact_id
    WHERE packet.workspace_id=$1::uuid ORDER BY packet.registered_at DESC LIMIT 1
  ),generation AS(
    SELECT generation.* FROM signal_semantic_context_generations generation
    WHERE generation.workspace_id=$1::uuid AND generation.status='draft'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
        WHERE successor.workspace_id=generation.workspace_id AND successor.supersedes_generation_id=generation.id)
    ORDER BY generation.generation_version DESC LIMIT 1
  ),leaves AS(
    SELECT element.* FROM signal_semantic_context_element_versions element,generation
    WHERE element.workspace_id=$1::uuid AND element.generation_id=generation.id
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)
  ) SELECT packet.artifact_id::text packet_artifact_id,packet.artifact_key corpus_identity,
    packet.discovery_run_digest,packet.source_manifest_digest,packet.rights_digest,
    packet.modeling_denominator,packet.packet_digest,packet.proposal_count,packet.evidence_count,
    generation.id::text generation_id,generation.generation_key,generation.brand_os_digest,
    generation.knowledge_digest,generation.locale_context_digest,
    encode(digest(convert_to(string_agg(element_digest,E'\\n' ORDER BY element_key),'UTF8'),'sha256'),'hex') pack_hex,
    count(*) FILTER(WHERE disposition='approved' AND lifecycle_state='active')::int approved_count
    FROM packet,generation,leaves
    WHERE signal_data_governance_actor_is_valid($1::uuid,$2::uuid)
    GROUP BY packet.artifact_id,packet.artifact_key,packet.discovery_run_digest,packet.source_manifest_digest,
      packet.rights_digest,packet.modeling_denominator,packet.packet_digest,packet.proposal_count,
      packet.evidence_count,generation.id,generation.generation_key,generation.brand_os_digest,
      generation.knowledge_digest,generation.locale_context_digest`,[workspaceId,actorId]);
  const row=authority.rows[0];
  if(!row||row.proposal_count!==115||row.approved_count<1){
    throw new SignalTopicEvaluationError("topic_evaluation_input_authority_unavailable",409);
  }
  const proposals=await queryable.query<ProposalRow>(`SELECT proposal.artifact_key proposal_key,
    COALESCE(proposal.title,proposal.artifact_key) title,
    'sha256:'||encode(digest(convert_to(proposal.content::text,'UTF8'),'sha256'),'hex') content_digest,
    jsonb_build_object(
      'cluster_member_count',CASE WHEN (proposal.content->>'cluster_member_count')~'^[0-9]+$'
        THEN (proposal.content->>'cluster_member_count')::int ELSE 0 END,
      'coverage',CASE WHEN (proposal.content->>'coverage')~'^(0|1|0?\\.[0-9]+)$'
        THEN (proposal.content->>'coverage')::numeric ELSE 0 END,
      'local_terms',CASE WHEN jsonb_typeof(proposal.content->'local_terms')='array'
        THEN (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM
          jsonb_array_elements(proposal.content->'local_terms') WITH ORDINALITY item(value,ordinal)
          WHERE jsonb_typeof(value)='string' AND ordinal<=40) ELSE '[]'::jsonb END,
      'local_phrases',CASE WHEN jsonb_typeof(proposal.content->'local_phrases')='array'
        THEN (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM
          jsonb_array_elements(proposal.content->'local_phrases') WITH ORDINALITY item(value,ordinal)
          WHERE jsonb_typeof(value)='string' AND ordinal<=24) ELSE '[]'::jsonb END,
      'scope_labels',COALESCE((SELECT jsonb_agg(scope_key ORDER BY scope_key) FROM
        jsonb_object_keys(CASE WHEN jsonb_typeof(proposal.content->'distributions'->'scope')='object'
          THEN proposal.content->'distributions'->'scope' ELSE '{}'::jsonb END) scope_key),'[]'::jsonb),
      'limitations',CASE WHEN jsonb_typeof(proposal.content->'limitations')='array'
        THEN (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM
          jsonb_array_elements(proposal.content->'limitations') WITH ORDINALITY item(value,ordinal)
          WHERE jsonb_typeof(value)='string' AND ordinal<=12) ELSE '[]'::jsonb END) signals,
    COALESCE(jsonb_agg(jsonb_build_object(
      'evidence_ref_digest','sha256:'||encode(digest(convert_to(COALESCE(link.locator->>'evidence_ref',link.id::text),'UTF8'),'sha256'),'hex'),
      'mention_ref_digest','sha256:'||encode(digest(convert_to(link.source_id::text,'UTF8'),'sha256'),'hex'),
      'relation',CASE WHEN link.relation_type IN('supports','limits','contradicts') THEN link.relation_type ELSE 'supports' END)
      ORDER BY link.position) FILTER(WHERE link.id IS NOT NULL),'[]'::jsonb) evidence
    FROM analysis_artifact_relations relation
    JOIN analysis_artifacts proposal ON proposal.id=relation.target_artifact_id
    LEFT JOIN analysis_evidence_groups evidence_group ON evidence_group.artifact_id=proposal.id
    LEFT JOIN analysis_evidence_links link ON link.evidence_group_id=evidence_group.id
    WHERE relation.source_artifact_id=$1::uuid AND relation.relation_type='contains_proposal'
    GROUP BY proposal.id,proposal.artifact_key,proposal.title,proposal.content
    ORDER BY proposal.artifact_key`,[row.packet_artifact_id]);
  if(proposals.rows.length!==115)throw new SignalTopicEvaluationError("topic_evaluation_packet_incomplete",409);
  const contexts=await queryable.query<ContextElementRow>(`SELECT element.element_key,
    element.element_kind,element.display_text,COALESCE(element.scope,'workspace') scope,
    element.locale,element.relation_kind,element.relation_target_key,element.source_refs_digest,
    count(link.id)::int evidence_count
    FROM signal_semantic_context_element_versions element
    LEFT JOIN analysis_evidence_links link ON link.evidence_group_id=element.evidence_group_id
    WHERE element.generation_id=$1::uuid AND element.disposition='approved'
      AND element.lifecycle_state='active'
      AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_element_versions successor
        WHERE successor.supersedes_element_id=element.id)
    GROUP BY element.id ORDER BY element.element_key`,[row.generation_id]);
  if(contexts.rows.length!==row.approved_count){
    throw new SignalTopicEvaluationError("topic_evaluation_context_incomplete",409);
  }
  const generationAuthority=signalTopicEvaluationDigestV1({generation_key:row.generation_key,
    brand_os_digest:row.brand_os_digest,knowledge_digest:row.knowledge_digest,
    locale_context_digest:row.locale_context_digest,candidate_pack_digest:`sha256:${row.pack_hex}`});
  return buildSignalTopicEvaluationEnvelopeV1({contract_version:SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION,
    corpus:{identity:row.corpus_identity,discovery_run_digest:row.discovery_run_digest,
      source_manifest_digest:row.source_manifest_digest,rights_digest:row.rights_digest,
      modeling_count:row.modeling_denominator},
    semantic_context:{generation_key:row.generation_key,generation_authority_digest:generationAuthority,
      brand_os_digest:row.brand_os_digest,knowledge_digest:row.knowledge_digest,
      locale_context_digest:row.locale_context_digest,candidate_pack_digest:`sha256:${row.pack_hex}`,
      approved_count:row.approved_count,context_elements:contexts.rows},
    diagnostic_packet:{packet_digest:row.packet_digest,proposal_count:115,
      evidence_count:row.evidence_count,proposals:proposals.rows.map((proposal)=>({
        proposal_key:proposal.proposal_key,title:proposal.title,content_digest:proposal.content_digest,
        signals:proposal.signals,evidence:proposal.evidence}))}});
}

function buildPrompt(envelope: SignalTopicEvaluationEnvelopeV1){return [
  "Return strict JSON matching signal-topic-evaluation-output-v1.",
  "Produce editable diagnostic Topic candidates, not Topic Contracts and not publication decisions.",
  "Every candidate must cite only evidence_ref_digest and source proposal keys in this envelope.",
  stableSignalTopicEvaluationJsonV1(envelope)
].join("\n\n");}

function uniqueEvidence(envelope:SignalTopicEvaluationEnvelopeV1){const values=new Map<string,
  SignalTopicEvaluationEnvelopeV1["diagnostic_packet"]["proposals"][number]["evidence"][number]>();
  for(const item of envelope.diagnostic_packet.proposals.flatMap((proposal)=>proposal.evidence)){
    const prior=values.get(item.evidence_ref_digest);
    if(prior&&(prior.mention_ref_digest!==item.mention_ref_digest||prior.relation!==item.relation)){
      throw new SignalTopicEvaluationError("topic_evaluation_evidence_ref_conflict",422);
    }values.set(item.evidence_ref_digest,item);
  }return[...values.values()];}

async function insertEvent(queryable:Queryable,runId:string,workspaceId:string,eventIndex:number,eventKind:string,detail:unknown){
  await queryable.query(`INSERT INTO signal_topic_evaluation_events(
    run_id,workspace_id,event_index,event_kind,state_digest) VALUES($1::uuid,$2::uuid,$3,$4,$5)`,
  [runId,workspaceId,eventIndex,eventKind,signalTopicEvaluationDigestV1({event_kind:eventKind,detail})]);}

async function markAmbiguous(pool:Pick<Pool,"connect">,runId:string,errorCode:string){const client=await pool.connect();try{
  await client.query("BEGIN");await client.query(`UPDATE signal_topic_evaluation_runs SET status='outcome_unknown',
    error_code=$2,failed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid AND provider_call_count=1`,[runId,errorCode]);
  await client.query(`UPDATE signal_topic_evaluation_reservations SET status='ambiguous' WHERE run_id=$1::uuid`,[runId]);
  await client.query(`UPDATE signal_topic_evaluation_outbox SET status='dead_letter',error_code=$2 WHERE run_id=$1::uuid`,[runId,errorCode]);
  const run=await client.query<{workspace_id:string}>(`SELECT workspace_id::text FROM signal_topic_evaluation_runs WHERE id=$1::uuid`,[runId]);
  await insertEvent(client,runId,run.rows[0]!.workspace_id,2,"outcome_unknown",{error_code:errorCode});
  await client.query("COMMIT");}catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}}

async function settleFailure(client:PoolClient,run:RunRow,actual:bigint,errorCode:string){
  if(actual>BigInt(run.reservation_micro_usd))throw new SignalTopicEvaluationError("topic_evaluation_settlement_exceeds_reservation",500);
  await client.query(`UPDATE signal_topic_evaluation_reservations SET status='settled',actual_micro_usd=$2,
    input_tokens=$3,output_tokens=$4,settled_at=clock_timestamp() WHERE run_id=$1::uuid`,
  [run.id,actual.toString(),run.input_tokens,run.output_tokens]);
  await client.query(`UPDATE signal_topic_evaluation_runs SET status='failed',provider_call_state='settled',
    settled_micro_usd=$2,error_code=$3,failed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
  [run.id,actual.toString(),errorCode]);
  await client.query(`UPDATE signal_topic_evaluation_outbox SET status='dead_letter',error_code=$2 WHERE run_id=$1::uuid`,[run.id,errorCode]);
  await insertEvent(client,run.id,run.workspace_id,3,"failed",{error_code:errorCode});
}

function costMicroUsd(inputTokens:number,outputTokens:number,config:{input_usd_per_million_tokens:string;output_usd_per_million_tokens:string}){
  const input=decimalMicros(config.input_usd_per_million_tokens);const output=decimalMicros(config.output_usd_per_million_tokens);
  return(BigInt(inputTokens)*input+BigInt(outputTokens)*output+999_999n)/1_000_000n;}
function decimalMicros(value:string){const[whole="0",fraction=""]=value.split(".");return BigInt(whole)*1_000_000n+BigInt(fraction.padEnd(6,"0").slice(0,6));}
function explicit(value:string|undefined){return value&&value===value.trim()&&value.length>0?value:null;}
function positiveInteger(value:string|undefined){if(!value||!/^\d+$/u.test(value))return null;
  const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;}
function positiveBigInt(value:string|undefined){if(!value||!/^[1-9][0-9]*$/u.test(value))return null;
  const parsed=BigInt(value);return parsed<=9_223_372_036_854_775_807n?parsed:null;}
function nonnegativeDecimal(value:string|undefined){return value&&/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u.test(value)
  ?value:null;}
function assertActor(actor:SignalTopicEvaluationActorV1){if(actor.user_type!=="noisia_internal")throw new SignalTopicEvaluationError("topic_evaluation_forbidden",403);}

type AuthorityRow={packet_artifact_id:string;corpus_identity:string;discovery_run_digest:string;
  source_manifest_digest:string;rights_digest:string;modeling_denominator:number;packet_digest:string;
  proposal_count:number;evidence_count:number;generation_id:string;generation_key:string;
  brand_os_digest:string;knowledge_digest:string;locale_context_digest:string;pack_hex:string;approved_count:number};
type ProposalRow={proposal_key:string;title:string;content_digest:string;
  signals:SignalTopicEvaluationEnvelopeV1["diagnostic_packet"]["proposals"][number]["signals"];
  evidence:SignalTopicEvaluationEnvelopeV1["diagnostic_packet"]["proposals"][number]["evidence"]};
type ContextElementRow=SignalTopicEvaluationEnvelopeV1["semantic_context"]["context_elements"][number];
type RunRow={id:string;workspace_id:string;requested_by_user_id:string;status:string;model:string;
  max_output_tokens:number;provider_request_identity:string;provider_call_state:string;provider_call_count:number;
  provider_response_private:string|null;provider_response_digest:string|null;envelope_digest:string;
  input_tokens:number|null;output_tokens:number|null;reservation_micro_usd:string;
  input_usd_per_million_tokens:string;output_usd_per_million_tokens:string};
