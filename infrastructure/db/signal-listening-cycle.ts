import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  compileSignalListeningConfigurationV1, signalListeningPairQuestionV1, signalListeningTopicWordingV1, SIGNAL_LISTENING_CYCLE_POLICY_V1, validateSignalListeningCatalogV1,
  validateSignalListeningConfigurationV1,
  type SignalListeningAskedQuestionV1, type SignalListeningCatalogTopicV1, type SignalListeningConfigurationV1, type SignalListeningCycleEvidenceV1,
  type SignalListeningCyclePolicyV1, type SignalListeningItemV1, type SignalListeningOrphanGroupV1, type SignalListeningPairChoiceV1, type SignalListeningThemeV1,
  type SignalTopicLocalizationV1,
} from "@noisia/query-engine";
import { SignalLabelingError } from "./signal-labeling-runs";
import { ensureSignalListeningQuestionsV1, SIGNAL_LISTENING_DEFAULT_PRICE_V1, type SignalListeningRunV1 } from "./signal-listening";
import { signalListeningInternalsV1 as shared } from "./signal-listening-configuration";

type Database = Pick<Pool, "connect" | "query">;
type Queryable = Pick<PoolClient, "query">;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const LEASE = "interval '5 minutes'";
function fail(code: string, status = 409): never { throw new SignalLabelingError(code, status); }

export type SignalListeningCycleStatusV1 = "queued" | "running" | "completed" | "failed" | "canceled";
export type SignalListeningCycleV1 = {
  id: string; workspace_id: string; base_map_id: string; configuration_id: string; lexicon_revision: number; policy: SignalListeningCyclePolicyV1;
  status: SignalListeningCycleStatusV1; cap_micro_usd: number; spent_micro_usd: number; stop_reason: string | null; error_code: string | null;
  receipt: Record<string, unknown>; lease_token: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};
export type SignalListeningRoundStepV1 = "created" | "asked" | "measured" | "regrouped" | "reviewed";
export type SignalListeningStoredOrphanGroupV1 = SignalListeningOrphanGroupV1 & { centroid: number[] };
export type SignalListeningRoundV1 = {
  id: string; cycle_id: string; workspace_id: string; round_no: number; step: SignalListeningRoundStepV1;
  catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[]; evidence: SignalListeningCycleEvidenceV1 | null;
  orphan_groups: SignalListeningStoredOrphanGroupV1[] | null; review: Record<string, unknown> | null; run_id: string | null;
};
const CYCLE = `id,workspace_id,base_map_id,configuration_id,lexicon_revision,policy,status,cap_micro_usd::float8 cap_micro_usd,
  spent_micro_usd::float8 spent_micro_usd,stop_reason,error_code,receipt,lease_token,created_at::text,started_at::text,completed_at::text`;
const ROUND = "id,cycle_id,workspace_id,round_no,step,catalog,themes,evidence,orphan_groups,review,run_id";
const vectorText = (values: ArrayLike<number>) => `[${Array.from(values).join(",")}]`;

/** Topics a person renamed or merged (both the one that stays and the one folded into it): the agent
 * must leave them exactly as they are. Correcting one mention does not freeze the topic; that correction stays with the mention. */
async function lockedTopicKeys(client: Queryable, workspace_id: string, display_names: Record<string, unknown>) {
  const rows = (await client.query<{ topic_key: string | null }>(`SELECT topic_key FROM signal_listening_human_edits
    WHERE workspace_id=$1 AND operation IN('merge_topics','rename_topic')
    UNION SELECT payload->>'source_topic_key' FROM signal_listening_human_edits WHERE workspace_id=$1 AND operation='merge_topics'`, [workspace_id])).rows;
  return new Set([...rows.flatMap(row => row.topic_key ? [row.topic_key] : []), ...Object.keys(display_names)]);
}

function topicQuestion(configuration: SignalListeningConfigurationV1, topic: SignalListeningCatalogTopicV1): SignalListeningAskedQuestionV1 {
  return compileSignalListeningConfigurationV1(configuration).topic(topic.topic_key, signalListeningTopicWordingV1(topic, configuration.candidate_language));
}
async function writeRoundTopics(client: Queryable, round: { id: string; workspace_id: string }, configuration: SignalListeningConfigurationV1,
  catalog: SignalListeningCatalogTopicV1[], centroids: Map<string, { vector: string; members: number }>) {
  const questions = catalog.map(topic => topicQuestion(configuration, topic));
  const ids = await ensureSignalListeningQuestionsV1(client, round.workspace_id, configuration.model, questions);
  await client.query(`INSERT INTO signal_listening_round_topics(round_id,topic_key,question_id,centroid,confirmed_members)
    SELECT $1,topic.topic_key,topic.question_id,topic.centroid::vector,topic.members
    FROM jsonb_to_recordset($2::jsonb) topic(topic_key text,question_id bigint,centroid text,members int)
    ON CONFLICT(round_id,topic_key) DO NOTHING`, [round.id, JSON.stringify(catalog.map((topic, index) => ({ topic_key: topic.topic_key,
      question_id: ids.get(questions[index]!.question_digest), centroid: centroids.get(topic.topic_key)?.vector ?? null,
      members: centroids.get(topic.topic_key)?.members ?? 0 })))]);
  // A round is measured through these rows minutes after they are written. Without fresh statistics the planner takes
  // the new round for empty, and a measurement that takes seconds runs into the statement timeout.
  await client.query("ANALYZE signal_listening_round_topics");
}

