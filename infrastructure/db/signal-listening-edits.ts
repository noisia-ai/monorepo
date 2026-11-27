import type { Pool, PoolClient } from "pg";
import type { SignalListeningCatalogTopicV1, SignalListeningCyclePolicyV1, SignalListeningThemeV1 } from "@noisia/query-engine";
import { SignalLabelingError } from "./signal-labeling-runs";
import { signalListeningInternalsV1 as shared } from "./signal-listening-configuration";
import { signalListeningCycleInternalsV1 as cycles } from "./signal-listening-cycle";

/**
 * The reviewed map as people see it, and their corrections to it. A correction
 * is an appended row, never a rewrite: the latest one for a mention and a topic
 * wins over the classifier, and a merge folds one topic into another. No
 * correction is needed for anything to advance.
 */

type Database = Pick<Pool, "connect" | "query">;
type Queryable = Pick<PoolClient, "query">;
type Access = { database: Database; workspace_id: string; actor_user_id: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu, topicKey = /^[a-z][a-z0-9_]{0,119}$/u;
function fail(code: string, status = 409): never { throw new SignalLabelingError(code, status); }

type FinalMap = { cycle_id: string; base_map_id: string; policy: SignalListeningCyclePolicyV1; completed_at: string; round_id: string; round_no: number;
  catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[];
  /** Topics a person folded into another one: source → the topic that holds its mentions now. */
  merged: Map<string, string> };
/** The last finished discovery cycle of the brand and the merges people made on its map. */
async function finalMap(client: Queryable, workspace_id: string): Promise<FinalMap | null> {
  const cycle = (await client.query<{ id: string; base_map_id: string; policy: SignalListeningCyclePolicyV1; completed_at: string }>(`SELECT id,base_map_id,policy,completed_at::text
    FROM signal_listening_cycles WHERE workspace_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 1`, [workspace_id])).rows[0];
  if (!cycle) return null;
  const round = (await client.query<{ id: string; round_no: number; catalog: SignalListeningCatalogTopicV1[]; themes: SignalListeningThemeV1[] }>(
    "SELECT id,round_no,catalog,themes FROM signal_listening_rounds WHERE cycle_id=$1 ORDER BY round_no DESC LIMIT 1", [cycle.id])).rows[0];
  if (!round) return null;
  const known = new Set(round.catalog.map(topic => topic.topic_key)), direct = new Map<string, string>();
  for (const row of (await client.query<{ source: string | null; target: string }>(`SELECT payload->>'source_topic_key' source,topic_key target FROM signal_listening_human_edits
    WHERE workspace_id=$1 AND operation='merge_topics' ORDER BY created_at,id`, [workspace_id])).rows) {
    // A later merge of the same topic replaces the earlier one.
    if (row.source && row.source !== row.target && known.has(row.source) && known.has(row.target)) direct.set(row.source, row.target);
  }
  const merged = new Map<string, string>();
  for (const source of direct.keys()) {
    let target = direct.get(source)!;
    for (let hop = 0; direct.has(target) && hop < 64; hop++) target = direct.get(target)!;
    if (target !== source && !direct.has(target)) merged.set(source, target);
  }
  return { cycle_id: cycle.id, base_map_id: cycle.base_map_id, policy: cycle.policy, completed_at: cycle.completed_at, round_id: round.id, round_no: round.round_no,
    catalog: round.catalog, themes: round.themes, merged };
}
const pairs = (merged: Map<string, string>) => [[...merged.keys()], [...merged.values()]] as const;
/**
 * Who belongs to which topic once corrections are applied. Parameters: $1 the
 * workspace, $2 the map, $3 the round, $4 the approval threshold, $5 and $6 the
 * merged topics and where they went.
 */
const EFFECTIVE = `${cycles.VALID}, merged AS (SELECT * FROM unnest($5::text[],$6::text[]) folded(source,target)),
  classified AS (SELECT DISTINCT valid.root_id,COALESCE(merged.target,valid.topic_key) topic_key FROM valid LEFT JOIN merged ON merged.source=valid.topic_key WHERE valid.ok),
  corrections AS (
    SELECT DISTINCT ON (edit.root_id,COALESCE(merged.target,edit.topic_key)) edit.root_id,COALESCE(merged.target,edit.topic_key) topic_key,edit.operation
    FROM signal_listening_human_edits edit LEFT JOIN merged ON merged.source=edit.topic_key
    WHERE edit.workspace_id=$1 AND edit.operation IN('remove_label','add_label') ORDER BY 1,2,edit.created_at DESC,edit.id DESC),
  effective AS (
    SELECT classified.root_id,classified.topic_key,false by_person FROM classified
    WHERE NOT EXISTS(SELECT 1 FROM corrections WHERE corrections.root_id=classified.root_id AND corrections.topic_key=classified.topic_key)
    UNION ALL
    SELECT corrections.root_id,corrections.topic_key,true FROM corrections
    JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=corrections.root_id WHERE corrections.operation='add_label')`;

export type SignalListeningMapV1 = {
  contract_version: "signal-listening-map-v1"; workspace_id: string; cycle_id: string | null; round: number | null; completed_at: string | null;
  /** Whether this person may correct mentions and merge topics. */
  can_edit: boolean;
  themes: Array<{ theme_key: string | null; name: { original: string; en: string; es: string } | null;
    topics: Array<{ topic_key: string; name: { original: string; en: string; es: string }; definition: { original: string; en: string; es: string };
      domain: "category" | "adjacent" | "outside"; mentions: number;
      /** Probable members: below the confirmation line, kept and not counted in `mentions`. */
      probable_mentions: number;
      /** Topics a person folded into this one. */
      merged_from: string[] }> }>;
};
/** The map of the last finished discovery cycle: themes, their topics and how many mentions each holds after people's corrections. */
export async function readSignalListeningMapV1(access: Access): Promise<SignalListeningMapV1> {
  return shared.transaction(access.database, async client => {
    await client.query("SET TRANSACTION READ ONLY");
    const caps = await shared.authorize(client, access, "view");
    const empty: SignalListeningMapV1 = { contract_version: "signal-listening-map-v1", workspace_id: access.workspace_id, cycle_id: null, round: null, completed_at: null,
      can_edit: caps.can_edit_topics, themes: [] };
    const map = await finalMap(client, access.workspace_id);
    if (!map) return empty;
    const volumes = new Map((await client.query<{ topic_key: string; mentions: number }>(`WITH ${EFFECTIVE}
      SELECT topic_key,count(*)::int mentions FROM effective GROUP BY 1`, [access.workspace_id, map.base_map_id, map.round_id, map.policy.approval, ...pairs(map.merged)])).rows
      .map(row => [row.topic_key, row.mentions]));
    const probable = new Map(map.policy.probable === undefined ? [] : (await client.query<{ topic_key: string; mentions: number }>(`WITH ${EFFECTIVE}
      SELECT COALESCE(merged.target,valid.topic_key) topic_key,count(DISTINCT valid.root_id)::int mentions FROM valid LEFT JOIN merged ON merged.source=valid.topic_key
      WHERE NOT valid.ok AND valid.probability>=$7::real
        AND NOT EXISTS(SELECT 1 FROM effective WHERE effective.root_id=valid.root_id AND effective.topic_key=COALESCE(merged.target,valid.topic_key)) GROUP BY 1`,
      [access.workspace_id, map.base_map_id, map.round_id, map.policy.approval, ...pairs(map.merged), map.policy.probable])).rows.map(row => [row.topic_key, row.mentions]));
    const names = new Map(map.themes.map(item => [item.theme_key, item.name]));
    const grouped = new Map<string | null, SignalListeningMapV1["themes"][number]>();
    for (const topic of map.catalog) {
      if (map.merged.has(topic.topic_key)) continue;
      const theme_key = topic.theme_key !== null && names.has(topic.theme_key) ? topic.theme_key : null;
      if (!grouped.has(theme_key)) grouped.set(theme_key, { theme_key, name: theme_key === null ? null : names.get(theme_key)!, topics: [] });
      const { original, en, es } = topic.localization;
      grouped.get(theme_key)!.topics.push({ topic_key: topic.topic_key, name: { original: original.name, en: en.name, es: es.name },
        definition: { original: original.definition, en: en.definition, es: es.definition }, domain: topic.domain, mentions: volumes.get(topic.topic_key) ?? 0,
        probable_mentions: probable.get(topic.topic_key) ?? 0,
        merged_from: [...map.merged].filter(([, target]) => target === topic.topic_key).map(([source]) => source).sort() });
    }
    const total = (item: SignalListeningMapV1["themes"][number]) => item.topics.reduce((sum, topic) => sum + topic.mentions, 0);
    const themes = [...grouped.values()].map(item => ({ ...item, topics: item.topics.sort((a, b) => b.mentions - a.mentions || a.topic_key.localeCompare(b.topic_key)) }))
      .sort((a, b) => Number(a.theme_key === null) - Number(b.theme_key === null) || total(b) - total(a));
    return { ...empty, cycle_id: map.cycle_id, round: map.round_no, completed_at: map.completed_at, themes };
  });
}

export type SignalListeningTopicMentionsV1 = {
  contract_version: "signal-listening-topic-mentions-v1"; workspace_id: string; topic_key: string; total: number;
  mentions: Array<{ root_id: string; text: string; url: string | null; platform: string | null; published_at: string | null;
    /** True when a person put this mention in the topic. */
    by_person: boolean }>;
};
/** Some mentions of one topic, so a person can read them and correct them. The ones a person added come first. */
export async function readSignalListeningTopicMentionsV1(access: Access & { topic_key: string; limit?: number;
  /** `probable` lists the members below the confirmation line instead of the confirmed ones. */
  level?: "confirmed" | "probable" }): Promise<SignalListeningTopicMentionsV1> {
  const limit = access.limit ?? 30, level = access.level ?? "confirmed";
  if (!topicKey.test(access.topic_key) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("listening_request_invalid", 422);
  return shared.transaction(access.database, async client => {
    await client.query("SET TRANSACTION READ ONLY");
    await shared.authorize(client, access, "view");
    const map = await finalMap(client, access.workspace_id);
    if (!map || map.merged.has(access.topic_key) || !map.catalog.some(topic => topic.topic_key === access.topic_key)) fail("listening_topic_unavailable", 404);
    // Only this topic and the ones folded into it are read: the whole map is not needed to show one topic.
    const keys = [access.topic_key, ...[...map.merged].filter(([, target]) => target === access.topic_key).map(([source]) => source)];
    const rows = (await client.query<SignalListeningTopicMentionsV1["mentions"][number] & { total: number }>(`WITH classified AS (
        SELECT answer.root_id FROM signal_listening_round_topics topic
        JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1
        JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=answer.root_id
          AND answer.input_sha=decode(substr(item.input_digest,8),'hex')
        WHERE topic.round_id=$3 AND topic.topic_key=ANY($5::text[]) GROUP BY 1
        -- Confirmed: some question of the topic reaches the line. Probable: none does, and some reaches the lower one.
        HAVING CASE WHEN $7::real IS NULL THEN max(answer.probability)>=$4::real ELSE max(answer.probability)<$4::real AND max(answer.probability)>=$7::real END),
      corrections AS (SELECT DISTINCT ON (root_id) root_id,operation FROM signal_listening_human_edits
        WHERE workspace_id=$1 AND topic_key=ANY($5::text[]) AND operation IN('remove_label','add_label') ORDER BY root_id,created_at DESC,id DESC),
      effective AS (
        SELECT root_id,false by_person FROM classified WHERE NOT EXISTS(SELECT 1 FROM corrections WHERE corrections.root_id=classified.root_id)
        UNION ALL SELECT corrections.root_id,true FROM corrections
        JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=corrections.root_id
        WHERE corrections.operation='add_label' AND $7::real IS NULL),
      -- The few that are shown are chosen first; texts and links are read only for them.
      chosen AS MATERIALIZED (SELECT root_id,by_person,count(*) OVER()::int total FROM effective ORDER BY by_person DESC,md5(root_id::text) LIMIT $6)
      SELECT chosen.root_id,chosen.by_person,chosen.total,left(item.text,600) text,mention.url,mention.platform,mention.published_at::text
      FROM chosen JOIN signal_mass_labeling_items item ON item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=chosen.root_id
      JOIN mentions mention ON mention.workspace_id=$1 AND mention.id=chosen.root_id
      ORDER BY chosen.by_person DESC,md5(chosen.root_id::text)`,
      [access.workspace_id, map.base_map_id, map.round_id, map.policy.approval, keys, limit, level === "probable" ? map.policy.probable ?? map.policy.approval : null])).rows;
    return { contract_version: "signal-listening-topic-mentions-v1", workspace_id: access.workspace_id, topic_key: access.topic_key, total: rows[0]?.total ?? 0,
      mentions: rows.map(({ total: _total, ...row }) => row) };
  });
}

export type SignalListeningHumanEditV1 = { operation: "remove_label"; topic_key: string; root_id: string }
  | { operation: "move_label"; root_id: string; from_topic_key: string; to_topic_key: string }
  | { operation: "merge_topics"; source_topic_key: string; target_topic_key: string };
/**
 * Records a correction by a person: take a mention out of a topic, move it to
 * another one, or fold a topic into another. Corrections are appended; the map
 * and its numbers are read with them applied, and later discovery cycles leave
 * a merged topic as the person left it.
 */
export async function applySignalListeningHumanEditV1(access: Access & { edit: SignalListeningHumanEditV1 }) {
  const { edit } = access;
  return shared.transaction(access.database, async client => {
    await shared.lock(client, access.workspace_id);
    await shared.authorize(client, access, "edit");
    const map = await finalMap(client, access.workspace_id);
    if (!map) fail("listening_map_required");
    // Only topics the map shows today can be corrected: one that was folded into another is no longer there.
    const shown = (key: string) => topicKey.test(key) && !map.merged.has(key) && map.catalog.some(topic => topic.topic_key === key);
    const insert = (operation: string, topic_key: string, root_id: string | null, payload: Record<string, unknown>) => client.query(
      "INSERT INTO signal_listening_human_edits(workspace_id,operation,topic_key,root_id,payload,created_by_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [access.workspace_id, operation, topic_key, root_id, JSON.stringify({ ...payload, cycle_id: map.cycle_id }), access.actor_user_id]);
    if (edit.operation === "merge_topics") {
      if (edit.source_topic_key === edit.target_topic_key || !shown(edit.source_topic_key) || !shown(edit.target_topic_key)) fail("listening_edit_invalid", 422);
      await insert("merge_topics", edit.target_topic_key, null, { source_topic_key: edit.source_topic_key });
      return { applied: "merge_topics" as const };
    }
    if (!uuid.test(edit.root_id) || !(await client.query("SELECT 1 FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3",
      [access.workspace_id, map.base_map_id, edit.root_id])).rows.length) fail("listening_edit_invalid", 422);
    if (edit.operation === "remove_label") {
      if (!shown(edit.topic_key)) fail("listening_edit_invalid", 422);
      await insert("remove_label", edit.topic_key, edit.root_id, {});
      return { applied: "remove_label" as const };
    }
    if (edit.from_topic_key === edit.to_topic_key || !shown(edit.from_topic_key) || !shown(edit.to_topic_key)) fail("listening_edit_invalid", 422);
    // A move is the two corrections together: out of one topic and into the other.
    await insert("remove_label", edit.from_topic_key, edit.root_id, { moved_to: edit.to_topic_key });
    await insert("add_label", edit.to_topic_key, edit.root_id, { moved_from: edit.from_topic_key });
    return { applied: "move_label" as const };
  });
}
