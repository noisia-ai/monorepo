import {
  buildSignalSemanticResolutionPreflightV2,
  loadSignalSemanticResolutionSelectionV2
} from "@noisia/db";
import {
  SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL,
  SIGNAL_SEMANTIC_RESOLUTION_PRICING_VERSION,
  SIGNAL_SEMANTIC_RESOLUTION_BATCH_INPUT_USD_PER_MILLION_TOKENS,
  SIGNAL_SEMANTIC_RESOLUTION_BATCH_OUTPUT_USD_PER_MILLION_TOKENS,
  SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
  SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
  estimateSignalSemanticResolutionCostV2,
  formatMicroUsd,
  signalSemanticResolutionSelectionDigestV2,
  signalSemanticStableHashV1
} from "@noisia/query-engine";
import { pool } from "@/lib/db";
import { loadSemanticResolutionRuntimeReadiness } from "@/lib/queue/data-os";

export function loadLatestWorkspaceSemanticResolution(workspaceId: string) {
  return pool.query(`
    WITH latest AS (
      SELECT run.* FROM signal_semantic_resolution_runs run
      WHERE run.workspace_id=$1::uuid ORDER BY run.created_at DESC,run.id DESC LIMIT 1
    ), item_counts AS (
      SELECT count(*) FILTER(WHERE item.provider_result_status='succeeded')::int succeeded,
        count(*) FILTER(WHERE item.provider_result_status='errored')::int errored,
        count(*) FILTER(WHERE item.provider_result_status='canceled')::int canceled,
        count(*) FILTER(WHERE item.provider_result_status='expired')::int expired
      FROM latest LEFT JOIN signal_semantic_resolution_run_items item ON item.run_id=latest.id
    ), child_rows AS (
      SELECT child.run_id,jsonb_agg(jsonb_build_object(
        'ordinal',child.ordinal,'status',child.status,'item_count',child.item_count,
        'completed_items',child.completed_items,'failed_items',child.failed_items,
        'provider_status',child.provider_batch_status,
        'estimated_cost_usd',child.estimated_cost_usd::text,
        'reserved_cost_usd',child.reserved_cost_usd::text,
        'actual_cost_usd',child.actual_cost_usd::text,'error_code',child.error_code,
        'started_at',child.started_at,'completed_at',child.completed_at,
        'updated_at',child.updated_at
      ) ORDER BY child.ordinal) AS children
      FROM signal_semantic_resolution_child_batches child
      JOIN latest ON latest.id=child.run_id GROUP BY child.run_id
    ), outbox AS (
      SELECT count(*) FILTER(WHERE item.status IN ('pending','dispatching','dispatched','failed'))::int active,
        count(*) FILTER(WHERE item.status='dead_letter')::int dead_letter
      FROM latest LEFT JOIN signal_semantic_resolution_child_outbox item ON item.run_id=latest.id
    )
    SELECT latest.id::text AS run_id,latest.status,latest.model_version,
      latest.pricing_version,latest.total_items,latest.completed_items,latest.failed_items,
      latest.child_batch_count,latest.completed_child_batch_count,
      latest.failed_child_batch_count,latest.canceled_child_batch_count,
      latest.estimated_cost_usd::text,latest.actual_cost_usd::text,
      latest.budget_cap_usd::text AS hard_cap_usd,
      greatest(COALESCE(latest.hard_cap_micro_usd,0)-COALESCE((
        SELECT sum(child.reserved_cost_micro_usd) FROM signal_semantic_resolution_child_batches child
        WHERE child.run_id=latest.id
      ),0),0)::text AS hard_cap_headroom_micro_usd,
      item_counts.succeeded AS provider_succeeded_items,item_counts.errored AS provider_errored_items,
      item_counts.canceled AS provider_canceled_items,item_counts.expired AS provider_expired_items,
      COALESCE(child_rows.children,'[]'::jsonb) AS children,
      outbox.active AS active_outbox_count,outbox.dead_letter AS dead_letter_count,
      latest.cancellation_requested_at::text,latest.next_policy_transition_at::text,
      latest.error_code,latest.created_at::text,latest.started_at::text,
      latest.completed_at::text,latest.updated_at::text
    FROM latest CROSS JOIN item_counts CROSS JOIN outbox
    LEFT JOIN child_rows ON child_rows.run_id=latest.id
  `,[workspaceId]).then((result)=>result.rows[0]??null);
}

