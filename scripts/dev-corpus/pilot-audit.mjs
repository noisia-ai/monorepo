import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const POSITIVE_THRESHOLD = 0.7;
const INTERMEDIATE_THRESHOLD = 0.3;
const OPERATOR_STAGES = ['voyage', 'bertopic', 'claude', 'jev_smoke', 'jev_full'];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const canonicalDigest = (value) => `sha256:${sha256(canonicalJson(value))}`;
const safeIntegerValue = (value) => (Number.isSafeInteger(value) && value >= 0)
  || (typeof value === 'string' && /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)));
const normalizedIdentity = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
  .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, ' ').trim();

export function validatePilotSnapshot(snapshot) {
  const frozenTime = Date.parse(snapshot?.map?.created_at);
  if (!record(snapshot) || snapshot.contract_version !== 'mass-labeling-private-export-v1'
    || !record(snapshot.map) || typeof snapshot.map.map_digest !== 'string'
    || !snapshot.map.map_digest || !Number.isFinite(frozenTime)
    || !Array.isArray(snapshot.map.catalog) || !Array.isArray(snapshot.items)
    || !Number.isSafeInteger(snapshot.map.root_count) || snapshot.map.root_count !== snapshot.items.length
    || !record(snapshot.run) || snapshot.run.status !== 'completed' || snapshot.run.smoke_root_limit !== null
    || !record(snapshot.run.smoke_metrics) || !Number.isSafeInteger(snapshot.run.smoke_metrics.root_count)
    || snapshot.run.smoke_metrics.root_count < 1 || snapshot.run.smoke_metrics.root_count >= snapshot.map.root_count
    || !Array.isArray(snapshot.calls)
    || !record(snapshot.stage_receipts) || !record(snapshot.stage_receipts.embeddings)
    || !record(snapshot.stage_receipts.engine) || !Array.isArray(snapshot.stage_receipts.editorial_calls)) {
    throw new Error('pilot_audit_snapshot_invalid_or_map_not_frozen');
  }

  const topicKeys = new Set();
  for (const topic of snapshot.map.catalog) {
    if (!record(topic) || typeof topic.topic_key !== 'string' || !topic.topic_key
      || typeof topic.name !== 'string' || typeof topic.definition !== 'string'
      || topicKeys.has(topic.topic_key)) throw new Error('pilot_audit_topic_catalog_invalid');
    topicKeys.add(topic.topic_key);
  }
  if (snapshot.items.some((item) => typeof item.root_id !== 'string' || !item.root_id)
    || new Set(snapshot.items.map((item) => item.root_id)).size !== snapshot.items.length) {
    throw new Error('pilot_audit_duplicate_item');
  }
  return snapshot;
}

export function computeSnapshotDigest(snapshot) {
  validatePilotSnapshot(snapshot);
  return sha256(JSON.stringify(snapshot));
}

export function validateOperatorReceipt(snapshot, receipt) {
  validatePilotSnapshot(snapshot);
  if (!record(receipt) || receipt.contract_version !== 'signal-mass-labeling-operator-receipt-v1'
    || receipt.map_digest !== snapshot.map.map_digest
    || receipt.snapshot_sha256 !== computeSnapshotDigest(snapshot) || !Array.isArray(receipt.stages)) {
    throw new Error('pilot_audit_operator_receipt_invalid_or_wrong_map');
  }
  const stages = new Map(receipt.stages.map((stage) => [stage.name, stage]));
  const nullableCount = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
  const expectedUnits = { voyage: 'fragments', bertopic: 'roots', claude: 'groups', jev_smoke: 'roots', jev_full: 'roots' };
  if (stages.size !== receipt.stages.length || stages.size !== OPERATOR_STAGES.length
    || OPERATOR_STAGES.some((name) => !stages.has(name))
    || !record(receipt.population) || !Number.isSafeInteger(receipt.population.unique_roots)
    || !Number.isSafeInteger(receipt.population.excluded_roots) || !Number.isSafeInteger(receipt.population.eligible_roots)
    || receipt.population.eligible_roots !== snapshot.map.root_count
    || receipt.population.unique_roots !== receipt.population.eligible_roots + receipt.population.excluded_roots
    || receipt.stages.some((stage) => !record(stage) || typeof stage.name !== 'string'
      || stage.input_unit !== expectedUnits[stage.name]
      || !Object.hasOwn(stage, 'charged_micro_usd') || !Object.hasOwn(stage, 'usage_value_micro_usd')
      || !Object.hasOwn(stage, 'free_tokens_used') || !Object.hasOwn(stage, 'input_tokens')
      || !Object.hasOwn(stage, 'ledger_call_ids') || !Number.isSafeInteger(stage.input_count) || stage.input_count < 0
      || !nullableCount(stage.charged_micro_usd) || !nullableCount(stage.usage_value_micro_usd)
      || !nullableCount(stage.free_tokens_used) || !nullableCount(stage.input_tokens)
      || !Array.isArray(stage.ledger_call_ids)
      || (stage.group_count !== undefined && (!Number.isSafeInteger(stage.group_count) || stage.group_count < 1))
      || !Number.isFinite(Date.parse(stage.started_at)) || !Number.isFinite(Date.parse(stage.completed_at))
      || Date.parse(stage.completed_at) < Date.parse(stage.started_at))) {
    throw new Error('pilot_audit_operator_stages_incomplete');
  }
  const publicCatalog = receipt.public_catalog;
  const identityTerms = publicCatalog?.private_identity_terms;
  const publicTopics = publicCatalog?.topics;
  if (!record(publicCatalog) || publicCatalog.map_digest !== snapshot.map.map_digest
    || !Array.isArray(identityTerms) || identityTerms.some((term) => typeof term !== 'string' || !normalizedIdentity(term))
    || !Array.isArray(publicTopics) || publicTopics.length !== snapshot.map.catalog.length) {
    throw new Error('pilot_audit_public_catalog_required');
  }
  const rawTopics = new Map(snapshot.map.catalog.map((topic) => [topic.topic_key, topic]));
  const publicKeys = new Set();
  for (const topic of publicTopics) {
    if (!record(topic) || !rawTopics.has(topic.topic_key) || publicKeys.has(topic.topic_key)
      || typeof topic.public_name !== 'string' || !topic.public_name.trim()
      || typeof topic.public_definition !== 'string' || !topic.public_definition.trim()) {
      throw new Error('pilot_audit_public_catalog_invalid');
    }
    publicKeys.add(topic.topic_key);
    const display = normalizedIdentity(`${topic.public_name} ${topic.public_definition}`);
    if (identityTerms.some((term) => display.includes(normalizedIdentity(term)))) {
      throw new Error('pilot_audit_public_catalog_private_identity_leak');
    }
  }
  const engineGroupCount = snapshot.stage_receipts.engine.result_summary?.fit_checkpoint?.interpretation_manifest?.unit_count;
  const suppliedGroupCount = stages.get('bertopic')?.group_count;
  if ((engineGroupCount !== undefined && (!Number.isSafeInteger(engineGroupCount) || engineGroupCount < 1))
    || (engineGroupCount !== undefined && suppliedGroupCount !== undefined && engineGroupCount !== suppliedGroupCount)
    || (engineGroupCount === undefined && suppliedGroupCount === undefined)) {
    throw new Error('pilot_audit_bertopic_group_census_required');
  }
  return receipt;
}

