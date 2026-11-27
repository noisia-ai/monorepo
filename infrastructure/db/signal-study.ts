import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  compileSignalListeningConfigurationV1, compileSignalStudyAxesV1, signalStudyMotiveQuestionV1, SIGNAL_LISTENING_CONSUMER_CUT_V1, SIGNAL_STUDY_TB_TEMPLATE_V3,
  validateSignalListeningConfigurationV1, validateSignalStudyLexiconV1, validateSignalStudySubjectV1, validateSignalStudyTemplateV1,
  type SignalListeningAskedQuestionV1, type SignalListeningConfigurationV1, type SignalListeningItemV1, type SignalStudyLayerV1,
  type SignalStudyPermissionV1, type SignalStudySubjectV1, type SignalStudyTemplateV1, type SignalStudyWordingV1,
} from "@noisia/query-engine";
import { SignalLabelingError } from "./signal-labeling-runs";
import { ensureSignalListeningQuestionsV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1, type SignalListeningRunV1 } from "./signal-listening";
import { signalListeningInternalsV1 as shared } from "./signal-listening-configuration";
import { getMassLabelingStudyPolicyV1, updateMassLabelingStudyPolicyV1 } from "./signal-mass-labeling-study-policy";

type Database = Pick<Pool, "connect" | "query">;
type Queryable = Pick<PoolClient, "query">;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const LEASE = "interval '5 minutes'";
function fail(code: string, status = 409): never { throw new SignalLabelingError(code, status); }
const vectorText = (values: ArrayLike<number>) => `[${Array.from(values).join(",")}]`;
/** JSON for a jsonb column. Posts can carry half characters or NUL, which jsonb refuses: they are replaced, never the reason a paid step is lost. */
const json = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => typeof item === "string"
  ? item.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD").replaceAll("\u0000", "") : item);
/** The least a study can be created with: its first pass keeps room for the judgments that follow. */
export const SIGNAL_STUDY_MIN_CAP_MICRO_USD_V1 = 6_000_000;

export type SignalStudyCutV1 = { voice: "individual"; promotion_max: number; exclude_hashtag_only: true; require_category_lexicon: true;
  /** Optional period, as ISO timestamps. Without it the whole corpus is the cut. */
  start_at: string | null; end_at: string | null;
  /** The study's own lexicon. With it the cut is the posts these terms match, not the ones the brand's lexicon matches. */
  lexicon_terms?: string[] };
export type SignalStudyStepV1 = "created" | "axes_asked" | "grouped" | "motives_named" | "layers_coded" | "motives_asked" | "members_confirmed" | "checked" | "published";
export type SignalStudyV1 = {
  id: string; workspace_id: string; base_map_id: string; configuration_id: string; lexicon_revision: number; name: string;
  methodology: SignalStudyTemplateV1; subject: SignalStudySubjectV1; cut: SignalStudyCutV1;
  status: "queued" | "running" | "completed" | "failed" | "canceled"; step: SignalStudyStepV1; cap_micro_usd: number; spent_micro_usd: number;
  state: Record<string, unknown>; output: Record<string, unknown> | null; error_code: string | null; receipt: Record<string, unknown>;
  lease_token: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};
const STUDY = `id,workspace_id,base_map_id,configuration_id,lexicon_revision,name,methodology,subject,cut,status,step,cap_micro_usd::float8 cap_micro_usd,
  spent_micro_usd::float8 spent_micro_usd,state,output,error_code,receipt,lease_token,created_at::text,started_at::text,completed_at::text`;
export type SignalStudyMotiveRowV1 = { study_id: string; motive_key: string; wording: SignalStudyWordingV1; layer: SignalStudyLayerV1; permission: SignalStudyPermissionV1;
  layer_record: Record<string, unknown>; group_keys: string[]; question_id: number | null };

/**
 * Creates a study on the brand's corpus: the cut, the methodology as it is
 * today and the subject are frozen here, with a spending cap. Nothing is imported
 * or embedded again.
 */
