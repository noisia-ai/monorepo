import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  compileSignalListeningConfigurationV1, signalListeningConfigurationDigestV1,
  selectSignalListeningPendingV1, signalListeningQuestionIdentityV1, validateSignalListeningConfigurationV1,
  SIGNAL_LISTENING_CONSUMER_CUT_V1,
  type SignalListeningAskedQuestionV1, type SignalListeningChoiceQuestionV1,
  type SignalListeningConfigurationV1, type SignalListeningItemV1, type SignalTopicLocalizationV1,
} from "@noisia/query-engine";
import type { JevQuestionV1 } from "@noisia/query-engine/src/signal-mention-facets-jev-v1";
import { SignalLabelingError } from "./signal-labeling-runs";
import { loadMassLabelingStudyPolicyWithClientV1 } from "./signal-mass-labeling-study-policy";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { ensureSignalListeningQuestionsV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1, validateSignalListeningPlanV1,
  type SignalListeningListeningPlanV1, type SignalListeningRunV1 } from "./signal-listening";

type Database = Pick<Pool, "connect" | "query">;
type Queryable = Pick<PoolClient, "query">;
type Access = { database: Database; workspace_id: string; actor_user_id: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
function fail(code: string, status = 409): never { throw new SignalLabelingError(code, status); }

async function transaction<T>(database: Database, work: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function authorize(client: Queryable, access: Omit<Access, "database">, need: "view" | "edit" | "process") {
  if (!uuid.test(access.workspace_id) || !uuid.test(access.actor_user_id)) fail("listening_scope_invalid", 422);
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: access.workspace_id,
    actor_user_id: access.actor_user_id, lock_authority: need !== "view" });
  if (!caps.can_view || (need !== "view" && !caps.can_edit_topics) || (need === "process" && !caps.can_request_processing)) {
    fail("listening_forbidden", 403);
  }
  return caps;
}

type Stored = { id: string; revision: number; configuration: SignalListeningConfigurationV1; configuration_digest: string };
async function latestStored(client: Queryable, workspace_id: string): Promise<Stored | null> {
  return (await client.query<Stored>(`SELECT id,revision,configuration,configuration_digest FROM signal_listening_configurations
    WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 1`, [workspace_id])).rows[0] ?? null;
}
/** The effective configuration: category, lexicon and defined topics come from
 * the brand's study settings; questions with options come from the last stored
 * listening revision. Composing them here keeps a single place of truth for each. */
async function compose(client: Queryable, workspace_id: string, questions?: SignalListeningChoiceQuestionV1[]) {
  const stored = await latestStored(client, workspace_id);
  const policy = await loadMassLabelingStudyPolicyWithClientV1(client, workspace_id);
  if (!policy.category.trim()) fail("listening_category_required");
  const configuration = validateSignalListeningConfigurationV1({ contract_version: "signal-listening-config-v1", model: "jev-1.13.0",
    category: policy.category, lexicon_terms: policy.lexicon_terms, candidate_language: policy.candidate_language, base: ["voice", "promotion"],
    defined_topics: policy.interests.map(interest => ({ key: interest.key, name: interest.name, definition: interest.definition,
      active: interest.active, origin: "brand_os", human_locked: false })),
    discovered: { candidates_per_root: 4 }, questions: questions ?? stored?.configuration.questions ?? [] });
  return { stored, configuration, configuration_digest: signalListeningConfigurationDigestV1(configuration), policy_revision: policy.revision };
}
async function storeRevision(client: Queryable, args: { workspace_id: string; actor_user_id: string | null; stored: Stored | null;
  configuration: SignalListeningConfigurationV1; configuration_digest: string; provenance: "human" | "agent" | "migration"; note?: string }): Promise<Stored> {
  if (args.stored?.configuration_digest === args.configuration_digest) return args.stored;
  const revision = (args.stored?.revision ?? 0) + 1;
  const id = (await client.query<{ id: string }>(`INSERT INTO signal_listening_configurations
    (workspace_id,revision,configuration,configuration_digest,provenance,note,created_by_user_id) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7) RETURNING id`,
    [args.workspace_id, revision, JSON.stringify(args.configuration), args.configuration_digest, args.provenance, args.note ?? null, args.actor_user_id])).rows[0]!.id;
  return { id, revision, configuration: args.configuration, configuration_digest: args.configuration_digest };
}
const lock = (client: Queryable, workspace_id: string) =>
  client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening:'||$1,0))", [workspace_id]);

