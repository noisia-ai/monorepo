import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  buildMassLabelingJevRequestV2, describeSignalListeningRequestV1, massLabelingConfigurationV2,
  SIGNAL_LISTENING_JEV_INPUT_USD_PER_MTOK_V1,
  type MassLabelingConfigurationV2, type MassLabelingInputV1, type SignalListeningAnswerRowV1,
  type SignalListeningAskedQuestionV1, type SignalListeningItemV1, type SignalTopicLocalizationV1,
} from "@noisia/query-engine";
import { loadMassLabelingStudyPolicyWithClientV1 } from "./signal-mass-labeling-study-policy";

type Database = Pick<Pool, "connect" | "query">;
type Queryable = Pick<PoolClient, "query">;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const LEASE = "interval '3 minutes'";

export type SignalListeningRunKindV1 = "listening" | "topics_round" | "study" | "legacy_request";
export type SignalListeningRunStatusV1 = "queued" | "running" | "completed" | "failed" | "cap_reached" | "canceled";
/** Re-sends the exact R15 request over the first roots of a frozen R15 map. */
/** This planner is a measurement: it asks again even when the cache already
 * holds the answer, and only skips the roots this same run already answered. */
export type SignalListeningLegacyPlanV1 = { planner: "r15_request_v2"; map_id: string; root_limit: number; input_usd_per_mtok: number };
export type SignalListeningPlanV1 = SignalListeningLegacyPlanV1;
export type SignalListeningRunV1 = {
  id: string; workspace_id: string; kind: SignalListeningRunKindV1; plan: SignalListeningPlanV1;
  status: SignalListeningRunStatusV1; cap_micro_usd: number; spent_micro_usd: number; input_tokens: number;
  roots_done: number; roots_failed: number; pages: number; receipt: Record<string, unknown>;
  error_code: string | null; lease_token: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};
const RUN_COLUMNS = `id,workspace_id,kind,plan,status,cap_micro_usd::float8 cap_micro_usd,spent_micro_usd::float8 spent_micro_usd,
  input_tokens::float8 input_tokens,roots_done,roots_failed,pages,receipt,error_code,lease_token,created_at::text,started_at::text,completed_at::text`;

function fail(code: string): never { throw new Error(code); }

export function validateSignalListeningPlanV1(value: unknown): SignalListeningPlanV1 {
  const plan = value as SignalListeningLegacyPlanV1 | null;
  if (!plan || plan.planner !== "r15_request_v2" || !uuid.test(plan.map_id) || !Number.isSafeInteger(plan.root_limit)
    || plan.root_limit < 1 || plan.root_limit > 5_000_000 || !Number.isFinite(plan.input_usd_per_mtok)
    || plan.input_usd_per_mtok <= 0) fail("listening_plan_invalid");
  return { planner: plan.planner, map_id: plan.map_id, root_limit: plan.root_limit, input_usd_per_mtok: plan.input_usd_per_mtok };
}

/** Queue a run. The spending cap is part of the request and never grows. */
export async function requestSignalListeningRunV1(args: {
  database: Database; workspace_id: string; kind: SignalListeningRunKindV1; plan: SignalListeningPlanV1;
  cap_micro_usd: number; requested_by_user_id?: string | null;
}): Promise<SignalListeningRunV1> {
  if (!uuid.test(args.workspace_id) || !Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd < 1
    || args.cap_micro_usd > 200_000_000) fail("listening_run_invalid");
  const plan = validateSignalListeningPlanV1(args.plan);
  const run = (await args.database.query<SignalListeningRunV1>(`INSERT INTO signal_listening_runs
    (id,workspace_id,kind,plan,cap_micro_usd,requested_by_user_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING ${RUN_COLUMNS}`,
    [randomUUID(), args.workspace_id, args.kind, JSON.stringify(plan), args.cap_micro_usd, args.requested_by_user_id ?? null])).rows[0]!;
  return run;
}

export async function getSignalListeningRunV1(database: Queryable, run_id: string): Promise<SignalListeningRunV1 | null> {
  return (await database.query<SignalListeningRunV1>(`SELECT ${RUN_COLUMNS} FROM signal_listening_runs WHERE id=$1`, [run_id])).rows[0] ?? null;
}