/** Registers the question of each pair with the wording both topics have in this round, and leaves the pairs in the round. */
async function writeRoundPairs(client: Queryable, round: { id: string; workspace_id: string }, configuration: SignalListeningConfigurationV1,
  catalog: SignalListeningCatalogTopicV1[], pairs: Array<{ left: string; right: string; jaccard?: number | null }>) {
  const topics = new Map(catalog.map(topic => [topic.topic_key, topic]));
  const asked = pairs.flatMap(pair => {
    const left = topics.get(pair.left), right = topics.get(pair.right);
    return left && right ? [{ ...pair, question: pairQuestion(configuration, left, right) }] : [];
  });
  if (!asked.length) return;
  const ids = await ensureSignalListeningQuestionsV1(client, round.workspace_id, configuration.model, asked.map(pair => pair.question));
  await client.query("UPDATE signal_listening_rounds SET review=COALESCE(review,'{}'::jsonb)||jsonb_build_object('pairs',$2::jsonb) WHERE id=$1",
    [round.id, JSON.stringify(asked.map(pair => ({ left: pair.left, right: pair.right, question_id: ids.get(pair.question.question_digest), jaccard: pair.jaccard ?? null })))]);
}
function pairQuestion(configuration: SignalListeningConfigurationV1, left: SignalListeningCatalogTopicV1, right: SignalListeningCatalogTopicV1) {
  const worded = (topic: SignalListeningCatalogTopicV1) => ({ topic_key: topic.topic_key, ...signalListeningTopicWordingV1(topic, configuration.candidate_language) });
  return signalListeningPairQuestionV1(configuration.model, worded(left), worded(right));
}
/** For repairs by an operator: sets the pairs a round has to settle. Not used by the loop itself. */
export async function setSignalListeningRoundPairsV1(database: Database, round_id: string, pairs: Array<{ left: string; right: string; jaccard?: number | null }>) {
  return shared.transaction(database, async client => {
    const round = (await client.query<{ workspace_id: string; catalog: SignalListeningCatalogTopicV1[]; configuration_id: string }>(
      `SELECT round.workspace_id,round.catalog,cycle.configuration_id FROM signal_listening_rounds round JOIN signal_listening_cycles cycle ON cycle.id=round.cycle_id
       WHERE round.id=$1 FOR UPDATE OF round`, [round_id])).rows[0];
    if (!round) throw new Error("listening_round_unavailable");
    const configuration = await readSignalListeningCycleConfigurationV1(client, round);
    await writeRoundPairs(client, { id: round_id, workspace_id: round.workspace_id }, configuration, round.catalog, pairs);
  });
}

/**
 * Starts the automatic loop over the brand's current population. Round 1 is the
 * map as it stands today with the answers already in the cache; nothing is asked
 * until the first review changes the map. A brand that already finished a loop
 * on this population continues from its reviewed map, so what people merged or
 * renamed there is still in front of the agent, locked. The thresholds, the stop
 * rule and the spending cap are fixed here.
 */
export async function requestSignalListeningCycleV1(args: { database: Database; workspace_id: string; actor_user_id: string; cap_micro_usd: number;
  idempotency_key: string; policy?: SignalListeningCyclePolicyV1 }) {
  // A cycle needs room for at least one map review.
  if (!Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd < 3_500_000 || args.cap_micro_usd > 200_000_000) fail("listening_cap_invalid", 422);
  if (typeof args.idempotency_key !== "string" || args.idempotency_key.length < 8 || args.idempotency_key.length > 200) fail("listening_request_invalid", 422);
  const policy = args.policy ?? SIGNAL_LISTENING_CYCLE_POLICY_V1;
  return shared.transaction(args.database, async client => {
    await shared.lock(client, args.workspace_id);
    await shared.authorize(client, args, "process");
    const replay = (await client.query<{ id: string }>("SELECT id FROM signal_listening_cycles WHERE workspace_id=$1 AND receipt->>'idempotency_key'=$2",
      [args.workspace_id, args.idempotency_key])).rows[0];
    if (replay) return { cycle_id: replay.id, replayed: true };
    const target = await shared.population(client, args.workspace_id);
    if (!target) fail("listening_population_required");
    if ((await client.query(`SELECT 1 FROM signal_listening_cycles WHERE workspace_id=$1 AND status IN('queued','running')
      UNION ALL SELECT 1 FROM signal_listening_runs WHERE workspace_id=$1 AND status IN('queued','running') LIMIT 1`, [args.workspace_id])).rows.length) {
      fail("listening_run_active");
    }
    const { stored, configuration, configuration_digest, policy_revision } = await shared.compose(client, args.workspace_id);
    const revision = await shared.storeRevision(client, { workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, stored, configuration,
      configuration_digest, provenance: "human", note: "study settings synchronized before a discovery cycle" });
    const map = (await client.query<{ catalog: Array<{ topic_key: string; name: string; definition: string; localization?: SignalTopicLocalizationV1 }> }>(
      "SELECT catalog FROM signal_mass_labeling_maps WHERE workspace_id=$1 AND id=$2", [args.workspace_id, target.map_id])).rows[0]!;
    const localized = new Map(map.catalog.flatMap(topic => topic.localization ? [[topic.topic_key, topic.localization] as const] : []));
    for (const topic of (await client.query<{ topic_key: string; localization: SignalTopicLocalizationV1 }>(
      "SELECT topic_key,localization FROM signal_mass_labeling_localizations WHERE workspace_id=$1 AND map_id=$2", [args.workspace_id, target.map_id])).rows) {
      if (!localized.has(topic.topic_key)) localized.set(topic.topic_key, topic.localization);
    }
    const display = (await client.query<{ display_names: Record<string, unknown> }>(`SELECT display_names FROM signal_mass_labeling_study_policies
      WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 1`, [args.workspace_id])).rows[0]?.display_names ?? {};
    const locked = await lockedTopicKeys(client, args.workspace_id, display);
    const previous = (await client.query<{ round_id: string; catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[] }>(
      `SELECT round.id round_id,round.catalog,round.themes FROM signal_listening_cycles cycle JOIN signal_listening_rounds round ON round.cycle_id=cycle.id
       WHERE cycle.workspace_id=$1 AND cycle.base_map_id=$2 AND cycle.status='completed' ORDER BY cycle.completed_at DESC,round.round_no DESC LIMIT 1`,
      [args.workspace_id, target.map_id])).rows[0];
    const catalog = validateSignalListeningCatalogV1(previous
      ? previous.catalog.map(topic => ({ ...topic, human_locked: locked.has(topic.topic_key), source_topic_keys: [], orphan_group_keys: [] }))
      // Only topics worded in all three languages enter the loop; the rest keep their published state.
      : map.catalog.flatMap(topic => {
        const localization = localized.get(topic.topic_key);
        return localization && /^[a-z][a-z0-9_]{0,119}$/u.test(topic.topic_key) ? [{ topic_key: topic.topic_key, localization, domain: "category" as const,
          theme_key: null, origin: "discovery" as const, human_locked: locked.has(topic.topic_key), source_topic_keys: [], orphan_group_keys: [] }] : [];
      }));
    if (!catalog.length) fail("listening_catalog_required");
    const cycle_id = randomUUID(), round_id = randomUUID();
    await client.query(`INSERT INTO signal_listening_cycles(id,workspace_id,base_map_id,configuration_id,lexicon_revision,policy,cap_micro_usd,requested_by_user_id,receipt)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,jsonb_build_object('idempotency_key',$9::text))`,
      [cycle_id, args.workspace_id, target.map_id, revision.id, policy_revision, JSON.stringify(policy), args.cap_micro_usd, args.actor_user_id, args.idempotency_key]);
    await client.query("INSERT INTO signal_listening_rounds(id,cycle_id,workspace_id,round_no,step,catalog,themes) VALUES($1,$2,$3,1,'asked',$4::jsonb,$5::jsonb)",
      [round_id, cycle_id, args.workspace_id, JSON.stringify(catalog), JSON.stringify(previous?.themes ?? [])]);
    const centroids = new Map((previous
      ? await client.query<{ topic_key: string; centroid: string | null; members: number }>(
        "SELECT topic_key,centroid::text centroid,confirmed_members members FROM signal_listening_round_topics WHERE round_id=$1", [previous.round_id])
      : await client.query<{ topic_key: string; centroid: string | null; members: number }>(
        "SELECT topic_key,centroid::text centroid,0 members FROM signal_mass_labeling_topics WHERE workspace_id=$1 AND map_id=$2", [args.workspace_id, target.map_id])).rows
      .flatMap(row => row.centroid ? [[row.topic_key, { vector: row.centroid, members: row.members }] as const] : []));
    await writeRoundTopics(client, { id: round_id, workspace_id: args.workspace_id }, configuration, catalog, centroids);
    return { cycle_id, replayed: false, topics: catalog.length, locked: catalog.filter(topic => topic.human_locked).length };
  });
}