export type SignalListeningStateV1 = {
  contract_version: "signal-listening-state-v1"; workspace_id: string; revision: number; configuration: SignalListeningConfigurationV1;
  /** True when the study settings changed after the last stored revision. */
  unsaved_settings: boolean; can_edit: boolean; can_run: boolean;
  population: { map_id: string; roots: number } | null;
  run: Pick<SignalListeningRunV1, "id" | "status" | "roots_done" | "roots_failed" | "spent_micro_usd" | "cap_micro_usd" | "created_at" | "completed_at" | "error_code"> | null;
};
async function population(client: Queryable, workspace_id: string) {
  const row = (await client.query<{ map_id: string; roots: number }>(`SELECT map.id map_id,map.root_count roots
    FROM signal_mass_labeling_selections selection JOIN signal_mass_labeling_maps map ON map.workspace_id=selection.workspace_id AND map.id=selection.map_id
    WHERE selection.workspace_id=$1`, [workspace_id])).rows[0];
  return row ?? null;
}
export async function getSignalListeningStateV1(access: Access): Promise<SignalListeningStateV1> {
  return transaction(access.database, async client => {
    const caps = await authorize(client, access, "view");
    const { stored, configuration, configuration_digest } = await compose(client, access.workspace_id);
    const run = (await client.query<NonNullable<SignalListeningStateV1["run"]>>(`SELECT id,status,roots_done,roots_failed,spent_micro_usd::float8 spent_micro_usd,
      cap_micro_usd::float8 cap_micro_usd,created_at::text,completed_at::text,error_code FROM signal_listening_runs
      WHERE workspace_id=$1 AND kind='listening' ORDER BY created_at DESC LIMIT 1`, [access.workspace_id])).rows[0] ?? null;
    return { contract_version: "signal-listening-state-v1", workspace_id: access.workspace_id, revision: stored?.revision ?? 0, configuration,
      unsaved_settings: stored !== null && stored.configuration_digest !== configuration_digest, can_edit: caps.can_edit_topics,
      can_run: caps.can_edit_topics && caps.can_request_processing, population: await population(client, access.workspace_id), run };
  });
}

/** Saves the questions with options as a new revision. Nothing is asked yet. */
export async function saveSignalListeningQuestionsV1(args: Access & {
  expected_revision: number; questions: unknown; provenance?: "human" | "agent";
}) {
  return transaction(args.database, async client => {
    await lock(client, args.workspace_id);
    await authorize(client, args, "edit");
    const before = await latestStored(client, args.workspace_id);
    if ((before?.revision ?? 0) !== args.expected_revision) fail("listening_revision_conflict");
    if (!Array.isArray(args.questions)) fail("listening_configuration_invalid", 422);
    let composed: Awaited<ReturnType<typeof compose>>;
    try { composed = await compose(client, args.workspace_id, args.questions as SignalListeningChoiceQuestionV1[]); }
    catch (error) { if (error instanceof SignalLabelingError) throw error; fail("listening_configuration_invalid", 422); }
    // A person's edit freezes the question for any later agent proposal.
    const provenance = args.provenance ?? "human";
    const configuration = provenance === "human" ? validateSignalListeningConfigurationV1({ ...composed.configuration,
      questions: composed.configuration.questions.map(question => ({ ...question, human_locked: true })) }) : composed.configuration;
    const stored = await storeRevision(client, { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, stored: before,
      configuration, configuration_digest: signalListeningConfigurationDigestV1(configuration), provenance });
    return { revision: stored.revision, configuration: stored.configuration };
  });
}