function indexSnapshot(snapshot) {
  const items = new Map(snapshot.items.map((item) => [item.root_id, item]));
  if (items.size !== snapshot.items.length || snapshot.items.some((item) =>
    typeof item.root_id !== 'string' || typeof item.text !== 'string' || !Array.isArray(item.candidates))) {
    throw new Error('pilot_audit_items_invalid');
  }
  const calls = new Map(snapshot.calls.map((call) => [call.id, call]));
  if (calls.size !== snapshot.calls.length || snapshot.calls.some((call) =>
    typeof call.id !== 'string' || !call.id)) throw new Error('pilot_audit_call_ledger_invalid');
  const rootCallIds = new Set();
  const itemOrdinals = new Set();
  for (const item of snapshot.items) {
    if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 1 || itemOrdinals.has(item.ordinal)) {
      throw new Error('pilot_audit_item_ordinal_invalid');
    }
    itemOrdinals.add(item.ordinal);
    if (['labeled', 'abstained'].includes(item.status)) {
      if (typeof item.call_id !== 'string' || !calls.has(item.call_id) || rootCallIds.has(item.call_id)
        || !record(item.probabilities)) throw new Error('pilot_audit_result_call_missing');
      rootCallIds.add(item.call_id);
    }
    if (!['labeled', 'abstained', 'refused', 'error', null].includes(item.status)) {
      throw new Error('pilot_audit_result_status_invalid');
    }
    if (item.call_id !== null && item.call_id !== undefined && !calls.has(item.call_id)) {
      throw new Error('pilot_audit_result_call_missing');
    }
  }
  if (itemOrdinals.size !== snapshot.items.length
    || [...itemOrdinals].sort((a, b) => a - b).some((ordinal, index) => ordinal !== index + 1)) {
    throw new Error('pilot_audit_item_order_invalid');
  }
  return { items, calls };
}

function reconcileJevLedger(snapshot, operatorReceipt) {
  const calls = new Map(snapshot.calls.map((call) => [call.id, call]));
  const itemCallIds = new Map();
  for (const item of snapshot.items) {
    if (item.call_id === null || item.call_id === undefined) continue;
    if (typeof item.call_id !== 'string' || !calls.has(item.call_id) || itemCallIds.has(item.call_id)) {
      throw new Error('pilot_audit_item_call_reference_invalid');
    }
    itemCallIds.set(item.call_id, item.ordinal);
  }
  const assigned = new Set();
  const smokeStage = operatorReceipt.stages.find((stage) => stage.name === 'jev_smoke');
  if (smokeStage.input_count !== snapshot.run.smoke_metrics.root_count) {
    throw new Error('pilot_audit_smoke_metric_count_mismatch');
  }
  for (const stage of operatorReceipt.stages.filter((row) => row.name.startsWith('jev_'))) {
    const stageCallIds = new Set(stage.ledger_call_ids);
    const stageItems = [...stageCallIds].map((id) => itemCallIds.get(id));
    const stageRootCount = stageItems.filter((ordinal) => ordinal !== undefined).length;
    if (stageRootCount !== stage.input_count || stageRootCount !== stage.ledger_call_ids.length) {
      throw new Error('pilot_audit_jev_input_count_mismatch');
    }
    const smokeLimit = snapshot.run.smoke_metrics.root_count;
    if (stageItems.some((ordinal) => stage.name === 'jev_smoke' ? ordinal > smokeLimit : ordinal <= smokeLimit)) {
      throw new Error('pilot_audit_jev_smoke_full_overlap');
    }
    let settledTotal = 0n;
    let settledComplete = true;
    let tokenTotal = 0;
    let tokenComplete = true;
    for (const callId of stage.ledger_call_ids) {
      const call = calls.get(callId);
      if (!call || assigned.has(callId)) throw new Error('pilot_audit_jev_call_reference_invalid');
      assigned.add(callId);
      if (call.settled_micro_usd === null || call.settled_micro_usd === undefined) settledComplete = false;
      else if (!/^-?\d+$/u.test(String(call.settled_micro_usd)) || BigInt(call.settled_micro_usd) < 0n) {
        throw new Error('pilot_audit_jev_settlement_invalid');
      } else settledTotal += BigInt(call.settled_micro_usd);
      const inputTokens = call.usage?.input_tokens;
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) tokenComplete = false;
      else tokenTotal += inputTokens;
    }
    const expectedUsageValue = settledComplete ? settledTotal : null;
    const actualUsageValue = stage.usage_value_micro_usd === null ? null : BigInt(stage.usage_value_micro_usd);
    if (expectedUsageValue !== actualUsageValue) throw new Error('pilot_audit_jev_usage_value_mismatch');
    const expectedTokens = tokenComplete ? tokenTotal : null;
    if (expectedTokens !== stage.input_tokens) throw new Error('pilot_audit_jev_input_tokens_mismatch');
  }
  if (assigned.size !== calls.size) throw new Error('pilot_audit_jev_call_unassigned');
  if (itemCallIds.size !== calls.size) throw new Error('pilot_audit_call_without_item');
}