export async function claimSignalListeningCycleV1(database: Database, cycle_id?: string): Promise<SignalListeningCycleV1 | null> {
  return (await database.query<SignalListeningCycleV1>(`UPDATE signal_listening_cycles SET status='running',lease_token=gen_random_uuid(),
    lease_until=now()+${LEASE},started_at=COALESCE(started_at,now()),updated_at=now()
    WHERE id=(SELECT id FROM signal_listening_cycles WHERE status IN('queued','running') AND ($1::uuid IS NULL OR id=$1)
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING ${CYCLE}`, [cycle_id ?? null])).rows[0] ?? null;
}
export async function renewSignalListeningCycleV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">) {
  return (await database.query(`UPDATE signal_listening_cycles SET lease_until=now()+${LEASE},updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running'`,
    [cycle.id, cycle.lease_token])).rowCount === 1;
}
export async function releaseSignalListeningCycleV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">) {
  await database.query("UPDATE signal_listening_cycles SET lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2", [cycle.id, cycle.lease_token]);
}
export async function finishSignalListeningCycleV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">,
  outcome: { status: "completed" | "failed"; stop_reason?: string | null; error_code?: string | null; receipt?: Record<string, unknown> }) {
  await database.query(`UPDATE signal_listening_cycles SET status=$3,stop_reason=$4,error_code=$5,receipt=receipt||$6::jsonb,lease_token=NULL,lease_until=NULL,
    completed_at=now(),updated_at=now() WHERE id=$1 AND lease_token=$2`,
    [cycle.id, cycle.lease_token, outcome.status, outcome.stop_reason ?? null, outcome.error_code ?? null, JSON.stringify(outcome.receipt ?? {})]);
}
export async function getSignalListeningCycleV1(database: Queryable, cycle_id: string) {
  const cycle = (await database.query<SignalListeningCycleV1>(`SELECT ${CYCLE} FROM signal_listening_cycles WHERE id=$1`, [cycle_id])).rows[0] ?? null;
  const rounds = cycle ? (await database.query<SignalListeningRoundV1>(`SELECT ${ROUND} FROM signal_listening_rounds WHERE cycle_id=$1 ORDER BY round_no`, [cycle_id])).rows : [];
  return cycle ? { cycle, rounds } : null;
}
export async function readSignalListeningCycleConfigurationV1(database: Queryable, cycle: Pick<SignalListeningCycleV1, "configuration_id" | "workspace_id">) {
  const row = (await database.query<{ configuration: SignalListeningConfigurationV1 }>(
    "SELECT configuration FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2", [cycle.configuration_id, cycle.workspace_id])).rows[0];
  if (!row) throw new Error("listening_cycle_configuration_unavailable");
  return validateSignalListeningConfigurationV1(row.configuration);
}
/** Adds a cost that has no step to travel with, such as a review that was billed but could not be used. */
export async function chargeSignalListeningCycleV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id">, micro_usd: number) {
  await database.query("UPDATE signal_listening_cycles SET spent_micro_usd=spent_micro_usd+$2,updated_at=now() WHERE id=$1", [cycle.id, Math.ceil(micro_usd)]);
}
/** Answers of a round that count: this round's topics, for the text the map holds today. Where the classifier
 * was asked to choose between two topics for a post, that choice replaces the two separate answers. */
const VALID = `valid AS MATERIALIZED (
  SELECT answer.root_id,topic.topic_key,COALESCE(decided.belongs,answer.probability>=$4::real) ok,
    CASE WHEN decided.belongs IS NULL THEN answer.probability WHEN decided.belongs THEN 1::real ELSE 0::real END probability
  FROM signal_listening_round_topics topic
  JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1
  JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=answer.root_id
    AND answer.input_sha=decode(substr(item.input_digest,8),'hex')
  LEFT JOIN signal_listening_answer_overrides decided ON decided.question_id=topic.question_id AND decided.root_id=answer.root_id AND decided.input_sha=answer.input_sha
  WHERE topic.round_id=$3)`;
/** A pair of topics the classifier settles post by post, as a round carries it. */
export type SignalListeningRoundPairV1 = { left: string; right: string; question_id: number; jaccard?: number | null };
const roundPairs = (round: Pick<SignalListeningRoundV1, "review">) => ((round.review as { pairs?: SignalListeningRoundPairV1[] } | null)?.pairs ?? []);

/**
 * Applies what the classifier chose for the pairs of a round: for each post
 * both topics held, its choice (left, right, both or neither) becomes the two
 * memberships. Safe to repeat. Returns how the posts of each pair were shared out.
 */
