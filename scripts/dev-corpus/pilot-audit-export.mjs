import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBlindSamples,
  comparePilotSnapshot,
  computeSnapshotDigest,
  readPilotSnapshot,
  renderBlindSamples,
  renderPrivateComparisonAnnex,
  renderPublicReceipt,
  renderSealedAnswerKey,
  summarizePilotSnapshot,
  validateOperatorReceipt,
  validatePilotSnapshot,
} from './pilot-audit.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateRoot = resolve(repositoryRoot, '.data');

function within(parent, path) {
  const child = relative(parent, path);
  return child === '' || (!child.startsWith('..' + sep) && child !== '..' && !isAbsolute(child));
}

async function existingPrivateInput(path) {
  const absolute = resolve(repositoryRoot, path);
  const actual = await realpath(absolute);
  const privateActual = await realpath(privateRoot);
  if (((await stat(privateActual)).mode & 0o077) !== 0) throw new Error('pilot_audit_private_directory_permissions_invalid');
  const metadata = await stat(actual);
  if (!within(privateActual, actual) || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error('pilot_audit_private_input_path_required');
  }
  return actual;
}

async function privateOutputDirectory(path) {
  const absolute = resolve(repositoryRoot, path);
  if (!within(privateRoot, absolute) || absolute === privateRoot) throw new Error('pilot_audit_private_output_path_required');
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await chmod(privateRoot, 0o700);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const actual = await realpath(absolute);
  if (!within(await realpath(privateRoot), actual)) throw new Error('pilot_audit_private_output_path_required');
  await chmod(actual, 0o700);
  return actual;
}

async function publicReceiptPath(path) {
  const absolute = resolve(repositoryRoot, path);
  if (!within(repositoryRoot, absolute) || within(privateRoot, absolute)) throw new Error('pilot_audit_public_receipt_path_invalid');
  await mkdir(dirname(absolute), { recursive: true });
  const actualParent = await realpath(dirname(absolute));
  if (!within(await realpath(repositoryRoot), actualParent) || within(await realpath(privateRoot), actualParent)) {
    throw new Error('pilot_audit_public_receipt_path_invalid');
  }
  return absolute;
}

async function atomicWrite(path, contents, mode = 0o600) {
  const temporary = join(dirname(path), `.${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temporary, contents, { mode, flag: 'wx' });
  await rename(temporary, path);
}

async function sampleSecret(directory) {
  const path = join(directory, 'sample-seed.bin');
  try {
    const secret = await readFile(path);
    if (secret.length !== 32) throw new Error('pilot_audit_sample_seed_invalid');
    return secret;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(32);
    try {
      await writeFile(path, secret, { mode: 0o600, flag: 'wx' });
      return secret;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      const existing = await readFile(path);
      if (existing.length !== 32) throw new Error('pilot_audit_sample_seed_invalid');
      return existing;
    }
  }
}

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--snapshot-digest', '--snapshot', '--operator-receipt', '--comparison', '--out-dir', '--public-receipt'].includes(key)
      || !args[index + 1] || values[key]) throw new Error('pilot_audit_arguments_invalid');
    values[key] = args[index + 1];
  }
  if (values['--snapshot-digest'] && Object.keys(values).length === 1) return values;
  if (!values['--snapshot'] || !values['--operator-receipt'] || !values['--comparison'] || !values['--out-dir']) {
    throw new Error('pilot_audit_usage: --snapshot-digest .data/snapshot.json OR --snapshot .data/... --operator-receipt .data/... --comparison .data/... --out-dir .data/...');
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args['--snapshot-digest']) {
    const snapshotPath = await existingPrivateInput(args['--snapshot-digest']);
    const snapshot = await readPilotSnapshot(snapshotPath);
    validatePilotSnapshot(snapshot);
    process.stdout.write(`${computeSnapshotDigest(snapshot)}\n`);
    return;
  }
  const snapshotPath = await existingPrivateInput(args['--snapshot']);
  const snapshot = await readPilotSnapshot(snapshotPath);
  validatePilotSnapshot(snapshot);
  const operatorReceiptPath = await existingPrivateInput(args['--operator-receipt']);
  const operatorReceiptText = await readFile(operatorReceiptPath, 'utf8');
  const operatorReceipt = JSON.parse(operatorReceiptText);
  validateOperatorReceipt(snapshot, operatorReceipt);
  const comparisonPath = await existingPrivateInput(args['--comparison']);
  const comparison = JSON.parse(await readFile(comparisonPath, 'utf8'));
  const outDirectory = await privateOutputDirectory(args['--out-dir']);
  const summary = summarizePilotSnapshot(snapshot, operatorReceipt);
  const annex = comparePilotSnapshot(snapshot, comparison);
  const secret = await sampleSecret(outDirectory);
  const { samples, answerKey } = buildBlindSamples(snapshot, summary, secret);
  const samplesText = renderBlindSamples(samples);
  const keyText = renderSealedAnswerKey(answerKey);
  const annexText = renderPrivateComparisonAnnex(annex);
  const keyHash = JSON.parse(keyText).sha256;
  const manifest = {
    contract_version: 'signal-mass-labeling-audit-delivery-v1',
    map_digest: snapshot.map.map_digest,
    map_frozen_at: snapshot.map.created_at,
    operator_receipt_sha256: digest(operatorReceiptText),
    root_count: summary.root_count,
    blind_sample_count: samples.length,
    answer_key_sha256: keyHash,
    samples_sha256: digest(samplesText),
    comparison_annex_sha256: digest(annexText),
  };

  await atomicWrite(join(outDirectory, 'blind-samples.jsonl'), samplesText);
  await atomicWrite(join(outDirectory, 'answer-key.json'), keyText);
  await atomicWrite(join(outDirectory, 'comparison-annex.json'), annexText);
  await atomicWrite(join(outDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (args['--public-receipt']) {
    const receiptPath = await publicReceiptPath(args['--public-receipt']);
    await mkdir(dirname(receiptPath), { recursive: true });
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(snapshot.map.created_at));
    const date = `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
    await atomicWrite(receiptPath, renderPublicReceipt(summary, date), 0o644);
  }
  process.stdout.write(JSON.stringify({
    status: 'complete',
    map_digest: snapshot.map.map_digest,
    root_count: summary.root_count,
    sample_count: samples.length,
    answer_key_sha256: keyHash,
    private_output: relative(repositoryRoot, outDirectory),
    public_receipt: args['--public-receipt'] ?? null,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