export async function requestSignalStudyV1(args: { database: Database; workspace_id: string; actor_user_id: string; name: string; subject: unknown;
  cap_micro_usd: number; idempotency_key: string; period?: { start_at: string; end_at: string } | null; template?: unknown;
  /** The study's own lexicon for its cut, when it is not about the category the brand listens to. */
  lexicon_terms?: unknown }) {
  if (!Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd < SIGNAL_STUDY_MIN_CAP_MICRO_USD_V1 || args.cap_micro_usd > 200_000_000) fail("study_cap_invalid", 422);
  if (typeof args.idempotency_key !== "string" || args.idempotency_key.length < 8 || args.idempotency_key.length > 200) fail("study_request_invalid", 422);
  if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 200) fail("study_request_invalid", 422);
  let subject: SignalStudySubjectV1, template: SignalStudyTemplateV1, lexicon: string[] | null;
  try {
    subject = validateSignalStudySubjectV1(args.subject); template = validateSignalStudyTemplateV1(args.template ?? SIGNAL_STUDY_TB_TEMPLATE_V3);
    lexicon = args.lexicon_terms === undefined || args.lexicon_terms === null ? null : validateSignalStudyLexiconV1(args.lexicon_terms);
  } catch { fail("study_request_invalid", 422); }
  const period = args.period ?? null;
  if (period && (!Number.isFinite(Date.parse(period.start_at)) || !Number.isFinite(Date.parse(period.end_at)) || Date.parse(period.start_at) >= Date.parse(period.end_at))) {
    fail("study_period_invalid", 422);
  }
  return shared.transaction(args.database, async client => {
    await shared.lock(client, args.workspace_id);
    await shared.authorize(client, args, "process");
    const replay = (await client.query<{ id: string }>("SELECT id FROM signal_studies WHERE workspace_id=$1 AND receipt->>'idempotency_key'=$2",
      [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) return { study_id: replay.id, replayed: true };
    const target = await shared.population(client, args.workspace_id);
    if (!target) fail("listening_population_required");
    const { stored, configuration, configuration_digest, policy_revision } = await shared.compose(client, args.workspace_id);
    if (!lexicon && !configuration.lexicon_terms.length) fail("listening_lexicon_required", 422);
    const cut: SignalStudyCutV1 = { ...template.rules.cut, start_at: period?.start_at ?? null, end_at: period?.end_at ?? null, ...(lexicon ? { lexicon_terms: lexicon } : {}) };
    // The cut is read from the base listening answers (who speaks, and whether it is promotion). Without them it would be
    // empty and the study would finish with nothing in it, so the brand is asked to listen first.
    const base = compileSignalListeningConfigurationV1(configuration).base;
    const baseIds = await shared.questionIds(client, args.workspace_id, [base.voice.question_digest, base.promotion.question_digest]);
    const voiceId = baseIds.get(base.voice.question_digest), promotionId = baseIds.get(base.promotion.question_digest);
    // With its own lexicon the cut is only known once the study starts and matches it; the base answers are still required.
    if (voiceId === undefined || promotionId === undefined || (!lexicon && !(await client.query(`SELECT 1 FROM (${shared.consumerRootsSql(3)}) consumer LIMIT 1`,
      [args.workspace_id, target.map_id, voiceId, promotionId, SIGNAL_LISTENING_CONSUMER_CUT_V1.voice, cut.promotion_max, policy_revision])).rows.length)) {
      fail("study_listening_required");
    }
    const revision = await shared.storeRevision(client, { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, stored, configuration,
      configuration_digest, provenance: "human", note: "study settings synchronized before a study" });
    const id = randomUUID();
    await client.query(`INSERT INTO signal_studies(id,workspace_id,base_map_id,configuration_id,lexicon_revision,name,methodology,subject,cut,cap_micro_usd,requested_by_user_id,receipt)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,jsonb_build_object('idempotency_key',$12::text))`,
      [id, args.workspace_id, target.map_id, revision.id, policy_revision, args.name.trim(), JSON.stringify(template), JSON.stringify(subject), JSON.stringify(cut),
        args.cap_micro_usd, args.actor_user_id, args.idempotency_key]);
    return { study_id: id, replayed: false };
  });
}

export async function claimSignalStudyV1(database: Database, study_id?: string): Promise<SignalStudyV1 | null> {
  return (await database.query<SignalStudyV1>(`UPDATE signal_studies SET status='running',lease_token=gen_random_uuid(),lease_until=now()+${LEASE},
    started_at=COALESCE(started_at,now()),updated_at=now()
    WHERE id=(SELECT id FROM signal_studies WHERE status IN('queued','running') AND ($1::uuid IS NULL OR id=$1)
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING ${STUDY}`, [study_id ?? null])).rows[0] ?? null;
}
export async function renewSignalStudyV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">) {
  return (await database.query(`UPDATE signal_studies SET lease_until=now()+${LEASE},updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'`,
    [study.id, study.lease_token])).rowCount === 1;
}
export async function releaseSignalStudyV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">) {
  await database.query("UPDATE signal_studies SET lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2", [study.id, study.lease_token]);
}
export async function finishSignalStudyV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">,
  outcome: { status: "completed" | "failed"; error_code?: string | null; output?: Record<string, unknown> }) {
  await database.query(`UPDATE signal_studies SET status=$3,error_code=$4,output=COALESCE($5::jsonb,output),step=CASE WHEN $3='completed' THEN 'published' ELSE step END,
    lease_token=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND lease_token=$2`,
    [study.id, study.lease_token, outcome.status, outcome.error_code ?? null, outcome.output ? json(outcome.output) : null]);
}
/** Counts an unexpected failure of a step, so a study is tried again a few times before it is given up. */
export async function countSignalStudyStumbleV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">): Promise<number> {
  const row = (await database.query<{ stumbles: number }>(`UPDATE signal_studies SET receipt=jsonb_set(receipt,'{stumbles}',to_jsonb(COALESCE((receipt->>'stumbles')::int,0)+1),true),
    updated_at=now() WHERE id=$1 AND lease_token=$2 RETURNING (receipt->>'stumbles')::int stumbles`, [study.id, study.lease_token])).rows[0];
  return row?.stumbles ?? Number.MAX_SAFE_INTEGER;
}
/**
 * Puts a failed study back in the queue. Finished steps and paid answers are
 * kept. A JEV pass that did not complete is requested again, and only what is
 * still pending in it is asked.
 */