export async function settleSignalListeningPairChoicesV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "workspace_id" | "lease_token">,
  round: Pick<SignalListeningRoundV1, "id" | "review">): Promise<SignalListeningPairChoiceV1[]> {
  const pairs = roundPairs(round);
  if (!pairs.length) return [];
  return shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_listening_cycles WHERE id=$1 AND lease_token=$2 FOR UPDATE", [cycle.id, cycle.lease_token])).rows.length) {
      throw new Error("listening_cycle_lease_lost");
    }
    const topics = new Map((await client.query<{ topic_key: string; question_id: string }>(
      "SELECT topic_key,question_id::text FROM signal_listening_round_topics WHERE round_id=$1", [round.id])).rows.map(row => [row.topic_key, row.question_id]));
    const result: SignalListeningPairChoiceV1[] = [];
    for (const pair of pairs) {
      const left = topics.get(pair.left), right = topics.get(pair.right);
      if (!left || !right) continue;
      // The decision travels with the digest of the text it was made on: it never applies to an answer about another text.
      await client.query(`INSERT INTO signal_listening_answer_overrides(workspace_id,question_id,root_id,belongs,decided_by_question_id,input_sha)
        SELECT $1,side.question_id,answer.root_id,answer.choice=ANY(side.accepted),$2::bigint,answer.input_sha
        FROM signal_listening_answers answer
        CROSS JOIN (VALUES($3::bigint,ARRAY['left','both']),($4::bigint,ARRAY['right','both'])) side(question_id,accepted)
        WHERE answer.question_id=$2::bigint AND answer.workspace_id=$1 AND answer.choice IN('left','right','both','neither')
        ON CONFLICT(question_id,root_id) DO UPDATE SET belongs=EXCLUDED.belongs,decided_by_question_id=EXCLUDED.decided_by_question_id,input_sha=EXCLUDED.input_sha`,
        [cycle.workspace_id, pair.question_id, left, right]);
      const counts = new Map((await client.query<{ choice: string; posts: number }>(
        "SELECT choice,count(*)::int posts FROM signal_listening_answers WHERE question_id=$1::bigint AND workspace_id=$2 GROUP BY 1", [pair.question_id, cycle.workspace_id])).rows
        .map(row => [row.choice, row.posts]));
      const of = (choice: string) => counts.get(choice) ?? 0, total = of("left") + of("right") + of("both") + of("neither");
      result.push({ left: pair.left, right: pair.right, shared: total, chose_left: of("left"), chose_right: of("right"), chose_both: of("both"), chose_neither: of("neither"),
        both_share: total ? of("both") / total : null, jaccard: pair.jaccard ?? null });
    }
    return result;
  });
}
const CATEGORY = `category AS MATERIALIZED (
  SELECT item.root_id FROM signal_mass_labeling_items item
  JOIN signal_mass_labeling_category_matches lexical ON lexical.workspace_id=item.workspace_id AND lexical.policy_revision=$5::int
    AND lexical.root_id=item.root_id AND lexical.matched
  WHERE item.workspace_id=$1 AND item.map_id=$2)`;

/** Measures a round without calling any provider: acceptance per topic, possible
 * twins, and roots about the category that no topic accepted. */