export async function loadWorkspaceSemanticResolutionPreflight(args: {
  workspaceId: string;
  hardCapUsd: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await buildSignalSemanticResolutionPreflightV2(client, {
      workspace_id: args.workspaceId,
      hard_cap_usd: args.hardCapUsd
    });
    const recovery = await client.query<{
      recovery_ready: boolean;
      active_outbox_count: number;
      dead_letter_count: number;
    }>(`
      SELECT
        to_regprocedure('claim_signal_semantic_resolution_child_dispatch_v1(integer,integer,integer)') IS NOT NULL
          AND to_regprocedure('refresh_signal_semantic_resolution_parent_v1(uuid)') IS NOT NULL
          AND to_regprocedure('retry_signal_semantic_resolution_child_execution_v1(uuid,uuid,text)') IS NOT NULL
          AS recovery_ready,
        (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox
          WHERE workspace_id=$1::uuid
            AND status IN ('pending','dispatching','dispatched','failed')) AS active_outbox_count,
        (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox
          WHERE workspace_id=$1::uuid AND status='dead_letter') AS dead_letter_count
    `, [args.workspaceId]);
    await client.query("COMMIT");
    const runtime = await loadSemanticResolutionRuntimeReadiness();
    const recoveryState = recovery.rows[0] ?? {
      recovery_ready: false,
      active_outbox_count: 0,
      dead_letter_count: 0
    };
    const blockingReasons: string[] = [];
    if (result.data.unresolved_count === 0) blockingReasons.push("semantic_resolution_population_empty");
    if (!result.estimate.within_hard_cap) blockingReasons.push("semantic_resolution_hard_cap_insufficient");
    if (!runtime.queue_configured) blockingReasons.push("semantic_resolution_queue_unavailable");
    if (runtime.queue_paused) blockingReasons.push("semantic_resolution_queue_paused");
    if (!runtime.worker_alive) blockingReasons.push("semantic_resolution_worker_not_alive");
    if (!runtime.recovery_alive) blockingReasons.push("semantic_resolution_recovery_drainer_not_alive");
    if (!recoveryState.recovery_ready) blockingReasons.push("semantic_resolution_recovery_not_ready");
    if (Number(recoveryState.active_outbox_count)>0) blockingReasons.push("semantic_resolution_run_active");
    if (recoveryState.dead_letter_count > 0) blockingReasons.push("semantic_resolution_dead_letter_present");
    if (!process.env.ANTHROPIC_API_KEY?.trim()) blockingReasons.push("semantic_resolution_provider_authority_unavailable");
    const core = {
      contract_version: "signal-semantic-resolution-preflight-v2" as const,
      read_only: true as const,
      writes_performed: false as const,
      jobs_enqueued: 0 as const,
      provider_calls: 0 as const,
      spend_usd: "0.000000" as const,
      workspace_id: args.workspaceId,
      population: {
        generation: result.data.projection_generation,
        snapshot_digest: result.data.projection_snapshot_digest,
        population_digest: result.data.population_digest,
        reconciled_at: result.data.projection_reconciled_at
      },
      counts: {
        accepted_roots: result.data.accepted_root_count,
        quality_excluded: result.data.quality_excluded_count,
        quality_unknown: result.data.quality_unknown_count,
        incomplete_provenance: result.data.incomplete_provenance_count,
        retention_blocked: result.data.retention_blocked_count,
        retention_expired: result.data.retention_expired_count,
        retention_unknown: result.data.retention_unknown_count,
        licensing_unknown: result.data.licensing_unknown_count,
        licensing_denied: result.data.licensing_denied_count,
        licensing_expired: result.data.licensing_expired_count,
        llm_processing_eligible: result.data.llm_eligible_count,
        already_resolved: result.data.already_resolved_count,
        unresolved: result.data.unresolved_count,
        deterministic: result.data.deterministic_count,
        ambiguous: result.data.ambiguous_count,
        needs_context: result.data.needs_context_count
      },
      authority: {
        required_usage: "llm-processing" as const,
        governance_digest: result.data.governance_digest,
        next_policy_transition_at: result.data.next_policy_transition_at
      },
      provider: {
        provider: "anthropic" as const,
        model: SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL,
        pricing_version: SIGNAL_SEMANTIC_RESOLUTION_PRICING_VERSION,
        input_usd_per_million_tokens: SIGNAL_SEMANTIC_RESOLUTION_BATCH_INPUT_USD_PER_MILLION_TOKENS,
        output_usd_per_million_tokens: SIGNAL_SEMANTIC_RESOLUTION_BATCH_OUTPUT_USD_PER_MILLION_TOKENS
      },
      selection: {
        digest: result.data.selection_digest,
        character_count: result.data.selected_character_count
      },
      estimate: result.estimate,
      runtime: {
        ...runtime,
        recovery_ready: recoveryState.recovery_ready,
        active_outbox_count: Number(recoveryState.active_outbox_count),
        dead_letter_count: Number(recoveryState.dead_letter_count)
      },
      confirmation: {
        required: result.estimate.confirmation_required,
        threshold_usd: 40,
        hard_cap_operator_supplied: true
      },
      blocking_reasons: blockingReasons
    };
    const digestPayload = {
      ...core,
      runtime: {
        queue_configured: core.runtime.queue_configured,
        worker_alive: core.runtime.worker_alive,
        recovery_ready: core.runtime.recovery_ready,
        dead_letter_count: core.runtime.dead_letter_count
      }
    };
    return {
      ...core,
      ready: blockingReasons.length === 0,
      preflight_digest: signalSemanticStableHashV1(digestPayload)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function prepareWorkspaceSemanticResolutionV2(args: {
  workspaceId: string;
  requestedByUserId: string;
  hardCapUsd: string;
  preflightDigest: string;
  confirmationAccepted: boolean;
  idempotencyKey: string;
  supersedesRunId?: string | null;
}) {
  const publicPreflight = await loadWorkspaceSemanticResolutionPreflight({
    workspaceId: args.workspaceId,
    hardCapUsd: args.hardCapUsd
  });
  if (publicPreflight.preflight_digest !== args.preflightDigest) {
    throw new Error("semantic_resolution_preflight_changed");
  }
  if (!publicPreflight.ready) throw new Error("semantic_resolution_preflight_blocked");
  if (publicPreflight.confirmation.required && !args.confirmationAccepted) {
    return { state: "confirmation_required" as const, preflight: publicPreflight };
  }
  const requestDigest = signalSemanticStableHashV1({
    workspace_id: args.workspaceId,
    preflight_digest: args.preflightDigest,
    hard_cap_usd: publicPreflight.estimate.hard_cap_usd,
    confirmation_accepted: args.confirmationAccepted,
    supersedes_run_id: args.supersedesRunId ?? null
  });
  const idempotencyKey = signalSemanticStableHashV1({
    operation: "prepare-semantic-resolution-v2",
    supplied_key: args.idempotencyKey,
    workspace_id: args.workspaceId
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${args.workspaceId}:semantic-resolution-v2`
    ]);
    const authorized = await client.query<{ authorized: boolean }>(`
      SELECT signal_policy_actor_is_authorized($1::uuid,$2::uuid) AS authorized
    `, [args.workspaceId, args.requestedByUserId]);
    if (authorized.rows[0]?.authorized !== true) throw new Error("semantic_resolution_actor_unauthorized");
    const existing = await client.query<{
      id: string;
      request_digest: string;
      status: string;
      child_batch_count: number;
    }>(`
      SELECT id::text,request_digest,status,child_batch_count
      FROM signal_semantic_resolution_runs
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
      FOR UPDATE
    `, [args.workspaceId, idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_digest !== requestDigest) {
        throw new Error("semantic_resolution_idempotency_conflict");
      }
      await client.query("COMMIT");
      return { state: "already_prepared" as const, run: existing.rows[0], preflight: publicPreflight };
    }
    if (args.supersedesRunId) {
      const superseded = await client.query<{ status: string }>(`
        SELECT status FROM signal_semantic_resolution_runs
        WHERE id=$2::uuid AND workspace_id=$1::uuid AND status IN ('partial','failed','canceled')
        FOR SHARE
      `, [args.workspaceId, args.supersedesRunId]);
      if (!superseded.rows[0]) throw new Error("semantic_resolution_superseded_run_invalid");
    }
    const sealed = await buildSignalSemanticResolutionPreflightV2(client, {
      workspace_id: args.workspaceId,
      hard_cap_usd: args.hardCapUsd,
      provider_batch_item_limit: publicPreflight.estimate.provider_batch_item_limit
    });
    if (
      sealed.data.projection_snapshot_digest !== publicPreflight.population.snapshot_digest
      || sealed.data.population_digest !== publicPreflight.population.population_digest
      || sealed.data.governance_digest !== publicPreflight.authority.governance_digest
      || sealed.data.selection_digest !== publicPreflight.selection.digest
      || sealed.estimate.estimated_cost_micro_usd !== publicPreflight.estimate.estimated_cost_micro_usd
      || sealed.estimate.hard_cap_micro_usd !== publicPreflight.estimate.hard_cap_micro_usd
    ) throw new Error("semantic_resolution_authority_changed");
    const selection = await loadSignalSemanticResolutionSelectionV2(client, {
      workspace_id: args.workspaceId,
      projection_snapshot_digest: sealed.data.projection_snapshot_digest,
      population_digest: sealed.data.population_digest,
      governance_digest: sealed.data.governance_digest
    });
    if (
      selection.length !== sealed.data.unresolved_count
      || signalSemanticResolutionSelectionDigestV2(selection) !== sealed.data.selection_digest
    ) throw new Error("semantic_resolution_selection_changed");
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO signal_semantic_resolution_runs(
        workspace_id,requested_by_user_id,status,model_version,policy_key,policy_version,
        queue_digest,total_items,budget_threshold_usd,budget_cap_usd,estimated_cost_usd,
        over_budget_confirmed,projection_snapshot_digest,population_digest,governance_digest,
        pricing_version,input_usd_per_million_tokens,output_usd_per_million_tokens,
        preflight_digest,request_digest,idempotency_key,estimated_cost_micro_usd,
        hard_cap_micro_usd,provider_batch_item_limit,child_batch_count,supersedes_run_id,
        next_policy_transition_at
      ) VALUES(
        $1::uuid,$2::uuid,'queued',$3,$4,$5,$6,$7,40,$8::numeric,$9::numeric,
        $10,$11,$12,$13,$14,$15::numeric,$16::numeric,$17,$18,$19,$20::bigint,
        $21::bigint,$22,$23,$24::uuid,$25::timestamptz
      ) RETURNING id::text
    `, [
      args.workspaceId,
      args.requestedByUserId,
      publicPreflight.provider.model,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
      sealed.data.selection_digest,
      selection.length,
      publicPreflight.estimate.hard_cap_usd,
      publicPreflight.estimate.estimated_cost_usd,
      publicPreflight.confirmation.required,
      sealed.data.projection_snapshot_digest,
      sealed.data.population_digest,
      sealed.data.governance_digest,
      publicPreflight.provider.pricing_version,
      publicPreflight.provider.input_usd_per_million_tokens,
      publicPreflight.provider.output_usd_per_million_tokens,
      publicPreflight.preflight_digest,
      requestDigest,
      idempotencyKey,
      publicPreflight.estimate.estimated_cost_micro_usd,
      publicPreflight.estimate.hard_cap_micro_usd,
      publicPreflight.estimate.provider_batch_item_limit,
      publicPreflight.estimate.provider_batch_count,
      args.supersedesRunId ?? null,
      publicPreflight.authority.next_policy_transition_at
    ]);
    const runId = inserted.rows[0]?.id;
    if (!runId) throw new Error("semantic_resolution_run_not_created");
    const childInputs = buildChildInputs({
      selection,
      runId,
      workspaceId: args.workspaceId,
      contextCharacterCount: sealed.context_character_count,
      hardCapUsd: publicPreflight.estimate.hard_cap_usd,
      itemLimit: publicPreflight.estimate.provider_batch_item_limit,
      totalEstimatedMicroUsd: BigInt(publicPreflight.estimate.estimated_cost_micro_usd)
    });
    for (const child of childInputs) {
      const childResult = await client.query<{ id: string }>(`
        INSERT INTO signal_semantic_resolution_child_batches(
          run_id,workspace_id,ordinal,item_count,estimated_input_tokens,
          estimated_output_tokens,estimated_cost_usd,estimated_cost_micro_usd
        ) VALUES($1::uuid,$2::uuid,$3,$4,$5::bigint,$6::bigint,$7::numeric,$8::bigint)
        RETURNING id::text
      `, [
        runId,args.workspaceId,child.ordinal,child.items.length,
        child.estimatedInputTokens,child.estimatedOutputTokens,
        formatMicroUsd(child.estimatedCostMicroUsd),child.estimatedCostMicroUsd.toString()
      ]);
      const childId = childResult.rows[0]?.id;
      if (!childId) throw new Error("semantic_resolution_child_not_created");
      for (let offset = 0; offset < child.items.length; offset += 2_000) {
        const chunk = child.items.slice(offset, offset + 2_000);
        await client.query(`
          INSERT INTO signal_semantic_resolution_run_items(
            run_id,workspace_id,mention_id,context_hash,child_batch_id
          ) SELECT $1::uuid,$2::uuid,input.mention_id::uuid,input.context_hash,$3::uuid
          FROM jsonb_to_recordset($4::jsonb) input(mention_id text,context_hash text)
          ON CONFLICT(run_id,mention_id) DO NOTHING
        `, [runId,args.workspaceId,childId,JSON.stringify(chunk)]);
      }
      await client.query(`
        INSERT INTO signal_semantic_resolution_child_outbox(
          workspace_id,run_id,child_batch_id,status
        ) VALUES($1::uuid,$2::uuid,$3::uuid,'pending')
      `, [args.workspaceId,runId,childId]);
    }
    const persisted = await client.query<{
      item_count: number;
      child_count: number;
      outbox_count: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM signal_semantic_resolution_run_items WHERE run_id=$1::uuid) item_count,
        (SELECT count(*)::int FROM signal_semantic_resolution_child_batches WHERE run_id=$1::uuid) child_count,
        (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox WHERE run_id=$1::uuid) outbox_count
    `, [runId]);
    if (
      persisted.rows[0]?.item_count !== selection.length
      || persisted.rows[0]?.child_count !== childInputs.length
      || persisted.rows[0]?.outbox_count !== childInputs.length
    ) throw new Error("semantic_resolution_persistence_did_not_reconcile");
    await client.query(`
      INSERT INTO signal_semantic_resolution_run_events(
        workspace_id,run_id,action,actor_user_id,idempotency_key,details
      ) VALUES($1::uuid,$2::uuid,'prepared',$3::uuid,$4,
        jsonb_build_object('total_items',$5::int,'child_batch_count',$6::int,
          'estimated_cost_usd',$7::text,'hard_cap_usd',$8::text))
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING
    `,[args.workspaceId,runId,args.requestedByUserId,idempotencyKey,selection.length,
      childInputs.length,publicPreflight.estimate.estimated_cost_usd,
      publicPreflight.estimate.hard_cap_usd]);
    await client.query("COMMIT");
    return {
      state: "prepared" as const,
      run: {
        run_id: runId,
        status: "queued" as const,
        total_items: selection.length,
        child_batch_count: childInputs.length
      },
      preflight: publicPreflight
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelWorkspaceSemanticResolutionV2(args:{
  workspaceId:string;runId:string;actorUserId:string;idempotencyKey:string;
}){
  const key=signalSemanticStableHashV1({operation:"cancel-semantic-resolution-v2",
    workspace_id:args.workspaceId,run_id:args.runId,supplied_key:args.idempotencyKey});
  const result=await pool.query<{status:string}>(`
    SELECT request_cancel_signal_semantic_resolution_run_v1(
      $1::uuid,$2::uuid,$3::uuid,$4
    ) AS status
  `,[args.workspaceId,args.runId,args.actorUserId,key]);
  return {run_id:args.runId,status:result.rows[0]?.status??"unknown"};
}

export async function resumeWorkspaceSemanticResolutionChildV2(args:{
  workspaceId:string;runId:string;childOrdinal:number;actorUserId:string;idempotencyKey:string;
}){
  const key=signalSemanticStableHashV1({operation:"resume-semantic-resolution-child-v2",
    workspace_id:args.workspaceId,run_id:args.runId,child_ordinal:args.childOrdinal,
    supplied_key:args.idempotencyKey});
  const result=await pool.query<{replayed:boolean}>(`
    SELECT resumed.replayed FROM signal_semantic_resolution_child_batches child
    CROSS JOIN LATERAL resume_signal_semantic_resolution_child_v1(
      $1::uuid,$2::uuid,child.id,$3::uuid,$4
    ) resumed
    WHERE child.run_id=$2::uuid AND child.workspace_id=$1::uuid AND child.ordinal=$5::int
  `,[args.workspaceId,args.runId,args.actorUserId,key,args.childOrdinal]);
  if(!result.rows[0])throw new Error("semantic_resolution_child_not_found");
  return {run_id:args.runId,child_ordinal:args.childOrdinal,replayed:result.rows[0].replayed,status:"queued" as const};
}

function buildChildInputs(args: {
  selection: Awaited<ReturnType<typeof loadSignalSemanticResolutionSelectionV2>>;
  runId: string;
  workspaceId: string;
  contextCharacterCount: number;
  hardCapUsd: string;
  itemLimit: number;
  totalEstimatedMicroUsd: bigint;
}) {
  const raw = [] as Array<{
    ordinal: number;
    items: typeof args.selection;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    weight: bigint;
  }>;
  for (let offset = 0; offset < args.selection.length; offset += args.itemLimit) {
    const items = args.selection.slice(offset, offset + args.itemLimit);
    const estimate = estimateSignalSemanticResolutionCostV2({
      mention_count: items.length,
      mention_character_count: items.reduce((sum, item) => sum + item.character_count, 0),
      context_character_count: args.contextCharacterCount,
      hard_cap_usd: args.hardCapUsd,
      provider_batch_item_limit: args.itemLimit
    });
    raw.push({
      ordinal: raw.length + 1,
      items,
      estimatedInputTokens: estimate.estimated_input_tokens,
      estimatedOutputTokens: estimate.estimated_output_tokens,
      weight: BigInt(estimate.estimated_cost_micro_usd)
    });
  }
  const totalWeight = raw.reduce((sum, item) => sum + item.weight, 0n);
  let allocated = 0n;
  return raw.map((item, index) => {
    const estimatedCostMicroUsd = index === raw.length - 1
      ? args.totalEstimatedMicroUsd - allocated
      : totalWeight === 0n
        ? 0n
        : args.totalEstimatedMicroUsd * item.weight / totalWeight;
    allocated += estimatedCostMicroUsd;
    return { ...item, estimatedCostMicroUsd };
  });
}
