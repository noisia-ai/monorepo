type Client = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> };
type Generation = { id: string; workspace_id: string; map_id: string; configuration_id: string; preparation_run_id: string };
type Study = { id: string; workspace_id: string };
type Event = { ledger: string; call_id: string; stage: string; status: string; settled_micro_usd: string | null;
  reserved_micro_usd: string | null; started_at: Date | string | null; ended_at: Date | string | null; timing_granularity: "call" | "run" };

export async function loadNativeReceiptEvidenceV1(client: Client, before: Generation, after: Generation, study: Study) {
  const events: Event[] = [], limitations = new Set<string>();
  const manifest: Record<string, unknown> = { contract_version: "r16-native-ledger-receipts-v1", deduplication: "ledger+call_id",
    generation_preparation_run_ids: [before.preparation_run_id, after.preparation_run_id] };
  const parents = (await client.query<{ id: string; initial_generation_id: string; initial_classification_run_id: string;
    initial_preparation_id: string | null; status: string }>(`SELECT e.id,e.initial_generation_id,e.initial_classification_run_id,e.initial_preparation_id,e.status
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
      classification_run_id: string | null; classification_preparation_id: string | null; status: string }>(`SELECT id,ordinal,input_generation_id,output_generation_id,
        classification_run_id,classification_preparation_id,status FROM signal_listening_discovery_rounds
      WHERE workspace_id=$1 AND execution_id=$2 ORDER BY ordinal,id`, [before.workspace_id, parent.id])).rows;
    let cursor = before.id; const path: typeof rounds = [];
    for (let n = 0; n < rounds.length && cursor !== after.id; n++) {
      const candidates = rounds.filter(item => item.input_generation_id === cursor);
      if (candidates.length !== 1) {
        if (candidates.length > 1) limitations.add("listening_generation_path_ambiguous");
        break;
      }
      const round = candidates[0]!;
      path.push(round);
      if (round.status !== "completed" || !round.output_generation_id) break;
      cursor = round.output_generation_id;
    }
    if (cursor !== after.id || !path.length) limitations.add("listening_generation_path_incomplete");
    const roundIds = path.map(item => item.id);
    const children = roundIds.length ? (await client.query<{ run_id: string; preparation_id: string | null }>(`SELECT run_id,preparation_id
      FROM signal_listening_discovery_children WHERE workspace_id=$1 AND execution_id=$2 AND round_id=ANY($3::uuid[]) ORDER BY run_id`,
    [before.workspace_id, parent.id, roundIds])).rows : [];
    runIds = [...new Set([parent.initial_classification_run_id, ...path.flatMap(r => r.classification_run_id ? [r.classification_run_id] : []), ...children.map(x => x.run_id)])];
    prepIds = [...new Set([...(parent.initial_preparation_id ? [parent.initial_preparation_id] : []),
      ...path.flatMap(r => r.classification_preparation_id ? [r.classification_preparation_id] : []),
      ...children.flatMap(x => x.preparation_id ? [x.preparation_id] : [])])];
    manifest.listening_parent = { id: parent.id, initial_generation_id: parent.initial_generation_id,
      initial_classification_run_id: parent.initial_classification_run_id, status: parent.status,
      rounds: path.map(r => ({ id: r.id, ordinal: r.ordinal, input_generation_id: r.input_generation_id,
        output_generation_id: r.output_generation_id, status: r.status, classification_run_id: r.classification_run_id,
        classification_preparation_id: r.classification_preparation_id })), generation_path_complete: cursor === after.id,
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
  for (const event of calls) grouped.set(event.stage, [...(grouped.get(event.stage) ?? []), event]);
  const terminal = (e: Event) => e.status === "settled" ? e.settled_micro_usd !== null
    : e.status === "completed_without_new_provider_call" || e.status === "definitely_not_sent";
  const summarize = (stage: string, items: Event[]) => {
    const knownCost = items.every(terminal), knownTime = items.every(e => e.started_at !== null && e.ended_at !== null);
    const cost = knownCost ? items.reduce((n, e) => n + BigInt(e.settled_micro_usd ?? "0"), 0n) : null;
    const reserved = items.reduce((n, e) => n + BigInt(terminal(e) ? "0" : e.reserved_micro_usd ?? "0"), 0n);
    const times = knownTime ? items.flatMap(e => [new Date(e.started_at!).getTime(), new Date(e.ended_at!).getTime()]) : [];
    return { stage, cost_usd: safeUsd(cost), reserved_usd: safeUsd(reserved),
      elapsed_ms: knownTime && times.every(Number.isFinite) ? Math.max(...times) - Math.min(...times) : null };
  };
  const stages = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([stage, items]) => summarize(stage, items));
  const allCostKnown = calls.length > 0 && calls.every(terminal), allTimeKnown = calls.length > 0 && calls.every(e => e.started_at !== null && e.ended_at !== null);
  const allCost = allCostKnown ? calls.reduce((n, e) => n + BigInt(e.settled_micro_usd ?? "0"), 0n) : null;
  const reserve = calls.reduce((n, e) => n + BigInt(terminal(e) ? "0" : e.reserved_micro_usd ?? "0"), 0n);
  const reserveUnknownCodes = new Set(["listening_parent_missing_or_ambiguous", "listening_generation_path_incomplete", "listening_generation_path_ambiguous",
    "listening_sonnet_round_receipt_missing", "listening_labeling_run_source_missing", "listening_labeling_run_not_completed",
    "listening_preparation_source_missing", "listening_voyage_run_source_missing", "listening_voyage_run_not_completed",
    "study_step_receipt_missing", "study_jev_run_source_missing", "study_jev_run_not_completed", "native_receipt_stage_conflict"]);
  const exposureKnown = ![...limitations].some(code => reserveUnknownCodes.has(code));
  const timeValues = allTimeKnown ? calls.flatMap(e => [new Date(e.started_at!).getTime(), new Date(e.ended_at!).getTime()]) : [];
  const wall = allTimeKnown && timeValues.every(Number.isFinite) ? Math.max(...timeValues) - Math.min(...timeValues) : null;
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