export async function requeueSignalStudyV1(database: Database, study_id: string): Promise<boolean> {
  if (!uuid.test(study_id)) return false;
  return shared.transaction(database, async client => {
    const study = (await client.query<{ runs: Record<string, string> | null }>("SELECT state->'runs' runs FROM signal_studies WHERE id=$1 AND status='failed' FOR UPDATE", [study_id])).rows[0];
    if (!study) return false;
    const ids = Object.values(study.runs ?? {});
    const usable = new Set(ids.length ? (await client.query<{ id: string }>("SELECT id FROM signal_listening_runs WHERE id=ANY($1::uuid[]) AND status IN('queued','running','completed')",
      [ids])).rows.map(row => row.id) : []);
    await client.query(`UPDATE signal_studies SET status='queued',error_code=NULL,completed_at=NULL,lease_token=NULL,lease_until=NULL,
      state=jsonb_set(state,'{runs}',$2::jsonb,true)-'attempts',receipt=receipt-'stumbles',updated_at=now() WHERE id=$1`,
      [study_id, JSON.stringify(Object.fromEntries(Object.entries(study.runs ?? {}).filter(([, id]) => usable.has(id))))]);
    return true;
  });
}
export async function getSignalStudyV1(database: Queryable, study_id: string): Promise<SignalStudyV1 | null> {
  return (await database.query<SignalStudyV1>(`SELECT ${STUDY} FROM signal_studies WHERE id=$1`, [study_id])).rows[0] ?? null;
}
export async function listSignalStudyMotivesV1(database: Queryable, study_id: string): Promise<SignalStudyMotiveRowV1[]> {
  return (await database.query<SignalStudyMotiveRowV1>(`SELECT study_id,motive_key,wording,layer,permission,layer_record,group_keys,question_id::float8 question_id
    FROM signal_study_motives WHERE study_id=$1 ORDER BY motive_key`, [study_id])).rows;
}
/** Moves the study to its next step and merges working data, only while this worker owns it. */
export async function advanceSignalStudyV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">, step: SignalStudyStepV1, state: Record<string, unknown> = {}) {
  const updated = await database.query(`UPDATE signal_studies SET step=$3,state=state||$4::jsonb,lease_until=now()+${LEASE},updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='running'`, [study.id, study.lease_token, step, json(state)]);
  if (updated.rowCount !== 1) throw new Error("study_lease_lost");
}
/** Counts an attempt of an agent step before the provider is called. */
export async function beginSignalStudyAgentStepV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">, key: string): Promise<number> {
  const row = (await database.query<{ attempts: number }>(`UPDATE signal_studies SET state=jsonb_set(jsonb_set(state,'{attempts}',COALESCE(state->'attempts','{}'::jsonb),true),
    ARRAY['attempts',$3::text],to_jsonb(COALESCE((state#>>ARRAY['attempts',$3::text])::int,0)+1),true),updated_at=now() WHERE id=$1 AND lease_token=$2
    RETURNING (state#>>ARRAY['attempts',$3::text])::int attempts`, [study.id, study.lease_token, key])).rows[0];
  if (!row) throw new Error("study_lease_lost");
  return row.attempts;
}
/** Stores the answer of an agent step and charges it, in one transaction, before anything is built on it. */
export async function recordSignalStudyAgentAnswerV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">, key: string,
  answer: Record<string, unknown>, cost_micro_usd: number) {
  const stored = await database.query(`UPDATE signal_studies SET state=jsonb_set(jsonb_set(state,'{answers}',COALESCE(state->'answers','{}'::jsonb),true),ARRAY['answers',$3::text],$4::jsonb,true),
    spent_micro_usd=spent_micro_usd+$5,updated_at=now() WHERE id=$1 AND lease_token=$2 AND NOT COALESCE(state->'answers','{}'::jsonb) ? $3::text`,
    [study.id, study.lease_token, key, json(answer), Math.ceil(cost_micro_usd)]);
  if (stored.rowCount !== 1) throw new Error("study_lease_lost");
}
export async function chargeSignalStudyV1(database: Database, study: Pick<SignalStudyV1, "id">, micro_usd: number) {
  await database.query("UPDATE signal_studies SET spent_micro_usd=spent_micro_usd+$2,updated_at=now() WHERE id=$1", [study.id, Math.ceil(micro_usd)]);
}

async function studyConfiguration(database: Queryable, study: Pick<SignalStudyV1, "configuration_id" | "workspace_id">): Promise<SignalListeningConfigurationV1> {
  const row = (await database.query<{ configuration: SignalListeningConfigurationV1 }>(
    "SELECT configuration FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2", [study.configuration_id, study.workspace_id])).rows[0];
  if (!row) throw new Error("study_configuration_unavailable");
  return validateSignalListeningConfigurationV1(row.configuration);
}
type Cut = { sql: string; params: unknown[] };
/** The cut as SQL: consumer voice that talks about the category, inside the period. Its first two parameters are the workspace and the map. */
async function cutOf(database: Queryable, study: SignalStudyV1): Promise<Cut> {
  const compiled = compileSignalListeningConfigurationV1(await studyConfiguration(database, study));
  const ids = await shared.questionIds(database, study.workspace_id, [compiled.base.voice.question_digest, compiled.base.promotion.question_digest]);
  const own = Boolean(study.cut.lexicon_terms?.length);
  const base = [study.workspace_id, study.base_map_id, ids.get(compiled.base.voice.question_digest) ?? -1, ids.get(compiled.base.promotion.question_digest) ?? -1,
    SIGNAL_LISTENING_CONSUMER_CUT_V1.voice, study.cut.promotion_max, own ? study.id : study.lexicon_revision, study.cut.start_at, study.cut.end_at];
  // Same consumer rule either way; only the lexicon that says what the posts are about changes.
  const consumer = own ? `SELECT item.root_id FROM signal_mass_labeling_items item
    JOIN signal_study_lexicon_matches lexical ON lexical.study_id=$7::uuid AND lexical.root_id=item.root_id
    JOIN signal_mass_labeling_root_segments segment ON segment.map_id=item.map_id AND segment.root_id=item.root_id
    JOIN signal_listening_answers voice ON voice.question_id=$3 AND voice.root_id=item.root_id AND voice.workspace_id=item.workspace_id
      AND voice.choice=$5 AND voice.input_sha=decode(substr(item.input_digest,8),'hex')
    JOIN signal_listening_answers promotion ON promotion.question_id=$4 AND promotion.root_id=item.root_id
      AND promotion.workspace_id=item.workspace_id AND promotion.probability<=$6 AND promotion.input_sha=decode(substr(item.input_digest,8),'hex')
    WHERE item.workspace_id=$1 AND item.map_id=$2 AND NOT segment.hashtag_only` : shared.consumerRootsSql(3);
  return { params: base, sql: `SELECT consumer.root_id FROM (${consumer}) consumer
    JOIN mentions mention ON mention.workspace_id=$1 AND mention.id=consumer.root_id
    WHERE ($8::timestamptz IS NULL OR mention.published_at>=$8::timestamptz) AND ($9::timestamptz IS NULL OR mention.published_at<$9::timestamptz)` };
}
/**
 * Matches the study's own lexicon against the corpus, once, in pages: one statement over every post
 * does not fit in the statement timeout of a real brand. Nothing to do for a study that uses the brand's lexicon.
 */
