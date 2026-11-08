import { createHash, createHmac, randomUUID } from 'node:crypto';
import { open, mkdir, link, unlink, realpath, stat } from 'node:fs/promises';
import { resolve, relative, dirname, basename, join } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rate = (n, d) => d ? Number((100 * n / d).toFixed(4)) : null;
const answerOf = (row) => row?.response?.answers?.trigger_barrier ?? row?.answers?.trigger_barrier
  ?? row?.response?.trigger_barrier;
const decisionOf = (answer) => {
  if (!answer || (answer.type && answer.type !== 'choice')) return null;
  const confidence = answer.confidence ?? answer.probabilities?.[answer.choice];
  return ['trigger', 'barrier', 'none'].includes(answer.choice) && Number.isFinite(confidence)
    ? { choice: answer.choice, confidence } : null;
};

export function isHashtagOnlyR13(text) {
  if (typeof text !== 'string') return false;
  const hashtags = /#[\p{L}\p{N}_]+/gu;
  return hashtags.test(text) && text.replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/[\s.,;:!?()\[\]{}'"“”‘’«»…—–-]+/gu, '').length === 0;
}

export function summarizeR13Baseline(snapshot) {
  const voices = {};
  const originalRelevance = { positive: 0, intermediate: 0, negative: 0, missing: 0 };
  const triggerBarrierByPromotion = Object.fromEntries(['trigger', 'barrier', 'none', 'intermediate', 'unresolved']
    .map((key) => [key, { promoted: 0, organic: 0 }]));
  const calls = new Map(snapshot.calls.map((call) => [call.id, call]));
  let inputTokens = 0;
  let outputTokens = 0;
  let usageComplete = true;
  let promotional = 0;
  for (const item of snapshot.items) {
    const answers = item.probabilities ?? {};
    const voice = answers.voice?.choice ?? 'missing';
    voices[voice] = (voices[voice] ?? 0) + 1;
    const relevance = answers.relevance?.noul;
    if (!Number.isFinite(relevance)) originalRelevance.missing++;
    else originalRelevance[relevance > 0.7 ? 'positive' : relevance < 0.3 ? 'negative' : 'intermediate']++;
    const promoted = answers.promotion?.noul > 0.7;
    promotional += Number(promoted);
    const decision = decisionOf(answers.trigger_barrier);
    const label = !decision || decision.confidence < 0.3 ? 'unresolved'
      : decision.confidence <= 0.7 ? 'intermediate' : decision.choice;
    triggerBarrierByPromotion[label][promoted ? 'promoted' : 'organic']++;
    const call = calls.get(item.call_id);
    if (!Number.isSafeInteger(call?.usage?.input_tokens) || !Number.isSafeInteger(call?.usage?.output_tokens)) usageComplete = false;
    else { inputTokens += call.usage.input_tokens; outputTokens += call.usage.output_tokens; }
  }
  return { root_count: snapshot.items.length, voices, original_relevance: originalRelevance,
    promotional, historical_trigger_barrier_by_promotion: triggerBarrierByPromotion,
    prior_jev_usage: usageComplete ? { input_tokens: inputTokens, output_tokens: outputTokens,
      input_tokens_per_root: inputTokens / snapshot.items.length } : null };
}

function indexedRows(stage, rows, knownItems) {
  if (!Array.isArray(rows)) throw new Error('r13_rows_invalid');
  const result = new Map();
  for (const row of rows) {
    if ((row.stage && row.stage !== stage) || !knownItems.has(row.root_id) || result.has(row.root_id)
      || (row.status && row.status !== 'settled' && row.status !== 'completed')) {
      throw new Error('r13_row_binding_invalid');
    }
    result.set(row.root_id, row);
  }
  return result;
}

export function summarizeR13Repair(snapshot, repairRows, { hashtagOnlyByRoot } = {}) {
  const items = new Map(snapshot.items.map((item) => [item.root_id, item]));
  const result = indexedRows('repair', repairRows, items);
  const counts = { trigger: 0, barrier: 0, none: 0, intermediate: 0, unresolved: 0 };
  const consumerEligibility = { eligible: 0, excluded: 0 };
  const promotional = { trigger: 0, barrier: 0, none: 0, intermediate: 0, unresolved: 0 };
  const organic = { ...promotional };
  const rows = [];
  for (const item of snapshot.items) {
    const prior = item.probabilities ?? {};
    const isHashtag = hashtagOnlyByRoot?.[item.root_id] ?? isHashtagOnlyR13(item.full_text ?? item.text);
    const eligible = prior.voice?.choice === 'individual' && prior.promotion?.noul <= 0.7 && !isHashtag;
    if (eligible) consumerEligibility.eligible++;
    else consumerEligibility.excluded++;
    const decision = decisionOf(answerOf(result.get(item.root_id)));
    const label = !decision ? 'unresolved' : decision.confidence <= 0.7
      ? decision.confidence >= 0.3 ? 'intermediate' : 'unresolved' : decision.choice;
    counts[label]++;
    if (eligible) (prior.promotion.noul > 0.7 ? promotional : organic)[label]++;
    rows.push({ root_id: item.root_id, input_digest: item.input_digest, eligible, hashtag_only: isHashtag,
      label, confidence: decision?.confidence ?? null, text: item.full_text ?? item.text,
      response: result.get(item.root_id) ?? null });
  }
  return { root_count: snapshot.items.length, consumer_eligibility: consumerEligibility, counts,
    percentages: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, rate(value, snapshot.items.length)])),
    consumer_voice_by_prior_promotion: { promotional, organic }, private_rows: rows };
}