function reconcileEditorialLedger(snapshot, operatorReceipt) {
  const rows = snapshot.stage_receipts.editorial_calls;
  const calls = new Map(rows.map((call) => [call.id, call]));
  if (calls.size !== snapshot.stage_receipts.editorial_calls.length
    || rows.some((call) => typeof call.id !== 'string' || !call.id)) {
    throw new Error('pilot_audit_editorial_ledger_invalid');
  }
  const stage = operatorReceipt.stages.find((row) => row.name === 'claude');
  if (!stage.ledger_call_ids.length || new Set(stage.ledger_call_ids).size !== stage.ledger_call_ids.length
    || stage.ledger_call_ids.length !== rows.length
    || stage.ledger_call_ids.some((id) => !calls.has(id))) {
    throw new Error('pilot_audit_editorial_call_ids_required');
  }

  // Older H2 snapshots contain only successful calls. Keep that contract
  // readable; once any transport fields are present, require the full ledger.
  const enriched = rows.some((call) => Object.hasOwn(call, 'retry_of_call_id')
    || Object.hasOwn(call, 'request_digest') || Object.hasOwn(call, 'response_http_status'));
  let settledTotal = 0n;
  let inputTokenTotal = 0;
  const terminalRows = [];
  const successfulRows = [];
  for (const id of stage.ledger_call_ids) {
    const call = calls.get(id);
    if (!call) throw new Error('pilot_audit_editorial_call_reference_invalid');
    if (!enriched) {
      if (call.settled_micro_usd === null || call.settled_micro_usd === undefined) {
        throw new Error('pilot_audit_editorial_settlement_invalid');
      }
      if (!/^\d+$/u.test(String(call.settled_micro_usd))) throw new Error('pilot_audit_editorial_settlement_invalid');
      settledTotal += BigInt(call.settled_micro_usd);
      const inputTokens = call.input_tokens ?? call.usage?.input_tokens;
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) throw new Error('pilot_audit_editorial_input_tokens_invalid');
      inputTokenTotal += inputTokens;
      continue;
    }
    if (!record(call) || typeof call.call_state !== 'string' || !record(call.call_configuration)
      || typeof call.request_digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(call.request_digest)
      || typeof call.actor_user_id !== 'string' || !call.actor_user_id
      || typeof call.workspace_id !== 'string' || !call.workspace_id
      || typeof call.execution_id !== 'string' || !call.execution_id
      || typeof call.provider !== 'string' || typeof call.model !== 'string'
      || call.provider !== call.call_configuration.provider || call.model !== call.call_configuration.model
      || !record(call.metadata) || !record(call.metadata.mass_labeling_stage)) {
      throw new Error('pilot_audit_editorial_call_contract_invalid');
    }
    if (!/^\d+$/u.test(String(call.settled_micro_usd))) throw new Error('pilot_audit_editorial_settlement_invalid');
    if (call.call_state === 'terminal_confirmed') {
      validateBilledTerminalCall(call);
      terminalRows.push(call);
    } else if (call.call_state === 'settled') {
      validateSettledEditorialCall(call);
      successfulRows.push(call);
    } else {
      throw new Error('pilot_audit_editorial_call_unreconciled');
    }
    const tokens = call.input_tokens;
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('pilot_audit_editorial_input_tokens_invalid');
    settledTotal += BigInt(call.settled_micro_usd);
    inputTokenTotal += tokens;
  }
  if (enriched && new Set([...terminalRows, ...successfulRows].map((call) => call.id)).size !== rows.length) {
    throw new Error('pilot_audit_editorial_call_unassigned');
  }
  if (terminalRows.length) {
    if (terminalRows.length !== 1) throw new Error('pilot_audit_editorial_terminal_duplicate');
    const terminal = terminalRows[0];
    const successors = rows.filter((call) => call.retry_of_call_id === terminal.id);
    if (successors.length !== 1 || successors[0].call_state !== 'settled'
      || successfulRows.filter((call) => call.id === successors[0].id).length !== 1) {
      throw new Error('pilot_audit_editorial_terminal_successor_invalid');
    }
    const successor = successors[0];
    const sameStage = canonicalJson(terminal.metadata.mass_labeling_stage) === canonicalJson(successor.metadata.mass_labeling_stage);
    if (successor.retry_of_call_id !== terminal.id || successor.request_digest !== terminal.request_digest
      || canonicalJson(successor.call_configuration) !== canonicalJson(terminal.call_configuration)
      || successor.actor_user_id !== terminal.actor_user_id || successor.workspace_id !== terminal.workspace_id
      || successor.execution_id !== terminal.execution_id || successor.provider !== terminal.provider
      || successor.model !== terminal.model || successor.reserved_micro_usd !== terminal.reserved_micro_usd || !sameStage) {
      throw new Error('pilot_audit_editorial_retry_scope_invalid');
    }
    if (rows.some((call) => call.id !== terminal.id && call.request_digest === terminal.request_digest
      && call.id !== successor.id)) throw new Error('pilot_audit_editorial_retry_duplicate');
  }
  if (enriched && rows.some((call) => call.retry_of_call_id !== null && call.retry_of_call_id !== undefined
    && !calls.has(call.retry_of_call_id))) throw new Error('pilot_audit_editorial_retry_parent_missing');
  const usage = stage.usage_value_micro_usd === null ? null : BigInt(stage.usage_value_micro_usd);
  if (usage !== settledTotal) throw new Error('pilot_audit_editorial_usage_value_mismatch');
  if (stage.input_tokens !== inputTokenTotal) throw new Error('pilot_audit_editorial_input_tokens_mismatch');
  if (enriched) validateConsolidationArtifact(snapshot, successfulRows);
  const embeddingTokens = snapshot.stage_receipts.embeddings.input_tokens;
  const voyageStage = operatorReceipt.stages.find((row) => row.name === 'voyage');
  const expectedEmbeddingTokens = embeddingTokens === null || embeddingTokens === undefined
    ? null : Number(embeddingTokens);
  if (!Number.isSafeInteger(expectedEmbeddingTokens) || voyageStage.input_tokens !== expectedEmbeddingTokens) {
    throw new Error('pilot_audit_voyage_input_tokens_mismatch');
  }
}

