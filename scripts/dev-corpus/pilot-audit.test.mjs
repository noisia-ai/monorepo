import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
  buildBlindSamples,
  comparePilotSnapshot,
  derivePilotJevAuthorization,
  computeSnapshotDigest,
  computeJsonStringifyDigest,
  loadPilotAuditInputs,
  renderBlindSamples,
  renderPrivateComparisonAnnex,
  renderPublicReceipt,
  renderSealedAnswerKey,
  readPilotSnapshot,
  sealAnswerKey,
  summarizePilotSnapshot,
  validatePilotSnapshot,
  verifyAnswerKeySeal,
} from './pilot-audit.mjs';

const topicAnswer = (probability) => ({ type: 'noul', noul: probability });
const choiceAnswer = (selected, probability) => ({
  type: 'choice',
  choice: selected,
  confidence: probability,
  probabilities: {
    trigger: selected === 'trigger' ? probability : (1 - probability) / 2,
    barrier: selected === 'barrier' ? probability : (1 - probability) / 2,
    none: selected === 'none' ? probability : (1 - probability) / 2,
  },
});
const result = (root_id, topic0, topic1, decision, decisionProbability) => ({
  root_id,
  call_id: root_id === 'root-1' ? 'call-smoke' : `call-full-${root_id}`,
  status: 'completed',
  probabilities: {
    relevance: topicAnswer(0.9),
    promotion: topicAnswer(0.2),
    spam: topicAnswer(0.1),
    voice: choiceAnswer('consumer', 0.9),
    trigger_barrier: choiceAnswer(decision, decisionProbability),
    topic_0: topicAnswer(topic0),
    topic_1: topicAnswer(topic1),
  },
});