export async function matchSignalStudyLexiconV1(database: Database, study: SignalStudyV1, heartbeat: () => Promise<unknown> = async () => undefined, page = 4000): Promise<number | null> {
  const terms = study.cut.lexicon_terms;
  if (!terms?.length) return null;
  const last = (await database.query<{ last: number | null }>("SELECT max(ordinal)::int last FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2",
    [study.workspace_id, study.base_map_id])).rows[0]!.last ?? 0;
  for (let from = 0; from < last; from += page) {
    await database.query(`INSERT INTO signal_study_lexicon_matches(study_id,root_id)
      SELECT $1,item.root_id FROM signal_mass_labeling_items item JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
      WHERE item.workspace_id=$2 AND item.map_id=$3 AND item.ordinal>$4 AND item.ordinal<=$5 AND signal_mass_labeling_category_matches_v1(mention.text_clean,$6::text[])
      ON CONFLICT DO NOTHING`, [study.id, study.workspace_id, study.base_map_id, from, from + page, terms]);
    await heartbeat();
  }
  return (await database.query<{ matched: number }>("SELECT count(*)::int matched FROM signal_study_lexicon_matches WHERE study_id=$1", [study.id])).rows[0]!.matched;
}
/** Writes the layer each motive took from its posts. Wording, questions and centres are left as they are. */
export async function setSignalStudyMotiveLayersV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">,
  layers: Array<{ motive_key: string; layer: SignalStudyLayerV1; permission: SignalStudyPermissionV1; layer_record: Record<string, unknown> }>) {
  await shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_studies WHERE id=$1 AND lease_token=$2 FOR UPDATE", [study.id, study.lease_token])).rows.length) throw new Error("study_lease_lost");
    await client.query(`UPDATE signal_study_motives motive SET layer=coded.layer,permission=coded.permission,layer_record=coded.layer_record
      FROM jsonb_to_recordset($2::jsonb) coded(motive_key text,layer text,permission text,layer_record jsonb)
      WHERE motive.study_id=$1 AND motive.motive_key=coded.motive_key`, [study.id, json(layers)]);
  });
}
/** Registers the three questions of the study and remembers their ids. */
export async function ensureSignalStudyAxesV1(database: Database, study: SignalStudyV1) {
  const axes = compileSignalStudyAxesV1(study.methodology, study.subject);
  const ids = await ensureSignalListeningQuestionsV1(database, study.workspace_id, study.methodology.model, Object.values(axes));
  return { axes, ids: { direction: ids.get(axes.direction.question_digest)!, target: ids.get(axes.target.question_digest)!, use: ids.get(axes.use.question_digest)! } };
}

export type SignalStudyRunPlanV1 = { planner: "study_axes_v1" | "study_motives_v1"; study_id: string; input_usd_per_mtok: number; pass: number };
/** Queues a JEV pass of the study. Each pass is requested once; its id is kept in the study. */
export async function requestSignalStudyRunV1(database: Database, study: SignalStudyV1, planner: SignalStudyRunPlanV1["planner"], pass: number, cap_micro_usd: number) {
  return shared.transaction(database, async client => {
    const current = (await client.query<{ run_id: string | null }>(`SELECT state#>>ARRAY['runs',$2::text] run_id FROM signal_studies WHERE id=$1 AND lease_token=$3 FOR UPDATE`,
      [study.id, `${planner}:${pass}`, study.lease_token])).rows[0];
    if (!current) throw new Error("study_lease_lost");
    if (current.run_id) return { run_id: current.run_id };
    const plan: SignalStudyRunPlanV1 = { planner, study_id: study.id, input_usd_per_mtok: SIGNAL_LISTENING_DEFAULT_PRICE_V1, pass };
    const run_id = randomUUID();
    await client.query("INSERT INTO signal_listening_runs(id,workspace_id,kind,plan,cap_micro_usd) VALUES($1,$2,'study',$3::jsonb,$4)",
      [run_id, study.workspace_id, JSON.stringify(plan), Math.max(1, Math.floor(cap_micro_usd))]);
    await client.query(`UPDATE signal_studies SET state=jsonb_set(jsonb_set(state,'{runs}',COALESCE(state->'runs','{}'::jsonb),true),ARRAY['runs',$2::text],to_jsonb($3::text),true),
      updated_at=now() WHERE id=$1`, [study.id, `${planner}:${pass}`, run_id]);
    return { run_id };
  });
}
/** Looks at a JEV pass of the study. When it stops, what it spent is charged to the study, once. */
export async function settleSignalStudyRunV1(database: Database, study: Pick<SignalStudyV1, "id" | "lease_token">, run_id: string) {
  return shared.transaction(database, async client => {
    const run = (await client.query<{ status: SignalListeningRunV1["status"]; spent_micro_usd: number; roots_done: number; roots_failed: number }>(
      "SELECT status,spent_micro_usd::float8 spent_micro_usd,roots_done,roots_failed FROM signal_listening_runs WHERE id=$1", [run_id])).rows[0];
    if (!run) throw new Error("study_run_unavailable");
    if (run.status === "queued" || run.status === "running") return run;
    const charged = await client.query(`UPDATE signal_studies SET spent_micro_usd=spent_micro_usd+$3,
      state=jsonb_set(jsonb_set(state,'{charged_runs}',COALESCE(state->'charged_runs','{}'::jsonb),true),ARRAY['charged_runs',$4::text],'true'::jsonb,true),updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND NOT COALESCE(state->'charged_runs','{}'::jsonb) ? $4::text`, [study.id, study.lease_token, Math.ceil(run.spent_micro_usd), run_id]);
    if (charged.rowCount !== 1 && !(await client.query("SELECT 1 FROM signal_studies WHERE id=$1 AND lease_token=$2", [study.id, study.lease_token])).rows.length) {
      throw new Error("study_lease_lost");
    }
    return run;
  });
}