/** What a run would ask right now, question by question, without asking it. */
export async function estimateSignalListeningV1(access: Access) {
  return transaction(access.database, async client => {
    await authorize(client, access, "view");
    const { configuration } = await compose(client, access.workspace_id);
    const target = await population(client, access.workspace_id);
    if (!target) return { roots: 0, questions: [], estimated_micro_usd: 0, requests: 0 };
    return estimateWithClient(client, access.workspace_id, target.map_id, configuration);
  });
}
async function estimateWithClient(client: Queryable, workspace_id: string, map_id: string, configuration: SignalListeningConfigurationV1) {
  const compiled = compileSignalListeningConfigurationV1(configuration);
  const fixed = [compiled.base.voice, compiled.base.promotion, ...compiled.defined, ...compiled.choices];
  const ids = await questionIds(client, workspace_id, fixed.map(question => question.question_digest));
  const sizes = (await client.query<{ roots: number; text_chars: string }>(`SELECT count(*)::int roots,COALESCE(sum(length(text)),0)::text text_chars
    FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2`, [workspace_id, map_id])).rows[0]!;
  const consumer = compiled.choices.some(question => question.scope === "consumer_category")
    ? (await client.query<{ roots: number }>(`SELECT count(*)::int roots FROM signal_mass_labeling_items item
        JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
        JOIN signal_mass_labeling_root_segments segment ON segment.map_id=item.map_id AND segment.root_id=item.root_id
        JOIN signal_listening_answers voice ON voice.question_id=$3 AND voice.root_id=item.root_id AND voice.choice=$5
        JOIN signal_listening_answers promotion ON promotion.question_id=$4 AND promotion.root_id=item.root_id AND promotion.probability<=$6
        WHERE item.workspace_id=$1 AND item.map_id=$2 AND NOT segment.hashtag_only
          AND signal_mass_labeling_category_matches_v1(mention.text_clean,$7::text[])`,
        [workspace_id, map_id, ids.get(compiled.base.voice.question_digest) ?? -1, ids.get(compiled.base.promotion.question_digest) ?? -1,
          SIGNAL_LISTENING_CONSUMER_CUT_V1.voice, SIGNAL_LISTENING_CONSUMER_CUT_V1.promotion_max, configuration.lexicon_terms])).rows[0]!.roots
    : 0;
  const answered = new Map((await client.query<{ question_id: string; roots: number }>(`SELECT answer.question_id::text,count(*)::int roots
    FROM signal_listening_answers answer JOIN signal_mass_labeling_items item ON item.root_id=answer.root_id AND item.map_id=$2
    WHERE answer.workspace_id=$1 AND answer.question_id=ANY($3::bigint[]) GROUP BY 1`, [workspace_id, map_id, [...ids.values()]])).rows
    .map(row => [Number(row.question_id), row.roots]));
  const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3.2);
  const questions = fixed.map(question => {
    const scope = "scope" in question ? (question as { scope: string }).scope : "all";
    const population_roots = scope === "consumer_category" ? consumer : sizes.roots;
    const done = answered.get(ids.get(question.question_digest) ?? -1) ?? 0;
    return { label: question.label, scope, roots: population_roots, pending: Math.max(0, population_roots - done), question_tokens: tokens(question.wire) };
  });
  const requests = Math.max(0, ...questions.map(question => question.pending));
  const textTokens = sizes.roots ? Number(sizes.text_chars) / sizes.roots / 3.2 : 0;
  const inputTokens = requests * (textTokens + 30) + questions.reduce((sum, question) => sum + question.pending * question.question_tokens, 0);
  return { roots: sizes.roots, questions, requests, estimated_micro_usd: Math.ceil(inputTokens * SIGNAL_LISTENING_DEFAULT_PRICE_V1) };
}
async function questionIds(client: Queryable, workspace_id: string, digests: string[]) {
  const rows = (await client.query<{ id: string; question_digest: string }>(`SELECT id::text,question_digest FROM signal_listening_questions
    WHERE workspace_id=$1 AND question_digest=ANY($2::text[])`, [workspace_id, digests])).rows;
  return new Map(rows.map(row => [row.question_digest, Number(row.id)]));
}