function fixture({ funded = false } = {}) {
  const smokeMetrics = { root_count: 1, technical_failure: false };
  const smokeMetricsCanonical = canonicalForTest(smokeMetrics);
  const smokeMetricsDigest = `sha256:${createHash('sha256').update(smokeMetricsCanonical).digest('hex')}`;
  const snapshot = {
    contract_version: 'mass-labeling-private-export-v1',
    exported_at: '2026-11-07T12:02:00.000Z',
    map: {
      id: 'synthetic-map-id',
      map_digest: 'sha256:synthetic-map-digest',
      created_at: '2026-11-07T12:00:00.000Z',
      root_count: 5,
      source_engine_execution_id: 'synthetic-engine-run',
      preparation_run_id: 'synthetic-preparation-run',
      input_revision: 7,
      catalog: [
        { topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', group_ids: ['g1'] },
        { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', group_ids: ['g2'] },
      ],
    },
    run: { id: 'synthetic-label-run', run_id: 'synthetic-label-run', map_id: 'synthetic-map-id', workspace_id: 'synthetic-workspace',
      actor_user_id: '00000000-0000-4000-8000-000000000003',
      status: 'completed', smoke_root_limit: null, smoke_metrics: smokeMetrics,
      smoke_metrics_digest: smokeMetricsDigest, continued_at: '2026-11-07T12:01:00.000Z' },
    items: [
      { map_id: 'synthetic-map-id', root_id: 'root-1', ordinal: 1, input_digest: 'sha256:synthetic-input-1',
        chunk_index: 0, text: 'Synthetic mention one', status: 'labeled', call_id: 'call-smoke',
        probabilities: result('root-1', 0.8, 0.1, 'trigger', 0.9).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:01.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-2', ordinal: 2, input_digest: 'sha256:synthetic-input-2',
        chunk_index: 0, text: 'Synthetic mention two', status: 'labeled', call_id: 'call-full-root-2',
        probabilities: result('root-2', 0.7, 0.2, 'none', 0.55).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:02.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-3', ordinal: 3, input_digest: 'sha256:synthetic-input-3',
        chunk_index: 0, text: 'Synthetic mention three', status: 'abstained', call_id: 'call-full-root-3',
        probabilities: result('root-3', 0.1, 0.3, 'barrier', 0.8).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:03.000Z' },
      { map_id: 'synthetic-map-id', root_id: 'root-4', ordinal: 4, input_digest: 'sha256:synthetic-input-4',
        chunk_index: 0, text: 'Synthetic mention four', status: null, call_id: null, probabilities: null,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: null },
      { map_id: 'synthetic-map-id', root_id: 'root-5', ordinal: 5, input_digest: 'sha256:synthetic-input-5',
        chunk_index: 0, text: 'Synthetic mention five', status: 'labeled', call_id: 'call-full-root-5',
        probabilities: result('root-5', 0.2, 0.29, 'none', 0.8).probabilities,
        candidates: [{ topic_key: 'product-a', name: 'Synthetic topic A', definition: 'Synthetic definition A', similarity: 0.9 },
          { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B', similarity: 0.8 }],
        error_code: null, result_created_at: '2026-11-07T12:01:05.000Z' },
    ],
    calls: [
      { id: 'call-smoke', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'settled',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 1000 },
        request_digest: 'sha256:synthetic-request-1', raw_sha256: 'sha256:synthetic-raw-1', results_applied: true,
        budget_date: '2026-11-07', budget_timezone: 'UTC' },
      { id: 'call-full-root-2', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'settled',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 3000 },
        request_digest: 'sha256:synthetic-request-2', raw_sha256: 'sha256:synthetic-raw-2', results_applied: true,
        budget_date: '2026-11-07', budget_timezone: 'UTC' },
      { id: 'call-full-root-3', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'settled',
        reserved_micro_usd: '10000', settled_micro_usd: '12340', terminal_exposure_micro_usd: '12340', usage: { input_tokens: 3000 },
        request_digest: 'sha256:synthetic-request-3', raw_sha256: 'sha256:synthetic-raw-3', results_applied: true,
        budget_date: '2026-11-07', budget_timezone: 'UTC' },
      { id: 'call-full-root-5', run_id: 'synthetic-label-run', model: 'synthetic-jev-v1', status: 'settled',
        reserved_micro_usd: '10000', settled_micro_usd: '0', terminal_exposure_micro_usd: '0', usage: { input_tokens: 4000 },
        request_digest: 'sha256:synthetic-request-5', raw_sha256: 'sha256:synthetic-raw-5', results_applied: true,
        budget_date: '2026-11-07', budget_timezone: 'UTC' },
    ],
    stage_receipts: {
      embeddings: { input_tokens: '5000' },
      engine: { id: 'synthetic-engine-run', status: 'completed', result_summary: { fit_checkpoint: { interpretation_manifest: { unit_count: 12 } } } },
      editorial_calls: [{ id: 'editorial-call', settled_micro_usd: '0', input_tokens: 0, usage: { input_tokens: 0 } }],
    },
  };
  if (funded) snapshot.scoped_authority = syntheticScopedAuthority(snapshot);
  return snapshot;
}

const fundedFixture = () => fixture({ funded: true });

function syntheticScopedAuthority(snapshot) {
  const extensionId = '00000000-0000-4000-8000-000000000010';
  const admissionId = '00000000-0000-4000-8000-000000000011';
  const fundingId = '00000000-0000-4000-8000-000000000012';
  const digest = (character) => `sha256:${character.repeat(64)}`;
  const smokeDigestRows = snapshot.calls.filter((call) => call.id === 'call-smoke').map((call) => ({
    id: call.id, run_id: call.run_id, model: call.model, status: call.status,
    reserved_micro_usd: String(call.reserved_micro_usd), settled_micro_usd: String(call.settled_micro_usd),
    terminal_exposure_micro_usd: String(call.terminal_exposure_micro_usd), usage: call.usage,
    request_digest: call.request_digest, raw_sha256: call.raw_sha256, results_applied: call.results_applied,
    budget_date: call.budget_date, budget_timezone: call.budget_timezone,
  }));
  const quote = {
    contract_version: 'mass-labeling-smoke-usage-quote-v1', basis: 'ledger_usage_at_sealed_tariff',
    model: 'synthetic-jev-v1', input_usd_per_mtok: 0.042, population_roots: snapshot.map.root_count,
    observed_smoke_roots: 1, observed_smoke_calls: 1, observed_input_tokens: 1000,
    observed_settled_micro_usd: '0', projected_total_usage_micro_usd: '8804000',
    observed_max_page_reserved_micro_usd: '10000', page_size: 200,
    reserve_observation_basis: 'max_200_call_window_from_smoke', total_cap_micro_usd: '9500000',
    provider_charged_micro_usd: null,
  };
  const funding = {
    contract_version: 'mass-labeling-prospective-total-budget-v1',
    id: fundingId, scoped_admission_id: admissionId, extension_id: extensionId,
    organization_id: 'synthetic-organization', workspace_id: 'synthetic-workspace',
    map_id: snapshot.map.id, map_digest: snapshot.map.map_digest,
    run_id: snapshot.run.id, actor_user_id: snapshot.run.actor_user_id,
    base_policy_version_id: 'synthetic-base-policy', base_policy_digest: digest('a'),
    labeler_digest: digest('b'), entity_context_digest: digest('c'),
    smoke_metrics_canonical: canonicalForTest(snapshot.run.smoke_metrics),
    prior_total_cap_micro_usd: '6970000', total_cap_micro_usd: '9500000',
    prior_admission_receipt_digest: digest('d'), prior_budget_date: '2026-11-07', prior_budget_timezone: 'UTC',
    smoke_metrics_digest: snapshot.run.smoke_metrics_digest, smoke_root_count: 1, smoke_call_count: 1,
    smoke_calls_digest: `sha256:${createHash('sha256').update(canonicalForTest(smokeDigestRows)).digest('hex')}`,
    budget_date: '2026-11-07', budget_timezone: 'UTC', admission_not_after: '2026-11-08T12:00:00.000000Z',
    idempotency_key: 'synthetic-funding-idempotency',
    quote, quote_digest: `sha256:${createHash('sha256').update(canonicalForTest(quote)).digest('hex')}`,
    created_at: '2026-11-07T12:01:00.000000Z', created_by_user_id: snapshot.run.actor_user_id,
  };
  funding.receipt_digest = `sha256:${createHash('sha256').update(canonicalForTest(
    Object.fromEntries(Object.entries(funding).filter(([key]) => key !== 'quote')),
  )).digest('hex')}`;
  return {
    extension: { id: extensionId, organization_id: 'synthetic-organization', workspace_id: 'synthetic-workspace',
      map_id: snapshot.map.id, map_digest: snapshot.map.map_digest, actor_user_id: snapshot.run.actor_user_id,
      base_policy_version_id: 'synthetic-base-policy', base_policy_digest: digest('a'), cap_micro_usd: '6970000' },
    admission: {
      id: admissionId, extension_id: extensionId, organization_id: 'synthetic-organization',
      workspace_id: 'synthetic-workspace', map_id: snapshot.map.id, target_id: snapshot.run.id,
      actor_user_id: snapshot.run.actor_user_id, policy_version_id: 'synthetic-base-policy',
      budget_date: '2026-11-07', budget_timezone: 'UTC',
      receipt_digest: digest('d'),
    },
    effective_total_cap_micro_usd: '9500000',
    funding_receipts: [funding],
    call_authorities: snapshot.calls.map((call, index) => ({
      call_id: call.id, scoped_admission_id: admissionId,
      funding_receipt_id: index === 0 ? null : fundingId,
    })),
  };
}

function operatorReceipt(snapshot = fixture()) {
  const timing = (name, input_count, duration, charged_micro_usd, usage_value_micro_usd,
    free_tokens_used, input_tokens, ledger_call_ids = []) => ({
    name,
    input_count,
    input_unit: name === 'voyage' ? 'fragments' : name === 'claude' ? 'groups' : 'roots',
    charged_micro_usd,
    usage_value_micro_usd,
    free_tokens_used,
    input_tokens,
    ledger_call_ids,
    started_at: '2026-11-07T12:00:00.000Z',
    completed_at: new Date(Date.parse('2026-11-07T12:00:00.000Z') + duration * 1000).toISOString(),
  });
  return {
    contract_version: 'signal-mass-labeling-operator-receipt-v1',
    map_digest: 'sha256:synthetic-map-digest',
    snapshot_sha256: computeSnapshotDigest(snapshot),
    population: { unique_roots: 6, excluded_roots: 1, eligible_roots: 5 },
    public_catalog: {
      map_digest: snapshot.map.map_digest,
      private_identity_terms: ['confidential brand zeta', 'private competitor omega'],
      topics: snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
        public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` })),
    },
    stages: [
      timing('voyage', 5, 2, 0, 10000, 5000, 5000),
      { ...timing('bertopic', 5, 5, 0, 0, 0, 0), group_count: 12 },
      timing('claude', 2, 3, 0, 0, 0, 0, ['editorial-call']),
      timing('jev_smoke', 1, 2, 0, 0, 0, 1000, ['call-smoke']),
      timing('jev_full', 3, 5, 12340, 12340, 0, 10000,
        ['call-full-root-2', 'call-full-root-3', 'call-full-root-5']),
    ],
  };
}

const comparison = {
  map_digest: 'sha256:synthetic-map-digest',
  study_topics: [{ key: 'study-a', name: 'Synthetic study topic A' }, { key: 'study-b', name: 'Synthetic study topic B' }],
  topic_matches: [{ product_topic_key: 'product-a', study_topic_keys: ['study-a'] }],
  new_product_topic_keys: ['product-b'],
  study_triggers: [{ key: 'trigger-a', label: 'Synthetic trigger', product_topic_keys: ['product-a'] }],
  study_barriers: [{ key: 'barrier-a', label: 'Synthetic barrier', product_topic_keys: [] }],
};

function canonicalForTest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalForTest(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function resealFundingReceipt(funding) {
  const { quote: _quote, receipt_digest: _receiptDigest, ...dto } = funding;
  funding.receipt_digest = `sha256:${createHash('sha256').update(canonicalForTest(dto)).digest('hex')}`;
}

function enrichedEditorialSnapshot() {
  const snapshot = fixture();
  const stage = { stage: 'global-consolidation-v1', source_groups_digest: `sha256:${'a'.repeat(64)}` };
  const configuration = {
    provider: 'anthropic', model: 'synthetic-model', prompt_digest: `sha256:${'b'.repeat(64)}`,
    schema_digest: `sha256:${'c'.repeat(64)}`, pricing_version: 'synthetic-v1',
    input_micro_usd_per_million_tokens: 1_000_000, output_micro_usd_per_million_tokens: 1_000_000,
    cache_read_micro_usd_per_million_tokens: 1_000_000, cache_creation_micro_usd_per_million_tokens: 1_000_000,
  };
  const terminalUsage = {
    input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 3,
  };
  const terminalReceipt = {
    contract_version: 'workspace-provider-terminal-evidence-v1', source: 'anthropic_console',
    provider_request_id: 'req_synthetic_terminal', provider_model: configuration.model,
    started_at: '2026-11-07T12:00:10.000Z', ended_at: '2026-11-07T12:00:11.000Z',
    http_status: 499, reason: 'client_disconnected', billing_status: 'unreconciled',
    usage: terminalUsage, usage_cost_micro_usd: 19, verified_by_user_id: '00000000-0000-4000-8000-000000000001',
    call_id: 'synthetic-terminal-call', attempt_token: 'synthetic-attempt-1',
    workspace_id: 'synthetic-workspace', execution_id: 'synthetic-engine-run',
    request_digest: `sha256:${'d'.repeat(64)}`,
    configuration_digest: `sha256:${createHash('sha256').update(canonicalForTest(configuration)).digest('hex')}`,
    evidence: { storage_key: 'workspace-engine/synthetic-workspace/synthetic-engine-run/evidence.json',
      sha256: `sha256:${'e'.repeat(64)}`, size_bytes: 240 },
    verified_at: '2026-11-07T12:00:12.000Z',
  };
  const terminal = {
    id: terminalReceipt.call_id, call_state: 'terminal_confirmed', retry_of_call_id: null,
    request_digest: terminalReceipt.request_digest, actor_user_id: terminalReceipt.verified_by_user_id,
    workspace_id: terminalReceipt.workspace_id, catalog_execution_id: terminalReceipt.execution_id,
    provider: configuration.provider, model: configuration.model, call_configuration: configuration,
    reserved_micro_usd: '100', settled_micro_usd: '19', input_tokens: 15, output_tokens: 4, total_tokens: 19,
    response_http_status: null, response_storage_key: null, response_sha256: null, response_size_bytes: null,
    response_complete: null, settled_at: '2026-11-07T12:00:13.000Z',
    usage: terminalUsage,
    metadata: {
      mass_labeling_stage: stage,
      provider_terminal_receipt: terminalReceipt,
      provider_terminal_billing_reconciliation: {
        contract_version: 'workspace-provider-terminal-billing-v1', method: 'audited_usage_pricing',
        provider_request_id: terminalReceipt.provider_request_id,
        terminal_receipt_digest: `sha256:${createHash('sha256').update(canonicalForTest(terminalReceipt)).digest('hex')}`,
        actual_micro_usd: 19, usage: terminalUsage,
        verified_by_user_id: terminalReceipt.verified_by_user_id, reconciled_at: '2026-11-07T12:00:14.000Z',
      },
    },
  };
  const successor = {
    id: 'synthetic-successor-call', call_state: 'settled', retry_of_call_id: terminal.id,
    request_digest: terminal.request_digest, actor_user_id: terminal.actor_user_id,
    workspace_id: terminal.workspace_id, catalog_execution_id: terminal.catalog_execution_id,
    provider: terminal.provider, model: terminal.model, call_configuration: structuredClone(configuration),
    reserved_micro_usd: terminal.reserved_micro_usd, settled_micro_usd: '7', input_tokens: 5, output_tokens: 2, total_tokens: 7,
    response_http_status: 200, response_storage_key: 'workspace-engine/synthetic-workspace/synthetic-engine-run/response.json',
    response_sha256: `sha256:${'f'.repeat(64)}`, response_size_bytes: '800', response_complete: true,
    settled_at: '2026-11-07T12:00:20.000Z',
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    metadata: { mass_labeling_stage: stage, response_complete: true },
  };
  const groupCalls = Array.from({ length: 144 }, (_, index) => ({
    id: `synthetic-group-call-${index + 1}`, call_state: 'settled', retry_of_call_id: null,
    request_digest: `sha256:${String(index + 10).padStart(64, '0')}`,
    actor_user_id: terminal.actor_user_id, workspace_id: terminal.workspace_id,
    catalog_execution_id: terminal.catalog_execution_id, provider: terminal.provider, model: terminal.model,
    call_configuration: structuredClone(configuration), reserved_micro_usd: '100', settled_micro_usd: '1',
    input_tokens: 1, output_tokens: 0, total_tokens: 1,
    response_http_status: 200, response_storage_key: `workspace-engine/synthetic-workspace/synthetic-engine-run/group-${index + 1}.json`,
    response_sha256: `sha256:${String(index + 100).padStart(64, '0')}`, response_size_bytes: '100', response_complete: true,
    settled_at: '2026-11-07T12:00:15.000Z', usage: { input_tokens: 1, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, metadata: {},
  }));
  snapshot.stage_receipts.engine.result_summary.fit_checkpoint.interpretation_manifest.unit_count = 144;
  snapshot.map.consolidation_artifact_id = 'synthetic-consolidation-artifact';
  snapshot.map.consolidation_digest = `sha256:${'9'.repeat(64)}`;
  snapshot.stage_receipts.editorial_calls = [...groupCalls, terminal, successor];
  snapshot.stage_receipts.consolidation_artifact = {
    id: snapshot.map.consolidation_artifact_id,
    artifact_key: 'mass-labeling-consolidation.json',
    content: { contract_version: 'workspace-engine-private-artifact-v1',
      storage_key: 'workspace-engine/synthetic-workspace/synthetic-engine-run/consolidation.json',
      sha256: snapshot.map.consolidation_digest, size_bytes: 900, media_type: 'application/json' },
    metadata: { contract_version: 'workspace-mass-labeling-consolidation-v1',
      source_engine_execution_id: snapshot.stage_receipts.engine.id, stage: stage.stage,
      source_groups_digest: stage.source_groups_digest, call_id: successor.id,
      request_digest: successor.request_digest, response_sha256: successor.response_sha256 },
  };
  const receipt = operatorReceipt(snapshot);
  const claude = receipt.stages.find((row) => row.name === 'claude');
  receipt.stages.find((row) => row.name === 'bertopic').group_count = 144;
  claude.ledger_call_ids = snapshot.stage_receipts.editorial_calls.map((call) => call.id);
  claude.usage_value_micro_usd = 170;
  claude.input_tokens = 164;
  claude.input_count = 144;
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  return { snapshot, receipt };
}

function recoveredGlobalEditorialSnapshot() {
  const { snapshot } = enrichedEditorialSnapshot();
  snapshot.stage_receipts.engine.input_digest = `sha256:${'1'.repeat(64)}`;
  snapshot.stage_receipts.engine.result_summary.fit_checkpoint.checkpoint_digest = `sha256:${'2'.repeat(64)}`;
  const catalog = Array.from({ length: 98 }, (_, index) => ({
    topic_key: `synthetic-topic-${index + 1}`,
    name: `Synthetic topic ${index + 1}`,
    definition: `Synthetic definition ${index + 1}`,
    group_ids: index < 16 ? [`synthetic-group-${index + 1}`] : [],
  }));
  catalog[0] = { topic_key: 'acucar', name: 'Synthetic retained topic A',
    definition: 'Synthetic retained definition A', group_ids: ['synthetic-duplicate-group'] };
  catalog[1] = { topic_key: 'cafe', name: 'Synthetic retained topic B',
    definition: 'Synthetic retained definition B', group_ids: [] };
  catalog[2] = { topic_key: 'bebidasn', name: 'Synthetic retained topic C',
    definition: 'Synthetic retained definition C', group_ids: [] };
  snapshot.map.catalog = catalog;
  for (const item of snapshot.items) {
    item.candidates[0] = { ...item.candidates[0], topic_key: 'acucar', name: catalog[0].name,
      definition: catalog[0].definition };
    item.candidates[1] = { ...item.candidates[1], topic_key: 'cafe', name: catalog[1].name,
      definition: catalog[1].definition };
  }
  const changes = [
    { from: 'açúcar', to: 'acucar' },
    { from: 'café', to: 'cafe' },
    { from: 'bebidasñ', to: 'bebidasn' },
  ];
  const decision = {
    contract_version: 'workspace-mass-labeling-receipt-recovery-v1',
    workspace_id: 'synthetic-workspace', execution_id: 'synthetic-engine-run',
    call_id: 'synthetic-successor-call', request_digest: `sha256:${'d'.repeat(64)}`,
    response_sha256: `sha256:${'f'.repeat(64)}`,
    source_groups_digest: `sha256:${'a'.repeat(64)}`,
    topic_key_changes: changes,
    assignment_resolution: {
      method: 'source_segments_and_exact_remaining_summary', group_id: 'synthetic-duplicate-group',
      keep_topic_key: 'açúcar', remove_topic_key: 'café',
      definition_omission: { unit: 'unicode_code_points', prefix_length: 18, removed_length: 5, suffix_length: 22 },
    },
  };
  const decisionDigest = `sha256:${createHash('sha256').update(canonicalForTest(decision)).digest('hex')}`;
  snapshot.stage_receipts.global_receipt_recovery_decision = {
    decision_id: 'synthetic-recovery-decision', workspace_id: decision.workspace_id,
    execution_id: decision.execution_id, call_id: decision.call_id,
    request_digest: decision.request_digest, response_sha256: decision.response_sha256,
    source_groups_digest: decision.source_groups_digest,
    input_digest: snapshot.stage_receipts.engine.input_digest,
    fit_checkpoint_digest: snapshot.stage_receipts.engine.result_summary.fit_checkpoint.checkpoint_digest,
    decision_digest: decisionDigest, decision,
    created_by_user_id: '00000000-0000-4000-8000-000000000001', created_at: '2026-11-07T12:00:30.000Z',
  };
  snapshot.stage_receipts.engine.result_summary.global_receipt_recovery_decision_id = 'synthetic-recovery-decision';
  snapshot.stage_receipts.consolidation_artifact.metadata.recovery_decision_id = 'synthetic-recovery-decision';
  snapshot.stage_receipts.consolidation_artifact.metadata.recovery_decision_digest = decisionDigest;
  const receipt = operatorReceipt(snapshot);
  const claude = receipt.stages.find((row) => row.name === 'claude');
  claude.ledger_call_ids = snapshot.stage_receipts.editorial_calls.map((call) => call.id);
  claude.usage_value_micro_usd = 170;
  claude.input_tokens = 164;
  claude.input_count = 144;
  receipt.stages.find((row) => row.name === 'bertopic').group_count = 144;
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  return { snapshot, receipt };
}

test('rejects snapshots without a frozen map before baseline comparison can be read', async () => {
  const snapshot = fixture();
  snapshot.map.created_at = null;
  assert.throws(() => validatePilotSnapshot(snapshot), /map_not_frozen/u);
});

test('streams item and call records while preserving JSON.stringify snapshot digest bytes', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'pilot-audit-stream-'));
  const path = join(directory, 'snapshot.json');
  try {
    const snapshot = fixture();
    snapshot.items.forEach((item) => { item.text = 'synthetic '.repeat(60000); });
    const serialized = JSON.stringify(snapshot);
    await writeFile(path, serialized);
    const parsed = await readPilotSnapshot(path);
    validatePilotSnapshot(parsed);
    assert.equal(computeSnapshotDigest(parsed), createHash('sha256').update(serialized).digest('hex'));
    assert.equal(JSON.stringify(parsed), serialized);
    await writeFile(path, '{"items":[{} ,],"calls":[]}');
    await assert.rejects(readPilotSnapshot(path), SyntaxError);
    await writeFile(path, '{\u00a0"items":[],"calls":[]}');
    await assert.rejects(readPilotSnapshot(path), SyntaxError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('incremental JSON digest matches JSON.stringify for JSON values and rejects toJSON objects', () => {
  const sparse = [];
  sparse.length = 2;
  const value = { omitted: undefined, sparse, nested: [undefined, Number.NaN, -0] };
  assert.equal(computeJsonStringifyDigest(value), createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  assert.throws(() => computeJsonStringifyDigest(new Date('2026-01-01T00:00:00.000Z')),
    /json_plain_objects/u);
});

test('accepts the H2 full export with null smoke_root_limit and partitions calls by persisted smoke_metrics.root_count', () => {
  const snapshot = fixture();
  assert.equal(snapshot.run.smoke_root_limit, null);
  assert.equal(snapshot.run.smoke_metrics.root_count, 1);
  const summary = summarizePilotSnapshot(snapshot, operatorReceipt(snapshot));
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_smoke').input_count, 1);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_full').input_count, 3);
  const invalidLegacyLimit = structuredClone(snapshot);
  invalidLegacyLimit.run.smoke_root_limit = 1;
  assert.throws(() => validatePilotSnapshot(invalidLegacyLimit), /map_not_frozen/u);
});

test('reads no baseline content until both frozen map and operator receipt match', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'pilot-audit-'));
  const snapshotPath = join(directory, 'snapshot.json');
  const operatorPath = join(directory, 'operator.json');
  const comparisonPath = join(directory, 'comparison.json');
  try {
    const snapshot = fixture();
    const receipt = operatorReceipt();
    receipt.snapshot_sha256 = 'wrong';
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    await writeFile(operatorPath, JSON.stringify(receipt));
    await writeFile(comparisonPath, '{ invalid baseline data');
    await assert.rejects(loadPilotAuditInputs(snapshotPath, operatorPath, comparisonPath), /operator_receipt_invalid/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('summarizes threshold coverage, calls, timing, and cost projections', () => {
  const summary = summarizePilotSnapshot(fixture(), operatorReceipt());
  assert.deepEqual(summary.coverage, {
    covered: 1, intermediate: 2, no_topic: 1, unresolved: 1,
    covered_percent: 20, intermediate_percent: 40, no_topic_percent: 20, unresolved_percent: 20,
  });
  assert.deepEqual(summary.trigger_barrier, {
    trigger: 1, barrier: 1, none: 1, intermediate: 1, unresolved: 1,
    trigger_percent: 20, barrier_percent: 20, none_percent: 20, intermediate_percent: 20, unresolved_percent: 20,
  });
  assert.equal(summary.topics[0].volume, 1);
  assert.equal(summary.charged_per_1000_micro_usd, 2_468_000);
  assert.equal(summary.charged_per_million_micro_usd, 2_468_000_000);
  assert.equal(summary.usage_value_micro_usd, 22_340);
  assert.equal(summary.estimated_cash_usage_micro_usd, 12_340);
  assert.equal(summary.free_tokens_used, 5_000);
  assert.equal(summary.stages[0].duration_seconds, 2);
  assert.equal(summary.bertopic_group_count, 12);
  const duplicateCall = operatorReceipt();
  duplicateCall.stages[4].ledger_call_ids = ['call-smoke'];
  assert.throws(() => summarizePilotSnapshot(fixture(), duplicateCall), /input_count_mismatch/u);
});

function version2DelayedReceipt(snapshot = fundedFixture()) {
  const receipt = operatorReceipt(snapshot);
  receipt.contract_version = 'signal-mass-labeling-operator-receipt-v2';
  receipt.jev_authorization = derivePilotJevAuthorization(snapshot);
  for (const stage of receipt.stages.filter((row) => row.name.startsWith('jev_'))) stage.charged_micro_usd = null;
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  const observations = ['smoke_before', 'smoke_after', 'full_before', 'full_after'].map((boundary, index) => ({
    boundary, balance_micro_usd: 30_000_000, observed_at: `2026-11-07T12:0${index}:00.000Z`,
    evidence_sha256: createHash('sha256').update(`synthetic-${boundary}`).digest('hex'),
  }));
  receipt.jev_charge_reconciliation = {
    status: 'delayed', attributed_smoke_micro_usd: null, attributed_full_micro_usd: null,
    attribution_evidence_sha256: { smoke: null, full: null },
    unattributed_interval_change_micro_usd: 0, observations,
  };
  return receipt;
}

test('v2 reconciles one cumulative cap and discloses delayed cash separately from token-valued use', () => {
  const snapshot = fundedFixture();
  const receipt = version2DelayedReceipt(snapshot);
  const summary = summarizePilotSnapshot(snapshot, receipt);
  assert.equal(summary.charged_micro_usd, null);
  assert.equal(summary.usage_value_micro_usd, 22_340);
  assert.equal(summary.scoped_jev_cumulative_cap_micro_usd, 9_500_000);
  assert.equal(summary.jev_charge_reconciliation.status, 'delayed');
  const markdown = renderPublicReceipt(summary, '2026-11-07');
  assert.match(markdown, /USD 9\.500000/u);
  assert.match(markdown, /\| 180 \|/u);
  assert.match(markdown, /La consola del proveedor aún no confirma débitos de JEV/u);
  assert.match(markdown, /Voyage usó 5,000 tokens gratis; su cargo efectivo confirmado fue USD 0\.000000/u);
  assert.doesNotMatch(markdown, /Estimación de caja con crédito de Voyage aplicado/u);
  assert.doesNotMatch(markdown, /6\.970000 \+ 9\.500000/u);
});

test('derives a public-safe authorization summary without workspace, map, run, or call IDs', () => {
  const authorization = derivePilotJevAuthorization(fundedFixture());
  assert.deepEqual({
    contract_version: authorization.contract_version,
    currency: authorization.currency,
    smoke_root_count: authorization.smoke_root_count,
    full_root_count: authorization.full_root_count,
    previous_total_cap_micro_usd: authorization.previous_total_cap_micro_usd,
    cumulative_total_cap_micro_usd: authorization.cumulative_total_cap_micro_usd,
    observed_smoke_usage_value_micro_usd: authorization.observed_smoke_usage_value_micro_usd,
    observed_full_usage_value_micro_usd: authorization.observed_full_usage_value_micro_usd,
    projected_total_usage_micro_usd: authorization.estimate.projected_total_usage_value_micro_usd,
  }, {
    contract_version: 'signal-mass-labeling-jev-authorization-v1', currency: 'USD',
    smoke_root_count: 1, full_root_count: 4, previous_total_cap_micro_usd: 6_970_000,
    cumulative_total_cap_micro_usd: 9_500_000, observed_smoke_usage_value_micro_usd: 0,
    observed_full_usage_value_micro_usd: 12_340, projected_total_usage_micro_usd: 8_804_000,
  });
  assert.doesNotMatch(JSON.stringify(authorization), /synthetic-(?:workspace|label-run|map-id)|call-/u);
});

test('requires receipt v2 whenever the snapshot contains prospective funding, preserving v1 only for historical exports', () => {
  const historicalSnapshot = fixture();
  assert.doesNotThrow(() => summarizePilotSnapshot(historicalSnapshot, operatorReceipt(historicalSnapshot)));

  const funded = fundedFixture();
  const downgraded = operatorReceipt(funded);
  downgraded.snapshot_sha256 = computeSnapshotDigest(funded);
  assert.throws(() => summarizePilotSnapshot(funded, downgraded), /operator_receipt_invalid/u);
  const validV2 = summarizePilotSnapshot(funded, version2DelayedReceipt(funded));
  validV2.operator_receipt_contract_version = 'signal-mass-labeling-operator-receipt-v1';
  assert.throws(() => renderPublicReceipt(validV2, '2026-11-07'), /v2_required_for_scoped_funding/u);
});

test('detects a stripped funding row from remaining full-call bindings and cap markers', () => {
  const snapshot = fundedFixture();
  snapshot.scoped_authority.funding_receipts = [];
  snapshot.scoped_authority.call_authorities = snapshot.scoped_authority.call_authorities.map((binding) => ({
    ...binding, funding_receipt_id: null,
  }));
  snapshot.scoped_authority.effective_total_cap_micro_usd = snapshot.scoped_authority.extension.cap_micro_usd;
  const downgraded = operatorReceipt(snapshot);
  downgraded.snapshot_sha256 = computeSnapshotDigest(snapshot);
  assert.throws(() => summarizePilotSnapshot(snapshot, downgraded), /operator_receipt_invalid/u);
});

test('v2 attributes only direct smoke evidence and leaves an intervening balance decrease unassigned', () => {
  const snapshot = fundedFixture();
  const receipt = version2DelayedReceipt(snapshot);
  const smoke = receipt.stages.find((stage) => stage.name === 'jev_smoke');
  smoke.charged_micro_usd = 100;
  const [before, after, fullBefore, fullAfter] = receipt.jev_charge_reconciliation.observations;
  before.balance_micro_usd = 30_000_000;
  after.balance_micro_usd = 29_999_900;
  fullBefore.balance_micro_usd = 28_999_900;
  fullAfter.balance_micro_usd = 28_999_900;
  receipt.jev_charge_reconciliation.status = 'interval_unattributed';
  receipt.jev_charge_reconciliation.attributed_smoke_micro_usd = 100;
  receipt.jev_charge_reconciliation.attribution_evidence_sha256.smoke = createHash('sha256').update('direct-smoke-evidence').digest('hex');
  receipt.jev_charge_reconciliation.unattributed_interval_change_micro_usd = 1_000_000;
  const summary = summarizePilotSnapshot(snapshot, receipt);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_smoke').charged_micro_usd, 100);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_full').charged_micro_usd, null);
  assert.equal(summary.charged_micro_usd, null);
  assert.equal(summary.jev_charge_reconciliation.unattributed_interval_change_micro_usd, 1_000_000);
  assert.match(renderPublicReceipt(summary, '2026-11-07'), /USD 1\.000000 sin atribución a una etapa/u);
});

test('v2 rejects attributed cash without a hashed attribution record and rejects a credit as a charge', () => {
  const snapshot = fundedFixture();
  const missingProof = version2DelayedReceipt(snapshot);
  missingProof.jev_charge_reconciliation.attributed_smoke_micro_usd = 100;
  missingProof.jev_charge_reconciliation.status = 'interval_unattributed';
  missingProof.stages.find((stage) => stage.name === 'jev_smoke').charged_micro_usd = 100;
  missingProof.jev_charge_reconciliation.observations[0].balance_micro_usd = 30_000_000;
  missingProof.jev_charge_reconciliation.observations[1].balance_micro_usd = 29_999_900;
  missingProof.jev_charge_reconciliation.unattributed_interval_change_micro_usd = 0;
  assert.throws(() => summarizePilotSnapshot(snapshot, missingProof), /pilot_audit_jev_attribution_evidence_invalid/u);

  const credit = version2DelayedReceipt(snapshot);
  credit.jev_charge_reconciliation.status = 'delayed';
  credit.jev_charge_reconciliation.observations[2].balance_micro_usd = 30_100_000;
  credit.jev_charge_reconciliation.unattributed_interval_change_micro_usd = 0;
  assert.equal(summarizePilotSnapshot(snapshot, credit).jev_charge_reconciliation.unattributed_interval_change_micro_usd, 0);
});

test('v2 reports a directly evidenced stage charge with delayed balances and leaves the other stage unknown', () => {
  const snapshot = fundedFixture();
  const receipt = version2DelayedReceipt(snapshot);
  receipt.jev_charge_reconciliation.status = 'partially_confirmed';
  receipt.jev_charge_reconciliation.attributed_smoke_micro_usd = 100;
  receipt.jev_charge_reconciliation.attribution_evidence_sha256.smoke = createHash('sha256').update('verified-ledger').digest('hex');
  receipt.stages.find((stage) => stage.name === 'jev_smoke').charged_micro_usd = 100;
  const summary = summarizePilotSnapshot(snapshot, receipt);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_smoke').charged_micro_usd, 100);
  assert.equal(summary.stages.find((stage) => stage.name === 'jev_full').charged_micro_usd, null);
  assert.equal(summary.charged_micro_usd, null);
  assert.match(renderPublicReceipt(summary, '2026-11-07'), /Se confirmó el débito de una etapa/u);
});

test('v2 rejects cross-tranche calls, an additive cap, duplicate authority rows, and exposure above the cumulative ceiling', () => {
  const cases = [
    (snapshot) => { snapshot.scoped_authority.call_authorities[0].funding_receipt_id = snapshot.scoped_authority.funding_receipts[0].id; },
    (snapshot) => { snapshot.scoped_authority.effective_total_cap_micro_usd = '16470000'; },
    (snapshot) => { snapshot.scoped_authority.call_authorities.push(snapshot.scoped_authority.call_authorities[0]); },
    (snapshot) => { snapshot.calls[0].settled_micro_usd = '9500001'; },
    (snapshot) => { snapshot.scoped_authority.funding_receipts[0].prior_total_cap_micro_usd = '9500000'; },
    (snapshot) => { snapshot.scoped_authority.extension.map_digest = 'sha256:cross-map'; },
    (snapshot) => { snapshot.scoped_authority.extension.base_policy_version_id = 'cross-policy'; },
    (snapshot) => { snapshot.scoped_authority.funding_receipts[0].created_by_user_id = '00000000-0000-4000-8000-000000000099'; },
    (snapshot) => { snapshot.calls.at(-1).run_id = 'cross-run'; },
    (snapshot) => { snapshot.run.workspace_id = 'cross-workspace'; },
    (snapshot) => { snapshot.scoped_authority.admission.receipt_digest = `sha256:${'e'.repeat(64)}`; },
  ];
  for (const corrupt of cases) {
    const snapshot = fundedFixture();
    const receipt = version2DelayedReceipt(snapshot);
    corrupt(snapshot);
    resealFundingReceipt(snapshot.scoped_authority.funding_receipts[0]);
    receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
    assert.throws(() => summarizePilotSnapshot(snapshot, receipt), /pilot_audit_(?:scoped|funding)/u);
  }
});

test('binds quote fields to quote_digest and rejects a quote model substitution', () => {
  const snapshot = fundedFixture();
  const receipt = version2DelayedReceipt(snapshot);
  snapshot.scoped_authority.funding_receipts[0].quote.model = 'synthetic-other-model';
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  assert.throws(() => summarizePilotSnapshot(snapshot, receipt), /pilot_audit_funding_receipt_invalid/u);
});

test('binds native smoke metrics bytes and parsed content to the sealed metrics digest', () => {
  const snapshot = fundedFixture();
  const receipt = version2DelayedReceipt(snapshot);
  const funding = snapshot.scoped_authority.funding_receipts[0];
  funding.smoke_metrics_canonical = '{"root_count":1,"technical_failure":true}';
  funding.smoke_metrics_digest = `sha256:${createHash('sha256').update(funding.smoke_metrics_canonical).digest('hex')}`;
  snapshot.run.smoke_metrics_digest = funding.smoke_metrics_digest;
  resealFundingReceipt(funding);
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  assert.throws(() => summarizePilotSnapshot(snapshot, receipt), /smoke_metrics_mismatch/u);
});

test('derives authority from native finite prior and cumulative caps without assuming pilot-specific amounts', () => {
  const snapshot = fundedFixture();
  const authority = snapshot.scoped_authority;
  const funding = authority.funding_receipts[0];
  authority.extension.cap_micro_usd = '1000000';
  funding.prior_total_cap_micro_usd = '1000000';
  funding.total_cap_micro_usd = '1500000';
  authority.effective_total_cap_micro_usd = '1500000';
  funding.quote.total_cap_micro_usd = '1500000';
  funding.quote.projected_total_usage_micro_usd = '1400000';
  funding.quote_digest = `sha256:${createHash('sha256').update(canonicalForTest(funding.quote)).digest('hex')}`;
  resealFundingReceipt(funding);
  const receipt = version2DelayedReceipt(snapshot);
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  assert.equal(receipt.jev_authorization.previous_total_cap_micro_usd, 1_000_000);
  assert.equal(receipt.jev_authorization.cumulative_total_cap_micro_usd, 1_500_000);
});

test('compares frozen map keys and rejects mismatched study baseline map digest', async () => {
  const snapshot = fixture();
  const comparisonResult = comparePilotSnapshot(snapshot, comparison);
  assert.deepEqual(comparisonResult.topics_found_by_both, [
    {
      product_topic_key: 'product-a',
      product_topic_name: 'Synthetic topic A',
      study_topic_keys: ['study-a'],
      study_topic_names: ['Synthetic study topic A'],
    },
  ]);
  assert.deepEqual(comparisonResult.product_only_topics, [
    { topic_key: 'product-b', name: 'Synthetic topic B', definition: 'Synthetic definition B' },
  ]);
  assert.deepEqual(comparisonResult.study_only_topics, [{ topic_key: 'study-b', name: 'Synthetic study topic B' }]);
  assert.deepEqual(comparisonResult.new_topics, [{ topic_key: 'product-b', name: 'Synthetic topic B' }]);
  assert.equal(comparisonResult.study_triggers[0].found, true);
  assert.equal(comparisonResult.study_barriers[0].found, false);
  const wrongComparison = { ...comparison, map_digest: 'sha256:wrong' };
  assert.throws(() => comparePilotSnapshot(snapshot, wrongComparison), /wrong_frozen_map/u);
});

test('creates blind samples with a separate key and tamper-evident SHA256', () => {
  const snapshot = fixture();
  const summary = summarizePilotSnapshot(snapshot, operatorReceipt());
  assert.throws(() => buildBlindSamples(snapshot, summary, Buffer.alloc(32, 7)), /top_ten_topics_insufficient/u);
  const answerKey = { 'synthetic-case': { root_id: 'synthetic-root', probability: 0.9 } };
  const seal = sealAnswerKey(answerKey);
  assert.equal(seal.sha256.length, 64);
  assert.equal(JSON.parse(renderSealedAnswerKey(answerKey)).sha256, seal.sha256);
  assert.equal(verifyAnswerKeySeal(seal), true);
  const tampered = structuredClone(seal);
  tampered.answer_key[Object.keys(tampered.answer_key)[0]].root_id = 'changed';
  assert.equal(verifyAnswerKeySeal(tampered), false);
});

test('selects exactly 50 distinct roots per leading topic and 100 for trigger/barrier combined', () => {
  const snapshot = fixture();
  snapshot.map.catalog = Array.from({ length: 10 }, (_, index) => ({
    topic_key: `product-${index}`, name: `Synthetic topic ${index}`, definition: `Synthetic definition ${index}`,
  }));
  snapshot.items = [];
  snapshot.calls = [];
  snapshot.map.root_count = 105;
  const receipt = operatorReceipt();
  receipt.population = { unique_roots: 106, excluded_roots: 1, eligible_roots: 105 };
  receipt.public_catalog.topics = snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
    public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` }));
  for (let index = 0; index < 105; index += 1) {
    const root_id = `synthetic-root-${index}`;
    const candidateKeys = Array.from({ length: 8 }, (_, offset) => `product-${(index + offset) % 10}`);
    snapshot.items.push({ root_id, ordinal: index + 1, text: `Synthetic auditor text ${index}`,
      status: 'labeled', call_id: `synthetic-call-${index}`, probabilities: null,
      candidates: candidateKeys.map((topic_key, ordinal) => ({ ordinal, topic_key })) });
    const decision = index < 50 ? 'trigger' : index < 100 ? 'barrier' : 'none';
    const resultRow = result(root_id, 0.9, 0.85, decision, decision === 'none' ? 0.95 : 0.9);
    for (const [ordinal] of candidateKeys.entries()) resultRow.probabilities[`topic_${ordinal}`] = topicAnswer(0.9);
    resultRow.call_id = `synthetic-call-${index}`;
    snapshot.items.at(-1).probabilities = resultRow.probabilities;
    snapshot.calls.push({ id: resultRow.call_id, settled_micro_usd: '0', usage: { input_tokens: 0 } });
  }
  receipt.stages[1].input_count = 105;
  receipt.stages[3].input_count = 1;
  receipt.stages[3].input_tokens = 0;
  receipt.stages[3].ledger_call_ids = ['synthetic-call-0'];
  receipt.stages[4].input_count = 104;
  receipt.stages[4].ledger_call_ids = snapshot.calls.slice(1).map((call) => call.id);
  receipt.stages[4].usage_value_micro_usd = 0;
  receipt.stages[4].charged_micro_usd = 0;
  receipt.stages[4].input_tokens = 0;
  receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
  const { samples, answerKey } = buildBlindSamples(snapshot, summarizePilotSnapshot(snapshot, receipt), Buffer.alloc(32, 9));
  const reordered = { ...snapshot, items: [...snapshot.items].reverse() };
  const reorderedReceipt = { ...receipt, snapshot_sha256: computeSnapshotDigest(reordered) };
  const reorderedResult = buildBlindSamples(reordered, summarizePilotSnapshot(reordered, reorderedReceipt), Buffer.alloc(32, 9));
  const idsFor = (sampleRows, key, cohort) => sampleRows.map((sample) => sample.case_id)
    .filter((caseId) => key[caseId].cohort === cohort);
  assert.deepEqual(idsFor(reorderedResult.samples, reorderedResult.answerKey, 'topic-1'),
    idsFor(samples, answerKey, 'topic-1'));
  const orderFor = (sample) => createHmac('sha256', Buffer.alloc(32, 9))
    .update(`blind-order\0${sample.case_id}`).digest('hex');
  assert.deepEqual(samples.map((sample) => sample.case_id),
    [...samples].sort((left, right) => orderFor(left).localeCompare(orderFor(right)))
      .map((sample) => sample.case_id));
  const serializedCohorts = samples.map((sample) => answerKey[sample.case_id].cohort);
  let longestVisibleRun = 1, currentRun = 1;
  for (let index = 1; index < serializedCohorts.length; index += 1) {
    if (serializedCohorts[index] === serializedCohorts[index - 1]) currentRun += 1;
    else currentRun = 1;
    longestVisibleRun = Math.max(longestVisibleRun, currentRun);
  }
  assert.ok(longestVisibleRun < 20);
  assert.equal(renderBlindSamples(samples).includes('synthetic-root-0'), false);
  const topicSamples = Object.values(answerKey).filter((entry) => entry.cohort.startsWith('topic-'));
  assert.equal(topicSamples.length, 500);
  for (let index = 1; index <= 10; index += 1) {
    assert.equal(new Set(topicSamples.filter((entry) => entry.cohort === `topic-${index}`).map((entry) => entry.root_id)).size, 50);
  }
  const triggerBarrierSamples = Object.values(answerKey).filter((entry) => entry.cohort === 'trigger-barrier');
  assert.equal(triggerBarrierSamples.length, 100);
  assert.equal(new Set(triggerBarrierSamples.map((entry) => entry.root_id)).size, 100);
  assert.equal(samples.length, 600);
  assert.ok(samples.every((sample) => !Object.hasOwn(sample, 'root_id') && !Object.hasOwn(sample, 'probability')));
  assert.ok(samples.every((sample) => !Object.hasOwn(sample, 'topic_key') && !Object.hasOwn(sample, 'cohort')));
  assert.ok(Object.values(answerKey).some((entry) => entry.root_id === 'synthetic-root-0'));
});

test('public receipt contains aggregate metrics and excludes mention text and IDs', () => {
  const summary = summarizePilotSnapshot(fixture(), operatorReceipt());
  const receipt = renderPublicReceipt(summary, '2026-11-07');
  assert.match(receipt, /Estudio real A \(cerveza, Brasil\)/u);
  assert.match(receipt, /\| 180 \|/u);
  assert.match(receipt, /Grupos BERTopic totales .*: 12/u);
  assert.match(receipt, /Public alias product-a/u);
  assert.doesNotMatch(receipt, /Synthetic topic A|Synthetic definition A/u);
  assert.doesNotMatch(receipt, /Synthetic mention/u);
  assert.doesNotMatch(receipt, /root-[1-4]/u);
});

test('R13 receipt composition and phase A/B replay are idempotent with an H4 fixture', async () => {
  const { mkdtemp, mkdir, readFile, rm, writeFile, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { dirname, join } = await import('node:path');
  const { phaseA, phaseB } = await import('./pilot-r13-audit-export.mjs');
  const { projectR13Cost, renderCorrectedPublicReceiptR13, summarizeR13Baseline, summarizeR13Repair } = await import('./pilot-r13-audit.mjs');
  const { mkdtemp: mkdtempRepo, rm: rmRepo } = await import('node:fs/promises');
  const receiptSnapshot = fixture();
  const summary = summarizePilotSnapshot(receiptSnapshot, operatorReceipt(receiptSnapshot));
  const snapshot = structuredClone(receiptSnapshot);
  const sourceItems = snapshot.items.filter((item) => item.probabilities);
  const items = [];
  for (let index = 0; index < 100; index++) {
    const item = structuredClone(sourceItems[index % sourceItems.length]);
    item.root_id = `root-${index + 1}`;
    item.ordinal = index + 1;
    item.input_digest = `sha256:synthetic-input-${index + 1}`;
    item.probabilities.voice.choice = index % 2 ? 'individual' : 'conversation';
    items.push(item);
  }
  snapshot.items = items;
  snapshot.map.root_count = items.length;
  const repairRows = items.map((item, index) => ({ stage: 'repair', root_id: item.root_id,
    status: 'settled', input_tokens: 10, micro_usd: 1, response: { usage: { input_tokens: 10, output_tokens: 2 },
      answers: { trigger_barrier: { type: 'choice', choice: index % 2 ? 'trigger' : 'barrier', confidence: 0.9,
        probabilities: { trigger: index % 2 ? 0.9 : 0.05, barrier: index % 2 ? 0.05 : 0.9, none: 0.05 } } } } }));
  const repaired = summarizeR13Repair(snapshot, repairRows);
  const baseline = summarizeR13Baseline(snapshot);
  const projection = projectR13Cost({ roots: summary.root_count, voyageTokens: summary.stages.find((s) => s.name === 'voyage').free_tokens_used,
    jevInputTokens: 2_000, observedEditorialUsd: 8, observedEditorialCalls: 12 });
  const composed = renderCorrectedPublicReceiptR13({ receipt: renderPublicReceipt(summary, '2026-11-07'),
    baseline, repaired, projection, r13StageUsage: [{ stage: 'repair', results: 100, input_tokens: 1000, output_tokens: 200, micro_usd: 100 }] });
  assert.match(composed, /Proyección lineal por millón de raíces/u);
  assert.match(composed, /USD 107–112 por millón de raíces/u);
  assert.match(composed, /USD 7\.50 por millón/u);
  assert.match(composed, /DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R14_2026-11-08\.md/u);
  assert.match(composed, /DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R13_HISTORICO_2026-11-08\.md/u);
  assert.match(composed, /Elegibles: 100/u);
  assert.match(composed, /Uso medido de R13 en etapas completadas/u);

  const temporary = await mkdtemp(join(tmpdir(), 'pilot-r13-phase-replay-'));
  const dataRoot = join(temporary, '.data');
  await mkdir(dataRoot, { mode: 0o755 });
  await chmod(dataRoot, 0o755);
  const r13 = join(dataRoot, 'pilot');
  const inputDir = join(r13, 'inputs');
  await mkdir(inputDir, { recursive: true, mode: 0o700 });
  const stageDirs = {};
  for (const name of ['repair', 'interests', 'cost13', 'cost7', 'language-pt', 'language-en']) {
    stageDirs[name] = join(r13, name);
    await mkdir(stageDirs[name], { mode: 0o700 });
  }
  const save = async (path, contents) => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    await writeFile(path, contents, { mode: 0o600 });
  };
  const saveRows = async (path, rows) => save(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const interests = items.map((item) => ({ stage: 'interests', root_id: item.root_id, status: 'settled',
    input_tokens: 12, micro_usd: 1, response: { usage: { input_tokens: 12, output_tokens: 2 },
      answers: { apostas: { noul: 0.8 }, racismo: { noul: 0.2 } } } }));
  const costArm = (stage) => Array.from({ length: 1000 }, (_, index) => ({ stage, root_id: `cost-${index}`,
    status: 'settled', input_tokens: stage === 'cost13' ? 13 : 7, micro_usd: 1,
    response: { usage: { input_tokens: stage === 'cost13' ? 13 : 7, output_tokens: 2 } } }));
  const blindLinks = {};
  const languageRows = async (stage) => Promise.all(Array.from({ length: 597 }, async (_, index) => {
    const rootId = `variant-${index}`;
    blindLinks[rootId] = [`blind-${index}`];
    const response = { model: 'jev-r13', usage: { input_tokens: 10, output_tokens: 2 }, answers: {
      trigger_barrier: { type: 'choice', choice: 'trigger', confidence: 0.8,
        probabilities: { trigger: 0.8, barrier: 0.1, none: 0.1 } } } };
    const body = JSON.stringify(response);
    const rawSha = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const rootDigest = createHash('sha256').update(rootId).digest('hex');
    await save(join(stageDirs[stage], `${rootDigest}.raw.json`), JSON.stringify({ body, http_status: 200, latency_ms: 1 }));
    return { stage, root_id: rootId, status: 'settled', input_digest: `input-${index}`, request_digest: `request-${stage}-${index}`,
      input_tokens: 10, micro_usd: 1, raw_sha256: rawSha, response };
  }));
  const variantsPT = await languageRows('language-pt');
  const variantsEN = await languageRows('language-en');
  const compare = { contract_version: 'mass-labeling-r13-cost-comparison-v1', paired_roots: 1000,
    same_text_and_shared_questions_verified: true, tokens_per_root: { full: 13, reduced: 7 }, token_reduction_fraction: 6 / 13,
    probability_comparisons: { reduced_vs_full: { mean_absolute_delta: 0.1 } } };
  const flags = Object.fromEntries(items.map((item) => [item.root_id, false]));
  await save(join(inputDir, 'hashtag.json'), JSON.stringify(flags));
  await save(join(inputDir, 'variant-links.json'), JSON.stringify(blindLinks));
  await save(join(inputDir, 'translation-success.json'), JSON.stringify({ count: 98, cost_micro_usd: 750000,
    usage: { input_tokens: 10774, output_tokens: 19526 } }));
  await save(join(inputDir, 'translations.json'), JSON.stringify({ map_digest: snapshot.map.map_digest,
    translations: Array.from({ length: 98 }, (_, index) => ({ topic: index })) }));
  await saveRows(join(stageDirs.repair, 'results.jsonl'), repairRows);
  await saveRows(join(stageDirs.interests, 'results.jsonl'), interests);
  await saveRows(join(stageDirs.cost13, 'results.jsonl'), costArm('cost13'));
  await saveRows(join(stageDirs.cost7, 'results.jsonl'), costArm('cost7'));
  await saveRows(join(stageDirs['language-pt'], 'results.jsonl'), variantsPT);
  await saveRows(join(stageDirs['language-en'], 'results.jsonl'), variantsEN);
  await save(join(r13, 'cost-comparison.json'), JSON.stringify(compare));
  const publicDir = await mkdtempRepo(join(process.cwd(), 'scripts/dev-corpus/.r13-replay-'));
  const receiptPath = join(publicDir, 'DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_2026-11-08.md');
  const audit = join(r13, 'auditor'), custody = join(r13, 'custody');
  const config = { repository_root: process.cwd(), workspace_data_root: dataRoot, r13_data_root: dataRoot,
    h4: {}, root_hashtag_flags: join(inputDir, 'hashtag.json'), variant_private_link: join(inputDir, 'variant-links.json'),
    translation_receipt: join(inputDir, 'translation-success.json'), translation_translations: join(inputDir, 'translations.json'),
    stages: { repair: join(stageDirs.repair, 'results.jsonl'), interests: join(stageDirs.interests, 'results.jsonl'),
      cost13: join(stageDirs.cost13, 'results.jsonl'), cost7: join(stageDirs.cost7, 'results.jsonl'),
      cost_comparison: join(r13, 'cost-comparison.json'), language_pt: join(stageDirs['language-pt'], 'results.jsonl'),
      language_en: join(stageDirs['language-en'], 'results.jsonl') },
    outputs: { audit_dir: audit, custody_dir: custody, new_blind_samples: join(audit, 'blind-r13.jsonl'),
      new_blind_key: join(custody, 'key-r13.json'), comparison_addendum: join(audit, 'comparison.json'),
      phase_a_evidence: join(audit, 'phase-a-evidence.json'), phase_a_manifest: join(audit, 'phase-a-manifest.json'),
      phase_b_evidence: join(audit, 'phase-b-evidence.json'), phase_b_manifest: join(audit, 'phase-b-manifest.json'),
      language_variants: join(audit, 'variantes-r13.jsonl') }, public_receipt_path: receiptPath };
  const operator = operatorReceipt(snapshot);
  const h4 = { snapshot, operator, comparison, priorRootSet: new Set(Array.from({ length: 597 }, (_, i) => `old-${i}`)),
    summary, source: { snapshot_sha256: 'snapshot-sha', operator_receipt_sha256: 'operator-sha',
      comparison_sha256: 'comparison-sha', h4_answer_key_sha256: 'answer-key-sha' } };
  try {
    const ctx = { config, r13Root: dataRoot, workspaceRoot: dataRoot, h4Override: h4 };
    await phaseA(ctx); const receiptA = await readFile(receiptPath, 'utf8');
    const evidenceA = await readFile(config.outputs.phase_a_evidence, 'utf8');
    await phaseA(ctx); assert.equal(await readFile(receiptPath, 'utf8'), receiptA);
    assert.equal(await readFile(config.outputs.phase_a_evidence, 'utf8'), evidenceA);
    assert.ok(evidenceA.includes('r13_stage_usage') && evidenceA.includes('eligible_count'));
    const blindSamples = await readFile(config.outputs.new_blind_samples, 'utf8');
    const blindKey = await readFile(config.outputs.new_blind_key, 'utf8');
    const changedRepair = structuredClone(repairRows);
    changedRepair[0].input_tokens++;
    changedRepair[0].response.usage.input_tokens++;
    await saveRows(config.stages.repair, changedRepair);
    await assert.rejects(phaseA(ctx), /r13_existing_evidence_mismatch/u);
    assert.equal(await readFile(config.outputs.new_blind_samples, 'utf8'), blindSamples);
    assert.equal(await readFile(config.outputs.new_blind_key, 'utf8'), blindKey);
    assert.equal(await readFile(receiptPath, 'utf8'), receiptA);
    await saveRows(config.stages.repair, repairRows);
    await phaseA(ctx);
    await phaseB(ctx); const receiptB = await readFile(receiptPath, 'utf8');
    const evidenceB = await readFile(config.outputs.phase_b_evidence, 'utf8');
    assert.ok(evidenceB.includes('750000'));
    assert.match(receiptB, /Etiquetado en todo el corpus/u);
    for (const stage of ['repair', 'interests', 'cost13', 'cost7', 'language-pt', 'language-en', 'translation']) {
      assert.match(receiptB, new RegExp(`\\| ${stage} \\|`, 'u'));
    }
    await phaseB(ctx); assert.equal(await readFile(receiptPath, 'utf8'), receiptB);
    assert.equal(await readFile(config.outputs.phase_b_evidence, 'utf8'), evidenceB);
    await assert.rejects(phaseA(ctx), /already_superseded/u);
    assert.equal(await readFile(receiptPath, 'utf8'), receiptB);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rmRepo(publicDir, { recursive: true, force: true });
  }
});

test('requires an explicitly sanitized public catalog and rejects private identity terms', () => {
  const snapshot = fixture();
  const receipt = operatorReceipt(snapshot);
  receipt.public_catalog.topics[0].public_name = 'Confidential Brand Zeta';
  assert.throws(() => summarizePilotSnapshot(snapshot, receipt), /private_identity_leak/u);
  const missing = operatorReceipt(snapshot);
  delete missing.public_catalog;
  assert.throws(() => summarizePilotSnapshot(snapshot, missing), /public_catalog_required/u);
});

test('keeps unverified charges unknown instead of reporting free provider usage', () => {
  const receipt = operatorReceipt();
  receipt.stages[0].charged_micro_usd = null;
  const summary = summarizePilotSnapshot(fixture(), receipt);
  assert.equal(summary.charged_micro_usd, null);
  assert.equal(summary.charged_per_million_micro_usd, null);
  assert.match(renderPublicReceipt(summary, '2026-11-07'), /Uso a tarifa del piloto/u);
  assert.doesNotMatch(renderPublicReceipt(summary, '2026-11-07'), /Cargo total confirmado:/u);
});

test('reconciles a terminal billed attempt plus its exact successful consolidation retry', () => {
  const { snapshot, receipt } = enrichedEditorialSnapshot();
  const summary = summarizePilotSnapshot(snapshot, receipt);
  assert.equal(summary.bertopic_group_count, 144);
  assert.equal(summary.stages.find((row) => row.name === 'claude').usage_value_micro_usd, 170);
  assert.equal(receipt.stages.find((row) => row.name === 'claude').input_count, 144);
  assert.deepEqual(receipt.stages.find((row) => row.name === 'claude').ledger_call_ids,
    snapshot.stage_receipts.editorial_calls.map((call) => call.id));
  assert.equal(summary.topics.length, 2);
  const invalidCases = [
    ['unknown call state', (copy) => { copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-terminal-call').call_state = 'outcome_unknown'; }, /unreconciled/u],
    ['unreconciled terminal billing', (copy) => { delete copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-terminal-call').metadata.provider_terminal_billing_reconciliation; }, /terminal_billing_invalid/u],
    ['duplicate ledger reference', (copy) => { copy.receipt.stages.find((row) => row.name === 'claude').ledger_call_ids.push('synthetic-successor-call'); }, /call_ids_required/u],
    ['incoherent audited charge', (copy) => { copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-terminal-call').metadata.provider_terminal_billing_reconciliation.actual_micro_usd = 20; }, /terminal_billing_invalid/u],
    ['incoherent settled successor charge', (copy) => { copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-successor-call').settled_micro_usd = '8'; }, /settled_cost_mismatch/u],
    ['retry changes request', (copy) => { copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-successor-call').request_digest = `sha256:${'8'.repeat(64)}`; }, /retry_scope_invalid/u],
    ['result not linked to successful call', (copy) => { copy.snapshot.stage_receipts.consolidation_artifact.metadata.call_id = 'synthetic-terminal-call'; }, /consolidation_call_missing/u],
    ['success missing HTTP 200 evidence', (copy) => { copy.snapshot.stage_receipts.editorial_calls.find((call) => call.id === 'synthetic-successor-call').response_http_status = 499; }, /settled_response_invalid/u],
  ];
  for (const [name, mutate, pattern] of invalidCases) {
    const copy = structuredClone({ snapshot, receipt });
    mutate(copy);
    copy.receipt.snapshot_sha256 = computeSnapshotDigest(copy.snapshot);
    assert.throws(() => summarizePilotSnapshot(copy.snapshot, copy.receipt), pattern, name);
  }
});

test('attests recovery decision, normalized keys, retained topics, and duplicate assignment removal', () => {
  const { snapshot, receipt } = recoveredGlobalEditorialSnapshot();
  const summary = summarizePilotSnapshot(snapshot, receipt);
  assert.equal(summary.topics.length, 98);
  assert.equal(snapshot.map.catalog.some((topic) => topic.topic_key === 'acucar'), true);
  assert.equal(snapshot.map.catalog.some((topic) => topic.topic_key === 'cafe'), true);
  const invalidCases = [
    ['missing DB decision', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision = null; }, /recovery_decision_invalid/u],
    ['decision digest mismatch', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision_digest = `sha256:${'0'.repeat(64)}`; }, /recovery_decision_invalid/u],
    ['wrong retry linkage', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.call_id = 'synthetic-terminal-call'; }, /recovery_decision_invalid/u],
    ['decision actor differs from call actor', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.created_by_user_id = '00000000-0000-4000-8000-000000000002'; }, /recovery_decision_invalid/u],
    ['run recovery binding differs', (copy) => { copy.snapshot.stage_receipts.engine.result_summary.global_receipt_recovery_decision_id = 'other-decision'; }, /recovery_decision_invalid/u],
    ['internal decision workspace bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.workspace_id = 'foreign-workspace'; }, /recovery_decision_invalid/u],
    ['internal decision execution bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.execution_id = 'foreign-execution'; }, /recovery_decision_invalid/u],
    ['internal decision call bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.call_id = 'foreign-call'; }, /recovery_decision_invalid/u],
    ['internal decision request bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.request_digest = `sha256:${'0'.repeat(64)}`; }, /recovery_decision_invalid/u],
    ['internal decision response bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.response_sha256 = `sha256:${'0'.repeat(64)}`; }, /recovery_decision_invalid/u],
    ['internal decision groups bypass', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.source_groups_digest = `sha256:${'0'.repeat(64)}`; }, /recovery_decision_invalid/u],
    ['key not NFKD normalized', (copy) => { copy.snapshot.stage_receipts.global_receipt_recovery_decision.decision.topic_key_changes[0].to = 'açucar'; }, /recovery_key_changes_invalid/u],
    ['duplicate remains assigned to removed topic', (copy) => { copy.snapshot.map.catalog[1].group_ids = ['synthetic-duplicate-group']; }, /recovery_assignment_mismatch/u],
    ['duplicate appears in third topic', (copy) => { copy.snapshot.map.catalog[2].group_ids = ['synthetic-duplicate-group']; }, /recovery_assignment_mismatch/u],
    ['topic membership missing', (copy) => { delete copy.snapshot.map.catalog[2].group_ids; }, /recovery_membership_invalid/u],
    ['invalid topic membership id', (copy) => { copy.snapshot.map.catalog[2].group_ids = [7]; }, /recovery_membership_invalid/u],
    ['retained topic missing', (copy) => { copy.snapshot.map.catalog.splice(1, 1); }, /recovery_key_catalog_mismatch/u],
    ['normalization destination missing', (copy) => { copy.snapshot.map.catalog[2].topic_key = 'synthetic-topic-3'; }, /recovery_key_catalog_mismatch/u],
    ['original key retained after normalization', (copy) => { copy.snapshot.map.catalog[2].topic_key = 'bebidasñ'; }, /recovery_key_catalog_mismatch/u],
  ];
  for (const [name, mutate, pattern] of invalidCases) {
    const copy = structuredClone({ snapshot, receipt });
    mutate(copy);
    if (!name.includes('decision digest') && name !== 'wrong retry linkage') {
      const proof = copy.snapshot.stage_receipts.global_receipt_recovery_decision;
      if (proof) {
        const digest = `sha256:${createHash('sha256').update(canonicalForTest(proof.decision)).digest('hex')}`;
        proof.decision_digest = digest;
        copy.snapshot.stage_receipts.consolidation_artifact.metadata.recovery_decision_digest = digest;
      }
    }
    copy.receipt.public_catalog.topics = copy.snapshot.map.catalog.map((topic) => ({
      topic_key: topic.topic_key, public_name: `Public alias ${topic.topic_key}`,
      public_definition: `Public definition ${topic.topic_key}`,
    }));
    copy.receipt.snapshot_sha256 = computeSnapshotDigest(copy.snapshot);
    assert.throws(() => summarizePilotSnapshot(copy.snapshot, copy.receipt), pattern, name);
  }
});

test('exports the H2 JSON contract into private audit files and sanitized public receipt', async () => {
  const { chmod, mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { dirname, join, relative, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const privateRoot = join(repositoryRoot, '.data');
  const fixtureDirectory = join(privateRoot, `.pilot-audit-test-${process.pid}`);
  const publicReceiptPath = join(repositoryRoot, 'docs/product/PROMPT_LOOPING', `.pilot-audit-test-${process.pid}.md`);
  try {
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    await chmod(privateRoot, 0o700);
    await mkdir(fixtureDirectory, { mode: 0o700 });
    const snapshot = fixture();
    snapshot.map.catalog = Array.from({ length: 10 }, (_, index) => ({
      topic_key: `product-${index}`, name: `Synthetic topic ${index}`, definition: `Synthetic definition ${index}`,
    }));
    snapshot.items = [];
    snapshot.calls = [];
    snapshot.map.root_count = 105;
    const receipt = operatorReceipt();
    receipt.population = { unique_roots: 106, excluded_roots: 1, eligible_roots: 105 };
    receipt.public_catalog.topics = snapshot.map.catalog.map((topic) => ({ topic_key: topic.topic_key,
      public_name: `Public alias ${topic.topic_key}`, public_definition: `Public definition ${topic.topic_key}` }));
    for (let index = 0; index < 105; index += 1) {
      const root_id = `synthetic-root-${index}`;
      const candidateKeys = Array.from({ length: 8 }, (_, offset) => `product-${(index + offset) % 10}`);
      const decision = index < 50 ? 'trigger' : index < 100 ? 'barrier' : 'none';
      const resultRow = result(root_id, 0.9, 0.85, decision, decision === 'none' ? 0.95 : 0.9);
      for (const [ordinal] of candidateKeys.entries()) resultRow.probabilities[`topic_${ordinal}`] = topicAnswer(0.9);
      resultRow.call_id = `synthetic-call-${index}`;
      snapshot.items.push({ root_id, ordinal: index + 1, text: `Synthetic auditor text ${index}`,
        status: 'labeled', call_id: resultRow.call_id, probabilities: resultRow.probabilities,
        candidates: candidateKeys.map((topic_key) => ({ topic_key })) });
      snapshot.calls.push({ id: resultRow.call_id, run_id: snapshot.run.run_id, model: 'synthetic-jev-v1', status: 'succeeded',
        settled_micro_usd: '0', usage: { input_tokens: 0 } });
    }
    receipt.stages[1].input_count = 105;
    receipt.stages[3].input_count = 1;
    receipt.stages[3].input_tokens = 0;
    receipt.stages[3].ledger_call_ids = ['synthetic-call-0'];
    receipt.stages[4].input_count = 104;
    receipt.stages[4].ledger_call_ids = snapshot.calls.slice(1).map((call) => call.id);
    receipt.stages[4].usage_value_micro_usd = 0;
    receipt.stages[4].charged_micro_usd = 0;
    receipt.stages[4].input_tokens = 0;
    receipt.snapshot_sha256 = computeSnapshotDigest(snapshot);
    const comparisonSnapshot = { ...comparison, topic_matches: [],
      new_product_topic_keys: snapshot.map.catalog.map((topic) => topic.topic_key), study_triggers: [], study_barriers: [] };
    const paths = {
      snapshot: join(fixtureDirectory, 'snapshot.json'),
      receipt: join(fixtureDirectory, 'operator-receipt.json'),
      comparison: join(fixtureDirectory, 'comparison.json'),
    };
    await writeFile(paths.snapshot, JSON.stringify(snapshot), { mode: 0o600 });
    await writeFile(paths.receipt, JSON.stringify(receipt), { mode: 0o600 });
    await writeFile(paths.comparison, JSON.stringify(comparisonSnapshot), { mode: 0o600 });
    const cli = join(repositoryRoot, 'scripts/dev-corpus/pilot-audit-export.mjs');
    const snapshotArgument = relative(repositoryRoot, paths.snapshot);
    const digestResult = spawnSync(process.execPath, [cli, '--snapshot-digest', snapshotArgument], { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(digestResult.status, 0, digestResult.stderr);
    assert.equal(digestResult.stdout.trim(), receipt.snapshot_sha256);
    const args = [
      cli, '--snapshot', snapshotArgument,
      '--operator-receipt', relative(repositoryRoot, paths.receipt),
      '--comparison', relative(repositoryRoot, paths.comparison),
      '--out-dir', relative(repositoryRoot, join(fixtureDirectory, 'output')),
      '--public-receipt', relative(repositoryRoot, publicReceiptPath),
    ];
    const run = spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const outputDirectory = join(fixtureDirectory, 'output');
    const blindSamples = await readFile(join(outputDirectory, 'blind-samples.jsonl'), 'utf8');
    const key = JSON.parse(await readFile(join(outputDirectory, 'answer-key.json'), 'utf8'));
    const publicReceipt = await readFile(publicReceiptPath, 'utf8');
    assert.equal(blindSamples.trim().split('\n').length, 600);
    assert.doesNotMatch(blindSamples, /synthetic-root|topic_key|probability|cohort/u);
    const serializedSamples = blindSamples.trim().split('\n').map((line) => JSON.parse(line));
    const sampleSecret = await readFile(join(outputDirectory, 'sample-seed.bin'));
    const serializedOrder = (sample) => createHmac('sha256', sampleSecret)
      .update(`blind-order\0${sample.case_id}`).digest('hex');
    assert.deepEqual(serializedSamples.map((sample) => sample.case_id),
      [...serializedSamples].sort((left, right) => serializedOrder(left).localeCompare(serializedOrder(right)))
        .map((sample) => sample.case_id));
    const sampleCohorts = serializedSamples.map((sample) => key.answer_key[sample.case_id].cohort);
    let longestVisibleRun = 1, currentRun = 1;
    for (let index = 1; index < sampleCohorts.length; index += 1) {
      if (sampleCohorts[index] === sampleCohorts[index - 1]) currentRun += 1;
      else currentRun = 1;
      longestVisibleRun = Math.max(longestVisibleRun, currentRun);
    }
    assert.ok(longestVisibleRun < 20);
    assert.doesNotMatch(publicReceipt, /Synthetic topic [0-9]|Synthetic definition/u);
    assert.doesNotMatch(publicReceipt, /confidential brand zeta|private competitor omega/iu);
    assert.match(publicReceipt, /Public alias product-0/u);
    assert.match(publicReceipt, /Grupos BERTopic totales .*: 12/u);
    assert.equal(verifyAnswerKeySeal(key), true);
    assert.equal((await stat(join(outputDirectory, 'answer-key.json'))).mode & 0o077, 0);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(publicReceiptPath, { force: true });
  }
});