export function buildNewConsumerSamples(repair, priorRootIds, secret, { sampleSize = 100, seed = 'r13-consumer-v1' } = {}) {
  if (!Buffer.isBuffer(secret) || secret.length < 32 || !Array.isArray(priorRootIds)
    || !Number.isSafeInteger(sampleSize) || sampleSize !== 100) throw new Error('r13_sample_input_invalid');
  const excluded = new Set(priorRootIds);
  const candidates = repair.private_rows.filter((row) => row.eligible && !excluded.has(row.root_id)
    && ['trigger', 'barrier'].includes(row.label));
  const rank = (row) => createHmac('sha256', secret).update(`${seed}\0${row.root_id}`).digest('hex');
  const sorted = [...candidates].sort((a, b) => rank(a).localeCompare(rank(b)));
  const triggers = sorted.filter((row) => row.label === 'trigger');
  const barriers = sorted.filter((row) => row.label === 'barrier');
  if (candidates.length < sampleSize) throw new Error('r13_blind_pool_insufficient');
  const triggerCount = Math.min(50, triggers.length);
  const barrierCount = Math.min(50, barriers.length);
  if (triggerCount + barrierCount !== sampleSize) throw new Error('r13_trigger_barrier_strata_insufficient');
  const chosen = [...triggers.slice(0, triggerCount), ...barriers.slice(0, barrierCount)];
  const samples = [];
  const answerKey = {};
  for (const row of chosen) {
    const caseId = createHmac('sha256', secret).update(`r13-case\0${row.root_id}`).digest('hex').slice(0, 24);
    samples.push({ case_id: caseId, text: row.text });
    answerKey[caseId] = { root_id: row.root_id, input_digest: row.input_digest,
      cohort: 'consumer-trigger-barrier', decision: row.label, confidence: row.confidence };
  }
  const order = (sample) => createHmac('sha256', secret).update(`blind\0${sample.case_id}`).digest('hex');
  samples.sort((a, b) => order(a).localeCompare(order(b)));
  return { samples, answerKey, allocation: { trigger: triggerCount, barrier: barrierCount }, seed };
}

export function buildR13LanguageVariants(portugueseRows, englishRows, blindRootToCases) {
  const byRoot = (rows, stage) => {
    if (!Array.isArray(rows)) throw new Error('r13_variant_rows_invalid');
    const map = new Map();
    for (const row of rows) {
      if (row.stage !== stage || map.has(row.root_id) || row.status !== 'settled'
        || !record(row.response?.answers?.trigger_barrier) || !row.request_digest
        || !row.input_digest || !Number.isSafeInteger(row.input_tokens)) throw new Error('r13_variant_row_invalid');
      map.set(row.root_id, row);
    }
    return map;
  };
  const pt = byRoot(portugueseRows, 'language-pt');
  const en = byRoot(englishRows, 'language-en');
  if (!record(blindRootToCases)) throw new Error('r13_variant_blind_link_invalid');
  const roots = Object.keys(blindRootToCases).sort();
  if (roots.length !== 597 || pt.size !== 597 || en.size !== 597) throw new Error('r13_variant_pair_count_invalid');
  const output = [];
  for (const root of roots) {
    const a = pt.get(root), b = en.get(root);
    if (!a || !b || a.input_digest !== b.input_digest || !Array.isArray(blindRootToCases[root])
      || !blindRootToCases[root].length) throw new Error('r13_variant_pair_mismatch');
    for (const [language, row] of [['pt', a], ['en', b]]) {
      output.push({ case_ids: blindRootToCases[root], input_digest: row.input_digest,
        question_language: language, request_digest: row.request_digest,
        input_tokens: row.input_tokens, raw_sha256: row.raw_sha256 });
    }
  }
  return output;
}

