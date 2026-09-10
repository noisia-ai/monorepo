/**
 * Creates the non-provider successor state for one Topic candidate-refinement proof.
 *
 * The destination is the fixed, fresh, loopback-only clone named by the host receipt. It imports
 * only the completed LAB-2G evaluation's immutable output rows, then applies 0118–0120 exactly
 * once. The LAB-2G source is read only; no candidate is edited, adopted, published or served.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
  verifyFixedSignalTopicEvaluationLabHostReceiptV1 } from "./signal-topic-evaluation-lab-host-provenance-v2";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SOURCE_DATABASE = "noisia_topic_eval_lab_20260905_20e4b67a137a";
const SOURCE_RUN = "topic-v2-lab-run-ee9dcedca1342d414d6646fd";
const CONFIRMATION = "HYDRATE_ONE_LOCAL_DISPOSABLE_REFINEMENT_SUCCESSOR_FROM_LAB_2G";
const OUTPUT_TABLES = [
  "signal_topic_evaluation_v2_execution_authorizations",
  "signal_topic_evaluation_v2_runs",
  "signal_topic_evaluation_v2_model_turns",
  "signal_topic_evaluation_v2_retrievals",
  "signal_topic_evaluation_v2_retrieval_evidence",
  "signal_topic_evaluation_v2_candidates",
  "signal_topic_evaluation_v2_candidate_revisions",
  "signal_topic_evaluation_v2_candidate_evidence",
  "signal_topic_evaluation_v2_rankings"
] as const;
const MIGRATIONS = [
  { ordinal: 118, name: "0118_signal_topic_evaluation_v2_candidate_refinement.sql" },
  { ordinal: 119, name: "0119_signal_topic_evaluation_v2_candidate_refinement_flight.sql" },
  { ordinal: 120, name: "0120_signal_topic_evaluation_v2_candidate_refinement_flight_execution_seal.sql" },
  { ordinal: 121, name: "0121_signal_topic_evaluation_v2_candidate_refinement_flight_provenance_anchor.sql" }
] as const;
const OUTPUT_KINDS = ["authorization", "run", "model_turn", "retrieval", "retrieval_evidence",
  "candidate", "candidate_revision", "candidate_evidence", "ranking"] as const;

export class SignalTopicCandidateRefinementSuccessorHydrationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function hydrateSignalTopicCandidateRefinementSuccessorV1(env: NodeJS.ProcessEnv) {
  if (env.NOISIA_RUNTIME_PROFILE !== "local_disposable_lab_v1"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_HYDRATION_ENABLED !== "true"
      || env.NOISIA_TOPIC_REFINEMENT_LAB_HYDRATION_CONFIRMATION !== CONFIRMATION) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_hydration_disabled");
  }
  const { receipt, container } = await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  if (receipt.clone_name === SOURCE_DATABASE) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_target_invalid");
  }
  const source = await readProof(SOURCE_DATABASE, sourceProofSql(), "source");
  if (!isExactSource(source)) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_source_invalid");
  }
  const before = await readProof(receipt.clone_name, targetBeforeProofSql(), "target_before");
  if (!isPristineTarget(before, receipt.receipt_digest, signalTopicEvaluationDigestV2({
    container_id: container.container_id, image_id: container.image_id
  }))) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_target_not_pristine");
  }
  const [sourceSchema, targetSchema] = await Promise.all([
    readProof(SOURCE_DATABASE, outputSchemaProofSql(), "source"),
    readProof(receipt.clone_name, outputSchemaProofSql(), "target_before")
  ]);
  if (JSON.stringify(sourceSchema) !== JSON.stringify(targetSchema)) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_schema_drift");
  }

  const rawDump = await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "pg_dump", "--no-owner", "--no-privileges", "--data-only", "--inserts", "--username", "postgres",
    "--dbname", SOURCE_DATABASE, ...OUTPUT_TABLES.flatMap((table) => ["--table", table])]);
  // pg_dump deliberately clears search_path. These retained historical rows pass the existing
  // local execution trigger, whose legacy SQL helper is schema-unqualified; restore only the
  // trusted public schema for the fixed dump before its first INSERT.
  const dump = rawDump.replace("SELECT pg_catalog.set_config('search_path', '', false);", "SET search_path TO public;");
  if (!dump.includes("INSERT INTO public.signal_topic_evaluation_v2_candidates")
      || dump === rawDump || Buffer.byteLength(dump, "utf8") > 256 * 1024) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_dump_invalid");
  }
  // These are a verbatim, already-terminal historical run snapshot. Replaying their original
  // INSERT transition would be false history (the runtime validators correctly require a fresh
  // run to progress through claimed/in-progress first). This fixed local clone temporarily
  // suppresses those historical transition triggers *and* foreign-key triggers, so the post-load
  // proof below must re-establish exact row content plus every imported relationship explicitly.
  try {
    await psql(receipt.clone_name, Buffer.from(`BEGIN;\nSET LOCAL session_replication_role = replica;\n${dump}\nSET LOCAL session_replication_role = origin;\nCOMMIT;\n`));
  } catch { throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_import_failed"); }
  for (const migration of MIGRATIONS) {
    try { await applyMigration(receipt.clone_name, receipt.receipt_digest, migration); }
    catch { throw new SignalTopicCandidateRefinementSuccessorHydrationError(`topic_refinement_successor_migration_${migration.ordinal}_failed`); }
  }

  const after = await readProof(receipt.clone_name, targetProofSql(), "target_after");
  if (!isHydratedTarget(after, source)) {
    throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_verify_failed");
  }
  const evidence = {
    contract_version: "signal-topic-candidate-refinement-successor-hydration-v1",
    recorded_at: new Date().toISOString(),
    source: { database: SOURCE_DATABASE, run_key: SOURCE_RUN, output: source },
    target: { clone_name: receipt.clone_name, host_anchor_receipt_digest: receipt.receipt_digest,
      container_identity_digest: signalTopicEvaluationDigestV2({ container_id: container.container_id,
        image_id: container.image_id }), output: after },
    migrations: await Promise.all(MIGRATIONS.map(async ({ ordinal, name }) => ({ ordinal, name,
      checksum_sha256: await migrationDigest(name), applied_exactly_once: true }))),
    effects: { provider_calls_during_hydration: 0, uat_connections: 0, production_accessed: false,
      candidate_edits: 0, topic_adoption: 0, publication: 0, serving: 0 }
  };
  const directory = resolve(ROOT, ".data/signal-topic-evaluation/lab-2h", receipt.clone_name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "successor-hydration.sanitized.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { evidence, path, receipt_digest: signalTopicEvaluationDigestV2(evidence) };
}

function sourceProofSql() {
  return `SELECT json_build_object(
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='${SOURCE_RUN}' AND status='completed'),
    'model_turns',(SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns),
    'retrievals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals),
    'retrieval_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrieval_evidence),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE status='pending' AND NOT adopted AND NOT published AND NOT serving),
    'candidate_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions),
    'candidate_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence),
    'rankings',(SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings),
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'adoption',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted),
    'publication',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published),
    'serving',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving),
    'content_digests',(${outputContentDigestsSql()}),
    'referential_integrity',(${outputIntegritySql()})
  )::text`;
}

function targetProofSql() {
  return `SELECT json_build_object(
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='${SOURCE_RUN}' AND status='completed'),
    'model_turns',(SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns),
    'retrievals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals),
    'retrieval_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrieval_evidence),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE status='pending' AND NOT adopted AND NOT published AND NOT serving),
    'candidate_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions),
    'candidate_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence),
    'rankings',(SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings),
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'adoption',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted),
    'publication',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published),
    'serving',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving),
    '0118',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=118 AND disposition='applied'),
    '0119',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=119 AND disposition='applied'),
    '0120',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=120 AND disposition='applied'),
    '0121',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=121 AND disposition='applied'),
    'sessions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_sessions),
    'flights',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flights),
    'claims',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims),
    'terminals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts),
    'content_digests',(${outputContentDigestsSql()}),
    'referential_integrity',(${outputIntegritySql()})
  )::text`;
}

function targetBeforeProofSql() {
  return `SELECT json_build_object(
    'authorizations',(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE run_key='${SOURCE_RUN}' AND status='completed'),
    'model_turns',(SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns),
    'retrievals',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals),
    'retrieval_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_retrieval_evidence),
    'candidates',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE status='pending' AND NOT adopted AND NOT published AND NOT serving),
    'candidate_revisions',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions),
    'candidate_evidence',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence),
    'rankings',(SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings),
    'provider_calls',(SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs),
    'adoption',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted),
    'publication',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published),
    'serving',(SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving),
    '0118',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=118 AND disposition='applied'),
    '0119',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=119 AND disposition='applied'),
    '0120',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=120 AND disposition='applied'),
    '0121',(SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=121 AND disposition='applied'),
    'host_anchor',(SELECT count(*)::int FROM noisia_topic_evaluation_lab.host_receipt_anchor),
    'host_anchor_receipt_digest',(SELECT host_receipt_digest FROM noisia_topic_evaluation_lab.host_receipt_anchor),
    'host_anchor_container_identity_digest',(SELECT container_identity_digest FROM noisia_topic_evaluation_lab.host_receipt_anchor),
    'content_digests',(${outputContentDigestsSql()}),
    'referential_integrity',(${outputIntegritySql()})
  )::text`;
}

/** A dump replay is allowed only when the full output-table physical shape is identical. */
function outputSchemaProofSql() {
  const tables = OUTPUT_TABLES.map((table) => `'${table}'`).join(",");
  return `SELECT json_build_object('columns',COALESCE(jsonb_agg(jsonb_build_object(
    'table_name',table_name,'ordinal_position',ordinal_position,'column_name',column_name,
    'udt_name',udt_name,'is_nullable',is_nullable,'column_default',column_default
  ) ORDER BY table_name,ordinal_position),'[]'::jsonb))::text
    FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${tables})`;
}