function validateSettledEditorialCall(call) {
  const complete = call.response_complete ?? call.metadata?.response_complete;
  const usage = call.metadata?.usage;
  const configuration = call.call_configuration;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const rates = ['input_micro_usd_per_million_tokens', 'output_micro_usd_per_million_tokens',
    'cache_read_micro_usd_per_million_tokens', 'cache_creation_micro_usd_per_million_tokens'];
  if (call.response_http_status !== 200 || complete !== true
    || typeof call.response_storage_key !== 'string' || !call.response_storage_key
    || typeof call.response_sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(call.response_sha256)
    || !safeIntegerValue(call.response_size_bytes) || Number(call.response_size_bytes) < 1
    || !call.settled_at || !Number.isFinite(Date.parse(call.settled_at))
    || !record(usage) || Object.keys(usage).sort().join(',') !== 'cache_creation_input_tokens,cache_read_input_tokens,input_tokens,output_tokens'
    || !Object.values(usage).every(integer) || !rates.every((key) => integer(configuration[key]))
    || call.input_tokens !== usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    || call.output_tokens !== usage.output_tokens
    || call.total_tokens !== call.input_tokens + call.output_tokens) {
    throw new Error('pilot_audit_editorial_settled_response_invalid');
  }
  const expectedCost = (BigInt(usage.input_tokens) * BigInt(configuration.input_micro_usd_per_million_tokens)
    + BigInt(usage.output_tokens) * BigInt(configuration.output_micro_usd_per_million_tokens)
    + BigInt(usage.cache_read_input_tokens) * BigInt(configuration.cache_read_micro_usd_per_million_tokens)
    + BigInt(usage.cache_creation_input_tokens) * BigInt(configuration.cache_creation_micro_usd_per_million_tokens)
    + 999999n) / 1000000n;
  if (BigInt(call.settled_micro_usd) !== expectedCost) {
    throw new Error('pilot_audit_editorial_settled_cost_mismatch');
  }
}

function validateBilledTerminalCall(call) {
  const receipt = call.metadata.provider_terminal_receipt;
  const billing = call.metadata.provider_terminal_billing_reconciliation;
  const usage = receipt?.usage;
  const configuration = call.call_configuration;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const rates = ['input_micro_usd_per_million_tokens', 'output_micro_usd_per_million_tokens',
    'cache_read_micro_usd_per_million_tokens', 'cache_creation_micro_usd_per_million_tokens'];
  if (call.response_storage_key !== null || call.response_sha256 !== null || call.response_size_bytes !== null
    || call.response_http_status !== null && call.response_http_status !== 499
    || call.response_complete !== null && call.response_complete !== false
    || !record(receipt) || receipt.contract_version !== 'workspace-provider-terminal-evidence-v1'
    || receipt.source !== 'anthropic_console' || receipt.http_status !== 499
    || receipt.reason !== 'client_disconnected' || receipt.billing_status !== 'unreconciled'
    || !/^req_[A-Za-z0-9_-]{1,220}$/u.test(receipt.provider_request_id ?? '')
    || receipt.call_id !== call.id || receipt.workspace_id !== call.workspace_id
    || receipt.execution_id !== call.execution_id || receipt.request_digest !== call.request_digest
    || receipt.provider_model !== call.model || receipt.configuration_digest !== canonicalDigest(configuration)
    || !record(receipt.evidence) || typeof receipt.evidence.storage_key !== 'string'
    || !receipt.evidence.storage_key.startsWith(`workspace-engine/${call.workspace_id}/${call.execution_id}/`)
    || receipt.evidence.storage_key.includes('..') || !/^sha256:[a-f0-9]{64}$/u.test(receipt.evidence.sha256)
    || !Number.isSafeInteger(receipt.evidence.size_bytes) || receipt.evidence.size_bytes < 1
    || !record(usage) || Object.keys(usage).sort().join(',') !== 'cache_creation_input_tokens,cache_read_input_tokens,input_tokens,output_tokens'
    || !Object.values(usage).every(integer)
    || !record(billing) || billing.contract_version !== 'workspace-provider-terminal-billing-v1'
    || billing.method !== 'audited_usage_pricing' || billing.provider_request_id !== receipt.provider_request_id
    || billing.terminal_receipt_digest !== canonicalDigest(receipt)
    || billing.actual_micro_usd !== receipt.usage_cost_micro_usd
    || canonicalJson(billing.usage) !== canonicalJson(usage)
    || !Number.isFinite(Date.parse(billing.reconciled_at))
    || !/^[0-9a-f-]{36}$/u.test(billing.verified_by_user_id ?? '')
    || canonicalJson(call.metadata.usage) !== canonicalJson(usage)
    || !integer(call.input_tokens) || !integer(call.output_tokens)
    || call.input_tokens !== usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    || call.output_tokens !== usage.output_tokens
    || !/^[0-9a-f-]{36}$/u.test(call.actor_user_id)
    || rates.some((key) => !integer(configuration[key]))) {
    throw new Error('pilot_audit_editorial_terminal_billing_invalid');
  }
  const expectedCost = (BigInt(usage.input_tokens) * BigInt(configuration.input_micro_usd_per_million_tokens)
    + BigInt(usage.output_tokens) * BigInt(configuration.output_micro_usd_per_million_tokens)
    + BigInt(usage.cache_read_input_tokens) * BigInt(configuration.cache_read_micro_usd_per_million_tokens)
    + BigInt(usage.cache_creation_input_tokens) * BigInt(configuration.cache_creation_micro_usd_per_million_tokens)
    + 999999n) / 1000000n;
  if (!Number.isSafeInteger(receipt.usage_cost_micro_usd) || receipt.usage_cost_micro_usd < 0
    || BigInt(call.settled_micro_usd) !== expectedCost || BigInt(receipt.usage_cost_micro_usd) !== expectedCost) {
    throw new Error('pilot_audit_editorial_terminal_cost_mismatch');
  }
}