async function secureDataDirectory(dataRoot, requested) {
  const root = await realpath(resolve(dataRoot));
  const unresolved = resolve(requested);
  let ancestor = unresolved;
  let canonicalAncestor;
  for (;;) {
    try { canonicalAncestor = await realpath(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('r13_output_parent_missing');
      ancestor = parent;
    }
  }
  const destination = join(canonicalAncestor, relative(ancestor, unresolved));
  if (destination === root || relative(root, destination).startsWith('..')) throw new Error('r13_output_outside_private_data');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const directory = await realpath(dirname(destination));
  if (directory === root || relative(root, directory).startsWith('..')) throw new Error('r13_output_directory_invalid');
  if ((await stat(directory)).mode & 0o077) throw new Error('r13_output_directory_permissions_invalid');
  return { root, destination, directory };
}

async function exclusiveAtomicWrite(file, contents, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', mode);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
  try {
    await link(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') throw new Error('r13_auditor_output_already_exists');
    throw error;
  }
  await unlink(temporary);
}

export async function writeR13BlindPacket({ dataRoot, packetPath, custodyPath, samples, seal }) {
  if (!Array.isArray(samples) || samples.length !== 100 || !verifyR13AnswerKeySeal(seal)
    || Object.keys(seal.answer_key).length !== 100) throw new Error('r13_blind_packet_invalid');
  const packet = await secureDataDirectory(dataRoot, packetPath);
  const custody = await secureDataDirectory(dataRoot, custodyPath);
  if (packet.destination === custody.destination || basename(packet.destination) === basename(custody.destination)) {
    throw new Error('r13_blind_key_path_not_separate');
  }
  const cases = new Set();
  for (const sample of samples) {
    if (!sample.case_id || typeof sample.text !== 'string' || !sample.text.trim() || cases.has(sample.case_id)
      || !Object.hasOwn(seal.answer_key, sample.case_id)) throw new Error('r13_blind_case_binding_invalid');
    cases.add(sample.case_id);
  }
  const publicRows = samples.map(({ case_id, text }) => JSON.stringify({ case_id, text })).join('\n') + '\n';
  const secret = JSON.stringify({ ...seal, sample_count: samples.length }, null, 2) + '\n';
  await exclusiveAtomicWrite(packet.destination, publicRows);
  try { await exclusiveAtomicWrite(custody.destination, secret); }
  catch (error) {
    await unlink(packet.destination).catch(() => undefined);
    throw error;
  }
  return { sample_count: samples.length, sample_file_sha256: hash(publicRows), answer_key_sha256: seal.sha256,
    sample_file: relative(packet.root, packet.destination), custody_file: relative(custody.root, custody.destination) };
}

export async function writeR13VariantFile({ dataRoot, destination, rows }) {
  const { destination: file, root } = await secureDataDirectory(dataRoot, destination);
  if (basename(file) !== 'variantes-r13.jsonl' || !Array.isArray(rows) || rows.length !== 1194) {
    throw new Error('r13_variant_export_invalid');
  }
  const seen = new Set();
  for (const row of rows) {
    const identity = `${[...(row.case_ids ?? [])].sort().join(',')}\0${row.question_language}`;
    if (!['pt', 'en'].includes(row.question_language) || !Array.isArray(row.case_ids) || !row.case_ids.length
      || row.case_ids.some((caseId) => typeof caseId !== 'string' || !caseId)
      || seen.has(identity) || !row.request_digest || !row.input_digest || !Number.isSafeInteger(row.input_tokens)) {
      throw new Error('r13_variant_export_row_invalid');
    }
    seen.add(identity);
  }
  if (seen.size !== 1194) throw new Error('r13_variant_export_pairs_incomplete');
  const content = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  let reused = false;
  try {
    const old = await (await import('node:fs/promises')).readFile(file, 'utf8');
    if (old !== content) throw new Error('r13_variant_output_mismatch');
    reused = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await exclusiveAtomicWrite(file, content);
  }
  return { rows: rows.length, sha256: hash(content), file: relative(root, file), reused };
}

export function sealR13AnswerKey(answerKey) {
  if (!record(answerKey) || !Object.keys(answerKey).length) throw new Error('r13_key_invalid');
  const bytes = Buffer.from(canonical(answerKey));
  return { answer_key: answerKey, sha256: hash(bytes), bytes: bytes.length };
}

export function verifyR13AnswerKeySeal(seal) {
  return record(seal) && record(seal.answer_key) && seal.sha256 === sealR13AnswerKey(seal.answer_key).sha256;
}

export function summarizeR13Interests(snapshot, interestRows) {
  const items = new Map(snapshot.items.map((item) => [item.root_id, item]));
  const rows = indexedRows('interests', interestRows, items);
  const interests = Object.fromEntries(['apostas', 'racismo'].map((key) => [key, new Set()]));
  const topicMembership = new Map();
  for (const item of snapshot.items) {
    for (const [index, candidate] of (item.candidates ?? []).entries()) {
      if (item.probabilities?.[`topic_${index}`]?.noul > 0.7) {
        const members = topicMembership.get(candidate.topic_key) ?? new Set();
        members.add(item.root_id);
        topicMembership.set(candidate.topic_key, members);
      }
    }
    const response = rows.get(item.root_id)?.response?.answers ?? rows.get(item.root_id)?.answers;
    for (const key of Object.keys(interests)) {
      const probability = response?.[key]?.noul ?? response?.[`interest_${key}`]?.noul;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('r13_interest_probability_invalid');
      if (probability > 0.7) interests[key].add(item.root_id);
    }
  }
  const union = new Set([...interests.apostas, ...interests.racismo]);
  const intersection = [...interests.apostas].filter((id) => interests.racismo.has(id));
  const topicRoots = new Set([...topicMembership.values()].flatMap((members) => [...members]));
  const summarize = (set) => ({ roots: set.size, coverage_percent: rate(set.size, items.size),
    overlap_with_topics_roots: [...set].filter((id) => topicRoots.has(id)).length });
  return { root_count: items.size, interests: Object.fromEntries(Object.entries(interests).map(([key, set]) => [key, summarize(set)])),
    union: summarize(union), intersection_roots: intersection.length,
    intersection_percent_of_union: rate(intersection.length, union.size),
    interest_union_outside_topic_map_roots: [...union].filter((id) => !topicRoots.has(id)).length };
}

export function projectR13Cost({ roots, voyageTokens, voyageUsdPerMillion = 0.12, jevInputTokens,
  jevUsdPerMillion = 0.042, observedEditorialUsd, observedEditorialCalls, forecastGroups = [180, 225, 270] }) {
  if (![roots, voyageTokens, jevInputTokens, observedEditorialCalls].every(Number.isSafeInteger)
    || roots <= 0 || voyageTokens <= 0 || jevInputTokens <= 0 || observedEditorialCalls <= 0
    || !Number.isFinite(observedEditorialUsd) || observedEditorialUsd < 0 || !Array.isArray(forecastGroups)
    || forecastGroups.length !== 3 || forecastGroups.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    throw new Error('r13_cost_inputs_invalid');
  }
  const voyageUsd = voyageTokens * voyageUsdPerMillion / 1e6;
  const jevUsd = jevInputTokens * jevUsdPerMillion / 1e6;
  const editorialPerGroup = observedEditorialUsd / observedEditorialCalls;
  return { source: { roots, voyage_input_tokens: voyageTokens, jev_input_tokens: jevInputTokens,
      voyage_usd_per_million_tokens: voyageUsdPerMillion, jev_usd_per_million_tokens: jevUsdPerMillion,
      editorial_calls: observedEditorialCalls, editorial_usage_usd: observedEditorialUsd,
      editorial_usage_usd_per_group: editorialPerGroup },
    pilot: { voyage_usage_usd: voyageUsd, voyage_confirmed_cash_usd: 0, jev_usage_usd: jevUsd,
      editorial_usage_usd: observedEditorialUsd, combined_usage_value_usd: voyageUsd + jevUsd + observedEditorialUsd },
    per_million_roots: forecastGroups.map((groups) => {
      const voyage = voyageUsd * 1e6 / roots;
      const jev = jevUsd * 1e6 / roots;
      const editorial = editorialPerGroup * groups;
      return { editorial_groups: groups, voyage_usage_usd: voyage, jev_usage_usd: jev,
        editorial_usage_usd: editorial, combined_usage_value_usd: voyage + jev + editorial };
    }) };
}

export function appendR13ComparisonCorrection(priorComparison, r13) {
  if (!record(priorComparison) || !record(r13) || !Number.isSafeInteger(r13.root_count)
    || !r13.consumer_eligibility || !r13.counts || !r13.consumer_voice_by_prior_promotion) {
    throw new Error('r13_comparison_correction_invalid');
  }
  return { ...priorComparison, r13_correction: {
    contract_version: 'pilot-comparison-r13-v1', roots: r13.root_count,
    prior_comparison_method: 'The earlier comparison checked whether the study dimensions were represented. It did not check individual consumer reasons or match individual triggers and barriers.',
    consumer_voice_eligibility: r13.consumer_eligibility,
    corrected_consumer_voice_trigger_barrier_counts: r13.consumer_voice_by_prior_promotion,
    corrected_trigger_barrier_counts_all_roots: r13.counts,
  } };
}

const money = (value) => `USD ${value.toFixed(6)}`;
export function renderCorrectedPublicReceiptR13({ receipt, baseline, repaired, projection, interests, costComparison,
  confirmedStageCharges = { voyage_usd: 0, claude_usd: 8.03, jev_usd: null } }) {
  if (typeof receipt !== 'string' || !receipt.startsWith('# Piloto de etiquetado masivo')
    || !baseline || !repaired || !projection || !Array.isArray(projection.per_million_roots)
    || projection.per_million_roots.length !== 3 || repaired.root_count !== baseline.root_count
    || repaired.root_count < 1 || Object.values(repaired.counts).reduce((sum, value) => sum + value, 0) !== repaired.root_count) {
    throw new Error('r13_public_receipt_input_invalid');
  }
  const pattern = /La proyección a 1,000,000 de raíces[^\n]*/u;
  if (!pattern.test(receipt)) throw new Error('r13_prior_projection_missing');
  const revised = receipt.replace(pattern,
    'La proyección separa Voyage y JEV por raíz, y Claude por grupos. Supone la misma mezcla de menciones y fragmentos al escalar el corpus.');
  const retained = revised.split('\n').filter((line) => !/^Cargo total confirmado:/u.test(line)
    && !/^Valor tarifario del uso:/u.test(line) && !/^Estimación de caja con crédito/u.test(line)).join('\n');
  const forecasts = projection.per_million_roots.map((row) =>
    `| ${row.editorial_groups} | ${money(row.voyage_usage_usd)} | ${money(row.jev_usage_usd)} | ${money(row.editorial_usage_usd)} | ${money(row.combined_usage_value_usd)} |`);
  const oldTriggers = baseline.historical_trigger_barrier_by_promotion.trigger;
  const oldBarriers = baseline.historical_trigger_barrier_by_promotion.barrier;
  const lines = [
    '', '## Correcciones R13', '',
    `La relevancia genérica histórica se conserva como diagnóstico. Dio ${baseline.original_relevance.positive} positivas, ${baseline.original_relevance.intermediate} intermedias y ${baseline.original_relevance.negative} negativas.`,
    `El trigger/barrier histórico marcó ${oldTriggers.promoted} triggers y ${oldBarriers.promoted} barriers con promoción superior a 0.7; el desglose completo por promoción está en el anexo privado.`,
    `La pregunta corregida nombró cerveza y limitó el indicador a voz individual de consumidor, promoción ≤0.7 y texto del post que no sea sólo hashtags. Elegibles: ${repaired.consumer_eligibility.eligible}; excluidas: ${repaired.consumer_eligibility.excluded}. Resultados corregidos en el corpus: ${repaired.counts.trigger} triggers, ${repaired.counts.barrier} barriers, ${repaired.counts.none} none, ${repaired.counts.intermediate} intermedios y ${repaired.counts.unresolved} sin resolver.`,
    'La comparación inicial verificó la presencia de las dimensiones trigger/barrier. No estableció la coincidencia de causas concretas.',
    '', '### Proyección corregida por millón de raíces', '',
    '| Grupos editoriales | Voyage a tarifa | JEV por raíz | Claude por grupo | Total a tarifa |',
    '|---:|---:|---:|---:|---:|', ...forecasts, '',
    `El uso histórico de Voyage costó ${money(projection.pilot.voyage_usage_usd)} a tarifa y su cargo confirmado fue USD 0. El uso tarifario de JEV es ${money(projection.pilot.jev_usage_usd)}. Claude costó ${money(projection.pilot.editorial_usage_usd)} para ${projection.source.editorial_calls} grupos, ${money(projection.source.editorial_usage_usd_per_group)} por grupo. Total piloto a tarifa ${money(projection.pilot.combined_usage_value_usd)}.`,
    `Cargo confirmado por etapa: Voyage ${money(confirmedStageCharges.voyage_usd)}, Claude ${money(confirmedStageCharges.claude_usd)}, JEV ${confirmedStageCharges.jev_usd === null ? 'no atribuible por etapa con la evidencia disponible' : money(confirmedStageCharges.jev_usd)}.`,
  ];
  if (interests) {
    lines.push('', '### Intereses definidos',
      `Apostas cubrió ${interests.interests.apostas.roots} raíces (${interests.interests.apostas.coverage_percent.toFixed(2)}%); Racismo cubrió ${interests.interests.racismo.roots} (${interests.interests.racismo.coverage_percent.toFixed(2)}%). La unión cubrió ${interests.union.roots} raíces y la intersección ${interests.intersection_roots}.`);
  }
  if (costComparison) {
    const fullTokens = costComparison.tokens_per_root?.full ?? costComparison.tokens_per_root_13_questions;
    const reducedTokens = costComparison.tokens_per_root?.reduced ?? costComparison.tokens_per_root_7_questions;
    const savedTokens = fullTokens - reducedTokens;
    const reductionPercent = costComparison.token_reduction_fraction === undefined
      ? costComparison.relative_token_reduction_percent : costComparison.token_reduction_fraction * 100;
    lines.push('', '### Comparación de costo por número de preguntas',
      `En ${costComparison.paired_roots} raíces elegidas de forma pareada, el promedio fue ${fullTokens.toFixed(2)} tokens por raíz con trece preguntas y ${reducedTokens.toFixed(2)} con siete, una diferencia de ${savedTokens.toFixed(2)} tokens (${reductionPercent.toFixed(1)}%). Las probabilidades de las preguntas compartidas se comparan en el anexo privado.`);
  }
  return retained.trimEnd() + '\n' + lines.join('\n') + '\n';
}

export function analyzeR13CostArms(snapshot, arm13, arm7, selectedRootIds) {
  const knownItems = new Map(snapshot.items.map((item) => [item.root_id, item]));
  const thirteen = indexedRows('cost13', arm13, knownItems);
  const seven = indexedRows('cost7', arm7, knownItems);
  if (!Array.isArray(selectedRootIds) || selectedRootIds.length !== 1000 || new Set(selectedRootIds).size !== 1000) {
    throw new Error('r13_cost_roots_invalid');
  }
  const fields = ['promotion', 'voice', 'trigger_barrier', 'topic_0', 'topic_1', 'topic_2', 'topic_3'];
  const absolute = Object.fromEntries(fields.map((field) => [field, 0]));
  const crossings = Object.fromEntries(fields.map((field) => [field, 0]));
  let tokens13 = 0;
  let tokens7 = 0;
  for (const root of selectedRootIds) {
    const original = knownItems.get(root), a = thirteen.get(root), b = seven.get(root);
    if (!original || !a || !b) throw new Error('r13_cost_pair_missing');
    const x = a.response?.answers ?? a.answers, y = b.response?.answers ?? b.answers;
    for (const field of fields) {
      const probability = (answers) => field === 'voice' ? answers?.voice?.probabilities?.individual
        : field === 'trigger_barrier' ? answers?.trigger_barrier?.probabilities?.[answers.trigger_barrier.choice]
          : answers?.[field]?.noul;
      const left = probability(x), right = probability(y);
      if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('r13_cost_probability_missing');
      absolute[field] += Math.abs(left - right);
      crossings[field] += Number((left > 0.7) !== (right > 0.7));
    }
    tokens13 += a.input_tokens;
    tokens7 += b.input_tokens;
  }
  return { paired_roots: selectedRootIds.length, tokens_13_questions: tokens13, tokens_7_questions: tokens7,
    tokens_per_root_13_questions: tokens13 / 1000, tokens_per_root_7_questions: tokens7 / 1000,
    question_removal_token_difference_per_root: (tokens13 - tokens7) / 1000,
    relative_token_reduction_percent: (tokens13 - tokens7) / tokens13 * 100,
    shared_questions: Object.fromEntries(fields.map((field) => [field, {
      mean_absolute_probability_delta: absolute[field] / 1000, threshold_07_crossings: crossings[field] }])) };
}