/** Queue a listening pass over the brand's current population. Only what the
 * cache does not hold will be asked. The cap is fixed here. */
export async function requestSignalListeningV1(args: Access & { cap_micro_usd: number }) {
  if (!Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd < 10_000 || args.cap_micro_usd > 200_000_000) fail("listening_cap_invalid", 422);
  return transaction(args.database, async client => {
    await lock(client, args.workspace_id);
    await authorize(client, args, "process");
    const target = await population(client, args.workspace_id);
    if (!target) fail("listening_population_required");
    if ((await client.query("SELECT 1 FROM signal_listening_runs WHERE workspace_id=$1 AND status IN('queued','running') LIMIT 1", [args.workspace_id])).rows.length) {
      fail("listening_run_active");
    }
    const { stored, configuration, configuration_digest } = await compose(client, args.workspace_id);
    const revision = await storeRevision(client, { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, stored, configuration,
      configuration_digest, provenance: "human", note: "study settings synchronized before a run" });
    const plan: SignalListeningListeningPlanV1 = { planner: "listening_v1", configuration_id: revision.id, map_id: target.map_id,
      input_usd_per_mtok: SIGNAL_LISTENING_DEFAULT_PRICE_V1 };
    const id = (await client.query<{ id: string }>(`INSERT INTO signal_listening_runs(id,workspace_id,kind,plan,cap_micro_usd,requested_by_user_id)
      VALUES($1,$2,'listening',$3::jsonb,$4,$5) RETURNING id`, [randomUUID(), args.workspace_id, JSON.stringify(plan), args.cap_micro_usd, args.actor_user_id])).rows[0]!.id;
    return { run_id: id, revision: revision.revision };
  });
}

type ItemRow = { ordinal: number; root_id: string; input_digest: string; text: string; hashtag_only: boolean | null; category_match: boolean;
  candidates: Array<{ topic_key: string; name: string; definition: string; similarity: number }> };