function validateConsolidationArtifact(snapshot, successfulRows) {
  const artifact = snapshot.stage_receipts.consolidation_artifact;
  const map = snapshot.map;
  if (!record(artifact) || artifact.id !== map.consolidation_artifact_id
    || artifact.artifact_key !== 'mass-labeling-consolidation.json'
    || !record(artifact.content) || artifact.content.contract_version !== 'workspace-engine-private-artifact-v1'
    || !/^sha256:[a-f0-9]{64}$/u.test(artifact.content.sha256 ?? '')
    || artifact.content.sha256 !== map.consolidation_digest
    || !Number.isSafeInteger(artifact.content.size_bytes) || artifact.content.size_bytes < 1
    || artifact.content.media_type !== 'application/json'
    || typeof artifact.content.storage_key !== 'string' || !artifact.content.storage_key
    || artifact.content.storage_key.includes('..')
    || !record(artifact.metadata) || artifact.metadata.contract_version !== 'workspace-mass-labeling-consolidation-v1'
    || artifact.metadata.source_engine_execution_id !== snapshot.stage_receipts.engine.id
    || artifact.metadata.source_engine_execution_id !== map.source_engine_execution_id
    || artifact.metadata.stage !== 'global-consolidation-v1'
    || !/^sha256:[a-f0-9]{64}$/u.test(artifact.metadata.source_groups_digest ?? '')) {
    throw new Error('pilot_audit_editorial_consolidation_artifact_invalid');
  }
  const linked = successfulRows.filter((call) => call.id === artifact.metadata.call_id);
  if (linked.length !== 1) throw new Error('pilot_audit_editorial_consolidation_call_missing');
  const call = linked[0];
  if (call.request_digest !== artifact.metadata.request_digest
    || call.response_sha256 !== artifact.metadata.response_sha256
    || call.metadata.mass_labeling_stage?.stage !== artifact.metadata.stage
    || call.metadata.mass_labeling_stage?.source_groups_digest !== artifact.metadata.source_groups_digest) {
    throw new Error('pilot_audit_editorial_consolidation_call_mismatch');
  }
}

function noul(answer) {
  return answer?.type === 'noul' && finite(answer.noul) && answer.noul >= 0 && answer.noul <= 1
    ? answer.noul : null;
}

function choice(answer) {
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string'
    || !record(answer.probabilities)) return null;
  const probabilities = Object.values(answer.probabilities);
  if (!probabilities.length || probabilities.some((value) => !finite(value) || value < 0 || value > 1)) return null;
  return { selected: answer.choice, confidence: answer.probabilities[answer.choice] ?? answer.confidence ?? null };
}

