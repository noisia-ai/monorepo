import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import {
  comparePilotSnapshot,
  readPilotSnapshot,
  renderPublicReceipt,
  summarizePilotSnapshot,
  verifyAnswerKeySeal,
  validateOperatorReceipt,
  validatePilotSnapshot,
} from './pilot-audit.mjs';
import {
  appendR13ComparisonCorrection,
  buildNewConsumerSamples,
  buildR13LanguageVariants,
  projectR13Cost,
  renderCorrectedPublicReceiptR13,
  sealR13AnswerKey,
  summarizeR13Baseline,
  summarizeR13Interests,
  summarizeR13Repair,
  verifyR13AnswerKeySeal,
  writeR13BlindPacket,
  writeR13VariantFile,
} from './pilot-r13-audit.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryPrivate = resolve(repositoryRoot, '.data');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = async (path) => hash(await readFile(path));
const within = (parent, child) => {
  const childPath = relative(parent, child);
  return childPath === '' || (!childPath.startsWith('..' + sep) && childPath !== '..' && !isAbsolute(childPath));
};

async function assertPrivateDescendantDirectories(dataRoot, location) {
  let directory = dirname(location);
  while (directory !== dataRoot) {
    if (!within(dataRoot, directory) || (await stat(directory)).mode & 0o077) {
      throw new Error('r13_private_directory_permissions_invalid');
    }
    directory = dirname(directory);
  }
}

async function canonicalPrivatePath(dataRoot, requested) {
  const absolute = resolve(requested);
  let ancestor = absolute;
  let canonicalAncestor;
  for (;;) {
    try { canonicalAncestor = await realpath(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('r13_private_path_invalid');
      ancestor = parent;
    }
  }
  const destination = join(canonicalAncestor, relative(ancestor, absolute));
  if (!within(dataRoot, canonicalAncestor) || !within(dataRoot, destination) || destination === dataRoot) {
    throw new Error('r13_private_path_invalid');
  }
  return destination;
}

async function pathInDataRoot(root, requested, { mustExist = true, file = false } = {}) {
  const data = await realpath(root);
  if (basename(data) !== '.data') throw new Error('r13_data_root_invalid');
  if (mustExist) {
    const actual = await realpath(resolve(requested));
    const metadata = await stat(actual);
    if (!within(data, actual) || actual === data || (file && !metadata.isFile()) || (metadata.mode & 0o077)) throw new Error('r13_private_input_permissions_invalid');
    await assertPrivateDescendantDirectories(data, actual);
    return actual;
  }
  const destination = await canonicalPrivatePath(data, requested);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(destination));
  if (!within(data, parent) || parent === data) throw new Error('r13_private_output_invalid');
  await assertPrivateDescendantDirectories(data, join(parent, 'child'));
  if ((await stat(parent)).mode & 0o077) throw new Error('r13_private_output_permissions_invalid');
  return join(parent, basename(destination));
}

async function inputFile(root, requested) {
  return pathInDataRoot(root, requested, { file: true });
}

async function outputFile(root, requested) {
  return pathInDataRoot(root, requested, { mustExist: false });
}