function isExactSource(value: Record<string, unknown>) {
  return value.authorizations === 1 && value.runs === 1 && value.model_turns === 12
    && value.retrievals === 11 && value.retrieval_evidence === 30 && value.candidates === 10
    && value.candidate_revisions === 10 && value.candidate_evidence === 30 && value.rankings === 10
    && value.provider_calls === 12 && value.adoption === 0 && value.publication === 0 && value.serving === 0
    && isOutputDigestMap(value.content_digests)
    && value.referential_integrity === true;
}

function isPristineTarget(value: Record<string, unknown>, receiptDigest: string, containerIdentityDigest: string) {
  return value.host_anchor === 1 && value.host_anchor_receipt_digest === receiptDigest
    && value.host_anchor_container_identity_digest === containerIdentityDigest
    && ["authorizations", "runs", "model_turns", "retrievals", "retrieval_evidence", "candidates",
    "candidate_revisions", "candidate_evidence", "rankings", "provider_calls", "adoption", "publication",
    "serving", "0118", "0119", "0120", "0121", "sessions", "flights", "claims", "terminals"]
    .every((key) => Number(value[key] ?? 0) === 0);
}

function isHydratedTarget(target: Record<string, unknown>, source: Record<string, unknown>) {
  return ["authorizations", "runs", "model_turns", "retrievals", "retrieval_evidence", "candidates",
    "candidate_revisions", "candidate_evidence", "rankings", "provider_calls", "adoption", "publication", "serving"]
    .every((key) => target[key] === source[key]) && sameOutputDigestMap(target.content_digests, source.content_digests)
    && target.referential_integrity === true && target["0118"] === 1 && target["0119"] === 1
    && target["0120"] === 1 && target["0121"] === 1 && target.sessions === 0 && target.flights === 0 && target.claims === 0
    && target.terminals === 0;
}