type SourceRow = { root_id: string; input_digest: string; text: string; candidates?: string[] | null };
/**
 * Source of the JEV passes of a study. `study_axes_v1` asks the three questions
 * of the methodology on every root of the cut. `study_motives_v1` asks each
 * root that shows a direction its closest motives. Answers already in the cache
 * for the same text are never asked again.
 */
export async function createSignalStudySourceV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "workspace_id" | "plan">) {
  const plan = run.plan as unknown as SignalStudyRunPlanV1;
  if (!["study_axes_v1", "study_motives_v1"].includes(plan.planner) || !uuid.test(plan.study_id) || !Number.isFinite(plan.input_usd_per_mtok) || plan.input_usd_per_mtok <= 0) {
    throw new Error("listening_plan_invalid");
  }
  const study = await getSignalStudyV1(database, plan.study_id);
  if (!study || study.workspace_id !== run.workspace_id) throw new Error("listening_plan_unavailable");
  const template = validateSignalStudyTemplateV1(study.methodology), cut = await cutOf(database, study);
  const { axes, ids: axisIds } = await ensureSignalStudyAxesV1(database, study);
  const motives = plan.planner === "study_motives_v1" ? await listSignalStudyMotivesV1(database, study.id) : [];
  const language = (await studyConfiguration(database, study)).candidate_language;
  const motiveQuestions = new Map(motives.map(motive => [motive.motive_key, signalStudyMotiveQuestionV1(template, study.subject, { key: motive.motive_key,
    ...(language === "en" ? motive.wording.en : motive.wording.original) })]));
  const motiveIds = new Map(motives.flatMap(motive => motive.question_id === null ? [] : [[motive.motive_key, motive.question_id] as const]));
  const fixed: SignalListeningAskedQuestionV1[] = [axes.direction, axes.target, axes.use];
  const fixedIds = new Map([[axes.direction.question_digest, axisIds.direction], [axes.target.question_digest, axisIds.target], [axes.use.question_digest, axisIds.use]]);
  const wanted = plan.planner === "study_axes_v1" ? [...fixedIds.values()] : [...motiveIds.values()];
  let cursor: string | null = null;
  return {
    model: template.model, input_usd_per_mtok: plan.input_usd_per_mtok,
    rewind() { cursor = null; },
    async next(limit: number): Promise<SignalListeningItemV1[]> {
      for (;;) {
        const page = cut.params.length;
        const rows: SourceRow[] = plan.planner === "study_axes_v1"
          ? (await database.query<SourceRow>(`SELECT item.root_id,item.input_digest,item.text FROM (${cut.sql}) included
              JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=included.root_id
              WHERE ($${page + 1}::uuid IS NULL OR item.root_id>$${page + 1}) ORDER BY item.root_id LIMIT $${page + 2}`, [...cut.params, cursor, limit])).rows
          // Motives are only asked where the first question found a direction.
          : (await database.query<SourceRow>(`SELECT item.root_id,item.input_digest,item.text,
              (SELECT array_agg(closest.motive_key ORDER BY closest.distance,closest.motive_key) FROM (
                SELECT motive.motive_key,motive.centroid <=> embedding.embedding distance FROM signal_study_motives motive
                WHERE motive.study_id=$${page + 3} AND motive.centroid IS NOT NULL AND motive.question_id IS NOT NULL AND embedding.embedding IS NOT NULL
                ORDER BY 2,1 LIMIT $${page + 4}) closest) candidates
            FROM (${cut.sql}) included
            JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=included.root_id
            JOIN signal_listening_answers direction ON direction.question_id=$${page + 5} AND direction.root_id=item.root_id AND direction.workspace_id=$1
              AND direction.choice<>'none' AND direction.probability>=$${page + 8}::real AND direction.input_sha=decode(substr(item.input_digest,8),'hex')
            JOIN signal_listening_answers use_ ON use_.question_id=$${page + 6} AND use_.root_id=item.root_id AND use_.workspace_id=$1
              AND use_.choice=$${page + 7} AND use_.input_sha=decode(substr(item.input_digest,8),'hex')
            JOIN signal_mass_labeling_maps map ON map.id=item.map_id AND map.workspace_id=item.workspace_id
            LEFT JOIN signal_workspace_chunk_embeddings embedding ON embedding.workspace_id=item.workspace_id AND embedding.config_digest=map.embedding_config_digest
              AND embedding.chunk_sha256=item.chunk_sha256
            WHERE ($${page + 1}::uuid IS NULL OR item.root_id>$${page + 1}) ORDER BY item.root_id LIMIT $${page + 2}`,
            [...cut.params, cursor, limit, study.id, template.rules.motive_candidates, axisIds.direction, axisIds.use, template.rules.group_use,
              template.rules.direction_min_probability ?? 0])).rows;
        if (!rows.length) return [];
        cursor = rows.at(-1)!.root_id;
        const digests = new Map(rows.map(row => [row.root_id, row.input_digest])), answered = new Map<string, Set<number>>();
        for (const answer of (await database.query<{ root_id: string; question_id: string; input_sha: string }>(
          `SELECT root_id,question_id::text,encode(input_sha,'hex') input_sha FROM signal_listening_answers
           WHERE workspace_id=$1 AND root_id=ANY($2::uuid[]) AND question_id=ANY($3::bigint[])`, [run.workspace_id, rows.map(row => row.root_id), wanted])).rows) {
          if (`sha256:${answer.input_sha}` !== digests.get(answer.root_id)) continue;
          const set = answered.get(answer.root_id); if (set) set.add(Number(answer.question_id)); else answered.set(answer.root_id, new Set([Number(answer.question_id)]));
        }
        const items: SignalListeningItemV1[] = [];
        for (const row of rows) {
          const done = answered.get(row.root_id);
          const pending = plan.planner === "study_axes_v1" ? fixed.filter(question => !done?.has(fixedIds.get(question.question_digest)!))
            : (row.candidates ?? []).flatMap(motive_key => motiveQuestions.has(motive_key) && !done?.has(motiveIds.get(motive_key)!) ? [motiveQuestions.get(motive_key)!] : []);
          if (!pending.length) continue;
          const questions = pending.map((question, index) => ({ ...question, request_key: `q${index}` }));
          items.push({ root_id: row.root_id, input_digest: row.input_digest, questions,
            request: { model: template.model, state: row.text, questions: Object.fromEntries(questions.map(question => [question.request_key, question.wire])) } });
        }
        if (items.length) return items;
      }
    },
  };
}