/** One worker owns a run at a time. An expired lease means that worker died:
 * its unwritten pages were never recorded, so their roots are still pending. */
export async function claimSignalListeningRunV1(database: Database, run_id?: string): Promise<SignalListeningRunV1 | null> {
  // Each claim is counted in the receipt, so a run that keeps dying is stopped instead of paying for the same pages again.
  return (await database.query<SignalListeningRunV1>(`UPDATE signal_listening_runs SET status='running',lease_token=gen_random_uuid(),
    lease_until=now()+${LEASE},started_at=COALESCE(started_at,now()),updated_at=now(),
    receipt=jsonb_set(receipt,'{claims}',to_jsonb(COALESCE((receipt->>'claims')::int,0)+1))
    WHERE id=(SELECT id FROM signal_listening_runs WHERE status IN('queued','running') AND ($1::uuid IS NULL OR id=$1)
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING ${RUN_COLUMNS}`, [run_id ?? null])).rows[0] ?? null;
}
export const SIGNAL_LISTENING_MAX_CLAIMS_V1 = 6;

/** Puts a failed or capped run back in the queue. It resumes: answered roots are not asked again. */
export async function requeueSignalListeningRunV1(database: Database, run_id: string, cap_micro_usd?: number): Promise<boolean> {
  return (await database.query(`UPDATE signal_listening_runs SET status='queued',error_code=NULL,completed_at=NULL,lease_token=NULL,lease_until=NULL,
    cap_micro_usd=GREATEST(cap_micro_usd,COALESCE($2::bigint,cap_micro_usd)),receipt=receipt-'claims',updated_at=now()
    WHERE id=$1 AND status IN('failed','cap_reached')`, [run_id, cap_micro_usd ?? null])).rowCount === 1;
}

export async function renewSignalListeningRunV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "lease_token">): Promise<boolean> {
  return (await database.query(`UPDATE signal_listening_runs SET lease_until=now()+${LEASE},updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='running'`, [run.id, run.lease_token])).rowCount === 1;
}

export async function finishSignalListeningRunV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "lease_token">,
  outcome: { status: Exclude<SignalListeningRunStatusV1, "queued" | "running">; receipt: Record<string, unknown>; error_code?: string | null }) {
  await database.query(`UPDATE signal_listening_runs SET status=$3,receipt=receipt||$4::jsonb,error_code=$5,lease_token=NULL,lease_until=NULL,
    completed_at=now(),updated_at=now() WHERE id=$1 AND lease_token=$2`,
    [run.id, run.lease_token, outcome.status, JSON.stringify(outcome.receipt), outcome.error_code ?? null]);
}

/** Leaves the run for the next drainer tick, keeping what is already written. */
export async function releaseSignalListeningRunV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "lease_token">) {
  await database.query(`UPDATE signal_listening_runs SET lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='running'`, [run.id, run.lease_token]);
}

/** Registers the questions of a page and returns their compact ids. */
export async function ensureSignalListeningQuestionsV1(client: Queryable, workspace_id: string, model: string,
  questions: SignalListeningAskedQuestionV1[]): Promise<Map<string, number>> {
  const unique = [...new Map(questions.map(question => [question.question_digest, question])).values()];
  if (!unique.length) return new Map();
  await client.query(`INSERT INTO signal_listening_questions(workspace_id,question_digest,model,kind,wire,label)
    SELECT $1,q.question_digest,$2,q.kind,q.wire,q.label
    FROM jsonb_to_recordset($3::jsonb) q(question_digest text,kind text,wire jsonb,label text)
    ON CONFLICT(workspace_id,question_digest) DO NOTHING`,
    [workspace_id, model, JSON.stringify(unique.map(q => ({ question_digest: q.question_digest, kind: q.kind, wire: q.wire, label: q.label })))]);
  const rows = (await client.query<{ id: string; question_digest: string }>(`SELECT id::text,question_digest FROM signal_listening_questions
    WHERE workspace_id=$1 AND question_digest=ANY($2::text[])`, [workspace_id, unique.map(q => q.question_digest)])).rows;
  if (rows.length !== unique.length) fail("listening_questions_unavailable");
  return new Map(rows.map(row => [row.question_digest, Number(row.id)]));
}