export function summarizePilotSnapshot(snapshot, operatorReceipt) {
  validatePilotSnapshot(snapshot);
  validateOperatorReceipt(snapshot, operatorReceipt);
  reconcileJevLedger(snapshot, operatorReceipt);
  reconcileEditorialLedger(snapshot, operatorReceipt);
  indexSnapshot(snapshot);
  const topics = new Map(snapshot.map.catalog.map((topic) => [topic.topic_key, {
    ...topic, volume: 0,
  }]));
  const coverage = { covered: 0, intermediate: 0, no_topic: 0, unresolved: 0 };
  const promotion = { positive: 0, measured: 0 };
  const spam = { positive: 0, measured: 0 };
  const triggerBarrier = { trigger: 0, barrier: 0, none: 0, intermediate: 0, unresolved: 0 };
  const validRows = [];

  for (const item of snapshot.items) {
    if (item.candidates.length > 8) throw new Error('pilot_audit_candidate_count_invalid');
    if (!['labeled', 'abstained'].includes(item.status) || !record(item.probabilities)) {
      coverage.unresolved += 1;
      triggerBarrier.unresolved += 1;
      continue;
    }
    const answers = item.probabilities;
    const probabilities = [];
    const candidateKeys = new Set();
    for (const [candidateOrdinal, candidate] of item.candidates.entries()) {
      const topic = topics.get(candidate.topic_key);
      const probability = noul(answers[`topic_${candidateOrdinal}`]);
      if (!topic || candidateKeys.has(candidate.topic_key) || probability === null) {
        throw new Error('pilot_audit_candidate_probability_invalid');
      }
      candidateKeys.add(candidate.topic_key);
      probabilities.push({ topic_key: candidate.topic_key, probability });
      if (probability > POSITIVE_THRESHOLD) {
        // Snapshot validation guarantees one row per root and candidateKeys
        // rejects duplicate topics within a row, so this membership check is
        // redundant. An array scan here made a large topic quadratic.
        topic.volume += 1;
      }
    }
    const maximum = probabilities.reduce((value, row) => Math.max(value, row.probability), 0);
    if (maximum > POSITIVE_THRESHOLD) coverage.covered += 1;
    else if (maximum >= INTERMEDIATE_THRESHOLD) coverage.intermediate += 1;
    else coverage.no_topic += 1;

    const promotionProbability = noul(answers.promotion);
    if (promotionProbability !== null) {
      promotion.measured += 1;
      if (promotionProbability > POSITIVE_THRESHOLD) promotion.positive += 1;
    }
    const spamProbability = noul(answers.spam);
    if (spamProbability !== null) {
      spam.measured += 1;
      if (spamProbability > POSITIVE_THRESHOLD) spam.positive += 1;
    }
    const decision = choice(answers.trigger_barrier);
    if (!decision) triggerBarrier.unresolved += 1;
    else if (decision.confidence !== null && decision.confidence >= INTERMEDIATE_THRESHOLD
      && decision.confidence <= POSITIVE_THRESHOLD) triggerBarrier.intermediate += 1;
    else if (decision.confidence !== null && decision.confidence > POSITIVE_THRESHOLD
      && Object.hasOwn(triggerBarrier, decision.selected)) triggerBarrier[decision.selected] += 1;
    else triggerBarrier.unresolved += 1;

    validRows.push({ root_id: item.root_id, text: item.text, answers, probabilities });
  }

  const rootCount = snapshot.items.length;
  const publicCatalog = new Map(operatorReceipt.public_catalog.topics.map((topic) => [topic.topic_key, topic]));
  const engineGroupCount = snapshot.stage_receipts.engine.result_summary?.fit_checkpoint?.interpretation_manifest?.unit_count;
  const groupCount = engineGroupCount ?? operatorReceipt.stages.find((stage) => stage.name === 'bertopic').group_count;
  const rate = (count, denominator) => denominator === 0 ? null : count / denominator * 100;
  const costs = [];
  const chargedValues = [];
  const usageValues = [];
  const freeTokens = [];
  const ledgerCallIds = new Set();
  for (const name of OPERATOR_STAGES) {
    const stage = operatorReceipt.stages.find((row) => row.name === name);
    const cost = stage.charged_micro_usd;
    const usageValue = stage.usage_value_micro_usd;
    const started = Date.parse(stage.started_at);
    const completed = Date.parse(stage.completed_at);
    if (!Number.isSafeInteger(stage.input_count) || stage.input_count < 0
      || (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))
      || (usageValue !== null && (!Number.isSafeInteger(usageValue) || usageValue < 0))
      || (stage.free_tokens_used !== null && (!Number.isSafeInteger(stage.free_tokens_used) || stage.free_tokens_used < 0))
      || (stage.input_tokens !== null && (!Number.isSafeInteger(stage.input_tokens) || stage.input_tokens < 0))
      || !Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
      throw new Error('pilot_audit_stage_receipt_invalid');
    }
    const ids = stage.ledger_call_ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
      throw new Error('pilot_audit_stage_call_ids_invalid');
    }
    if (name.startsWith('jev_') && !ids.length) throw new Error('pilot_audit_jev_call_ids_required');
    for (const id of ids) {
      if (ledgerCallIds.has(id)) throw new Error('pilot_audit_provider_call_double_counted');
      ledgerCallIds.add(id);
    }
    costs.push({
      name,
      input_count: stage.input_count,
      input_unit: stage.input_unit,
      charged_micro_usd: cost,
      usage_value_micro_usd: usageValue,
      charged_per_input_unit_micro_usd: cost === null || stage.input_count === 0 ? null : cost / stage.input_count,
      free_tokens_used: stage.free_tokens_used,
      input_tokens: stage.input_tokens,
      duration_seconds: (completed - started) / 1000,
    });
    chargedValues.push(cost);
    usageValues.push(usageValue);
    freeTokens.push(stage.free_tokens_used);
  }
  const totalChargedMicroUsd = chargedValues.some((value) => value === null) ? null
    : chargedValues.reduce((sum, value) => sum + value, 0);
  const totalUsageValueMicroUsd = usageValues.some((value) => value === null) ? null
    : usageValues.reduce((sum, value) => sum + value, 0);
  const totalFreeTokens = freeTokens.some((value) => value === null) ? null
    : freeTokens.reduce((sum, value) => sum + value, 0);
  const perThousand = (value) => value === null || rootCount === 0 ? null : value / rootCount * 1000;
  const perMillion = (value) => value === null || rootCount === 0 ? null : value / rootCount * 1_000_000;
  const topicRows = [...topics.values()].sort((a, b) => b.volume - a.volume || a.topic_key.localeCompare(b.topic_key));

  return {
    map_digest: snapshot.map.map_digest,
    frozen_at: snapshot.map.created_at,
    root_count: rootCount,
    population: operatorReceipt.population,
    classified_root_count: rootCount - coverage.unresolved,
    coverage: {
      ...coverage,
      covered_percent: rate(coverage.covered, rootCount),
      intermediate_percent: rate(coverage.intermediate, rootCount),
      no_topic_percent: rate(coverage.no_topic, rootCount),
      unresolved_percent: rate(coverage.unresolved, rootCount),
    },
    promotion: { ...promotion, percent: rate(promotion.positive, promotion.measured) },
    spam: { ...spam, percent: rate(spam.positive, spam.measured) },
    trigger_barrier: {
      ...triggerBarrier,
      trigger_percent: rate(triggerBarrier.trigger, rootCount),
      barrier_percent: rate(triggerBarrier.barrier, rootCount),
      none_percent: rate(triggerBarrier.none, rootCount),
      intermediate_percent: rate(triggerBarrier.intermediate, rootCount),
      unresolved_percent: rate(triggerBarrier.unresolved, rootCount),
    },
    topics: topicRows,
    public_topics: topicRows.map((topic) => {
      const publicTopic = publicCatalog.get(topic.topic_key);
      return { topic_key: topic.topic_key, name: publicTopic.public_name,
        definition: publicTopic.public_definition, volume: topic.volume };
    }),
    bertopic_group_count: groupCount,
    stages: costs,
    charged_micro_usd: totalChargedMicroUsd,
    usage_value_micro_usd: totalUsageValueMicroUsd,
    free_tokens_used: totalFreeTokens,
    charged_per_1000_micro_usd: perThousand(totalChargedMicroUsd),
    charged_per_million_micro_usd: perMillion(totalChargedMicroUsd),
    usage_value_per_1000_micro_usd: perThousand(totalUsageValueMicroUsd),
    usage_value_per_million_micro_usd: perMillion(totalUsageValueMicroUsd),
    private_rows: validRows,
  };
}

