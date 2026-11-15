import { signalWorkspaceEmbeddingDigestV1 as digest } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";
type Client = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };
type Generation = { id: string; workspace_id: string; map_id: string; configuration_id: string; preparation_run_id: string };
type Study = { id: string; workspace_id: string; listening_source_round_id: string };
type Event = { ledger: string; call_id: string; stage: string; status: string; settled_micro_usd: string | null;
  reserved_micro_usd: string | null; started_at: Date | string | null; ended_at: Date | string | null; timing_granularity: "call" | "run" };

export type NativeListeningRoundPathRowV1 = { id: string; ordinal: number; input_generation_id: string;
  output_generation_id: string | null; status: string };

export function nativeListeningRoundPathV1<T extends NativeListeningRoundPathRowV1>(args: { initial_generation_id: string; before_generation_id: string;
  after_generation_id: string; after_round_id: string; rounds: readonly T[] }):
  { rounds: T[]; generation_ids: string[]; before_generation_index: number; after_generation_index: number } | null {
  const { initial_generation_id: initial, before_generation_id: before, after_generation_id: after } = args;
  if (!initial || !before || !after || !args.after_round_id) return null;
  const rounds = [...args.rounds].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const path: T[] = [], generations = [initial];
  let cursor = initial, beforeIndex = initial === before ? 0 : -1, reachedAnchor = false;
  for (let i = 0; i < rounds.length && !reachedAnchor; i++) {
    const round = rounds[i]!;
    if (round.ordinal !== i + 1 || round.input_generation_id !== cursor || round.status !== "completed" || !round.output_generation_id
      ) return null;
    path.push(round);
    cursor = round.output_generation_id;
    generations.push(cursor);
    if (beforeIndex < 0 && cursor === before) beforeIndex = generations.length - 1;
    if (round.id === args.after_round_id) {
      if (cursor !== after || beforeIndex < 0 || beforeIndex >= generations.length - 1) return null;
      reachedAnchor = true;
    }
  }
  return reachedAnchor ? { rounds: path, generation_ids: generations, before_generation_index: beforeIndex,
    after_generation_index: generations.length - 1 } : null;
}

export function nativeWallSpanV1(intervals: Iterable<{ started_at: Date | string | number | null; ended_at: Date | string | number | null }>): number | null {
  let minStart = Number.POSITIVE_INFINITY, maxEnd = Number.NEGATIVE_INFINITY, count = 0;
  for (const interval of intervals) {
    if (interval.started_at === null || interval.ended_at === null) return null;
    const start = new Date(interval.started_at).getTime(), end = new Date(interval.ended_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, end);
    count++;
  }
  return count ? maxEnd - minStart : null;
}