async function privateDirectory(root, requested) {
  const data = await realpath(root);
  const absolute = await canonicalPrivatePath(data, requested);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const directory = await realpath(absolute);
  if (!within(data, directory) || directory === data) throw new Error('r13_private_output_invalid');
  await assertPrivateDescendantDirectories(data, join(directory, 'child'));
  return directory;
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

async function readJsonLines(path) {
  const rows = [];
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

async function readPrivateConfig(configArgument) {
  if (!configArgument) throw new Error('usage: pilot-r13-audit-export.mjs --phase phase-a|phase-b --config <private-json>');
  const configPath = resolve(configArgument);
  const dataAncestor = configPath.split(sep).slice(0, -1).reverse().map((part, index, pieces) => part === '.data'
    ? configPath.split(sep).slice(0, -1 - index).join(sep) : null).find(Boolean);
  if (!dataAncestor) throw new Error('r13_config_must_be_private');
  const actualPath = await realpath(configPath);
  const configDataRoot = await realpath(dataAncestor);
  if (!within(configDataRoot, actualPath) || (await stat(actualPath)).mode & 0o077) throw new Error('r13_config_must_be_private');
  await assertPrivateDescendantDirectories(configDataRoot, actualPath);
  const config = await readJson(actualPath);
  if (resolve(config.repository_root) !== repositoryRoot || resolve(config.workspace_data_root) !== repositoryPrivate) {
    throw new Error('r13_repository_binding_invalid');
  }
  const r13Root = await realpath(config.r13_data_root);
  if (basename(r13Root) !== '.data') throw new Error('r13_data_root_invalid');
  return { config, r13Root, workspaceRoot: await realpath(repositoryPrivate) };
}

async function loadH4({ config, workspaceRoot, r13Root }) {
  const snapshotPath = await inputFile(workspaceRoot, config.h4.snapshot);
  const proof = await readJson(await inputFile(workspaceRoot, config.h4.snapshot_proof));
  if (await fileHash(snapshotPath) !== proof.sha256) throw new Error('r13_h4_snapshot_hash_invalid');
  const snapshot = await readPilotSnapshot(snapshotPath);
  validatePilotSnapshot(snapshot);
  if (snapshot.map.map_digest !== proof.map_digest || snapshot.items.length !== 83_962) throw new Error('r13_h4_snapshot_binding_invalid');
  const operatorPath = await inputFile(workspaceRoot, config.h4.operator_receipt);
  const operatorText = await readFile(operatorPath, 'utf8');
  const operator = JSON.parse(operatorText);
  validateOperatorReceipt(snapshot, operator);
  const comparisonPath = await inputFile(workspaceRoot, config.h4.comparison);
  const comparison = await readJson(comparisonPath);
  const h4KeyPath = await inputFile(workspaceRoot, config.h4.answer_key);
  const h4Key = await readJson(h4KeyPath);
  if (!verifyAnswerKeySeal(h4Key) || Object.keys(h4Key.answer_key).length !== 600) throw new Error('r13_h4_answer_key_invalid');
  const h4Samples = await readJsonLines(await inputFile(workspaceRoot, config.h4.blind_samples));
  if (h4Samples.length !== 600 || h4Samples.some((sample) => Object.hasOwn(sample, 'root_id'))) throw new Error('r13_h4_samples_invalid');
  const priorRootIds = Object.values(h4Key.answer_key).map((row) => row.root_id);
  const priorRootSet = new Set(priorRootIds);
  if (priorRootSet.size !== 597) throw new Error('r13_h4_sample_population_invalid');
  const summary = summarizePilotSnapshot(snapshot, operator);
  return { snapshot, operator, operatorText, comparison, h4Key, priorRootSet, summary,
    source: { snapshot_sha256: proof.sha256, operator_receipt_sha256: hash(operatorText),
      comparison_sha256: await fileHash(comparisonPath), h4_answer_key_sha256: h4Key.sha256 } };
}

async function loadR13Rows(r13Root, config, key) {
  const rows = await readJsonLines(await inputFile(r13Root, config.stages[key]));
  return { rows, sha256: await fileHash(await inputFile(r13Root, config.stages[key])) };
}

function summarizeR13StageUsage(stage, rows, expectedCount) {
  if (rows.length !== expectedCount) throw new Error('r13_stage_usage_incomplete');
  const totals = { stage, results: rows.length, input_tokens: 0, output_tokens: 0, micro_usd: 0 };
  for (const row of rows) {
    if ((row.stage && row.stage !== stage) || row.status !== 'settled'
      || !Number.isSafeInteger(row.input_tokens) || row.input_tokens < 0
      || !Number.isSafeInteger(row.micro_usd) || row.micro_usd < 0
      || !Number.isSafeInteger(row.response?.usage?.output_tokens) || row.response.usage.output_tokens < 0) {
      throw new Error('r13_stage_usage_invalid');
    }
    totals.input_tokens += row.input_tokens;
    totals.output_tokens += row.response.usage.output_tokens;
    totals.micro_usd += row.micro_usd;
  }
  return totals;
}

async function loadVerifiedLanguageRows(r13Root, config, key) {
  const resultsPath = await inputFile(r13Root, config.stages[key]);
  const rows = await readJsonLines(resultsPath);
  for (const row of rows) {
    const stem = hash(row.root_id);
    const rawPath = await inputFile(r13Root, join(dirname(resultsPath), `${stem}.raw.json`));
    const rawReceipt = await readJson(rawPath);
    if (typeof rawReceipt.body !== 'string' || rawReceipt.http_status !== 200
      || `sha256:${hash(rawReceipt.body)}` !== row.raw_sha256) throw new Error('r13_variant_raw_digest_mismatch');
    row.raw_body = rawReceipt.body;
    row.raw_response = JSON.parse(rawReceipt.body);
  }
  return { rows, sha256: await fileHash(resultsPath) };
}

async function persistentSeed(dataRoot, directory) {
  const seedPath = await outputFile(dataRoot, join(directory, 'sample-seed.bin'));
  try {
    const seed = await readFile(seedPath);
    if (seed.length !== 32) throw new Error('r13_seed_invalid');
    return { seedPath, seed };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const seed = randomBytes(32);
    const handle = await open(seedPath, 'wx', 0o600);
    await handle.writeFile(seed);
    await handle.sync();
    await handle.close();
    return { seedPath, seed };
  }
}

async function writeImmutableJson(path, value) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  try {
    const previous = await readFile(path, 'utf8');
    if (previous !== contents) throw new Error('r13_existing_evidence_mismatch');
    return hash(contents);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
  const { link, unlink } = await import('node:fs/promises');
  try { await link(temporary, path); } finally { await unlink(temporary).catch(() => undefined); }
  return hash(contents);
}

async function publishReceipt(path, contents) {
  const absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  if (!within(repositoryRoot, parent) || within(repositoryPrivate, parent) || basename(absolute) !== 'DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_2026-11-08.md') {
    throw new Error('r13_public_receipt_path_invalid');
  }
  const temporary = join(parent, `.r13-${process.pid}.tmp`);
  const handle = await open(temporary, 'wx', 0o644);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, absolute);
}

function receiptDate(snapshot) {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(snapshot.map.created_at));
  return `${date.find((part) => part.type === 'year').value}-${date.find((part) => part.type === 'month').value}-${date.find((part) => part.type === 'day').value}`;
}