function isOutputDigestMap(value: unknown): value is Record<(typeof OUTPUT_KINDS)[number], string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === OUTPUT_KINDS.length
    && OUTPUT_KINDS.every((kind) => /^sha256:[0-9a-f]{64}$/u.test(
      String((value as Record<string, unknown>)[kind] ?? "")));
}

function sameOutputDigestMap(left: unknown, right: unknown) {
  return isOutputDigestMap(left) && isOutputDigestMap(right)
    && OUTPUT_KINDS.every((kind) => left[kind] === right[kind]);
}

/** Stable, per-table cross-clone content digests for the entire retained LAB-2G output set. */
function outputContentDigestsSql() {
  return `WITH rows(kind,row_key,payload) AS (
    SELECT 'authorization',auth.id::text,to_jsonb(auth) FROM signal_topic_evaluation_v2_execution_authorizations auth
    UNION ALL SELECT 'run',run.id::text,to_jsonb(run) FROM signal_topic_evaluation_v2_runs run
    UNION ALL SELECT 'model_turn',turn.run_id::text||':'||turn.turn_index::text,to_jsonb(turn) FROM signal_topic_evaluation_v2_model_turns turn
    UNION ALL SELECT 'retrieval',retrieval.id::text,to_jsonb(retrieval) FROM signal_topic_evaluation_v2_retrievals retrieval
    UNION ALL SELECT 'retrieval_evidence',evidence.retrieval_id::text||':'||evidence.evidence_ref,to_jsonb(evidence)
      FROM signal_topic_evaluation_v2_retrieval_evidence evidence
    UNION ALL SELECT 'candidate',candidate.id::text,to_jsonb(candidate) FROM signal_topic_evaluation_v2_candidates candidate
    UNION ALL SELECT 'candidate_revision',revision.id::text,to_jsonb(revision) FROM signal_topic_evaluation_v2_candidate_revisions revision
    UNION ALL SELECT 'candidate_evidence',evidence.candidate_id::text||':'||evidence.retrieval_id::text||':'||evidence.evidence_ref,to_jsonb(evidence)
      FROM signal_topic_evaluation_v2_candidate_evidence evidence
    UNION ALL SELECT 'ranking',ranking.candidate_id::text,to_jsonb(ranking) FROM signal_topic_evaluation_v2_rankings ranking
  ), digests AS (
    SELECT kind,'sha256:'||encode(digest(COALESCE(string_agg(row_key||E'\\t'||payload::text,E'\\n' ORDER BY row_key),''),'sha256'),'hex') value
    FROM rows GROUP BY kind
  ) SELECT COALESCE(jsonb_object_agg(kind,value ORDER BY kind),'{}'::jsonb) FROM digests`;
}