/** Source of a `listening_v1` run: pages of roots with only their pending questions. */
export async function createSignalListeningSourceV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "workspace_id" | "plan">) {
  const plan = validateSignalListeningPlanV1(run.plan);
  if (plan.planner !== "listening_v1") throw new Error("listening_plan_invalid");
  const client = await database.connect();
  try {
    const stored = (await client.query<{ configuration: SignalListeningConfigurationV1 }>(
      "SELECT configuration FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2", [plan.configuration_id, run.workspace_id])).rows[0];
    const map = (await client.query<{ catalog: Array<{ topic_key: string; name: string; definition: string; localization?: SignalTopicLocalizationV1 }> }>(
      "SELECT catalog FROM signal_mass_labeling_maps WHERE workspace_id=$1 AND id=$2", [run.workspace_id, plan.map_id])).rows[0];
    if (!stored || !map) throw new Error("listening_plan_unavailable");
    const configuration = validateSignalListeningConfigurationV1(stored.configuration), compiled = compileSignalListeningConfigurationV1(configuration);
    const localized = new Map(map.catalog.flatMap(topic => topic.localization ? [[topic.topic_key, topic.localization] as const] : []));
    for (const topic of (await client.query<{ topic_key: string; localization: SignalTopicLocalizationV1 }>(
      "SELECT topic_key,localization FROM signal_mass_labeling_localizations WHERE workspace_id=$1 AND map_id=$2", [run.workspace_id, plan.map_id])).rows) {
      if (!localized.has(topic.topic_key)) localized.set(topic.topic_key, topic.localization);
    }
    const topics = new Map<string, SignalListeningAskedQuestionV1>();
    for (const topic of map.catalog) {
      const wording = configuration.candidate_language === "en" ? localized.get(topic.topic_key)?.en
        : localized.get(topic.topic_key)?.original ?? { name: topic.name, definition: topic.definition };
      if (wording?.name.trim() && wording.definition.trim()) topics.set(topic.topic_key, compiled.topic(topic.topic_key, wording));
    }
    const fixed = [compiled.base.voice, compiled.base.promotion, ...compiled.defined, ...compiled.choices];
    const ids = await ensureSignalListeningQuestionsV1(client, run.workspace_id, compiled.model, [...fixed, ...topics.values()]);
    const byId = new Map([...ids].map(([digest, id]) => [id, digest]));
    const voiceId = ids.get(compiled.base.voice.question_digest)!, promotionId = ids.get(compiled.base.promotion.question_digest)!;
    const scoped = compiled.choices.some(question => question.scope === "consumer_category");
    let cursor = 0;
    return {
      model: compiled.model, input_usd_per_mtok: plan.input_usd_per_mtok,
      rewind() { cursor = 0; },
      async next(limit: number): Promise<SignalListeningItemV1[]> {
        for (;;) {
          const rows = (await database.query<ItemRow>(`SELECT item.ordinal,item.root_id,item.input_digest,item.text,item.candidates,segment.hashtag_only,
              CASE WHEN $5::boolean THEN signal_mass_labeling_category_matches_v1(mention.text_clean,$6::text[]) ELSE false END category_match
            FROM signal_mass_labeling_items item
            JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
            LEFT JOIN signal_mass_labeling_root_segments segment ON segment.map_id=item.map_id AND segment.root_id=item.root_id
            WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.ordinal>$3 ORDER BY item.ordinal LIMIT $4`,
            [run.workspace_id, plan.map_id, cursor, limit, scoped, configuration.lexicon_terms])).rows;
          if (!rows.length) return [];
          cursor = rows.at(-1)!.ordinal;
          const answers = (await database.query<{ root_id: string; question_id: string; probability: number; choice: string | null; input_sha: string }>(
            `SELECT root_id,question_id::text,probability,choice,encode(input_sha,'hex') input_sha FROM signal_listening_answers
             WHERE workspace_id=$1 AND root_id=ANY($2::uuid[]) AND question_id=ANY($3::bigint[])`,
            [run.workspace_id, rows.map(row => row.root_id), [...ids.values()]])).rows;
          const cache = new Map<string, typeof answers>();
          for (const answer of answers) { const list = cache.get(answer.root_id); if (list) list.push(answer); else cache.set(answer.root_id, [answer]); }
          const items: SignalListeningItemV1[] = [];
          for (const row of rows) {
            // An answer only counts for the same text fragment.
            const valid = (cache.get(row.root_id) ?? []).filter(answer => `sha256:${answer.input_sha}` === row.input_digest);
            const voice = valid.find(answer => Number(answer.question_id) === voiceId), promotion = valid.find(answer => Number(answer.question_id) === promotionId);
            const candidates = [...row.candidates].sort((a, b) => b.similarity - a.similarity || a.topic_key.localeCompare(b.topic_key))
              .slice(0, configuration.discovered.candidates_per_root).flatMap(candidate => topics.has(candidate.topic_key) ? [topics.get(candidate.topic_key)!] : []);
            const pending = selectSignalListeningPendingV1({ compiled, topics: candidates, category_match: row.category_match,
              answered: new Set(valid.map(answer => byId.get(Number(answer.question_id))!)),
              base: { voice_choice: voice?.choice ?? null, promotion: promotion?.probability ?? null, hashtag_only: row.hashtag_only ?? false } });
            if (!pending.length) continue;
            // Request keys are neutral positions; identity travels in the question digest.
            const questions = pending.map((question, index) => ({ ...question, request_key: `q${index}` }));
            items.push({ root_id: row.root_id, input_digest: row.input_digest, questions,
              request: { model: compiled.model, state: row.text, questions: Object.fromEntries(questions.map(question => [question.request_key, question.wire])) } });
          }
          if (items.length) return items;
        }
      },
    };
  } finally { client.release(); }
}

/**
 * Brings the answers R15 already paid for into the cache, without calling the
 * provider. The wire of each question is read from the stored R15 request, so
 * its identity is exactly what was asked. `trigger_barrier` stays in the R15
 * tables as history: it is no longer part of the base.
 */