export async function measureSignalListeningRoundV1(database: Database, cycle: SignalListeningCycleV1, round: Pick<SignalListeningRoundV1, "id" | "round_no">,
  /** How the classifier shared out the posts of the pairs it was asked to settle in this round. */
  pair_choices: SignalListeningPairChoiceV1[] = []) {
  const policy = cycle.policy, base = [cycle.workspace_id, cycle.base_map_id, round.id, policy.approval];
  const client = await database.connect();
  try {
    await client.query("BEGIN"); await client.query("SET TRANSACTION READ ONLY");
    const population = (await client.query<{ roots: number; category_roots: number; orphan_roots: number; orphan_roots_probable: number }>(`WITH ${VALID}, ${CATEGORY}
      SELECT (SELECT count(*)::int FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2) roots,
        (SELECT count(*)::int FROM category) category_roots,
        (SELECT count(*)::int FROM category WHERE NOT EXISTS(SELECT 1 FROM valid WHERE valid.root_id=category.root_id AND valid.ok)) orphan_roots,
        (SELECT count(*)::int FROM category WHERE NOT EXISTS(SELECT 1 FROM valid WHERE valid.root_id=category.root_id AND valid.probability>=$6::real)) orphan_roots_probable`,
      [...base, cycle.lexicon_revision, policy.probable ?? policy.approval])).rows[0]!;
    const topics = (await client.query<{ topic_key: string; asked: number; approved: number }>(`WITH ${VALID}
      SELECT topic.topic_key,count(valid.root_id)::int asked,count(valid.root_id) FILTER (WHERE valid.ok)::int approved
      FROM signal_listening_round_topics topic LEFT JOIN valid USING(topic_key) WHERE topic.round_id=$3 GROUP BY 1 ORDER BY 1`, base)).rows;
    const examples = (await client.query<{ topic_key: string; ok: boolean; excerpt: string }>(`WITH ${VALID}, ranked AS (
        SELECT valid.topic_key,valid.ok,valid.root_id,row_number() OVER (PARTITION BY valid.topic_key,valid.ok ORDER BY md5(valid.root_id::text||valid.topic_key)) position FROM valid)
      SELECT ranked.topic_key,ranked.ok,left(item.text,$5::int) excerpt FROM ranked
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.root_id=ranked.root_id WHERE ranked.position<=$6::int ORDER BY 1,2,ranked.position`,
      [...base, policy.excerpt_chars, policy.examples_per_stratum])).rows;
    const pairs = (await client.query<{ left_key: string; right_key: string; jointly_asked: number; jointly_approved: number; left_approved: number; right_approved: number }>(
      `WITH ${VALID}, per AS (SELECT topic_key,count(*) FILTER (WHERE ok)::int approved FROM valid GROUP BY 1),
        joint AS (SELECT a.topic_key left_key,b.topic_key right_key,count(*)::int jointly_asked,count(*) FILTER (WHERE a.ok AND b.ok)::int jointly_approved
          FROM valid a JOIN valid b ON b.root_id=a.root_id AND b.topic_key>a.topic_key GROUP BY 1,2)
      SELECT joint.*,l.approved left_approved,r.approved right_approved FROM joint JOIN per l ON l.topic_key=joint.left_key JOIN per r ON r.topic_key=joint.right_key
      WHERE joint.jointly_asked>=$5::int AND joint.jointly_approved>=$6::int`, [...base, policy.twin.min_jointly_asked, policy.twin.min_jointly_approved])).rows;
    const twins = pairs.map(pair => {
      const union = pair.left_approved + pair.right_approved - pair.jointly_approved;
      return { left: pair.left_key, right: pair.right_key, jointly_asked: pair.jointly_asked, jointly_approved: pair.jointly_approved,
        jaccard: union ? pair.jointly_approved / union : 0, coapproval: pair.jointly_approved / pair.jointly_asked,
        overlap: pair.jointly_approved / Math.max(1, Math.min(pair.left_approved, pair.right_approved)) };
    }).filter(pair => pair.jaccard >= policy.twin.jaccard || pair.coapproval >= policy.twin.coapproval || pair.overlap >= policy.twin.overlap_of_smaller)
      .sort((a, b) => b.jaccard - a.jaccard || b.jointly_approved - a.jointly_approved || a.left.localeCompare(b.left)).slice(0, policy.twin.max_pairs);
    const lefts = twins.map(pair => pair.left), rights = twins.map(pair => pair.right);
    const twinRoots = twins.length ? (await client.query<{ roots: number }>(`WITH ${VALID}, ${CATEGORY}
      SELECT count(DISTINCT a.root_id)::int roots FROM unnest($6::text[],$7::text[]) pair(left_key,right_key)
      JOIN valid a ON a.topic_key=pair.left_key AND a.ok JOIN valid b ON b.topic_key=pair.right_key AND b.ok AND b.root_id=a.root_id
      JOIN category ON category.root_id=a.root_id`, [...base, cycle.lexicon_revision, lefts, rights])).rows[0]!.roots : 0;
    const twinExamples = twins.length ? (await client.query<{ left_key: string; right_key: string; excerpt: string }>(`WITH ${VALID}, accepted_by_both AS (
        SELECT pair.left_key,pair.right_key,a.root_id,row_number() OVER (PARTITION BY pair.left_key,pair.right_key ORDER BY md5(a.root_id::text||pair.left_key)) position
        FROM unnest($6::text[],$7::text[]) pair(left_key,right_key)
        JOIN valid a ON a.topic_key=pair.left_key AND a.ok JOIN valid b ON b.topic_key=pair.right_key AND b.ok AND b.root_id=a.root_id)
      SELECT accepted_by_both.left_key,accepted_by_both.right_key,left(item.text,$5::int) excerpt FROM accepted_by_both
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.root_id=accepted_by_both.root_id WHERE accepted_by_both.position<=3`, [...base, policy.excerpt_chars, lefts, rights])).rows : [];
    await client.query("COMMIT");
    const evidence: SignalListeningCycleEvidenceV1 = { round: round.round_no, roots: population.roots, category_roots: population.category_roots,
      orphan_roots: population.orphan_roots, orphan_rate: population.category_roots ? population.orphan_roots / population.category_roots : null,
      ...(policy.probable === undefined ? {} : { orphan_roots_probable: population.orphan_roots_probable,
        orphan_rate_probable: population.category_roots ? population.orphan_roots_probable / population.category_roots : null }),
      ...(pair_choices.length ? { pair_choices } : {}),
      twin_roots: twinRoots, twin_root_rate: population.category_roots ? twinRoots / population.category_roots : null,
      topics: topics.map(topic => ({ topic_key: topic.topic_key, asked: topic.asked, approved: topic.approved, acceptance: topic.asked ? topic.approved / topic.asked : null,
        accepted_examples: examples.filter(row => row.topic_key === topic.topic_key && row.ok).map(row => row.excerpt),
        rejected_examples: examples.filter(row => row.topic_key === topic.topic_key && !row.ok).map(row => row.excerpt) })),
      twins: twins.map(({ overlap: _overlap, ...pair }) => ({ ...pair,
        examples: twinExamples.filter(row => row.left_key === pair.left && row.right_key === pair.right).map(row => row.excerpt) })) };
    await database.query("UPDATE signal_listening_rounds SET evidence=$2::jsonb,step='measured',updated_at=now() WHERE id=$1 AND step='asked'", [round.id, JSON.stringify(evidence)]);
    return evidence;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Roots about the category that no topic of the round accepted. Identifiers only: one pass over the answers. */
export async function listSignalListeningOrphanRootsV1(database: Database, cycle: SignalListeningCycleV1, round: Pick<SignalListeningRoundV1, "id">): Promise<string[]> {
  return (await database.query<{ root_id: string }>(`WITH ${VALID}, ${CATEGORY}, accepted AS MATERIALIZED (SELECT DISTINCT root_id FROM valid WHERE ok)
    SELECT category.root_id FROM category LEFT JOIN accepted USING(root_id) WHERE accepted.root_id IS NULL ORDER BY 1`,
    [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval, cycle.lexicon_revision])).rows.map(row => row.root_id);
}
/** The classified fragment of each given root and its vector. */
export async function readSignalListeningRootVectorsV1(database: Database, cycle: SignalListeningCycleV1, root_ids: string[]) {
  return (await database.query<{ root_id: string; excerpt: string; vector: number[] }>(`SELECT item.root_id,left(item.text,$4::int) excerpt,embedding.embedding::real[] vector
    FROM signal_mass_labeling_items item
    JOIN signal_mass_labeling_maps map ON map.id=item.map_id AND map.workspace_id=item.workspace_id
    JOIN signal_workspace_chunk_embeddings embedding ON embedding.workspace_id=item.workspace_id AND embedding.config_digest=map.embedding_config_digest
      AND embedding.chunk_sha256=item.chunk_sha256
    WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=ANY($3::uuid[]) ORDER BY item.root_id`,
    [cycle.workspace_id, cycle.base_map_id, root_ids, cycle.policy.excerpt_chars])).rows;
}
export async function saveSignalListeningOrphanGroupsV1(database: Database, round: Pick<SignalListeningRoundV1, "id">, groups: SignalListeningStoredOrphanGroupV1[]) {
  await database.query("UPDATE signal_listening_rounds SET orphan_groups=$2::jsonb,step='regrouped',updated_at=now() WHERE id=$1 AND step='measured'",
    [round.id, JSON.stringify(groups)]);
}

/** One confirmed centroid per topic of a measured round. */
export type SignalListeningConfirmedCentroidsV1 = Map<string, { members: number; centroid: number[] }>;
/**
 * The mean vector of the roots each topic of the round accepted. Read in pages
 * and summed here: one statement over every confirmed root does not fit in the
 * statement timeout of a real brand.
 */
export async function readSignalListeningConfirmedCentroidsV1(database: Database, cycle: SignalListeningCycleV1, round: Pick<SignalListeningRoundV1, "id">,
  heartbeat: () => Promise<void> = async () => undefined, page_size = 500): Promise<SignalListeningConfirmedCentroidsV1> {
  const accepted = (await database.query<{ root_id: string; topic_keys: string[] }>(`WITH ${VALID}
    SELECT root_id,array_agg(topic_key ORDER BY topic_key) topic_keys FROM valid WHERE ok GROUP BY 1 ORDER BY 1`,
    [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval])).rows;
  const sums = new Map<string, { members: number; sum: Float64Array }>();
  for (let from = 0; from < accepted.length; from += page_size) {
    const page = accepted.slice(from, from + page_size), topics = new Map(page.map(row => [row.root_id, row.topic_keys]));
    for (const row of await readSignalListeningRootVectorsV1(database, cycle, page.map(item => item.root_id))) {
      for (const topic_key of topics.get(row.root_id) ?? []) {
        let entry = sums.get(topic_key);
        if (!entry) sums.set(topic_key, entry = { members: 0, sum: new Float64Array(row.vector.length) });
        // A root without a vector of the map's size cannot move a centroid.
        if (entry.sum.length !== row.vector.length) continue;
        for (let d = 0; d < entry.sum.length; d++) entry.sum[d]! += row.vector[d]!;
        entry.members += 1;
      }
    }
    await heartbeat();
  }
  return new Map([...sums].map(([topic_key, entry]) => [topic_key, { members: entry.members, centroid: Array.from(entry.sum, value => value / entry.members) }]));
}

/**
 * Stores the review and opens the next round with the reviewed map. Each topic
 * of the new round gets the centroid of the roots that were confirmed for it
 * (or for the topics merged into it); a new topic gets the centroid of the
 * orphan groups that support it.
 */
export async function openSignalListeningNextRoundV1(args: { database: Database; cycle: SignalListeningCycleV1; round: SignalListeningRoundV1;
  catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[]; review: Record<string, unknown>;
  /** Confirmed members of every topic of the measured round, so merges can be weighted. */
  confirmed: SignalListeningConfirmedCentroidsV1;
  /** A last round with no review: it only asks what the merges of the rule left pending. Opened right after measuring. */
  settling?: boolean;
  /** Pairs accepted together very often that are still two topics: the posts both hold are asked to choose. */
  pairs?: Array<{ left: string; right: string; jaccard?: number | null }> }): Promise<{ round_id: string }> {
  const { cycle, round, confirmed } = args, configuration = await readSignalListeningCycleConfigurationV1(args.database, cycle);
  return shared.transaction(args.database, async client => {
    const owned = (await client.query("SELECT 1 FROM signal_listening_cycles WHERE id=$1 AND lease_token=$2 FOR UPDATE", [cycle.id, cycle.lease_token])).rows.length;
    if (!owned) throw new Error("listening_cycle_lease_lost");
    await client.query("UPDATE signal_listening_rounds SET review=$2::jsonb,step='reviewed',updated_at=now() WHERE id=$1 AND step=$3",
      [round.id, JSON.stringify(args.review), args.settling ? "measured" : "regrouped"]);
    const existing = (await client.query<{ id: string }>("SELECT id FROM signal_listening_rounds WHERE cycle_id=$1 AND round_no=$2", [cycle.id, round.round_no + 1])).rows[0];
    if (existing) return { round_id: existing.id };
    const previous = new Map((await client.query<{ topic_key: string; centroid: string | null }>(
      "SELECT topic_key,centroid::text centroid FROM signal_listening_round_topics WHERE round_id=$1", [round.id])).rows.map(row => [row.topic_key, row.centroid]));
    const groups = new Map((round.orphan_groups ?? []).map(group => [group.group_key, group]));
    const centroids = new Map<string, { vector: string; members: number }>();
    for (const topic of args.catalog) {
      const sources = topic.source_topic_keys.length ? topic.source_topic_keys : [topic.topic_key];
      const parts: Array<{ weight: number; vector: number[] }> = [
        ...sources.flatMap(source => confirmed.has(source) ? [{ weight: confirmed.get(source)!.members, vector: confirmed.get(source)!.centroid }] : []),
        ...topic.orphan_group_keys.flatMap(group => groups.has(group) ? [{ weight: groups.get(group)!.roots, vector: groups.get(group)!.centroid }] : [])];
      if (parts.length) {
        const total = parts.reduce((sum, part) => sum + part.weight, 0), mean = new Float64Array(parts[0]!.vector.length);
        for (const part of parts) for (let d = 0; d < mean.length; d++) mean[d]! += part.vector[d]! * part.weight / total;
        centroids.set(topic.topic_key, { vector: vectorText(mean), members: sources.reduce((sum, source) => sum + (confirmed.get(source)?.members ?? 0), 0) });
      } else {
        // Nobody was confirmed for it yet: it keeps the centroid it had, so it can still be a candidate.
        const fallback = sources.map(source => previous.get(source)).find(Boolean);
        if (fallback) centroids.set(topic.topic_key, { vector: fallback, members: 0 });
      }
    }
    const round_id = randomUUID();
    await client.query(`INSERT INTO signal_listening_rounds(id,cycle_id,workspace_id,round_no,step,catalog,themes,review)
      VALUES($1,$2,$3,$4,'created',$5::jsonb,$6::jsonb,$7::jsonb)`,
      [round_id, cycle.id, cycle.workspace_id, round.round_no + 1, JSON.stringify(args.catalog), JSON.stringify(args.themes), args.settling ? '{"settling":true}' : null]);
    await writeRoundTopics(client, { id: round_id, workspace_id: cycle.workspace_id }, configuration, args.catalog, centroids);
    await writeRoundPairs(client, { id: round_id, workspace_id: cycle.workspace_id }, configuration, args.catalog, args.pairs ?? []);
    return { round_id };
  });
}
/** Records a review that changed nothing: the map stays and no new round is opened. */
export async function saveSignalListeningReviewV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">,
  round: Pick<SignalListeningRoundV1, "id">, review: Record<string, unknown>,
  placement: { catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[] }) {
  await shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_listening_cycles WHERE id=$1 AND lease_token=$2 FOR UPDATE", [cycle.id, cycle.lease_token])).rows.length) {
      throw new Error("listening_cycle_lease_lost");
    }
    await client.query(`UPDATE signal_listening_rounds SET review=$2::jsonb,catalog=$3::jsonb,themes=$4::jsonb,step='reviewed',updated_at=now()
      WHERE id=$1 AND step='regrouped'`, [round.id, JSON.stringify(review), JSON.stringify(placement.catalog), JSON.stringify(placement.themes)]);
  });
}
/** Counts a review attempt before the provider is called, so a round that keeps dying cannot keep paying. */
export async function beginSignalListeningReviewV1(database: Database, round: Pick<SignalListeningRoundV1, "id">): Promise<number> {
  return (await database.query<{ attempts: number }>(`UPDATE signal_listening_rounds SET review=jsonb_set(COALESCE(review,'{}'::jsonb),'{attempts}',
    to_jsonb(COALESCE((review->>'attempts')::int,0)+1)),updated_at=now() WHERE id=$1 AND step='regrouped' RETURNING (review->>'attempts')::int attempts`, [round.id])).rows[0]?.attempts ?? 0;
}
/** Stores the answer of a review and charges it, in one small transaction, before anything is built on it.
 * A restart then applies the stored answer instead of paying for another one. */