/**
 * Full imported-row FK matrix required because the local snapshot import suppresses FK triggers.
 *
 * Do not collapse this to counts or only the intra-output links: this snapshot deliberately keeps
 * its immutable workspace/user/snapshot/membership parents in the disposable clone. Every FK
 * originating from an imported output table is rechecked here before we attest integrity.
 */
function outputIntegritySql() {
  return `SELECT
    NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations auth
      LEFT JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=auth.snapshot_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=auth.workspace_id
      LEFT JOIN users requester ON requester.id=auth.requested_by_user_id
      WHERE snapshot.id IS NULL OR workspace.id IS NULL OR requester.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_runs run
      LEFT JOIN signal_topic_evaluation_v2_execution_authorizations auth ON auth.id=run.execution_authorization_id
      LEFT JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=run.workspace_id
      LEFT JOIN users requester ON requester.id=run.requested_by_user_id
      WHERE auth.id IS NULL OR snapshot.id IS NULL OR workspace.id IS NULL OR requester.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_model_turns turn
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.id=turn.run_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=turn.workspace_id
      WHERE run.id IS NULL OR workspace.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_retrievals retrieval
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.id=retrieval.run_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=retrieval.workspace_id
      WHERE run.id IS NULL OR workspace.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_retrieval_evidence evidence
      LEFT JOIN signal_topic_evaluation_v2_retrievals retrieval ON retrieval.id=evidence.retrieval_id
      LEFT JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=evidence.snapshot_id
      LEFT JOIN signal_topic_evaluation_v2_cluster_memberships membership
        ON membership.snapshot_id=evidence.snapshot_id AND membership.member_ref=evidence.member_ref
      WHERE retrieval.id IS NULL OR snapshot.id IS NULL OR membership.member_ref IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidates candidate
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=candidate.workspace_id
      WHERE run.id IS NULL OR workspace.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_revisions revision
      LEFT JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=revision.candidate_id
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.id=revision.run_id
      LEFT JOIN signal_workspaces workspace ON workspace.id=revision.workspace_id
      LEFT JOIN signal_topic_evaluation_v2_candidate_revisions predecessor ON predecessor.id=revision.predecessor_revision_id
      WHERE candidate.id IS NULL OR run.id IS NULL OR workspace.id IS NULL OR candidate.run_id<>revision.run_id
        OR (revision.predecessor_revision_id IS NOT NULL AND predecessor.id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_evidence evidence
      LEFT JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=evidence.candidate_id
      LEFT JOIN signal_topic_evaluation_v2_retrievals retrieval ON retrieval.id=evidence.retrieval_id
      LEFT JOIN signal_topic_evaluation_v2_retrieval_evidence retrieval_evidence
        ON retrieval_evidence.retrieval_id=evidence.retrieval_id AND retrieval_evidence.evidence_ref=evidence.evidence_ref
      WHERE candidate.id IS NULL OR retrieval.id IS NULL OR retrieval_evidence.retrieval_id IS NULL
        OR candidate.run_id<>retrieval.run_id)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_rankings ranking
      LEFT JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=ranking.candidate_id
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.id=ranking.run_id
      LEFT JOIN signal_topic_evaluation_v2_candidates candidate_run
        ON candidate_run.id=ranking.candidate_id AND candidate_run.run_id=ranking.run_id
      WHERE candidate.id IS NULL OR run.id IS NULL OR candidate_run.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_execution_authorizations auth
      LEFT JOIN signal_topic_evaluation_v2_runs run ON run.execution_authorization_id=auth.id WHERE run.id IS NULL)`;
}