export async function importSignalListeningLegacyAnswersV1(args: { database: Database; workspace_id: string; map_id: string; batch?: number;
  on_progress?: (done: number, total: number) => void }) {
  const { database, workspace_id, map_id } = args, batch = args.batch ?? 4000;
  if (!uuid.test(workspace_id) || !uuid.test(map_id)) throw new Error("listening_import_invalid");
  const total = (await database.query<{ roots: number }>("SELECT max(ordinal)::int roots FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2",
    [workspace_id, map_id])).rows[0]?.roots ?? 0;
  if (!total) throw new Error("listening_import_map_unavailable");
  const prior = (await database.query<{ id: string }>(`SELECT id FROM signal_listening_runs WHERE workspace_id=$1 AND kind='legacy_request'
    AND plan->>'planner'='r15_import' AND plan->>'map_id'=$2 ORDER BY created_at LIMIT 1`, [workspace_id, map_id])).rows[0];
  const run_id = prior?.id ?? (await database.query<{ id: string }>(`INSERT INTO signal_listening_runs(id,workspace_id,kind,plan,status,cap_micro_usd,started_at)
    VALUES($1,$2,'legacy_request',$3::jsonb,'running',1,now()) RETURNING id`,
    [randomUUID(), workspace_id, JSON.stringify({ planner: "r15_import", map_id })])).rows[0]!.id;
  const known = new Set<string>();
  let answers = 0;
  for (let from = 0; from < total; from += batch) {
    const range = [workspace_id, map_id, from, from + batch];
    const wires = (await database.query<{ model: string; wire: JevQuestionV1; key: string }>(`SELECT DISTINCT ON (call.request->>'model',question.value)
        call.request->>'model' model,question.value wire,question.key
      FROM signal_mass_labeling_items item
      JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id AND result.status='labeled'
      JOIN signal_labeling_calls call ON call.id=result.call_id AND call.workspace_id=result.workspace_id
      CROSS JOIN LATERAL jsonb_each(call.request->'questions') question
      WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.ordinal>$3 AND item.ordinal<=$4 AND question.key<>'trigger_barrier'`, range)).rows;
    const fresh = wires.map(row => ({ row, question_digest: signalListeningQuestionIdentityV1(row.model, row.wire) })).filter(entry => !known.has(entry.question_digest));
    for (const model of new Set(fresh.map(entry => entry.row.model))) {
      await ensureSignalListeningQuestionsV1(database, workspace_id, model, fresh.filter(entry => entry.row.model === model).map(entry => ({
        request_key: entry.row.key, question_digest: entry.question_digest, kind: entry.row.wire.type, wire: entry.row.wire,
        label: entry.row.key.startsWith("topic_") ? `topic:${String((entry.row.wire.criteria as { true?: { name?: string } } | undefined)?.true?.name ?? "").slice(0, 80)}`
          : entry.row.key.startsWith("interest_") ? `interest:${entry.row.key.slice(9)}` : entry.row.key })));
    }
    for (const entry of fresh) known.add(entry.question_digest);
    answers += (await database.query(`INSERT INTO signal_listening_answers(question_id,root_id,workspace_id,input_sha,probability,choice,probabilities,run_id)
      SELECT known.id,item.root_id,item.workspace_id,decode(substr(item.input_digest,8),'hex'),
        CASE WHEN known.kind='noul' THEN (result.probabilities->question.key->>'noul')::real ELSE (result.probabilities->question.key->>'confidence')::real END,
        CASE WHEN known.kind='choice' THEN result.probabilities->question.key->>'choice' END,
        CASE WHEN known.kind='choice' THEN result.probabilities->question.key->'probabilities' END,$5
      FROM signal_mass_labeling_items item
      JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id AND result.status='labeled'
      JOIN signal_labeling_calls call ON call.id=result.call_id AND call.workspace_id=result.workspace_id
      CROSS JOIN LATERAL jsonb_each(call.request->'questions') question
      JOIN signal_listening_questions known ON known.workspace_id=item.workspace_id AND known.model=call.request->>'model' AND known.wire=question.value
      WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.ordinal>$3 AND item.ordinal<=$4 AND question.key<>'trigger_barrier'
        AND result.probabilities ? question.key
      ON CONFLICT(question_id,root_id) DO NOTHING`, [...range, run_id])).rowCount ?? 0;
    args.on_progress?.(Math.min(total, from + batch), total);
  }
  await database.query(`UPDATE signal_listening_runs SET status='completed',completed_at=now(),updated_at=now(),
    receipt=jsonb_build_object('imported_answers',$2::int,'questions',$3::int,'provider_requests',0) WHERE id=$1`, [run_id, answers, known.size]);
  return { run_id, answers, questions: known.size, roots: total };
}