export function comparePilotSnapshot(snapshot, comparison) {
  validatePilotSnapshot(snapshot);
  if (!record(comparison) || comparison.map_digest !== snapshot.map.map_digest
    || !Array.isArray(comparison.study_topics) || !Array.isArray(comparison.topic_matches)
    || !Array.isArray(comparison.study_triggers) || !Array.isArray(comparison.study_barriers)) {
    throw new Error('pilot_audit_comparison_invalid_or_wrong_frozen_map');
  }
  const productKeys = new Set(snapshot.map.catalog.map((topic) => topic.topic_key));
  const studyKeys = new Set(comparison.study_topics.map((topic) => topic.key));
  if (studyKeys.size !== comparison.study_topics.length || comparison.study_topics.some((topic) =>
    !record(topic) || typeof topic.key !== 'string' || !topic.key || typeof topic.name !== 'string')) {
    throw new Error('pilot_audit_comparison_study_topics_invalid');
  }
  const productMatches = new Map();
  const studyMatches = new Set();
  for (const match of comparison.topic_matches) {
    if (!productKeys.has(match.product_topic_key) || !Array.isArray(match.study_topic_keys)
      || productMatches.has(match.product_topic_key)
      || match.study_topic_keys.some((key) => !studyKeys.has(key))) {
      throw new Error('pilot_audit_comparison_topic_reference_invalid');
    }
    productMatches.set(match.product_topic_key, match.study_topic_keys);
    for (const key of match.study_topic_keys) studyMatches.add(key);
  }
  const studySignals = (rows, kind) => rows.map((signal) => {
    if (!record(signal) || typeof signal.key !== 'string' || typeof signal.label !== 'string'
      || !Array.isArray(signal.product_topic_keys)
      || signal.product_topic_keys.some((key) => !productKeys.has(key))) {
      throw new Error('pilot_audit_comparison_signal_reference_invalid');
    }
    return { key: signal.key, label: signal.label, found: signal.product_topic_keys.length > 0,
      kind, product_topic_keys: signal.product_topic_keys };
  });
  const productTopics = new Map(snapshot.map.catalog.map((topic) => [topic.topic_key, topic]));
  const studyTopics = new Map(comparison.study_topics.map((topic) => [topic.key, topic]));
  return {
    topics_found_by_both: [...productMatches].filter(([, keys]) => keys.length)
      .map(([product_topic_key, study_topic_keys]) => ({
        product_topic_key,
        product_topic_name: productTopics.get(product_topic_key).name,
        study_topic_keys,
        study_topic_names: study_topic_keys.map((key) => studyTopics.get(key).name),
      })),
    product_only_topics: [...productKeys].filter((key) => !(productMatches.get(key) ?? []).length)
      .map((key) => ({ topic_key: key, name: productTopics.get(key).name, definition: productTopics.get(key).definition })),
    study_only_topics: [...studyKeys].filter((key) => !studyMatches.has(key))
      .map((key) => ({ topic_key: key, name: studyTopics.get(key).name })),
    new_topics: (comparison.new_product_topic_keys ?? []).map((key) => {
      if (!productKeys.has(key) || (productMatches.get(key) ?? []).length) {
        throw new Error('pilot_audit_new_topic_reference_invalid');
      }
      return { topic_key: key, name: productTopics.get(key).name };
    }),
    study_triggers: studySignals(comparison.study_triggers, 'trigger'),
    study_barriers: studySignals(comparison.study_barriers, 'barrier'),
  };
}

export async function loadPilotAuditInputs(snapshotPath, operatorReceiptPath, comparisonPath) {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  validatePilotSnapshot(snapshot);
  const operatorReceipt = JSON.parse(await readFile(operatorReceiptPath, 'utf8'));
  validateOperatorReceipt(snapshot, operatorReceipt);
  const comparison = JSON.parse(await readFile(comparisonPath, 'utf8'));
  return { snapshot, operatorReceipt, comparison };
}

export function buildBlindSamples(snapshot, summary, secret) {
  validatePilotSnapshot(snapshot);
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('pilot_audit_sample_secret_invalid');
  const items = new Map(snapshot.items.map((item) => [item.root_id, item]));
  const rootId = (value) => typeof value === 'string' ? value : value.root_id;
  const ranked = (rows, salt) => rows.map((row) => ({
    row,
    rank: createHmac('sha256', secret).update(`${salt}\0${rootId(row)}`).digest('hex'),
  })).sort((left, right) => left.rank.localeCompare(right.rank)).map(({ row }) => row);
  const samples = [];
  const answerKey = {};
  const addSample = (rootId, cohort, details) => {
    const item = items.get(rootId);
    if (!item) throw new Error('pilot_audit_sample_root_missing');
    const caseId = createHmac('sha256', secret).update(`case\0${cohort}\0${rootId}`).digest('hex').slice(0, 20);
    samples.push({ case_id: caseId, text: item.text });
    answerKey[caseId] = { root_id: rootId, cohort, ...details };
  };
  const rows = new Map(summary.private_rows.map((row) => [row.root_id, row]));
  const topTopics = summary.topics.filter((topic) => topic.volume > 0).slice(0, 10);
  if (topTopics.length !== 10) throw new Error('pilot_audit_top_ten_topics_insufficient');
  for (const [index, topic] of topTopics.entries()) {
    const roots = ranked(summary.private_rows.filter((row) => row.probabilities.some((entry) =>
      entry.topic_key === topic.topic_key && entry.probability > POSITIVE_THRESHOLD))
      .map((row) => row.root_id), `topic:${topic.topic_key}`).slice(0, 50);
    if (roots.length !== 50) throw new Error('pilot_audit_topic_sample_insufficient');
    for (const rootId of roots) {
      const cohort = `topic-${index + 1}`;
      addSample(rootId, cohort, {});
      answerKey[samples.at(-1).case_id].topic_key = topic.topic_key;
      answerKey[samples.at(-1).case_id].probability = rows.get(rootId)?.probabilities
        .find((entry) => entry.topic_key === topic.topic_key)?.probability ?? null;
    }
  }
  const decisionRows = [...rows.values()].filter((row) => {
    const answer = choice(row.answers.trigger_barrier);
    return answer && answer.confidence > POSITIVE_THRESHOLD
      && ['trigger', 'barrier'].includes(answer.selected);
  });
  const triggerBarrierRoots = ranked(decisionRows, 'trigger-barrier').slice(0, 100);
  if (triggerBarrierRoots.length !== 100) throw new Error('pilot_audit_trigger_barrier_sample_insufficient');
  for (const row of triggerBarrierRoots) {
    const answer = choice(row.answers.trigger_barrier);
    addSample(row.root_id, 'trigger-barrier', {});
    answerKey[samples.at(-1).case_id].decision = answer.selected;
    answerKey[samples.at(-1).case_id].confidence = answer.confidence;
  }
  const blindedOrder = (sample) => createHmac('sha256', secret)
    .update(`blind-order\0${sample.case_id}`).digest('hex');
  samples.sort((left, right) => blindedOrder(left).localeCompare(blindedOrder(right)));
  return { samples, answerKey };
}