export async function recordSignalListeningReviewAnswerV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">,
  round: Pick<SignalListeningRoundV1, "id">, answer: Record<string, unknown>, cost_micro_usd: number) {
  await shared.transaction(database, async client => {
    if (!(await client.query("SELECT 1 FROM signal_listening_cycles WHERE id=$1 AND lease_token=$2 FOR UPDATE", [cycle.id, cycle.lease_token])).rows.length) {
      throw new Error("listening_cycle_lease_lost");
    }
    const stored = await client.query(`UPDATE signal_listening_rounds SET review=COALESCE(review,'{}'::jsonb)||jsonb_build_object('answer',$2::jsonb),updated_at=now()
      WHERE id=$1 AND step='regrouped' AND NOT COALESCE(review,'{}'::jsonb) ? 'answer'`, [round.id, JSON.stringify(answer)]);
    if (stored.rowCount === 1) await client.query("UPDATE signal_listening_cycles SET spent_micro_usd=spent_micro_usd+$2,updated_at=now() WHERE id=$1",
      [cycle.id, Math.ceil(cost_micro_usd)]);
  });
}

export type SignalListeningRoundPlanV1 = { planner: "topics_round_v1"; round_id: string; input_usd_per_mtok: number };
/** Queues the JEV pass of a round: every root is asked its closest topics, and only those it was never asked. */
export async function requestSignalListeningRoundRunV1(database: Database, cycle: SignalListeningCycleV1, round: Pick<SignalListeningRoundV1, "id">, cap_micro_usd: number) {
  return shared.transaction(database, async client => {
    const current = (await client.query<{ run_id: string | null }>("SELECT run_id FROM signal_listening_rounds WHERE id=$1 FOR UPDATE", [round.id])).rows[0];
    if (current?.run_id) return { run_id: current.run_id };
    const plan: SignalListeningRoundPlanV1 = { planner: "topics_round_v1", round_id: round.id, input_usd_per_mtok: SIGNAL_LISTENING_DEFAULT_PRICE_V1 };
    const run_id = randomUUID();
    await client.query(`INSERT INTO signal_listening_runs(id,workspace_id,kind,plan,cap_micro_usd) VALUES($1,$2,'topics_round',$3::jsonb,$4)`,
      [run_id, cycle.workspace_id, JSON.stringify(plan), Math.max(1, Math.floor(cap_micro_usd))]);
    await client.query("UPDATE signal_listening_rounds SET run_id=$2,updated_at=now() WHERE id=$1", [round.id, run_id]);
    return { run_id };
  });
}
/** Looks at the JEV pass of a round. When it finished, the round moves on and its cost is added to the cycle, once. */
export async function settleSignalListeningRoundRunV1(database: Database, cycle: Pick<SignalListeningCycleV1, "id" | "lease_token">,
  round: Pick<SignalListeningRoundV1, "id" | "run_id">): Promise<{ status: SignalListeningRunV1["status"]; spent_micro_usd: number; roots_done: number }> {
  return shared.transaction(database, async client => {
    const run = (await client.query<{ status: SignalListeningRunV1["status"]; spent_micro_usd: number; roots_done: number }>(
      "SELECT status,spent_micro_usd::float8 spent_micro_usd,roots_done FROM signal_listening_runs WHERE id=$1", [round.run_id])).rows[0];
    if (!run) throw new Error("listening_round_run_unavailable");
    if (run.status === "queued" || run.status === "running") return run;
    if (!(await client.query("SELECT 1 FROM signal_listening_cycles WHERE id=$1 AND lease_token=$2 FOR UPDATE", [cycle.id, cycle.lease_token])).rows.length) {
      throw new Error("listening_cycle_lease_lost");
    }
    // What the pass spent is charged once it stops, whether it finished or not.
    const settled = await client.query(`UPDATE signal_listening_rounds SET review=COALESCE(review,'{}'::jsonb)||'{"run_charged":true}'::jsonb,
      step=CASE WHEN $2::boolean THEN 'asked' ELSE step END,updated_at=now() WHERE id=$1 AND step='created' AND NOT COALESCE(review,'{}'::jsonb) ? 'run_charged'`,
      [round.id, run.status === "completed"]);
    if (settled.rowCount === 1) await client.query("UPDATE signal_listening_cycles SET spent_micro_usd=spent_micro_usd+$2,updated_at=now() WHERE id=$1",
      [cycle.id, Math.ceil(run.spent_micro_usd)]);
    return run;
  });
}