export type SignalListeningQuestionMetricsV1 = {
  question_key: string; revision: number; answered: number;
  distribution: Array<{ option: string; roots: number }>;
  by_topic: Array<{ topic_key: string; option: string; roots: number }>;
  trend: Array<{ period: string; option: string; roots: number }>;
};
/** Distribution, cross with topics and monthly trend of one question with options. */
export async function readSignalListeningQuestionMetricsV1(access: Access & { question_key: string }): Promise<SignalListeningQuestionMetricsV1> {
  return transaction(access.database, async client => {
    await client.query("SET TRANSACTION READ ONLY");
    await authorize(client, access, "view");
    const { stored, configuration } = await compose(client, access.workspace_id);
    const compiled = compileSignalListeningConfigurationV1(configuration);
    const question = compiled.choices.find(candidate => candidate.label === `question:${access.question_key}`);
    if (!question) fail("listening_question_unavailable", 404);
    const id = (await questionIds(client, access.workspace_id, [question.question_digest])).get(question.question_digest);
    const empty = { question_key: access.question_key, revision: stored?.revision ?? 0, answered: 0, distribution: [], by_topic: [], trend: [] };
    const target = await population(client, access.workspace_id);
    if (id === undefined || !target) return empty;
    const distribution = (await client.query<{ option: string; roots: number }>(`SELECT answer.choice option,count(*)::int roots
      FROM signal_listening_answers answer JOIN signal_mass_labeling_items item ON item.map_id=$3 AND item.root_id=answer.root_id
      WHERE answer.workspace_id=$1 AND answer.question_id=$2 GROUP BY 1 ORDER BY 2 DESC,1`, [access.workspace_id, id, target.map_id])).rows;
    const by_topic = (await client.query<{ topic_key: string; option: string; roots: number }>(`SELECT membership.concept_key topic_key,answer.choice option,count(*)::int roots
      FROM signal_listening_answers answer
      JOIN signal_mass_labeling_memberships_v1 membership ON membership.workspace_id=answer.workspace_id AND membership.map_id=$3
        AND membership.root_id=answer.root_id AND membership.belongs
      WHERE answer.workspace_id=$1 AND answer.question_id=$2 GROUP BY 1,2 ORDER BY 3 DESC,1,2 LIMIT 400`, [access.workspace_id, id, target.map_id])).rows;
    const trend = (await client.query<{ period: string; option: string; roots: number }>(`SELECT to_char(date_trunc('month',mention.published_at),'YYYY-MM') period,
        answer.choice option,count(*)::int roots
      FROM signal_listening_answers answer JOIN signal_mass_labeling_items item ON item.map_id=$3 AND item.root_id=answer.root_id
      JOIN mentions mention ON mention.workspace_id=answer.workspace_id AND mention.id=answer.root_id
      WHERE answer.workspace_id=$1 AND answer.question_id=$2 AND mention.published_at IS NOT NULL GROUP BY 1,2 ORDER BY 1,2`,
      [access.workspace_id, id, target.map_id])).rows;
    return { ...empty, answered: distribution.reduce((sum, row) => sum + row.roots, 0), distribution, by_topic, trend };
  });
}