/** One page, one transaction: answers, the raw object reference and the run totals
 * move together. A page is identified by the run and its number, so a repeated
 * write after a lost acknowledgement changes nothing. */
export async function writeSignalListeningPageV1(args: {
  database: Database; run: Pick<SignalListeningRunV1, "id" | "workspace_id" | "lease_token">; page_no: number; model: string;
  questions: SignalListeningAskedQuestionV1[]; answers: SignalListeningAnswerRowV1[];
  raw: { storage_key: string; sha256: string; size_bytes: number } | null;
  roots_done: number; roots_failed: number; input_tokens: number; cost_micro_usd: number;
}): Promise<{ spent_micro_usd: number }> {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    const owner = (await client.query<{ spent: number }>(`SELECT spent_micro_usd::float8 spent FROM signal_listening_runs
      WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE`, [args.run.id, args.run.lease_token])).rows[0];
    if (!owner) fail("listening_run_lease_lost");
    const page = await client.query(`INSERT INTO signal_listening_raw_pages(run_id,page_no,storage_key,sha256,size_bytes,responses,input_tokens)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,page_no) DO NOTHING`,
      [args.run.id, args.page_no, args.raw?.storage_key ?? "", args.raw?.sha256 ?? `sha256:${"0".repeat(64)}`,
        args.raw?.size_bytes ?? 0, args.roots_done, args.input_tokens]);
    if (page.rowCount !== 1) fail("listening_page_conflict");
    if (args.answers.length) {
      const ids = await ensureSignalListeningQuestionsV1(client, args.run.workspace_id, args.model, args.questions);
      const question: number[] = [], root: string[] = [], input: string[] = [], probability: number[] = [],
        choice: Array<string | null> = [], probabilities: Array<string | null> = [];
      const seen = new Set<string>();
      for (const answer of args.answers) {
        const id = ids.get(answer.question_digest);
        if (id === undefined) fail("listening_answer_question_unknown");
        // One row per root and question, even if a request carried the same question twice.
        if (seen.has(`${id}:${answer.root_id}`)) continue;
        seen.add(`${id}:${answer.root_id}`);
        question.push(id); root.push(answer.root_id); input.push(answer.input_digest.slice(7)); probability.push(answer.probability);
        choice.push(answer.choice); probabilities.push(answer.probabilities ? JSON.stringify(answer.probabilities) : null);
      }
      // The newest answer for a root and question wins; an older fragment's answer is replaced.
      await client.query(`INSERT INTO signal_listening_answers(question_id,root_id,workspace_id,input_sha,probability,choice,probabilities,run_id)
        SELECT a.question_id,a.root_id,$1,decode(a.input_sha,'hex'),a.probability,a.choice,a.probabilities::jsonb,$2
        FROM unnest($3::bigint[],$4::uuid[],$5::text[],$6::real[],$7::text[],$8::text[])
          a(question_id,root_id,input_sha,probability,choice,probabilities)
        ON CONFLICT(question_id,root_id) DO UPDATE SET input_sha=excluded.input_sha,probability=excluded.probability,
          choice=excluded.choice,probabilities=excluded.probabilities,run_id=excluded.run_id,created_at=clock_timestamp()`,
        [args.run.workspace_id, args.run.id, question, root, input, probability, choice, probabilities]);
    }
    const spent = (await client.query<{ spent: number }>(`UPDATE signal_listening_runs SET spent_micro_usd=spent_micro_usd+$2,
      input_tokens=input_tokens+$3,roots_done=roots_done+$4,roots_failed=roots_failed+$5,pages=pages+1,
      lease_until=now()+${LEASE},updated_at=now() WHERE id=$1 RETURNING spent_micro_usd::float8 spent`,
      [args.run.id, args.cost_micro_usd, args.input_tokens, args.roots_done, args.roots_failed])).rows[0]!.spent;
    await client.query("COMMIT");
    return { spent_micro_usd: spent };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

type LegacyRow = MassLabelingInputV1 & { ordinal: number };
/** Reads the frozen R15 fragments and candidates and rebuilds the exact R15 request. */
export async function createSignalListeningLegacySourceV1(database: Database, run: SignalListeningRunV1) {
  const plan = validateSignalListeningPlanV1(run.plan);
  const client = await database.connect();
  const model = "jev-1.13.0";
  let configuration: MassLabelingConfigurationV2, localized: Map<string, SignalTopicLocalizationV1>;
  try {
    const map = (await client.query<{ catalog: Array<{ topic_key: string; localization?: SignalTopicLocalizationV1 }> }>(
      "SELECT catalog FROM signal_mass_labeling_maps WHERE workspace_id=$1 AND id=$2", [run.workspace_id, plan.map_id])).rows[0];
    if (!map) fail("listening_legacy_map_unavailable");
    const policy = await loadMassLabelingStudyPolicyWithClientV1(client, run.workspace_id);
    configuration = massLabelingConfigurationV2({ category: policy.category, candidate_language: policy.candidate_language,
      interests: policy.interests.filter(interest => interest.active) });
    localized = new Map(map.catalog.flatMap(topic => topic.localization ? [[topic.topic_key, topic.localization] as const] : []));
    const imported = (await client.query<{ topic_key: string; localization: SignalTopicLocalizationV1 }>(
      "SELECT topic_key,localization FROM signal_mass_labeling_localizations WHERE workspace_id=$1 AND map_id=$2",
      [run.workspace_id, plan.map_id])).rows;
    for (const topic of imported) if (!localized.has(topic.topic_key)) localized.set(topic.topic_key, topic.localization);
  } finally { client.release(); }
  let cursor = 0;
  return {
    model, input_usd_per_mtok: plan.input_usd_per_mtok,
    /** Start another pass over the roots that are still pending. */
    rewind() { cursor = 0; },
    /** Next slice in `ordinal` order. Roots this run already answered are skipped, so a restart resumes. */
    async next(limit: number): Promise<SignalListeningItemV1[]> {
      const rows = (await database.query<LegacyRow>(`SELECT item.ordinal,item.root_id,item.input_digest,item.text,NULL::text title,
          mention.platform,mention.content_type,NULL::text author,mention.published_at::text,mention.language,item.chunk_index,
          item.map_id,''::text map_digest,item.candidates
        FROM signal_mass_labeling_items item
        JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
        WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.ordinal>$3 AND item.ordinal<=$4
          AND NOT EXISTS(SELECT 1 FROM signal_listening_answers answer WHERE answer.root_id=item.root_id
            AND answer.workspace_id=item.workspace_id AND answer.run_id=$5)
        ORDER BY item.ordinal LIMIT $6`,
        [run.workspace_id, plan.map_id, cursor, plan.root_limit, run.id, limit])).rows;
      if (rows.length) cursor = rows.at(-1)!.ordinal;
      return rows.flatMap(row => {
        // A root whose request cannot be built is left out; it never stops the others.
        try { return [build(row)]; } catch { return []; }
      });
      function build(row: LegacyRow): SignalListeningItemV1 {
        const candidates = [...row.candidates].sort((a, b) => b.similarity - a.similarity || a.topic_key.localeCompare(b.topic_key)).slice(0, 4)
          .map(candidate => ({ ...candidate, ...(localized.has(candidate.topic_key) ? { localization: localized.get(candidate.topic_key) } : {}) }));
        const request = buildMassLabelingJevRequestV2({ ...row, candidates }, { version_no: 0, entities: [] } as never, configuration, model);
        const questions = describeSignalListeningRequestV1(request, key => {
          const ordinal = /^topic_(\d)$/u.exec(key);
          return ordinal ? `topic:${candidates[Number(ordinal[1])]!.topic_key}` : key.startsWith("interest_") ? `interest:${key.slice(9)}` : key;
        });
        return { root_id: row.root_id, input_digest: row.input_digest, request, questions };
      }
    },
  };
}

export const SIGNAL_LISTENING_DEFAULT_PRICE_V1 = SIGNAL_LISTENING_JEV_INPUT_USD_PER_MTOK_V1;