type RoundRow = { ordinal: number; root_id: string; input_digest: string; text: string; candidates: string[] | null };
/** Source of a `topics_round_v1` run. Candidates are the closest topics of the
 * round by vector; cached answers for the same text are never asked again. */
export async function createSignalListeningRoundSourceV1(database: Database, run: Pick<SignalListeningRunV1, "id" | "workspace_id" | "plan">) {
  const plan = run.plan as unknown as SignalListeningRoundPlanV1;
  if (plan.planner !== "topics_round_v1" || !uuid.test(plan.round_id) || !Number.isFinite(plan.input_usd_per_mtok) || plan.input_usd_per_mtok <= 0) {
    throw new Error("listening_plan_invalid");
  }
  const scope = (await database.query<{ base_map_id: string; configuration_id: string; policy: SignalListeningCyclePolicyV1; catalog: SignalListeningCatalogTopicV1[]; workspace_id: string;
    previous_round_id: string | null; review: Record<string, unknown> | null }>(
    `SELECT cycle.base_map_id,cycle.configuration_id,cycle.policy,round.catalog,cycle.workspace_id,round.review,
       (SELECT earlier.id FROM signal_listening_rounds earlier WHERE earlier.cycle_id=round.cycle_id AND earlier.round_no=round.round_no-1) previous_round_id
     FROM signal_listening_rounds round
     JOIN signal_listening_cycles cycle ON cycle.id=round.cycle_id WHERE round.id=$1 AND round.workspace_id=$2`, [plan.round_id, run.workspace_id])).rows[0];
  if (!scope) throw new Error("listening_plan_unavailable");
  // A topic that was redefined, or that took another one in, is asked of every root its sources held:
  // being close to its centre is not the only reason to ask.
  const heirs = new Map<string, string[]>();
  for (const topic of scope.catalog) for (const source of topic.source_topic_keys) heirs.set(source, [...(heirs.get(source) ?? []), topic.topic_key]);
  const configuration = await readSignalListeningCycleConfigurationV1(database, scope);
  const questions = new Map(validateSignalListeningCatalogV1(scope.catalog).map(topic => [topic.topic_key, topicQuestion(configuration, topic)]));
  const ids = new Map((await database.query<{ topic_key: string; question_id: string }>(
    "SELECT topic_key,question_id::text FROM signal_listening_round_topics WHERE round_id=$1", [plan.round_id])).rows.map(row => [row.topic_key, Number(row.question_id)]));
  // Pairs the classifier settles: asked only of the posts both topics held in the previous round.
  const byKey = new Map(scope.catalog.map(topic => [topic.topic_key, topic]));
  const pairs = roundPairs(scope).flatMap(pair => byKey.has(pair.left) && byKey.has(pair.right)
    ? [{ ...pair, question: pairQuestion(configuration, byKey.get(pair.left)!, byKey.get(pair.right)!) }] : []);
  const watched = [...new Set([...heirs.keys(), ...pairs.flatMap(pair => [pair.left, pair.right])])];
  let cursor = 0;
  return {
    model: configuration.model, input_usd_per_mtok: plan.input_usd_per_mtok,
    rewind() { cursor = 0; },
    async next(limit: number): Promise<SignalListeningItemV1[]> {
      for (;;) {
        const rows = (await database.query<RoundRow>(`SELECT item.ordinal,item.root_id,item.input_digest,item.text,
            (SELECT array_agg(closest.topic_key ORDER BY closest.distance,closest.topic_key) FROM (
              SELECT topic.topic_key,topic.centroid <=> embedding.embedding distance FROM signal_listening_round_topics topic
              WHERE topic.round_id=$5 AND topic.centroid IS NOT NULL AND embedding.embedding IS NOT NULL ORDER BY 2,1 LIMIT $6) closest) candidates
          FROM signal_mass_labeling_items item
          JOIN signal_mass_labeling_maps map ON map.id=item.map_id AND map.workspace_id=item.workspace_id
          LEFT JOIN signal_workspace_chunk_embeddings embedding ON embedding.workspace_id=item.workspace_id AND embedding.config_digest=map.embedding_config_digest
            AND embedding.chunk_sha256=item.chunk_sha256
          WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.ordinal>$3 ORDER BY item.ordinal LIMIT $4`,
          [run.workspace_id, scope.base_map_id, cursor, limit, plan.round_id, scope.policy.candidates_per_root])).rows;
        if (!rows.length) return [];
        cursor = rows.at(-1)!.ordinal;
        const digests = new Map(rows.map(row => [row.root_id, row.input_digest]));
        const answered = new Map<string, Set<number>>();
        for (const answer of (await database.query<{ root_id: string; question_id: string; input_sha: string }>(
          `SELECT root_id,question_id::text,encode(input_sha,'hex') input_sha FROM signal_listening_answers
           WHERE workspace_id=$1 AND root_id=ANY($2::uuid[]) AND question_id=ANY($3::bigint[])`,
          [run.workspace_id, rows.map(row => row.root_id), [...ids.values(), ...pairs.map(pair => pair.question_id)]])).rows) {
          if (`sha256:${answer.input_sha}` !== digests.get(answer.root_id)) continue;
          const set = answered.get(answer.root_id); if (set) set.add(Number(answer.question_id)); else answered.set(answer.root_id, new Set([Number(answer.question_id)]));
        }
        // What each root held in the previous round, among the topics that matter here.
        const held = new Map<string, Set<string>>();
        if (watched.length && scope.previous_round_id) {
          for (const member of (await database.query<{ root_id: string; topic_key: string }>(`SELECT answer.root_id,topic.topic_key FROM signal_listening_round_topics topic
            JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1 AND answer.root_id=ANY($2::uuid[])
            LEFT JOIN signal_listening_answer_overrides decided ON decided.question_id=topic.question_id AND decided.root_id=answer.root_id AND decided.input_sha=answer.input_sha
            WHERE topic.round_id=$3 AND topic.topic_key=ANY($5::text[]) AND COALESCE(decided.belongs,answer.probability>=$4::real)`,
            [run.workspace_id, rows.map(row => row.root_id), scope.previous_round_id, scope.policy.approval, watched])).rows) {
            const set = held.get(member.root_id); if (set) set.add(member.topic_key); else held.set(member.root_id, new Set([member.topic_key]));
          }
        }
        const items: SignalListeningItemV1[] = [];
        for (const row of rows) {
          const before = held.get(row.root_id), done = answered.get(row.root_id);
          const inherited = [...(before ?? [])].flatMap(source => heirs.get(source) ?? []);
          const pending = [...new Set([...(row.candidates ?? []), ...inherited])]
            .filter(topic_key => questions.has(topic_key) && ids.has(topic_key) && !done?.has(ids.get(topic_key)!));
          const choosing = pairs.filter(pair => before?.has(pair.left) && before.has(pair.right) && !done?.has(pair.question_id));
          if (!pending.length && !choosing.length) continue;
          const asked = [...pending.map(topic_key => questions.get(topic_key)!), ...choosing.map(pair => pair.question)].map((question, index) => ({ ...question, request_key: `q${index}` }));
          items.push({ root_id: row.root_id, input_digest: row.input_digest, questions: asked,
            request: { model: configuration.model, state: row.text, questions: Object.fromEntries(asked.map(question => [question.request_key, question.wire])) } });
        }
        if (items.length) return items;
      }
    },
  };
}

/** Shared with the reader of the reviewed map. */
export const signalListeningCycleInternalsV1 = { VALID };