export async function loadNativeReceiptEvidenceV1(client: Client, before: Generation, after: Generation, study: Study) {
  const events: Event[] = [], limitations = new Set<string>();
  const manifest: Record<string, unknown> = { contract_version: "r16-native-ledger-receipts-v1", deduplication: "ledger+call_id",
    generation_preparation_run_ids: [before.preparation_run_id, after.preparation_run_id] };
  const parents = (await client.query<{ id: string; workspace_id: string; map_id: string; initial_configuration_id: string;
    initial_generation_id: string; initial_classification_run_id: string; initial_preparation_id: string | null;
    configuration_digest: string; root_census_digest: string; root_count: number; status: string }>(`SELECT e.id,e.workspace_id,e.map_id,e.initial_configuration_id,
      e.initial_generation_id,e.initial_classification_run_id,e.initial_preparation_id,e.configuration_digest,e.root_census_digest,e.root_count,e.status
    FROM signal_listening_discovery_executions e WHERE e.workspace_id=$1 AND e.map_id=$2
      AND (e.initial_generation_id=$3 OR EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r WHERE r.execution_id=e.id AND (r.input_generation_id=$3 OR r.output_generation_id=$3)))
      AND (e.initial_generation_id=$4 OR EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r WHERE r.execution_id=e.id AND (r.input_generation_id=$4 OR r.output_generation_id=$4)))
    ORDER BY e.id LIMIT 2`, [before.workspace_id, before.map_id, before.id, after.id])).rows;
  let runIds: string[] = [], prepIds: string[] = [];
  if (parents.length !== 1) {
    limitations.add("listening_parent_missing_or_ambiguous"); manifest.listening_parent_match_count = parents.length;
  } else {
    const parent = parents[0]!;
    const rounds = (await client.query<{ id: string; ordinal: number; input_generation_id: string; output_generation_id: string | null;
      configuration_id: string; configuration_digest: string; source_digest: string; output_configuration_id: string | null; output_digest: string | null;
      classification_run_id: string | null; classification_preparation_id: string | null; status: string }>(`SELECT id,ordinal,input_generation_id,output_generation_id,
        configuration_id,configuration_digest,source_digest,output_configuration_id,output_digest,
        classification_run_id,classification_preparation_id,status FROM signal_listening_discovery_rounds
      WHERE workspace_id=$1 AND execution_id=$2 ORDER BY ordinal,id`, [before.workspace_id, parent.id])).rows;
    const verifiedPath = parent.workspace_id === before.workspace_id && parent.workspace_id === after.workspace_id
      && parent.map_id === before.map_id && parent.map_id === after.map_id
      ? nativeListeningRoundPathV1({ initial_generation_id: parent.initial_generation_id, before_generation_id: before.id,
        after_generation_id: after.id, after_round_id: study.listening_source_round_id, rounds }) : null;
    const path = verifiedPath?.rounds ?? [];
    let ancestryProofValid = false;
    if (verifiedPath) {
      const uniqueGenerationIds = [...new Set(verifiedPath.generation_ids)];
      const generationRows = (await client.query<{ id: string; workspace_id: string; map_id: string; configuration_id: string;
        configuration_digest: string; configuration: Record<string, unknown>; configuration_state: string;
        kind: string; status: string; snapshot_digest: string | null; actual_digest: string | null;
        source_current: boolean; census_digest: string; counts: { roots?: number } | null }>(`SELECT g.id,g.workspace_id,g.map_id,g.configuration_id,
          cfg.configuration_digest,cfg.configuration,cfg.state configuration_state,g.kind,g.status,g.snapshot_digest,
          signal_listening_discovery_digest_v1(g.id) actual_digest,
          signal_listening_discovery_source_current_v1(g.id) source_current,signal_listening_discovery_census_v1(g.id) census_digest,g.counts
        FROM signal_listening_discovery_generations g JOIN signal_listening_configurations cfg
          ON cfg.workspace_id=g.workspace_id AND cfg.id=g.configuration_id
        WHERE g.workspace_id=$1 AND g.id=ANY($2::uuid[]) ORDER BY g.id`, [before.workspace_id, uniqueGenerationIds])).rows;
      const generationById = new Map(generationRows.map(row => [row.id, row]));
      const initial = generationById.get(parent.initial_generation_id);
      ancestryProofValid = generationRows.length === uniqueGenerationIds.length
        && generationRows.every(row => row.workspace_id === before.workspace_id && row.map_id === before.map_id && row.status === "ready"
          && row.kind === "confirmed_members" && row.source_current && row.configuration_state === "published"
          && digest(row.configuration) === row.configuration_digest && row.snapshot_digest !== null && row.snapshot_digest === row.actual_digest)
        && !!initial && initial.configuration_id === parent.initial_configuration_id
        && initial.configuration_digest === parent.configuration_digest
        && initial.counts?.roots === parent.root_count && initial.census_digest === parent.root_census_digest
        && path.every(round => {
          const input = generationById.get(round.input_generation_id), output = generationById.get(round.output_generation_id!);
          return !!input && !!output && round.configuration_id === input.configuration_id
            && input.census_digest === parent.root_census_digest && output.census_digest === parent.root_census_digest
            && round.configuration_digest === input.configuration_digest && round.source_digest === input.snapshot_digest
            && round.output_configuration_id === output.configuration_id && round.output_digest === output.configuration_digest;
        });
    }
    if (!verifiedPath) limitations.add("listening_generation_path_incomplete");
    if (verifiedPath && !ancestryProofValid) limitations.add("listening_generation_ancestry_proof_invalid");
    const roundIds = path.map(item => item.id);
    const children = roundIds.length ? (await client.query<{ run_id: string; preparation_id: string | null }>(`SELECT run_id,preparation_id
      FROM signal_listening_discovery_children WHERE workspace_id=$1 AND execution_id=$2 AND round_id=ANY($3::uuid[]) ORDER BY run_id`,
    [before.workspace_id, parent.id, roundIds])).rows : [];
    runIds = [...new Set([parent.initial_classification_run_id, ...path.flatMap(r => r.classification_run_id ? [r.classification_run_id] : []), ...children.map(x => x.run_id)])];
    prepIds = [...new Set([...(parent.initial_preparation_id ? [parent.initial_preparation_id] : []),
      ...path.flatMap(r => r.classification_preparation_id ? [r.classification_preparation_id] : []),
      ...children.flatMap(x => x.preparation_id ? [x.preparation_id] : [])])];
    manifest.listening_parent = { id: parent.id, initial_generation_id: parent.initial_generation_id,
      initial_configuration_id: parent.initial_configuration_id, configuration_digest: parent.configuration_digest,
      root_count: parent.root_count, initial_classification_run_id: parent.initial_classification_run_id, status: parent.status,
      rounds: path.map(r => ({ id: r.id, ordinal: r.ordinal, input_generation_id: r.input_generation_id,
        output_generation_id: r.output_generation_id, configuration_id: r.configuration_id,
        configuration_digest: r.configuration_digest, source_digest: r.source_digest,
        output_configuration_id: r.output_configuration_id, output_digest: r.output_digest,
        status: r.status, classification_run_id: r.classification_run_id,
        classification_preparation_id: r.classification_preparation_id })), generation_path_complete: !!verifiedPath && ancestryProofValid,
      before_generation_index: verifiedPath?.before_generation_index ?? null,
      after_generation_index: verifiedPath?.after_generation_index ?? null,
      generation_ids: verifiedPath?.generation_ids ?? null, listening_source_round_id: study.listening_source_round_id,
      root_census_digest: parent.root_census_digest,
      child_run_count: children.length };
    if (parent.status !== "completed") limitations.add("listening_parent_not_completed");
    const roundCalls = roundIds.length ? (await client.query<{ id: string; call_state: string; settled_micro_usd: string | null;
      reserved_micro_usd: string; sent_at: Date | string | null; response_received_at: Date | string | null; listening_round_id: string }>(`SELECT id,call_state,
        settled_micro_usd::text,reserved_micro_usd::text,sent_at,response_received_at,listening_round_id FROM engine_cost_events
      WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1' AND listening_round_id=ANY($2::uuid[]) ORDER BY listening_round_id,id`,
    [before.workspace_id, roundIds])).rows : [];
    if (roundCalls.length !== roundIds.length) limitations.add("listening_sonnet_round_receipt_missing");
    for (const c of roundCalls) events.push({ ledger: "engine_cost_events", call_id: c.id, stage: "listening_sonnet_review", status: c.call_state,
      settled_micro_usd: c.settled_micro_usd, reserved_micro_usd: c.reserved_micro_usd, started_at: c.sent_at,
      ended_at: c.response_received_at, timing_granularity: "call" });
    const labelRows = runIds.length ? (await client.query<{ run_id: string; kind: string; run_status: string; run_created_at: Date | string;
      completed_at: Date | string | null; call_id: string | null; call_status: string | null; settled_micro_usd: string | null;
      reserved_micro_usd: string | null }>(`SELECT r.id run_id,r.kind,r.status run_status,r.created_at run_created_at,r.completed_at,c.id call_id,c.status call_status,
        c.settled_micro_usd::text,c.reserved_micro_usd::text FROM signal_labeling_runs r LEFT JOIN signal_labeling_calls c
        ON c.workspace_id=r.workspace_id AND c.run_id=r.id WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id,c.id`,
    [before.workspace_id, runIds])).rows : [];
    if (new Set(labelRows.map(r => r.run_id)).size !== runIds.length) limitations.add("listening_labeling_run_source_missing");
    for (const r of labelRows) {
      if (r.run_status !== "completed") limitations.add("listening_labeling_run_not_completed");
      if (!r.call_id) {
        if (r.run_status === "completed") events.push({ ledger: "signal_labeling_calls", call_id: `${r.run_id}:no-new-call`, stage: "listening_labeling",
          status: "completed_without_new_provider_call", settled_micro_usd: "0", reserved_micro_usd: "0",
          started_at: r.run_created_at, ended_at: r.completed_at, timing_granularity: "run" });
      } else events.push({ ledger: "signal_labeling_calls", call_id: r.call_id, stage: "listening_labeling", status: r.call_status ?? "missing",
        settled_micro_usd: r.settled_micro_usd, reserved_micro_usd: r.reserved_micro_usd, started_at: r.run_created_at,
        ended_at: r.completed_at, timing_granularity: "run" });
    }
    const preps = prepIds.length ? (await client.query<{ id: string; prototype_run_id: string | null; prototype_cap_micro_usd: string; status: string }>(`SELECT id,
        prototype_run_id,prototype_cap_micro_usd::text,status FROM signal_listening_preparations WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
    [before.workspace_id, prepIds])).rows : [];
    if (preps.length !== prepIds.length) limitations.add("listening_preparation_source_missing");
    if (preps.some(p => Number(p.prototype_cap_micro_usd) > 0 && !p.prototype_run_id)) limitations.add("listening_voyage_run_source_missing");
    const voyageRunIds = [...new Set(preps.flatMap(p => p.prototype_run_id ? [p.prototype_run_id] : []))];
    const voyageRows = voyageRunIds.length ? (await client.query<{ run_id: string; run_status: string; run_created_at: Date | string;
      run_completed_at: Date | string | null; run_settled_micro_usd: string; run_reserved_micro_usd: string;
      call_id: string | null; call_status: string | null;
      call_settled_micro_usd: string | null; call_reserved_micro_usd: string | null; reserved_at: Date | string | null;
      sent_at: Date | string | null; response_at: Date | string | null }>(`SELECT r.id run_id,r.status run_status,r.created_at run_created_at,r.completed_at run_completed_at,
        r.settled_micro_usd::text run_settled_micro_usd,
        r.reserved_micro_usd::text run_reserved_micro_usd,c.id call_id,c.status call_status,
        c.settled_micro_usd::text call_settled_micro_usd,c.reserved_micro_usd::text call_reserved_micro_usd,c.reserved_at,c.sent_at,c.response_at
      FROM signal_workspace_embedding_runs r LEFT JOIN signal_workspace_embedding_calls c ON c.workspace_id=r.workspace_id AND c.run_id=r.id
      WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id,c.id`, [before.workspace_id, voyageRunIds])).rows : [];
    if (new Set(voyageRows.map(r => r.run_id)).size !== voyageRunIds.length) limitations.add("listening_voyage_run_source_missing");
    for (const runId of voyageRunIds) {
      const runCalls = voyageRows.filter(row => row.run_id === runId && row.call_id);
      const run = voyageRows.find(row => row.run_id === runId)!;
      if (runCalls.length === 0 && run.run_status === "completed" && BigInt(run.run_settled_micro_usd) === 0n
        && BigInt(run.run_reserved_micro_usd) === 0n) events.push({ ledger: "signal_workspace_embedding_calls", call_id: `${runId}:no-new-call`,
        stage: "listening_voyage_prototypes", status: "completed_without_new_provider_call", settled_micro_usd: "0", reserved_micro_usd: "0",
        started_at: run.run_created_at, ended_at: run.run_completed_at, timing_granularity: "run" });
      const callSum = runCalls.reduce((n, row) => n + BigInt(row.call_settled_micro_usd ?? "0"), 0n);
      if (run.run_status === "completed" && runCalls.every(row => row.call_status === "settled") && callSum !== BigInt(run.run_settled_micro_usd)) {
        limitations.add("listening_voyage_run_cost_census_mismatch");
      }
    }
    for (const r of voyageRows) {
      if (r.run_status !== "completed") limitations.add("listening_voyage_run_not_completed");
      if (r.call_id) events.push({ ledger: "signal_workspace_embedding_calls", call_id: r.call_id, stage: "listening_voyage_prototypes",
        status: r.call_status ?? "missing", settled_micro_usd: r.call_settled_micro_usd, reserved_micro_usd: r.call_reserved_micro_usd,
        started_at: r.sent_at ?? r.reserved_at, ended_at: r.response_at, timing_granularity: "call" });
    }
    const vectorCalls = (await client.query<{ call_id: string }>(`SELECT DISTINCT source_embedding_call_id call_id FROM signal_listening_question_vectors
      WHERE workspace_id=$1 AND configuration_id=ANY($2::uuid[]) AND source_embedding_call_id IS NOT NULL ORDER BY call_id`,
    [before.workspace_id, [before.configuration_id, after.configuration_id]])).rows.map(r => r.call_id);
    const paidVoyageCalls = new Set(events.filter(e => e.ledger === "signal_workspace_embedding_calls").map(e => e.call_id));
    manifest.listening = { preparation_ids: prepIds, prototype_run_ids: voyageRunIds,
      reused_voyage_embedding_call_ids: vectorCalls.filter(id => !paidVoyageCalls.has(id)), labeling_run_ids: runIds };
  }

  const stepRows = (await client.query<{ id: string; mode: string; call_id: string | null; call_state: string | null; settled_micro_usd: string | null;
    reserved_micro_usd: string | null; sent_at: Date | string | null; response_received_at: Date | string | null }>(`SELECT s.id,s.mode,c.id call_id,c.call_state,
      c.settled_micro_usd::text,c.reserved_micro_usd::text,c.sent_at,c.response_received_at FROM signal_study_steps s
    LEFT JOIN engine_cost_events c ON c.study_step_id=s.id AND c.workspace_id=s.workspace_id AND c.workspace_contract='signal-study-step-v1'
    WHERE s.workspace_id=$1 AND s.execution_id=$2 AND s.status='committed' ORDER BY s.mode,s.id`, [study.workspace_id, study.id])).rows;
  for (const r of stepRows) {
    if (!r.call_id) { limitations.add("study_step_receipt_missing"); continue; }
    events.push({ ledger: "engine_cost_events", call_id: r.call_id, stage: `study_${r.mode}`, status: r.call_state ?? "missing",
      settled_micro_usd: r.settled_micro_usd, reserved_micro_usd: r.reserved_micro_usd, started_at: r.sent_at,
      ended_at: r.response_received_at, timing_granularity: "call" });
  }
  const jevRunIds = (await client.query<{ run_id: string }>(`SELECT DISTINCT run_id FROM signal_study_jev_batches
    WHERE workspace_id=$1 AND execution_id=$2 AND run_id IS NOT NULL ORDER BY run_id`, [study.workspace_id, study.id])).rows.map(r => r.run_id);
  const jevRows = jevRunIds.length ? (await client.query<{ run_id: string; run_status: string; run_created_at: Date | string;
    completed_at: Date | string | null; call_id: string | null; call_status: string | null; settled_micro_usd: string | null;
    reserved_micro_usd: string | null }>(`SELECT r.id run_id,r.status run_status,r.created_at run_created_at,r.completed_at,c.id call_id,c.status call_status,
      c.settled_micro_usd::text,c.reserved_micro_usd::text FROM signal_labeling_runs r LEFT JOIN signal_labeling_calls c
      ON c.workspace_id=r.workspace_id AND c.run_id=r.id WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.id,c.id`,
  [study.workspace_id, jevRunIds])).rows : [];
  if (new Set(jevRows.map(r => r.run_id)).size !== jevRunIds.length) limitations.add("study_jev_run_source_missing");
  for (const r of jevRows) {
    if (r.run_status !== "completed") limitations.add("study_jev_run_not_completed");
    if (r.call_id) events.push({ ledger: "signal_labeling_calls", call_id: r.call_id, stage: "study_jev", status: r.call_status ?? "missing",
      settled_micro_usd: r.settled_micro_usd, reserved_micro_usd: r.reserved_micro_usd,
      started_at: r.run_created_at, ended_at: r.completed_at, timing_granularity: "run" });
    else if (r.run_status === "completed") events.push({ ledger: "signal_labeling_calls", call_id: `${r.run_id}:no-new-call`, stage: "study_jev",
      status: "completed_without_new_provider_call", settled_micro_usd: "0", reserved_micro_usd: "0",
      started_at: r.run_created_at, ended_at: r.completed_at, timing_granularity: "run" });
  }
  manifest.study = { committed_step_count: stepRows.length, step_receipt_count: stepRows.filter(r => r.call_id).length,
    jev_run_ids: jevRunIds, jev_call_count: jevRows.filter(r => r.call_id).length };

  const unique = new Map<string, Event>();
  for (const event of events) {
    const key = `${event.ledger}\0${event.call_id}`;
    const prior = unique.get(key);
    if (prior && prior.stage !== event.stage) limitations.add("native_receipt_stage_conflict"); else unique.set(key, event);
  }
  const calls = [...unique.values()], grouped = new Map<string, Event[]>();
  for (const event of calls) {
    let group = grouped.get(event.stage);
    if (!group) { group = []; grouped.set(event.stage, group); }
    group.push(event);
  }
  const terminal = (e: Event) => e.status === "settled" ? e.settled_micro_usd !== null
    : e.status === "completed_without_new_provider_call" || e.status === "definitely_not_sent";
  const summarize = (stage: string, items: Event[]) => {
    const knownCost = items.every(terminal), knownTime = items.every(e => e.started_at !== null && e.ended_at !== null);
    const cost = knownCost ? items.reduce((n, e) => n + BigInt(e.settled_micro_usd ?? "0"), 0n) : null;
    const reserved = items.reduce((n, e) => n + BigInt(terminal(e) ? "0" : e.reserved_micro_usd ?? "0"), 0n);
    const elapsed = knownTime ? nativeWallSpanV1(items) : null;
    return { stage, cost_usd: safeUsd(cost), reserved_usd: safeUsd(reserved),
      elapsed_ms: elapsed };
  };
  const stages = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([stage, items]) => summarize(stage, items));
  const allCostKnown = calls.length > 0 && calls.every(terminal), allTimeKnown = calls.length > 0 && calls.every(e => e.started_at !== null && e.ended_at !== null);
  const allCost = allCostKnown ? calls.reduce((n, e) => n + BigInt(e.settled_micro_usd ?? "0"), 0n) : null;
  const reserve = calls.reduce((n, e) => n + BigInt(terminal(e) ? "0" : e.reserved_micro_usd ?? "0"), 0n);
  const reserveUnknownCodes = new Set(["listening_parent_missing_or_ambiguous", "listening_generation_path_incomplete", "listening_generation_path_ambiguous",
    "listening_generation_ancestry_proof_invalid",
    "listening_sonnet_round_receipt_missing", "listening_labeling_run_source_missing", "listening_labeling_run_not_completed",
    "listening_preparation_source_missing", "listening_voyage_run_source_missing", "listening_voyage_run_not_completed",
    "study_step_receipt_missing", "study_jev_run_source_missing", "study_jev_run_not_completed", "native_receipt_stage_conflict"]);
  const exposureKnown = ![...limitations].some(code => reserveUnknownCodes.has(code));
  const wall = allTimeKnown ? nativeWallSpanV1(calls) : null;
  const totalUsd = safeUsd(allCost), reservedUsd = exposureKnown ? safeUsd(reserve) : null;
  if (!allCostKnown) limitations.add("native_cost_unsettled_or_missing");
  if (!allTimeKnown || wall === null) limitations.add("native_timing_incomplete");
  if (allCost !== null && totalUsd === null || exposureKnown && reservedUsd === null) limitations.add("native_micro_amount_out_of_safe_range");
  if (!calls.length) limitations.add("native_paid_call_receipts_missing");
  const complete = limitations.size === 0 && totalUsd !== null && wall !== null;
  manifest.unique_call_count = calls.length;
  manifest.call_receipts = calls;
  manifest.cost_micro_usd = allCost?.toString() ?? null;
  manifest.reserved_micro_usd = exposureKnown ? reserve.toString() : null;
  manifest.timing_scope = "max(actual_end)-min(actual_start); stage windows may overlap and are not summed";
  return { complete, total_cost_usd: complete ? totalUsd : null,
    total_reserved_usd: exposureKnown ? reservedUsd : null, total_elapsed_ms: complete ? wall : null,
    timing_scope: complete ? "wall_span" as const : "unknown" as const,
    stages: stages.length ? stages : [{ stage: "native_measurements", cost_usd: null, reserved_usd: null, elapsed_ms: null }],
    manifest, limitations: [...limitations] };
}

function safeUsd(micro: bigint | null): number | null {
  if (micro === null) return null;
  const value = Number(micro);
  return Number.isSafeInteger(value) ? value / 1_000_000 : null;
}