async function applyMigration(database: string, targetFingerprint: string,
  migration: { ordinal: number; name: string }) {
  const [bytes, checksum] = await Promise.all([readFile(resolve(ROOT, "infrastructure/db/migrations", migration.name)),
    migrationDigest(migration.name)]);
  const ledger = `INSERT INTO signal_workspace_data_plane_migration_ledger(migration_name,ordinal,checksum_sha256,
    disposition,runner_version,target_fingerprint) VALUES('${migration.name}',${migration.ordinal},'${checksum}',
    'applied','topic-refinement-successor-hydrator-v1','${targetFingerprint}');`;
  await psql(database, Buffer.from(`BEGIN;\n${bytes.toString("utf8")}\n${ledger}\nCOMMIT;\n`));
}

async function migrationDigest(name: string) {
  return `sha256:${createHash("sha256").update(await readFile(resolve(ROOT, "infrastructure/db/migrations", name))).digest("hex")}`;
}

async function json(database: string, sql: string) {
  const output = await runSignalTopicEvaluationLabDockerV1(["exec", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
    "--username", "postgres", "--dbname", database, "--command", sql]);
  try { return JSON.parse(output) as Record<string, unknown>; }
  catch { throw new SignalTopicCandidateRefinementSuccessorHydrationError("topic_refinement_successor_database_proof_invalid"); }
}

async function readProof(database: string, sql: string, stage: "source" | "target_before" | "target_after") {
  try { return await json(database, sql); }
  catch { throw new SignalTopicCandidateRefinementSuccessorHydrationError(`topic_refinement_successor_${stage}_proof_failed`); }
}

async function psql(database: string, input: Buffer) {
  await runSignalTopicEvaluationLabDockerV1(["exec", "--interactive", SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
    "psql", "--no-psqlrc", "--quiet", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", database], input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  hydrateSignalTopicCandidateRefinementSuccessorV1(process.env).then(({ evidence, path, receipt_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "hydrated", target: evidence.target, migrations: evidence.migrations,
      receipt_path: path, receipt_digest, effects: evidence.effects })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "topic_refinement_successor_hydration_failed"}\n`);
    process.exitCode = 1;
  });
}