export function sealAnswerKey(answerKey) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(answerKey).sort(([a], [b]) => a.localeCompare(b))));
  return { answer_key: answerKey, sha256: sha256(canonical), bytes: Buffer.byteLength(canonical) };
}

export function verifyAnswerKeySeal(sealed) {
  return record(sealed) && record(sealed.answer_key)
    && typeof sealed.sha256 === 'string' && sealAnswerKey(sealed.answer_key).sha256 === sealed.sha256;
}

const percent = (value) => value === null ? 'n/d' : `${value.toFixed(1)}%`;
const dollars = (microUsd) => microUsd === null ? 'n/d' : `USD ${(microUsd / 1_000_000).toFixed(6)}`;
const markdownCell = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ');

export function renderPublicReceipt(summary, comparisonDate) {
  if (typeof comparisonDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(comparisonDate)) {
    throw new Error('pilot_audit_receipt_date_invalid');
  }
  const groupCount = summary.bertopic_group_count;
  const stageRows = summary.stages.map((stage) =>
    `| ${markdownCell(stage.name)} | ${stage.input_count} ${stage.input_unit} | ${dollars(stage.usage_value_micro_usd)} | ${dollars(stage.charged_micro_usd)} | ${stage.name === 'claude' ? dollars(stage.charged_per_input_unit_micro_usd) : '—'} | ${stage.free_tokens_used ?? 'n/d'} | ${stage.duration_seconds.toFixed(1)} s |`);
  const topicRows = summary.public_topics.map((topic) =>
    `| ${markdownCell(topic.name)} | ${markdownCell(topic.definition)} | ${topic.volume} |`);
  return [
    '# Piloto de etiquetado masivo · Estudio real A (cerveza, Brasil)',
    '',
    `Fecha de corte: ${comparisonDate}. Mapa congelado antes de comparar con el estudio entregado.`,
    '',
    `Raíces: ${summary.root_count}. Grupos BERTopic totales (incluye Noise y grupos no adoptados): ${groupCount}. Tópicos finales: ${summary.public_topics.length}.`,
    `Universo de menciones: ${summary.population.unique_roots.toLocaleString('en-US')} únicas, ${summary.population.excluded_roots.toLocaleString('en-US')} excluidas y ${summary.population.eligible_roots.toLocaleString('en-US')} elegibles.`,
    '',
    '## Costos y tiempos',
    '',
    '| Etapa | Población de entrada | Valor tarifario del uso | Cargo confirmado | Claude por grupo | Tokens gratis | Tiempo de reloj |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...stageRows,
    '',
    `Cargo total confirmado: ${dollars(summary.charged_micro_usd)}. Por 1,000 raíces: ${dollars(summary.charged_per_1000_micro_usd)}. Proyección a 1,000,000 raíces: ${dollars(summary.charged_per_million_micro_usd)}.`,
    `Valor tarifario del uso: ${dollars(summary.usage_value_micro_usd)}. Tokens gratis consumidos: ${summary.free_tokens_used ?? 'n/d'}.`,
    'La proyección a 1,000,000 de raíces es lineal y supone la misma mezcla de procesamiento y tamaño del mapa. El costo de Claude se muestra por grupo porque puede cambiar al variar el número o tamaño de los grupos.',
    '',
    '## Cobertura',
    '',
    `Tópico > 0.7: ${percent(summary.coverage.covered_percent)}. Franja intermedia ([0.3, 0.7], sin tópico positivo): ${percent(summary.coverage.intermediate_percent)}. Sin tópico (< 0.3): ${percent(summary.coverage.no_topic_percent)}. Sin resultado válido: ${percent(summary.coverage.unresolved_percent)}.`,
    `Promoción > 0.7: ${percent(summary.promotion.percent)} de respuestas válidas. Spam o bot > 0.7: ${percent(summary.spam.percent)} de respuestas válidas.`,
    `Triggers: ${summary.trigger_barrier.trigger} (${percent(summary.trigger_barrier.trigger_percent)}). Barriers: ${summary.trigger_barrier.barrier} (${percent(summary.trigger_barrier.barrier_percent)}). None: ${summary.trigger_barrier.none} (${percent(summary.trigger_barrier.none_percent)}). Intermedio: ${summary.trigger_barrier.intermediate} (${percent(summary.trigger_barrier.intermediate_percent)}). Sin resolver: ${summary.trigger_barrier.unresolved}.`,
    '',
    '## Mapa de tópicos',
    '',
    `<details><summary>${summary.public_topics.length} tópicos, ${groupCount} grupos BERTopic</summary>`,
    '',
    '| Tópico | Definición | Raíces con probabilidad > 0.7 |',
    '|---|---|---:|',
    ...topicRows,
    '',
    '</details>',
  ].join('\n');
}

export function renderPrivateComparisonAnnex(comparison) {
  return JSON.stringify(comparison, null, 2) + '\n';
}

export function renderBlindSamples(samples) {
  return samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : '');
}

export function renderSealedAnswerKey(answerKey) {
  return JSON.stringify(sealAnswerKey(answerKey), null, 2) + '\n';
}