export type SignalStudyPoolRowV1 = { root_id: string; direction: string; target: string; use: string; direction_probability: number | null };
/** Every root of the cut with its three answers. One read: identifiers and choices only. */
export async function readSignalStudyAxesV1(database: Database, study: SignalStudyV1): Promise<SignalStudyPoolRowV1[]> {
  const cut = await cutOf(database, study), { ids } = await ensureSignalStudyAxesV1(database, study), n = cut.params.length;
  return (await database.query<SignalStudyPoolRowV1>(`SELECT item.root_id,direction.choice direction,target.choice target,use_.choice use,direction.probability::float8 direction_probability
    FROM (${cut.sql}) included JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=included.root_id
    JOIN signal_listening_answers direction ON direction.question_id=$${n + 1} AND direction.root_id=item.root_id AND direction.input_sha=decode(substr(item.input_digest,8),'hex')
    JOIN signal_listening_answers target ON target.question_id=$${n + 2} AND target.root_id=item.root_id AND target.input_sha=decode(substr(item.input_digest,8),'hex')
    JOIN signal_listening_answers use_ ON use_.question_id=$${n + 3} AND use_.root_id=item.root_id AND use_.input_sha=decode(substr(item.input_digest,8),'hex')
    ORDER BY item.root_id`, [...cut.params, ids.direction, ids.target, ids.use])).rows;
}
export async function countSignalStudyCutV1(database: Database, study: SignalStudyV1): Promise<{ cut_roots: number; corpus_roots: number }> {
  const cut = await cutOf(database, study);
  const cut_roots = (await database.query<{ roots: number }>(`SELECT count(*)::int roots FROM (${cut.sql}) included`, cut.params)).rows[0]!.roots;
  const corpus_roots = (await database.query<{ roots: number }>("SELECT count(*)::int roots FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2",
    [study.workspace_id, study.base_map_id])).rows[0]!.roots;
  return { cut_roots, corpus_roots };
}
/** The classified text of the given roots, their vector and what is needed to show a verbatim. */
export async function readSignalStudyRootsV1(database: Database, study: Pick<SignalStudyV1, "workspace_id" | "base_map_id">, root_ids: string[], options: { vectors: boolean }) {
  return (await database.query<{ root_id: string; text: string; vector: number[] | null; url: string | null; platform: string | null; published_at: string | null }>(
    `SELECT item.root_id,item.text,${options.vectors ? "embedding.embedding::real[]" : "NULL::real[]"} vector,mention.url,mention.platform,mention.published_at::text
     FROM signal_mass_labeling_items item
     JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
     JOIN signal_mass_labeling_maps map ON map.id=item.map_id AND map.workspace_id=item.workspace_id
     LEFT JOIN signal_workspace_chunk_embeddings embedding ON embedding.workspace_id=item.workspace_id AND embedding.config_digest=map.embedding_config_digest
       AND embedding.chunk_sha256=item.chunk_sha256
     WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=ANY($3::uuid[]) ORDER BY item.root_id`, [study.workspace_id, study.base_map_id, root_ids])).rows;
}