async function seedR13Packet({ config, r13Root, keyDir, repair, h4 }) {
  const { seed } = await persistentSeed(r13Root, keyDir);
  const { samples, answerKey } = buildNewConsumerSamples(repair, [...h4.priorRootSet], seed);
  const seal = sealR13AnswerKey(answerKey);
  const samplePath = await outputFile(r13Root, config.outputs.new_blind_samples);
  const keyPath = await outputFile(r13Root, config.outputs.new_blind_key);
  const sampleText = samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n';
  const keyText = JSON.stringify({ ...seal, sample_count: samples.length }, null, 2) + '\n';
  const oldSample = await readFile(samplePath, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const oldKey = await readFile(keyPath, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (oldSample === null && oldKey === null) {
    const receipt = await writeR13BlindPacket({ dataRoot: r13Root, packetPath: samplePath, custodyPath: keyPath, samples, seal });
    return { sample_count: receipt.sample_count, sample_file_sha256: receipt.sample_file_sha256,
      answer_key_sha256: receipt.answer_key_sha256, sample_path: config.outputs.new_blind_samples,
      key_path: config.outputs.new_blind_key,
      allocation: samples.reduce((out, sample) => { const cohort = answerKey[sample.case_id].decision; out[cohort]++; return out; }, { trigger: 0, barrier: 0 }) };
  }
  if (oldSample !== sampleText || oldKey !== keyText || !verifyR13AnswerKeySeal(JSON.parse(oldKey))) {
    throw new Error('r13_blind_packet_existing_mismatch');
  }
  return { sample_count: samples.length, sample_file_sha256: hash(sampleText), answer_key_sha256: seal.sha256,
    sample_path: config.outputs.new_blind_samples, key_path: config.outputs.new_blind_key,
    allocation: samples.reduce((out, sample) => { const cohort = answerKey[sample.case_id].decision; out[cohort]++; return out; }, { trigger: 0, barrier: 0 }) };
}

export async function phaseA(ctx) {
  const { config, r13Root, workspaceRoot } = ctx;
  const phaseBManifestPath = await outputFile(r13Root, config.outputs.phase_b_manifest);
  try {
    await stat(phaseBManifestPath);
    throw new Error('r13_phase_a_already_superseded');
  } catch (error) { if (error.message === 'r13_phase_a_already_superseded') throw error; if (error.code !== 'ENOENT') throw error; }
  const h4 = ctx.h4Override ?? await loadH4(ctx);
  const repair = await loadR13Rows(r13Root, config, 'repair');
  const hashtagOnly = await readJson(await inputFile(r13Root, config.root_hashtag_flags));
  if (Object.keys(hashtagOnly).length !== h4.snapshot.items.length
    || Object.values(hashtagOnly).some((value) => typeof value !== 'boolean')) throw new Error('r13_hashtag_flags_invalid');
  const baseline = summarizeR13Baseline(h4.snapshot);
  const revised = summarizeR13Repair(h4.snapshot, repair.rows, { hashtagOnlyByRoot: hashtagOnly });
  if (revised.counts.unresolved !== 0 || revised.private_rows.length !== h4.snapshot.items.length) throw new Error('r13_repair_incomplete');
  const stageUsage = [summarizeR13StageUsage('repair', repair.rows, h4.snapshot.items.length)];
  await privateDirectory(r13Root, resolve(config.outputs.audit_dir));
  const custodyDir = await privateDirectory(r13Root, resolve(config.outputs.custody_dir));
  const packet = await seedR13Packet({ config, r13Root, keyDir: custodyDir, repair: revised, h4 });
  const comparison = appendR13ComparisonCorrection(comparePilotSnapshot(h4.snapshot, h4.comparison), revised);
  const comparisonPath = await outputFile(r13Root, config.outputs.comparison_addendum);
  const comparisonHash = await writeImmutableJson(comparisonPath, comparison);
  const receiptPath = resolve(config.public_receipt_path);
  const canonicalReceipt = renderPublicReceipt(h4.summary, receiptDate(h4.snapshot));
  const projection = projectR13Cost({
    roots: h4.summary.root_count,
    voyageTokens: h4.summary.stages.find((s) => s.name === 'voyage').free_tokens_used,
    jevInputTokens: h4.summary.stages.filter((s) => s.name.startsWith('jev_')).reduce((sum, s) => sum + (s.input_tokens ?? 0), 0),
    observedEditorialUsd: h4.summary.stages.find((s) => s.name === 'claude').usage_value_micro_usd / 1_000_000,
    observedEditorialCalls: h4.summary.bertopic_group_count,
  });
  const finalReceipt = renderCorrectedPublicReceiptR13({ receipt: canonicalReceipt, baseline, repaired: revised,
    projection, r13StageUsage: stageUsage });
  await publishReceipt(receiptPath, finalReceipt);
  const evidence = {
    contract_version: 'pilot-r13-phase-a-v1', map_digest: h4.snapshot.map.map_digest, roots: h4.snapshot.items.length,
    inputs: { ...h4.source, repair_sha256: repair.sha256, hashtag_flags_sha256: await fileHash(await inputFile(r13Root, config.root_hashtag_flags)) },
    baseline, corrected_consumer_indicators: { root_count: revised.root_count,
      eligible_count: revised.consumer_voice_summary.eligible_count,
      consumer_eligibility: revised.consumer_eligibility,
      consumer_voice_counts: revised.consumer_voice_summary,
      diagnostic_all_roots: { counts: revised.counts, percentages: revised.percentages },
      consumer_voice_by_prior_promotion: revised.consumer_voice_by_prior_promotion },
    r13_stage_usage: stageUsage,
    blind_packet: packet, comparison_addendum_sha256: comparisonHash,
    corrected_receipt_sha256: hash(finalReceipt), revised_public_receipt: relative(workspaceRoot, receiptPath),
  };
  const evidencePath = await outputFile(r13Root, config.outputs.phase_a_evidence);
  const evidenceHash = await writeImmutableJson(evidencePath, evidence);
  const manifestPath = await outputFile(r13Root, config.outputs.phase_a_manifest);
  const manifest = { contract_version: 'pilot-r13-phase-a-manifest-v1', evidence_sha256: evidenceHash,
    receipt_sha256: evidence.corrected_receipt_sha256, comparison_sha256: comparisonHash,
    blind_samples_sha256: packet.sample_file_sha256, answer_key_sha256: packet.answer_key_sha256 };
  await writeImmutableJson(manifestPath, manifest);
  return { phase: 'phase-a', roots: evidence.roots, corrected_indicator: revised.counts,
    eligible_consumers: revised.consumer_eligibility.eligible, new_blind_samples: packet.sample_count,
    idempotent_key: packet.answer_key_sha256, receipt_sha256: evidence.corrected_receipt_sha256 };
}

export async function phaseB(ctx) {
  const { config, r13Root, workspaceRoot } = ctx;
  const h4 = ctx.h4Override ?? await loadH4(ctx);
  const phaseAManifest = await readJson(await inputFile(r13Root, config.outputs.phase_a_manifest));
  if (phaseAManifest.contract_version !== 'pilot-r13-phase-a-manifest-v1') throw new Error('r13_phase_a_missing');
  const repair = await loadR13Rows(r13Root, config, 'repair');
  const hashtagOnly = await readJson(await inputFile(r13Root, config.root_hashtag_flags));
  const revised = summarizeR13Repair(h4.snapshot, repair.rows, { hashtagOnlyByRoot: hashtagOnly });
  const interestRows = await loadR13Rows(r13Root, config, 'interests');
  const interestMetrics = summarizeR13Interests(h4.snapshot, interestRows.rows);
  const cost13 = await loadR13Rows(r13Root, config, 'cost13');
  const cost7 = await loadR13Rows(r13Root, config, 'cost7');
  const costFile = await inputFile(r13Root, config.stages.cost_comparison);
  const costComparison = await readJson(costFile);
  if (costComparison.contract_version !== 'mass-labeling-r13-cost-comparison-v1'
    || costComparison.paired_roots !== 1000 || costComparison.same_text_and_shared_questions_verified !== true
    || !Number.isFinite(costComparison.tokens_per_root?.full)
    || !Number.isFinite(costComparison.tokens_per_root?.reduced)
    || !Number.isFinite(costComparison.probability_comparisons?.reduced_vs_full?.mean_absolute_delta)) {
    throw new Error('r13_cost_comparison_incomplete');
  }
  const languagePT = await loadVerifiedLanguageRows(r13Root, config, 'language_pt');
  const languageEN = await loadVerifiedLanguageRows(r13Root, config, 'language_en');
  const stageUsage = [summarizeR13StageUsage('repair', repair.rows, h4.snapshot.items.length),
    summarizeR13StageUsage('interests', interestRows.rows, h4.snapshot.items.length),
    summarizeR13StageUsage('cost13', cost13.rows, costComparison.paired_roots),
    summarizeR13StageUsage('cost7', cost7.rows, costComparison.paired_roots),
    summarizeR13StageUsage('language-pt', languagePT.rows, 597),
    summarizeR13StageUsage('language-en', languageEN.rows, 597)];
  const blindLinks = await readJson(await inputFile(r13Root, config.variant_private_link));
  const variants = buildR13LanguageVariants(languagePT.rows, languageEN.rows, blindLinks);
  const variantOut = await outputFile(r13Root, config.outputs.language_variants);
  const variantReceipt = await writeR13VariantFile({ dataRoot: r13Root, destination: variantOut, rows: variants });
  const variantEvidence = { rows: variantReceipt.rows, sha256: variantReceipt.sha256,
    file: config.outputs.language_variants, portuguese_roots: languagePT.rows.length,
    english_roots: languageEN.rows.length, new_calls: languagePT.rows.length + languageEN.rows.length };
  const translation = await readJson(await inputFile(r13Root, config.translation_receipt));
  const translatedTopics = await readJson(await inputFile(r13Root, config.translation_translations));
  if (translation.count !== 98 || !Number.isSafeInteger(translation.cost_micro_usd) || translation.cost_micro_usd < 0
    || translatedTopics.translations?.length !== 98 || translatedTopics.map_digest !== h4.snapshot.map.map_digest) {
    throw new Error('r13_topic_translation_invalid');
  }
  if (!Number.isSafeInteger(translation.usage?.input_tokens) || !Number.isSafeInteger(translation.usage?.output_tokens)) {
    throw new Error('r13_translation_usage_invalid');
  }
  stageUsage.push({ stage: 'translation', results: translation.count, input_tokens: translation.usage.input_tokens,
    output_tokens: translation.usage.output_tokens, micro_usd: translation.cost_micro_usd });
  const baseline = summarizeR13Baseline(h4.snapshot);
  const revisedReceipt = renderCorrectedPublicReceiptR13({
    receipt: renderPublicReceipt(h4.summary, receiptDate(h4.snapshot)), baseline, repaired: revised,
    projection: projectR13Cost({
      roots: h4.summary.root_count,
      voyageTokens: h4.summary.stages.find((s) => s.name === 'voyage').free_tokens_used,
      jevInputTokens: h4.summary.stages.filter((s) => s.name.startsWith('jev_')).reduce((sum, s) => sum + (s.input_tokens ?? 0), 0),
      observedEditorialUsd: h4.summary.stages.find((s) => s.name === 'claude').usage_value_micro_usd / 1_000_000,
      observedEditorialCalls: h4.summary.bertopic_group_count,
    }),
    interests: interestMetrics, costComparison, r13StageUsage: stageUsage,
  });
  await publishReceipt(config.public_receipt_path, revisedReceipt);
  const evidence = { contract_version: 'pilot-r13-phase-b-v1', map_digest: h4.snapshot.map.map_digest,
    roots: h4.snapshot.items.length, phase_a_manifest_sha256: hash(JSON.stringify(phaseAManifest)),
    inputs: { interests_sha256: interestRows.sha256, cost_comparison_sha256: await fileHash(costFile),
      language_pt_sha256: languagePT.sha256, language_en_sha256: languageEN.sha256,
      translations_sha256: await fileHash(await inputFile(r13Root, config.translation_translations)) },
    corrected_consumer_indicators: { eligible_count: revised.consumer_voice_summary.eligible_count,
      eligible_counts_by_voice: revised.consumer_voice_summary,
      diagnostic_all_roots: revised.counts },
    interests: interestMetrics, cost: costComparison, r13_stage_usage: stageUsage, language_variants: variantEvidence,
    translations: { count: translation.count, cost_micro_usd: translation.cost_micro_usd, map_digest: translatedTopics.map_digest },
    corrected_receipt_sha256: hash(revisedReceipt), revised_public_receipt: relative(workspaceRoot, config.public_receipt_path) };
  const path = await outputFile(r13Root, config.outputs.phase_b_evidence);
  const evidenceHash = await writeImmutableJson(path, evidence);
  await writeImmutableJson(await outputFile(r13Root, config.outputs.phase_b_manifest),
    { contract_version: 'pilot-r13-phase-b-manifest-v1', evidence_sha256: evidenceHash,
      receipt_sha256: evidence.corrected_receipt_sha256, variants_sha256: variantEvidence.sha256 });
  return { phase: 'phase-b', interest_roots: { apostas: interestMetrics.interests.apostas.roots,
    racismo: interestMetrics.interests.racismo.roots }, paired_cost_roots: costComparison.paired_roots,
    language_rows: variantReceipt.rows, corrected_receipt_sha256: evidence.corrected_receipt_sha256 };
}

async function main() {
  const phaseIndex = process.argv.indexOf('--phase');
  const configIndex = process.argv.indexOf('--config');
  if (phaseIndex < 0 || configIndex < 0 || !['phase-a', 'phase-b'].includes(process.argv[phaseIndex + 1])) {
    throw new Error('usage: pilot-r13-audit-export.mjs --phase phase-a|phase-b --config private-config.json');
  }
  const { config, r13Root, workspaceRoot } = await readPrivateConfig(process.argv[configIndex + 1]);
  const outputs = config.outputs;
  await privateDirectory(r13Root, resolve(outputs.audit_dir));
  await privateDirectory(r13Root, resolve(outputs.custody_dir));
  const result = process.argv[phaseIndex + 1] === 'phase-a'
    ? await phaseA({ config, r13Root, workspaceRoot }) : await phaseB({ config, r13Root, workspaceRoot });
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