/** Writes the motives of the study with their question and centroid. Replaces any earlier draft of the same study. */
export async function saveSignalStudyMotivesV1(database: Database, study: SignalStudyV1, motives: Array<{ motive_key: string; wording: SignalStudyWordingV1;
  layer: SignalStudyLayerV1; permission: SignalStudyPermissionV1; layer_record: Record<string, unknown>; group_keys: string[]; centroid: ArrayLike<number> | null }>) {
  const language = (await studyConfiguration(database, study)).candidate_language;
  const questions = motives.map(motive => signalStudyMotiveQuestionV1(study.methodology, study.subject, { key: motive.motive_key,
    ...(language === "en" ? motive.wording.en : motive.wording.original) }));
  await shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_studies WHERE id=$1 AND lease_token=$2 FOR UPDATE", [study.id, study.lease_token])).rows.length) throw new Error("study_lease_lost");
    const ids = await ensureSignalListeningQuestionsV1(client, study.workspace_id, study.methodology.model, questions);
    await client.query("DELETE FROM signal_study_motives WHERE study_id=$1", [study.id]);
    await client.query(`INSERT INTO signal_study_motives(study_id,motive_key,wording,layer,permission,layer_record,group_keys,centroid,question_id)
      SELECT $1,motive.motive_key,motive.wording,motive.layer,motive.permission,motive.layer_record,motive.group_keys,motive.centroid::vector,motive.question_id
      FROM jsonb_to_recordset($2::jsonb) motive(motive_key text,wording jsonb,layer text,permission text,layer_record jsonb,group_keys text[],centroid text,question_id bigint)`,
      [study.id, json(motives.map((motive, index) => ({ ...motive, centroid: motive.centroid ? vectorText(motive.centroid) : null,
        question_id: ids.get(questions[index]!.question_digest) })))]);
  });
}

/**
 * Rewrites the wording of some motives. Their question changes with it, so they
 * are asked again where needed. The note that it was done is written in the
 * same transaction: a crash in between can never publish reworded motives that
 * nobody asked about.
 */
export async function rewordSignalStudyMotivesV1(database: Database, study: SignalStudyV1, wording: Map<string, SignalStudyWordingV1>, state: Record<string, unknown>) {
  const language = (await studyConfiguration(database, study)).candidate_language, entries = [...wording];
  const questions = entries.map(([motive_key, value]) => signalStudyMotiveQuestionV1(study.methodology, study.subject, { key: motive_key,
    ...(language === "en" ? value.en : value.original) }));
  await shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_studies WHERE id=$1 AND lease_token=$2 FOR UPDATE", [study.id, study.lease_token])).rows.length) throw new Error("study_lease_lost");
    const ids = entries.length ? await ensureSignalListeningQuestionsV1(client, study.workspace_id, study.methodology.model, questions) : new Map<string, number>();
    await client.query(`UPDATE signal_study_motives motive SET wording=changed.wording,question_id=changed.question_id,
        layer_record=motive.layer_record||jsonb_build_object('reworded_by_contrast',true)
      FROM jsonb_to_recordset($2::jsonb) changed(motive_key text,wording jsonb,question_id bigint)
      WHERE motive.study_id=$1 AND motive.motive_key=changed.motive_key`,
      [study.id, json(entries.map(([motive_key, value], index) => ({ motive_key, wording: value, question_id: ids.get(questions[index]!.question_digest) })))]);
    await client.query("UPDATE signal_studies SET state=state||$2::jsonb,updated_at=now() WHERE id=$1", [study.id, json(state)]);
  });
}

export type SignalStudyMembershipV1 = { root_id: string; motive_key: string };
/** Roots confirmed for each motive: the classifier said yes at or above the approval threshold. */
export async function readSignalStudyMembershipsV1(database: Database, study: SignalStudyV1): Promise<SignalStudyMembershipV1[]> {
  const cut = await cutOf(database, study), n = cut.params.length;
  return (await database.query<SignalStudyMembershipV1>(`SELECT item.root_id,motive.motive_key FROM (${cut.sql}) included
    JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=included.root_id
    JOIN signal_study_motives motive ON motive.study_id=$${n + 1}
    JOIN signal_listening_answers answer ON answer.question_id=motive.question_id AND answer.root_id=item.root_id AND answer.workspace_id=$1
      AND answer.probability>=$${n + 2}::real AND answer.input_sha=decode(substr(item.input_digest,8),'hex')`,
    [...cut.params, study.id, study.methodology.rules.motive_approval_min])).rows;
}
/** Listening topics each given root belongs to, from the brand's published map. Used for the cross of motives and topics. */
export async function readSignalStudyTopicMembershipsV1(database: Database, study: Pick<SignalStudyV1, "workspace_id" | "base_map_id">, root_ids: string[]) {
  return (await database.query<{ root_id: string; topic_key: string }>(`SELECT root_id,concept_key topic_key FROM signal_mass_labeling_memberships_v1
    WHERE workspace_id=$1 AND map_id=$2 AND belongs AND root_id=ANY($3::uuid[])`, [study.workspace_id, study.base_map_id, root_ids])).rows;
}

/**
 * The explicit bridge to the report: a person carries motives of a finished
 * study into the brand's defined topics, as a new revision of its study settings.
 * Nothing is asked here; the next listening pass asks them where they are pending.
 */
export async function promoteSignalStudyMotivesV1(args: { database: Database; workspace_id: string; actor_user_id: string; study_id: string; motive_keys: string[] }) {
  if (!uuid.test(args.study_id) || !Array.isArray(args.motive_keys) || !args.motive_keys.length || args.motive_keys.length > 32) fail("study_promotion_invalid", 422);
  const motives = await shared.transaction(args.database, async client => {
    await shared.authorize(client, args, "edit");
    const study = (await client.query<{ status: string }>("SELECT status FROM signal_studies WHERE id=$1 AND workspace_id=$2", [args.study_id, args.workspace_id])).rows[0];
    if (!study) fail("study_unavailable", 404);
    if (study.status !== "completed") fail("study_not_finished");
    const rows = (await client.query<{ motive_key: string; wording: SignalStudyWordingV1; promoted_as: string | null }>(
      `SELECT motive.motive_key,motive.wording,promotion.defined_topic_key promoted_as FROM signal_study_motives motive
       LEFT JOIN signal_study_promotions promotion ON promotion.study_id=motive.study_id AND promotion.motive_key=motive.motive_key
       WHERE motive.study_id=$1 AND motive.motive_key=ANY($2::text[]) ORDER BY motive.motive_key`, [args.study_id, args.motive_keys])).rows;
    if (rows.length !== new Set(args.motive_keys).size) fail("study_promotion_invalid", 422);
    return rows;
  });
  // The study settings are changed through their own door, with its checks and its revision.
  const policy = await getMassLabelingStudyPolicyV1({ database: args.database, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
  const taken = new Set(policy.interests.map(interest => interest.key)), added: Array<{ motive_key: string; defined_topic_key: string }> = [], carried: typeof added = [];
  const interests = [...policy.interests];
  for (const motive of motives) {
    const wording = policy.candidate_language === "en" ? motive.wording.en : motive.wording.original;
    // Already carried from this study: nothing to add.
    if (motive.promoted_as && taken.has(motive.promoted_as)) { carried.push({ motive_key: motive.motive_key, defined_topic_key: motive.promoted_as }); continue; }
    // A defined topic with exactly this wording is the same topic (a retry whose record was not written).
    const same = interests.find(interest => interest.name === wording.name && interest.definition === wording.definition);
    if (same) { carried.push({ motive_key: motive.motive_key, defined_topic_key: same.key }); continue; }
    // Motive keys are unique inside a study, topic keys across the brand: a key in use by another topic is never reused.
    const stem = `motive_${motive.motive_key}`.slice(0, 60);
    let defined_topic_key = stem;
    for (let suffix = 2; taken.has(defined_topic_key); suffix++) defined_topic_key = `${stem}_${suffix}`;
    interests.push({ key: defined_topic_key, name: wording.name, definition: wording.definition, active: true });
    taken.add(defined_topic_key); added.push({ motive_key: motive.motive_key, defined_topic_key }); carried.push({ motive_key: motive.motive_key, defined_topic_key });
  }
  const record = () => args.database.query(`INSERT INTO signal_study_promotions(study_id,workspace_id,motive_key,defined_topic_key,created_by_user_id)
    SELECT $1,$2,added.motive_key,added.defined_topic_key,$4 FROM jsonb_to_recordset($3::jsonb) added(motive_key text,defined_topic_key text)
    ON CONFLICT(study_id,motive_key) DO NOTHING`, [args.study_id, args.workspace_id, JSON.stringify(carried), args.actor_user_id]);
  // A retry after a half-finished promotion finds the topics already there: it only has to leave the record.
  if (!added.length) { await record(); return { promoted: [], revision: policy.revision }; }
  if (interests.length > 32) fail("study_promotion_too_many", 422);
  const saved = await updateMassLabelingStudyPolicyV1({ database: args.database, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id,
    expected_revision: policy.revision, category: policy.category, lexicon_terms: policy.lexicon_terms, candidate_language: policy.candidate_language,
    interest_threshold: policy.interest_threshold, interests, display_names: policy.display_names });
  await record();
  return { promoted: added, revision: saved.revision };
}

/** Studies of a workspace with their result, for the reader. */
export async function readSignalStudiesV1(access: { database: Database; workspace_id: string; actor_user_id: string; study_id?: string }) {
  return shared.transaction(access.database, async client => {
    await client.query("SET TRANSACTION READ ONLY");
    const caps = await shared.authorize(client, access, "view");
    const studies = (await client.query<Pick<SignalStudyV1, "id" | "name" | "status" | "step" | "subject" | "cut" | "spent_micro_usd" | "cap_micro_usd" | "created_at"
      | "completed_at" | "error_code" | "output"> & { methodology_key: string; methodology_version: string }>(
      `SELECT id,name,status,step,subject,cut,spent_micro_usd::float8 spent_micro_usd,cap_micro_usd::float8 cap_micro_usd,created_at::text,completed_at::text,error_code,
        CASE WHEN $2::uuid IS NULL THEN NULL ELSE output END output,methodology->>'key' methodology_key,methodology->>'version' methodology_version
       FROM signal_studies WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at DESC LIMIT 50`, [access.workspace_id, access.study_id ?? null])).rows;
    const promotions = access.study_id ? (await client.query<{ motive_key: string; defined_topic_key: string }>(
      "SELECT motive_key,defined_topic_key FROM signal_study_promotions WHERE study_id=$1 AND workspace_id=$2", [access.study_id, access.workspace_id])).rows : [];
    return { contract_version: "signal-studies-v1" as const, workspace_id: access.workspace_id, can_edit: caps.can_edit_topics,
      can_run: caps.can_edit_topics && caps.can_request_processing, studies, promotions };
  });
}
