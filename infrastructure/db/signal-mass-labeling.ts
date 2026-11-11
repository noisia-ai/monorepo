import { prepareMassLabelingMapScoresV1, insertMassLabelingMapItemsV1 } from "./signal-mass-labeling-map-sql";
import {loadMassLabelingStudyPolicyWithClientV1,massLabelingStudyInterestDigestV1} from "./signal-mass-labeling-study-policy";
import {massLabelingConfigurationV2} from "@noisia/query-engine";
import {MASS_LABELING_FUNDING_RECEIPT_SELECT_V1,type MassLabelingFundingReceiptV1} from "./signal-mass-labeling-funding";
import {massLabelingRequestPolicyWithClientV1,admitMassLabelingScopedWithClientV1,massLabelingRunPolicyWithClientV1} from "./signal-mass-labeling-scoped-policy";
import {createHash, randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {labelerDigestV1, signalWorkspaceEmbeddingDigestV1 as digest,
  buildMassLabelingConsolidationRequestV1,parseMassLabelingConsolidationResponseV1,type MassLabelingSourceGroupV1,
  type SignalWorkspaceInterpretationConfigurationV1,type SignalTopicLocalizationV1,type LabelerIdentity} from "@noisia/query-engine";
import {massLabelingJevIdentityV1, type MassLabelingInputV1, type MassLabelingResultV1} from "@noisia/query-engine/src/signal-mass-labeling-jev-v1";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";
import {inspectFacetContextChangeV1, type LabelingDatabaseV1} from "./signal-mention-facets";
import {createSignalLabelingStoreV1, requestMentionFacetsV1, SignalLabelingError,
  type LabelingRunV1} from "./signal-labeling-runs";
import {verifyMassLabelingSourceCheckpointsWithClientV1,type MassLabelingSourceCheckpointV1} from "./signal-mass-labeling-source";
import {verifySignalWorkspaceMassLabelingGlobalReceiptRecoveryWithClientV1,MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1,type SignalWorkspaceMassLabelingOperatorReceiptRecoveryV1} from "./signal-mass-labeling-global-recovery";
import {readClassicPolicyActiveWorkV1} from "./signal-classic-policy-completion";

export const MASS_LABELING_REQUEST_VERSION_V1 = "mass-labeling-jev-v1";
export type MassLabelingTopicV1 = {
  topic_key: string; name: string; definition: string; definition_digest: string; group_ids: string[];
  localization?: SignalTopicLocalizationV1;
};
export type MassLabelingMapV1 = {
  id: string; workspace_id: string; source_engine_execution_id: string; preparation_run_id: string;
  input_revision: string; embedding_config_digest: string; map_digest: string; entity_context_digest: string;
  consolidation_artifact_id: string; consolidation_digest: string; assignments_artifact_id: string; assignments_digest: string; catalog: MassLabelingTopicV1[];
  root_count: number; created_at: string;
};
function fail(code: string, status = 409): never {throw new SignalLabelingError(code, status);}
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
async function transaction<T>(database: LabelingDatabaseV1, work: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {await client.query("ROLLBACK"); throw error;}
  finally {client.release();}
}
async function authorize(client: Pick<PoolClient, "query">, workspace: string, actor: string, edit: boolean) {
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({queryable: client,
    workspace_id: workspace, actor_user_id: actor, lock_authority: edit});
  if (edit ? !caps.can_request_processing || !caps.can_edit_topics : !caps.can_view)
    fail("mass_labeling_forbidden", 403);
  if (!await signalWorkspaceFeatureEnabledV1({queryable: client, workspace_id: workspace, feature: "mass_labeling"}))
    fail("mass_labeling_not_enabled", 404);
  return caps;
}
export async function mapCurrent(client: Pick<PoolClient, "query">, workspace: string, mapId: string): Promise<MassLabelingMapV1> {
  const row = (await client.query<MassLabelingMapV1>(`SELECT map.* FROM signal_mass_labeling_maps map
    JOIN signal_corpus_preparation_input_state state ON state.workspace_id=map.workspace_id
      AND state.input_revision=map.input_revision
    JOIN signal_corpus_preparation_runs prep ON prep.workspace_id=map.workspace_id AND prep.id=map.preparation_run_id
      AND prep.status='completed' AND (prep.policy_valid_until IS NULL OR prep.policy_valid_until>now())
    JOIN signal_topic_catalog_executions engine ON engine.workspace_id=map.workspace_id AND engine.id=map.source_engine_execution_id
      AND engine.status='ready' AND engine.preparation_run_id=map.preparation_run_id
    WHERE map.workspace_id=$1 AND map.id=$2`, [workspace, mapId])).rows[0];
  if (!row) fail("mass_labeling_map_stale");
  const change = await inspectFacetContextChangeV1(client, workspace);
  if (change.digest !== row.entity_context_digest) fail("mass_labeling_context_changed");
  return row;
}

/** Internal editorial action. Group identities and assignments are bound to the stored numerical artifact. */
export async function createMassLabelingMapV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  source_engine_execution_id: string; assignments_artifact_id: string; assignments_raw: string;
  consolidation_artifact_id: string; consolidation_raw: string;
  source_checkpoints:MassLabelingSourceCheckpointV1[];
  catalog: Array<Omit<MassLabelingTopicV1, "definition_digest">>;
}) {
  if (!args.catalog.length || args.catalog.length > 200) fail("mass_labeling_catalog_invalid", 422);
  const topicKeys = new Set<string>(), groupKeys = new Set<string>();
  const catalog = args.catalog.map(topic => {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(topic.topic_key) || topic.topic_key.length > 120 || topicKeys.has(topic.topic_key)
      || !topic.name.trim() || topic.name.length > 160 || !topic.definition.trim() || topic.definition.length > 1200
      || !topic.group_ids.length) fail("mass_labeling_catalog_invalid", 422);
    topicKeys.add(topic.topic_key);
    for (const group of topic.group_ids) {
      if (!/^(guided|open):[A-Za-z0-9_.:-]{1,180}$/u.test(group) || groupKeys.has(group))
        fail("mass_labeling_group_map_invalid", 422);
      groupKeys.add(group);
    }
    return {...topic, group_ids: [...topic.group_ids].sort(),
      definition_digest: digest({definition: topic.definition, group_ids: [...topic.group_ids].sort()})};
  }).sort((left, right) => left.topic_key.localeCompare(right.topic_key));
  const assignmentsDigest = sha(args.assignments_raw), consolidationDigest = sha(args.consolidation_raw);
  const consolidation = JSON.parse(args.consolidation_raw) as {workspace_id: string; source_engine_execution_id: string;
    source_groups:MassLabelingSourceGroupV1[];source_groups_digest:string;raw_response:string;category_context?:{category:string;terms:string[]};configuration?:SignalWorkspaceInterpretationConfigurationV1;operator_receipt_recovery?:SignalWorkspaceMassLabelingOperatorReceiptRecoveryV1;
    output: {topics: Array<Omit<MassLabelingTopicV1,"definition_digest">>}};
  const batch=buildMassLabelingConsolidationRequestV1({workspace_id:args.workspace_id,
    source_engine_execution_id:args.source_engine_execution_id,source_groups:consolidation.source_groups,
    ...(consolidation.category_context?{category_context:consolidation.category_context}:{}),
    ...(consolidation.configuration?{configuration:consolidation.configuration}:{})});
  const operator=consolidation.operator_receipt_recovery;
  if(operator&&(Object.keys(operator).sort().join(",")!=="contract_version,decision_digest,decision_id"
    ||operator.contract_version!=="workspace-mass-labeling-global-receipt-decision-v1"||!uuid.test(operator.decision_id)))fail("mass_labeling_consolidation_invalid");
  let parsed=operator?null:parseMassLabelingConsolidationResponseV1(batch,consolidation.raw_response);
  if(consolidation.source_groups_digest!==batch.source_groups_digest||parsed&&digest(parsed.output)!==digest(consolidation.output))
    fail("mass_labeling_consolidation_invalid");
  if (consolidation.workspace_id !== args.workspace_id || consolidation.source_engine_execution_id !== args.source_engine_execution_id
    || digest(consolidation.output?.topics) !== digest(args.catalog)) fail("mass_labeling_consolidation_invalid");
  return transaction(args.database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    const source = (await client.query<{preparation_run_id: string; input_revision: string;
      embedding_config_digest: string; artifact_key: string; expected_chunks: number; expected_roots: number}>(`SELECT
      engine.preparation_run_id,engine.input_revision::text,engine.embedding_config_digest,artifact.artifact_key,
      engine.expected_chunks::int,engine.denominator::int expected_roots
      FROM signal_topic_catalog_executions engine
      JOIN signal_corpus_preparation_input_state state ON state.workspace_id=engine.workspace_id AND state.input_revision=engine.input_revision
      JOIN signal_corpus_preparation_runs prep ON prep.id=engine.preparation_run_id AND prep.workspace_id=engine.workspace_id
        AND prep.status='completed' AND (prep.policy_valid_until IS NULL OR prep.policy_valid_until>now())
      JOIN analysis_artifacts artifact ON artifact.id=$3 AND artifact.workspace_id=engine.workspace_id
        AND artifact.engine_execution_id=engine.id AND artifact.artifact_type='engine_output'
        AND artifact.content->>'sha256'=$4
      WHERE engine.workspace_id=$1 AND engine.id=$2 AND engine.status='ready'
        AND engine.input_snapshot#>>'{engine_config,profile_version}' IN ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
        AND artifact.artifact_key IN('assignments.open.jsonl','assignments.guided.jsonl')
        AND (artifact.artifact_key='assignments.guided.jsonl' OR NOT EXISTS(
          SELECT 1 FROM analysis_artifacts guided WHERE guided.engine_execution_id=engine.id
            AND guided.workspace_id=engine.workspace_id AND guided.artifact_key='assignments.guided.jsonl'))`,
      [args.workspace_id, args.source_engine_execution_id, args.assignments_artifact_id, assignmentsDigest])).rows[0];
    if (!source) fail("mass_labeling_source_invalid");
    const editorial = (await client.query<{call_id:string;request_digest:string;response_sha256:string;call_configuration:unknown;usage:unknown;metadata:Record<string,unknown>}>(
      `SELECT call.id call_id,artifact.metadata,call.request_digest,call.response_sha256,call.call_configuration,call.metadata->'usage' usage FROM analysis_artifacts artifact
      JOIN engine_cost_events call ON call.id::text=artifact.metadata->>'call_id'
        AND call.workspace_id=artifact.workspace_id AND call.catalog_execution_id=artifact.engine_execution_id
        AND call.request_digest=artifact.metadata->>'request_digest'
        AND call.response_sha256=artifact.metadata->>'response_sha256' AND call.call_state='settled'
        AND call.actor_user_id=(SELECT actor_user_id FROM signal_topic_catalog_executions WHERE id=artifact.engine_execution_id)
        AND call.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
        AND call.metadata#>>'{mass_labeling_stage,source_groups_digest}'=artifact.metadata->>'source_groups_digest'
        AND call.call_configuration=workspace_engine_interpretation_configuration_v1(artifact.engine_execution_id,call.metadata->>'interpretation_revision_digest')
      WHERE artifact.workspace_id=$1 AND artifact.engine_execution_id=$2 AND artifact.id=$3
        AND artifact.artifact_key='mass-labeling-consolidation.json' AND artifact.artifact_type='engine_proposals'
        AND artifact.metadata->>'contract_version'='workspace-mass-labeling-consolidation-v1'
        AND artifact.metadata->>'stage'='global-consolidation-v1'
        AND artifact.metadata->>'source_engine_execution_id'=artifact.engine_execution_id::text
        AND artifact.content->>'sha256'=$4`,
      [args.workspace_id,args.source_engine_execution_id,args.consolidation_artifact_id,consolidationDigest])).rows[0];
    if(!editorial)fail("mass_labeling_consolidation_receipt_invalid");
    if(operator){
      if(editorial.metadata.recovery_decision_id!==operator.decision_id||editorial.metadata.recovery_decision_digest!==operator.decision_digest)fail("mass_labeling_consolidation_receipt_invalid");
      parsed=await verifySignalWorkspaceMassLabelingGlobalReceiptRecoveryWithClientV1(client,{workspace_id:args.workspace_id,execution_id:args.source_engine_execution_id,
        actor_user_id:args.actor_user_id,call_id:editorial.call_id,decision_id:operator.decision_id,decision_digest:operator.decision_digest,batch,raw_response:consolidation.raw_response});
    }else if(editorial.metadata.recovery_decision_id||editorial.metadata.recovery_decision_digest)fail("mass_labeling_consolidation_receipt_invalid");
    if(!parsed||digest(parsed.output)!==digest(consolidation.output)||editorial.request_digest!==batch.request_digest||editorial.response_sha256!==sha(consolidation.raw_response)
      ||digest(editorial.call_configuration)!==digest(batch.configuration)||digest(editorial.usage)!==digest(parsed.usage)) fail("mass_labeling_consolidation_receipt_invalid");
    const lane = source.artifact_key === "assignments.guided.jsonl" ? "guided" : "open";
    if ([...groupKeys].some(group => !group.startsWith(`${lane}:`))) fail("mass_labeling_lane_invalid");
    const groupHashes=new Map<string,ReturnType<typeof createHash>>();
    const assignments = args.assignments_raw.trim().split("\n").map((line,index) => {
      const value = JSON.parse(line) as {ordinal:number;root_id:string;chunk_index:number;start:number;end:number;
        stable_cluster_id:string|null;chunk_sha256:string};
      if (!uuid.test(value.root_id) || value.ordinal!==index || !Number.isSafeInteger(value.chunk_index) || value.chunk_index < 0
        || !Number.isSafeInteger(value.start)||value.start<0||!Number.isSafeInteger(value.end)||value.end<value.start
        || value.stable_cluster_id !== null && typeof value.stable_cluster_id !== "string") fail("mass_labeling_assignments_invalid");
      const group_id=value.stable_cluster_id===null?null:`${lane}:${value.stable_cluster_id}`;
      if(group_id!==null) {
        let hash=groupHashes.get(group_id);if(!hash){hash=createHash("sha256");groupHashes.set(group_id,hash);}
        hash.update(JSON.stringify({ordinal:value.ordinal,root_id:value.root_id,chunk_index:value.chunk_index,
          start:value.start,end:value.end,chunk_sha256:value.chunk_sha256})+"\n");
      }
      return {root_id:value.root_id,chunk_index:value.chunk_index,chunk_sha256:value.chunk_sha256,group_id};
    });
    if (assignments.length !== source.expected_chunks) fail("mass_labeling_assignments_incomplete");
    await verifyMassLabelingSourceCheckpointsWithClientV1(client,{workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
      source_engine_execution_id:args.source_engine_execution_id,source_checkpoints:args.source_checkpoints,
      expected_group_ids:[...groupHashes.keys()],
      expected_cluster_digests:Object.fromEntries([...groupHashes].map(([key,hash])=>[key,`sha256:${hash.digest("hex")}`])),
      claimed_source_groups:batch.source_groups});
    const context = await inspectFacetContextChangeV1(client, args.workspace_id);
    const mapDigest = digest({source_execution_id: args.source_engine_execution_id,
      assignments_digest: assignmentsDigest, consolidation_digest: consolidationDigest, context_digest: context.digest, catalog});
    const replay = (await client.query<{id: string}>(`SELECT id FROM signal_mass_labeling_maps
      WHERE workspace_id=$1 AND map_digest=$2`, [args.workspace_id, mapDigest])).rows[0];
    if (replay) return {map_id: replay.id, map_digest: mapDigest, replayed: true};
    await client.query("DROP TABLE IF EXISTS pg_temp.mass_chunks,pg_temp.mass_assignments,pg_temp.mass_scores,pg_temp.mass_topic_vectors,pg_temp.mass_map_items");
    await client.query(`CREATE TEMP TABLE mass_chunks ON COMMIT DROP AS
      SELECT item.root_id,item.fingerprint,asset.full_text,(chunk.ordinality-1)::int chunk_index,
        chunk.value->>'sha256' chunk_sha256,(chunk.value->>'start')::int start_offset,(chunk.value->>'end')::int end_offset,
        cache.embedding
      FROM signal_corpus_preparation_items item
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id AND asset.text_sha256=item.asset_sha256
        AND asset.chunk_policy_version=item.chunk_policy_version
      CROSS JOIN LATERAL jsonb_array_elements(asset.chunks->'chunks') WITH ORDINALITY chunk
      JOIN signal_workspace_chunk_embeddings cache ON cache.workspace_id=item.workspace_id
        AND cache.config_digest=$3 AND cache.chunk_sha256=chunk.value->>'sha256'
      WHERE item.workspace_id=$1 AND item.run_id=$2 AND item.disposition='eligible'`,
      [args.workspace_id, source.preparation_run_id, source.embedding_config_digest]);
    await client.query("CREATE UNIQUE INDEX mass_chunks_root ON mass_chunks(root_id,chunk_index)");
    const c = (await client.query<{chunks: number; roots: number}>("SELECT count(*)::int chunks,count(DISTINCT root_id)::int roots FROM mass_chunks")).rows[0]!;
    if (c.chunks !== source.expected_chunks || c.roots !== source.expected_roots) fail("mass_labeling_vectors_incomplete");
    await client.query(`CREATE TEMP TABLE mass_assignments ON COMMIT DROP AS SELECT *
      FROM jsonb_to_recordset($1::jsonb) assignment(root_id uuid,chunk_index int,chunk_sha256 text,group_id text)`, [JSON.stringify(assignments)]);
    await client.query("CREATE UNIQUE INDEX mass_assignment_root ON mass_assignments(root_id,chunk_index)");
    if ((await client.query(`SELECT 1 FROM mass_assignments assignment LEFT JOIN mass_chunks chunk USING(root_id,chunk_index)
      WHERE chunk.root_id IS NULL OR chunk.chunk_sha256 IS DISTINCT FROM assignment.chunk_sha256 LIMIT 1`)).rows.length)
      fail("mass_labeling_assignment_lineage_invalid");
    const mapId = randomUUID();
    await client.query(`INSERT INTO signal_mass_labeling_maps(id,workspace_id,source_engine_execution_id,preparation_run_id,
      input_revision,embedding_config_digest,map_digest,entity_context_digest,assignments_artifact_id,assignments_digest,catalog,root_count,created_by_user_id,consolidation_artifact_id,consolidation_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)`, [mapId, args.workspace_id,
      args.source_engine_execution_id, source.preparation_run_id, source.input_revision, source.embedding_config_digest,
      mapDigest, context.digest, args.assignments_artifact_id, assignmentsDigest, JSON.stringify(catalog), c.roots, args.actor_user_id, args.consolidation_artifact_id, consolidationDigest]);
    const topicCount = await client.query(`INSERT INTO signal_mass_labeling_topics(workspace_id,map_id,topic_key,definition_digest,group_ids,centroid)
      SELECT $1,$2,topic.topic_key,topic.definition_digest,topic.group_ids,avg(chunk.embedding)
      FROM jsonb_to_recordset($3::jsonb) topic(topic_key text,definition_digest text,group_ids text[])
      CROSS JOIN LATERAL unnest(topic.group_ids) groups(group_id)
      JOIN mass_assignments assignment ON assignment.group_id=groups.group_id
      JOIN mass_chunks chunk USING(root_id,chunk_index)
      GROUP BY topic.topic_key,topic.definition_digest,topic.group_ids`, [args.workspace_id, mapId, JSON.stringify(catalog)]);
    if (topicCount.rowCount !== catalog.length) fail("mass_labeling_empty_topic");
    // Keep the original Voyage space, top-eight order and chunk tie breakers.
    await prepareMassLabelingMapScoresV1(client, mapId);
    await insertMassLabelingMapItemsV1(client, { workspace_id: args.workspace_id, map_id: mapId,
      catalog, map_digest: mapDigest, expected_roots: c.roots });
    return {map_id: mapId, map_digest: mapDigest, replayed: false, root_count: c.roots, topic_count: catalog.length};
  });
}

/** One sealed run spans the smoke and the continuation; expansion never creates new paid root identities. */
export async function requestMassLabelingV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; map_id: string;
  idempotency_key: string; identity: LabelerIdentity; provider_available: boolean;
  cap_micro_usd: number; smoke?: true;
}) {
  if (args.smoke !== undefined && args.smoke !== true) fail("mass_labeling_smoke_required",422);
  if (labelerDigestV1(args.identity) !== labelerDigestV1(massLabelingJevIdentityV1()))
    fail("mass_labeling_identity_invalid", 422);
  return requestMentionFacetsV1({...args, adapter: {
    request_identity: {version: MASS_LABELING_REQUEST_VERSION_V1, map_id: args.map_id, smoke: true},
    policy: client=>massLabelingRequestPolicyWithClientV1(client,args),
    admit: (client,request)=>admitMassLabelingScopedWithClientV1(client,{...request,map_id:args.map_id}),
    policy_action: "mass_labeling_jev", feature: "mass_labeling", select_labeler: false,
    validateIdentity: candidate => {if (labelerDigestV1(candidate) !== labelerDigestV1(args.identity)) fail("mass_labeling_identity_changed");},
    prepare: async (client, workspace) => {
      const map = await mapCurrent(client, workspace, args.map_id);
      if ((await client.query("SELECT 1 FROM signal_mass_labeling_runs WHERE map_id=$1", [args.map_id])).rows.length)
        fail("mass_labeling_map_already_admitted");
      const input = (await client.query<{characters: string}>(`SELECT sum(length(text)+length(candidates::text))::text characters
        FROM signal_mass_labeling_items WHERE map_id=$1`, [args.map_id])).rows[0]!;
      const rate = Number(args.identity.params.input_usd_per_mtok);
      if (!Number.isFinite(rate) || rate <= 0) fail("mass_labeling_price_invalid");
      return {roots: map.root_count, estimated_micro_usd: Math.ceil((Number(input.characters)/3.5+map.root_count*600)*rate),
        concept_set_digest: map.map_digest, snapshot: {map_id: map.id, map_digest: map.map_digest}};
    },
    persist: async (client, runId, prepared) => {
      await client.query(`INSERT INTO signal_mass_labeling_runs(workspace_id,map_id,run_id,smoke_root_limit)
        VALUES($1,$2,$3,$4)`, [args.workspace_id, args.map_id, runId, 1000]);
      await client.query("UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1",
        [runId, JSON.stringify(prepared.snapshot), prepared.concept_set_digest]);
    },
  }});
}

export async function continueMassLabelingV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; run_id: string;
}) {
  return transaction(args.database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    const run = (await client.query<{map_id: string; smoke_root_limit: number | null; status: string}>(`SELECT mass.map_id,mass.smoke_root_limit,run.status
      FROM signal_mass_labeling_runs mass JOIN signal_labeling_runs run ON run.id=mass.run_id
      WHERE mass.workspace_id=$1 AND mass.run_id=$2 FOR UPDATE OF mass,run`, [args.workspace_id, args.run_id])).rows[0];
    if (!run) fail("mass_labeling_run_unavailable", 404);
    await mapCurrent(client, args.workspace_id, run.map_id);
    await client.query("SELECT signal_mass_labeling_scoped_capacity_v1($1)",[args.run_id]);
    if (run.smoke_root_limit === null) return {run_id: args.run_id, replayed: true};
    if (run.status !== "completed") fail("mass_labeling_smoke_incomplete");
    const smoke = (await client.query<{smoke_metrics: {technical_failure: boolean} | null}>(
      "SELECT smoke_metrics FROM signal_mass_labeling_runs WHERE run_id=$1",[args.run_id])).rows[0]?.smoke_metrics;
    if (!smoke || smoke.technical_failure) fail("mass_labeling_smoke_review_required");
    await client.query("UPDATE signal_mass_labeling_runs SET smoke_root_limit=NULL,continued_at=now() WHERE run_id=$1", [args.run_id]);
    await client.query(`UPDATE signal_labeling_runs SET status='queued',completed_at=NULL,
      lease_token=NULL,lease_until=NULL,next_poll_at=now(),updated_at=now() WHERE id=$1`, [args.run_id]);
    return {run_id: args.run_id, replayed: false};
  });
}

const itemPageSql = `SELECT item.root_id,item.input_digest,item.text,NULL::text title,mention.platform,
  mention.content_type,NULL::text author,mention.published_at::text,mention.language,item.chunk_index,
  item.map_id,map.map_digest,item.candidates
  FROM signal_mass_labeling_runs mass JOIN signal_mass_labeling_maps map ON map.id=mass.map_id
  JOIN signal_mass_labeling_items item ON item.map_id=mass.map_id AND item.workspace_id=mass.workspace_id
  JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
  WHERE mass.run_id=$1 AND mass.workspace_id=$2
    AND (mass.smoke_root_limit IS NULL OR item.ordinal<=mass.smoke_root_limit)
    AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_call_roots call WHERE call.run_id=mass.run_id AND call.root_id=item.root_id)
  ORDER BY item.root_id LIMIT 200`;

export function createMassLabelingStoreV1(options: Omit<Parameters<typeof createSignalLabelingStoreV1>[0], "adapter">) {
  return createSignalLabelingStoreV1<MassLabelingInputV1, MassLabelingResultV1>({...options, adapter: {
    kind: "mass_labeling", policy_action: "mass_labeling_jev", feature: "mass_labeling",
    policy: massLabelingRunPolicyWithClientV1,
    pending_calls_only: true, persist_results_before_write: true,
    inputs: async (client, run) => {
      const rows=(await client.query<MassLabelingInputV1>(itemPageSql,[run.id,run.workspace_id])).rows;
      if(run.identity.params.request_version!=="mass-labeling-jev-v2"||!rows.length)return rows;
      const map=await mapCurrent(client,run.workspace_id,rows[0]!.map_id);
      const imported=(await client.query<{topic_key:string;localization:SignalTopicLocalizationV1}>(
        "SELECT topic_key,localization FROM signal_mass_labeling_localizations WHERE workspace_id=$1 AND map_id=$2",[run.workspace_id,map.id])).rows;
      const localized=new Map(map.catalog.flatMap(t=>t.localization?[[t.topic_key,t.localization] as const]:[]));
      for(const t of imported)if(!localized.has(t.topic_key))localized.set(t.topic_key,t.localization);
      return rows.map(row=>({...row,candidates:[...row.candidates].sort((a,b)=>b.similarity-a.similarity||a.topic_key.localeCompare(b.topic_key))
        .slice(0,4).map(c=>({...c,...(localized.has(c.topic_key)?{localization:localized.get(c.topic_key)}:{})}))}));
    },
    authority: async (client, run) => {
      const row = (await client.query<{map_id: string}>("SELECT map_id FROM signal_mass_labeling_runs WHERE run_id=$1 AND workspace_id=$2", [run.id, run.workspace_id])).rows[0];
      if (!row) fail("mass_labeling_run_unavailable");
      await mapCurrent(client, run.workspace_id, row.map_id);
      if(run.identity.params.request_version==="mass-labeling-jev-v2"){
        const policy=await loadMassLabelingStudyPolicyWithClientV1(client,run.workspace_id);
        const current=massLabelingConfigurationV2({category:policy.category,candidate_language:policy.candidate_language,
          interests:policy.interests.filter(i=>i.active)});
        if(digest(current)!==digest(massLabelingConfigurationV2(run.identity.params)))fail("mass_labeling_study_configuration_changed");
      }
    },
    pending: async (client, run) => (await client.query<{count: number}>(`SELECT count(*)::int count FROM signal_mass_labeling_items item
      JOIN signal_mass_labeling_runs mass ON mass.map_id=item.map_id
      WHERE mass.run_id=$1 AND mass.workspace_id=$2 AND (mass.smoke_root_limit IS NULL OR item.ordinal<=mass.smoke_root_limit)
      AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_results result WHERE result.map_id=item.map_id AND result.root_id=item.root_id)`,
      [run.id, run.workspace_id])).rows[0]!.count,
    write: async (client, run, pages) => {
      const rows = pages.map(page => {
        const input = page.call.inputs[0], result = page.results[0];
        if (page.call.inputs.length !== 1 || page.results.length !== 1 || !input || !result
          || result.root_id !== input.root_id || result.input_digest !== input.input_digest
          || result.entity_context_digest !== run.entity_context_digest) fail("mass_labeling_result_lineage_invalid");
        return {map_id: input.map_id, root_id: input.root_id, call_id: page.call.id, status: result.status,
          probabilities: result.probabilities ?? {}, error_code: result.error_code ?? null};
      });
      await client.query(`INSERT INTO signal_mass_labeling_results(workspace_id,map_id,root_id,run_id,call_id,status,probabilities,error_code)
        SELECT $1,value.map_id,value.root_id,$2,value.call_id,value.status,value.probabilities,value.error_code
        FROM jsonb_to_recordset($3::jsonb) value(map_id uuid,root_id uuid,call_id uuid,status text,probabilities jsonb,error_code text)
        ON CONFLICT(map_id,root_id) DO NOTHING`, [run.workspace_id, run.id, JSON.stringify(rows)]);
      const inconsistent = await client.query(`SELECT 1 FROM jsonb_to_recordset($3::jsonb)
        value(map_id uuid,root_id uuid,call_id uuid,status text,probabilities jsonb,error_code text)
        LEFT JOIN signal_mass_labeling_results result ON result.map_id=value.map_id AND result.root_id=value.root_id
        WHERE result.workspace_id IS DISTINCT FROM $1::uuid OR result.run_id IS DISTINCT FROM $2::uuid
          OR ROW(result.call_id,result.status,result.probabilities,result.error_code)
             IS DISTINCT FROM ROW(value.call_id,value.status,value.probabilities,value.error_code) LIMIT 1`,
        [run.workspace_id, run.id, JSON.stringify(rows)]);
      if (inconsistent.rows.length) fail("mass_labeling_result_conflict");
      if(run.identity.params.request_version==="mass-labeling-jev-v2"){
        const configuration=massLabelingConfigurationV2(run.identity.params);
        const interests=pages.flatMap(page=>{
          const input=page.call.inputs[0]!,result=page.results[0]!;
          if(result.status!=="labeled")return [];
          return configuration.interests.map(interest=>{
            const answer=result.probabilities?.[`interest_${interest.key}`];
            if(answer?.type!=="noul")fail("mass_labeling_interest_answer_invalid");
            return {root_id:input.root_id,map_id:input.map_id,input_digest:input.input_digest,interest_key:interest.key,
              definition_digest:massLabelingStudyInterestDigestV1(interest),probability:answer.noul,call_id:page.call.id};
          });
        });
        if(interests.length)await client.query(`INSERT INTO signal_mass_labeling_study_interest_results(workspace_id,map_id,
          interest_key,definition_digest,root_id,input_digest,probability,request_digest,response_digest,usage,created_by_user_id)
          SELECT $1,r.map_id,r.interest_key,r.definition_digest,r.root_id,r.input_digest,r.probability,
            receipt.request_digest,receipt.raw_sha256,receipt.usage,$3
          FROM jsonb_to_recordset($2::jsonb) r(map_id uuid,interest_key text,definition_digest text,root_id uuid,
            input_digest text,probability double precision,call_id uuid)
          JOIN signal_labeling_calls receipt ON receipt.id=r.call_id AND receipt.workspace_id=$1 AND receipt.run_id=$4
            AND receipt.status='settled' AND receipt.results_applied
          ON CONFLICT DO NOTHING`,[run.workspace_id,JSON.stringify(interests),run.actor_user_id,run.id]);
        if(interests.length){
          const conflict=await client.query(`SELECT 1 FROM jsonb_to_recordset($2::jsonb) r(map_id uuid,interest_key text,
            definition_digest text,root_id uuid,input_digest text,probability double precision,call_id uuid)
            JOIN signal_labeling_calls receipt ON receipt.id=r.call_id AND receipt.workspace_id=$1 AND receipt.run_id=$3
            LEFT JOIN signal_mass_labeling_study_interest_results stored ON stored.workspace_id=$1 AND stored.map_id=r.map_id
              AND stored.interest_key=r.interest_key AND stored.definition_digest=r.definition_digest AND stored.root_id=r.root_id
            WHERE ROW(stored.input_digest,stored.probability,stored.request_digest,stored.response_digest,stored.usage)
              IS DISTINCT FROM ROW(r.input_digest,r.probability,receipt.request_digest,receipt.raw_sha256,receipt.usage) LIMIT 1`,
            [run.workspace_id,JSON.stringify(interests),run.id]);
          if(conflict.rowCount)fail("mass_labeling_interest_result_conflict");
        }
      }
    },
  }});
}

/** Selection is an explicit publication of a completed full-population map. */
export async function selectMassLabelingTopicsV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  map_id: string; topic_keys: string[]; expected_revision: number;
}) {
  return transaction(args.database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    const map = await mapCurrent(client, args.workspace_id, args.map_id);
    if (new Set(args.topic_keys).size !== args.topic_keys.length || args.topic_keys.some(key => !map.catalog.some(topic => topic.topic_key === key)))
      fail("mass_labeling_selection_invalid", 422);
    const ready = (await client.query(`SELECT 1 FROM signal_mass_labeling_runs mass JOIN signal_labeling_runs run ON run.id=mass.run_id
      WHERE mass.map_id=$1 AND mass.workspace_id=$2 AND run.status='completed' AND mass.smoke_root_limit IS NULL
        AND (SELECT count(*) FROM signal_mass_labeling_results result WHERE result.map_id=mass.map_id)=$3
        AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=run.id
          AND (call.status IN('reserved','submitting','submitted','unknown') OR NOT call.results_applied))`,
      [args.map_id, args.workspace_id, map.root_count])).rows.length === 1;
    if (!ready) fail("mass_labeling_full_population_required");
    const prior = (await client.query<{revision: number}>("SELECT revision FROM signal_mass_labeling_selections WHERE workspace_id=$1 FOR UPDATE", [args.workspace_id])).rows[0];
    if ((prior?.revision ?? 0) !== args.expected_revision) fail("mass_labeling_selection_conflict");
    await client.query(`INSERT INTO signal_mass_labeling_selections(workspace_id,map_id,selected_topic_keys,revision,selected_by_user_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET map_id=excluded.map_id,
        selected_topic_keys=excluded.selected_topic_keys,revision=excluded.revision,selected_by_user_id=excluded.selected_by_user_id,selected_at=now()`,
      [args.workspace_id, args.map_id, args.topic_keys, args.expected_revision+1, args.actor_user_id]);
    return {revision: args.expected_revision+1, selected: args.topic_keys.length};
  });
}

export async function correctMassLabelingTopicV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  map_id: string; root_id: string; topic_key: string; belongs: boolean; decided_via: "human_ui" | "agent_assisted";
}) {
  return transaction(args.database, async client => {
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    await mapCurrent(client, args.workspace_id, args.map_id);
    if (!(await client.query(`SELECT 1 FROM signal_mass_labeling_items item
      JOIN signal_mass_labeling_topics topic ON topic.map_id=item.map_id AND topic.topic_key=$4
      WHERE item.workspace_id=$1 AND item.map_id=$2 AND item.root_id=$3`,
      [args.workspace_id, args.map_id, args.root_id, args.topic_key])).rows.length) fail("mass_labeling_pair_unavailable");
    return (await client.query<{id: string}>(`INSERT INTO signal_mass_labeling_overrides
      (workspace_id,map_id,root_id,topic_key,belongs,actor_user_id,decided_via) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [args.workspace_id, args.map_id, args.root_id, args.topic_key, args.belongs, args.actor_user_id, args.decided_via])).rows[0]!;
  });
}

/** Add JEV authority through an internal successor policy, preserving every prior action and limit. */
export async function provisionMassLabelingPolicyV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; cap_micro_usd: number;
}) {
  if (!Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd <= 0) fail("mass_labeling_cap_invalid", 422);
  return transaction(args.database, async client => {
    const scope = (await client.query<{organization_id: string}>(
      "SELECT organization_id FROM signal_workspaces WHERE id=$1", [args.workspace_id])).rows[0];
    if (!scope) fail("mass_labeling_workspace_unavailable", 404);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))", [scope.organization_id]);
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    if (!(await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active'
      AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')`, [args.actor_user_id])).rows.length)
      fail("mass_labeling_policy_internal_only", 403);
    const prior = (await client.query<{id: string; budget_timezone: string}>(`SELECT id,budget_timezone FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active' AND valid_from<=now() AND valid_until>now() FOR UPDATE`, [scope.organization_id])).rows[0];
    if (!prior) fail("mass_labeling_active_policy_required");
    await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
    const existing = (await client.query<{provider: string; model: string; max_execution_micro_usd: string | null; configuration: Record<string,unknown>}>(`SELECT provider,model,max_execution_micro_usd::text,configuration
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='mass_labeling_jev'`, [prior.id])).rows[0];
    if (existing) {
      if (existing.provider !== "typesafe" || existing.model !== "jev-1.13.0" || existing.configuration.workspace_id !== args.workspace_id
        || existing.max_execution_micro_usd !== null && Number(existing.max_execution_micro_usd) < args.cap_micro_usd)
        fail("mass_labeling_policy_action_conflict");
      return {status: "existing_policy", policy_id: prior.id};
    }
    if (await readClassicPolicyActiveWorkV1(client, scope.organization_id)) fail("mass_labeling_policy_active_work");
    const next = (await client.query<{id: string}>(`INSERT INTO signal_processing_policy_versions
      (organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      SELECT organization_id,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=$2),
        'draft',now(),valid_until,budget_timezone,daily_cap_micro_usd,$3
      FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,
      [prior.id, scope.organization_id, args.actor_user_id])).rows[0]!;
    await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2`, [next.id, prior.id]);
    const configuration = {workspace_id: args.workspace_id, contract_version: MASS_LABELING_REQUEST_VERSION_V1, provider: "typesafe", model: "jev-1.13.0"};
    await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'mass_labeling_jev','provider','typesafe','jev-1.13.0',$2::jsonb,$3,$4,false)`,
      [next.id, JSON.stringify(configuration), digest(configuration), args.cap_micro_usd]);
    const mismatch = await client.query(`SELECT 1 FROM signal_processing_policy_actions old
      LEFT JOIN signal_processing_policy_actions next ON next.policy_version_id=$2 AND next.action=old.action
      WHERE old.policy_version_id=$1 AND (to_jsonb(old)-ARRAY['id','policy_version_id','created_at'])
        IS DISTINCT FROM (to_jsonb(next)-ARRAY['id','policy_version_id','created_at']) LIMIT 1`, [prior.id, next.id]);
    if (mismatch.rows.length) fail("mass_labeling_policy_copy_mismatch");
    await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [prior.id]);
    await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [next.id]);
    return {status: "provisioned", policy_id: next.id, prior_policy_id: prior.id};
  });
}

/** Authorized private export. Text and root identities belong only in the operator's private artifact directory. */
export async function exportMassLabelingSnapshotV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; map_id: string;
}) {
  return transaction(args.database, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const capability=await authorize(client,args.workspace_id,args.actor_user_id,false);
    if(!capability.can_edit_topics||!capability.can_request_processing)fail("mass_labeling_private_export_forbidden",403);
    const operator=await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active'
      AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')`,[args.actor_user_id]);
    if(!operator.rows.length)fail("mass_labeling_private_export_forbidden",403);
    const map=await mapCurrent(client,args.workspace_id,args.map_id);
    const run = (await client.query(`SELECT run.*,mass.smoke_root_limit,mass.continued_at,mass.smoke_metrics,mass.smoke_metrics_digest FROM signal_mass_labeling_runs mass
      JOIN signal_labeling_runs run ON run.id=mass.run_id WHERE mass.workspace_id=$1 AND mass.map_id=$2`, [args.workspace_id, args.map_id])).rows[0] ?? null;
    const items = (await client.query(`SELECT item.*,result.call_id,result.status,result.probabilities,result.error_code,result.created_at result_created_at
      FROM signal_mass_labeling_items item LEFT JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id
      WHERE item.workspace_id=$1 AND item.map_id=$2 ORDER BY item.ordinal`, [args.workspace_id, args.map_id])).rows;
    const calls = run ? (await client.query(`SELECT id,run_id,model,status,reserved_micro_usd::text,settled_micro_usd::text,
      terminal_exposure_micro_usd::text,usage,created_at,updated_at,results_applied,request_digest,raw_sha256,budget_date::text,budget_timezone
      FROM signal_labeling_calls WHERE workspace_id=$1 AND run_id=$2 ORDER BY created_at,id`, [args.workspace_id, run.id])).rows : [];
    const embedding = (await client.query(`SELECT embedded.id,embedded.created_at,embedded.completed_at,embedded.status,
      embedded.settled_micro_usd::text,embedded.counts,
      COALESCE((SELECT sum(observed_tokens)::text FROM signal_workspace_embedding_calls call WHERE call.run_id=embedded.id),'0') input_tokens
      FROM signal_topic_catalog_executions engine JOIN signal_workspace_embedding_runs embedded ON embedded.id=engine.embedding_run_id
      WHERE engine.id=$1 AND engine.workspace_id=$2`, [map.source_engine_execution_id, args.workspace_id])).rows[0] ?? null;
    const engine = (await client.query(`SELECT id,input_digest,created_at,completed_at,status,result_summary FROM signal_topic_catalog_executions
      WHERE workspace_id=$1 AND id=$2`, [args.workspace_id, map.source_engine_execution_id])).rows[0]!;
    const consolidationArtifact = (await client.query(`SELECT id,artifact_key,content,metadata FROM analysis_artifacts
      WHERE id=$1 AND workspace_id=$2 AND engine_execution_id=$3`,[map.consolidation_artifact_id,args.workspace_id,map.source_engine_execution_id])).rows[0] ?? null;
    const globalReceiptDecision = consolidationArtifact?.metadata?.recovery_decision_id ? (await client.query(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1}
      WHERE id=$1 AND workspace_id=$2 AND execution_id=$3`,[consolidationArtifact.metadata.recovery_decision_id,args.workspace_id,map.source_engine_execution_id])).rows[0] ?? null : null;
    const editorialCalls = (await client.query(`SELECT id,workspace_id,catalog_execution_id,actor_user_id,provider,model,call_state,request_digest,request_seal,retry_of_call_id,reserved_micro_usd::text,
      settled_micro_usd::text,created_at,sent_at,response_received_at response_at,settled_at,metadata->'usage' usage,input_tokens,output_tokens,total_tokens,call_configuration,
      budget_date,budget_timezone,budget_daily_cap_micro_usd::text,failure_code,
      response_http_status,response_storage_key,response_sha256,response_size_bytes::text,provider_request_id,
      CASE WHEN response_storage_key IS NOT NULL THEN COALESCE((metadata->>'response_complete')::boolean,true) END response_complete,
      jsonb_strip_nulls(jsonb_build_object('mass_labeling_stage',metadata->'mass_labeling_stage','editorial_repair',metadata->'editorial_repair',
        'provider_terminal_receipt',metadata->'provider_terminal_receipt','provider_terminal_billing_reconciliation',metadata->'provider_terminal_billing_reconciliation',
        'interpretation_admission',metadata->'interpretation_admission','interpretation_revision_digest',metadata->'interpretation_revision_digest')) metadata
      FROM engine_cost_events WHERE workspace_id=$1 AND catalog_execution_id=$2
        AND workspace_contract='workspace-engine-interpretation-v1' ORDER BY created_at,id`, [args.workspace_id, map.source_engine_execution_id])).rows;
    const scopedAuthority=run?(await client.query(`SELECT to_jsonb(a) admission,to_jsonb(e) extension FROM signal_mass_labeling_scoped_admissions a
      JOIN signal_mass_labeling_policy_extensions e ON e.id=a.extension_id WHERE a.target_id=$1 AND a.workspace_id=$2`,[run.id,args.workspace_id])).rows[0]??null:null;
    const fundingReceipts=run?(await client.query<{receipt:MassLabelingFundingReceiptV1}>(`${MASS_LABELING_FUNDING_RECEIPT_SELECT_V1} WHERE f.run_id=$1 ORDER BY f.created_at,f.id`,[run.id])).rows.map(row=>row.receipt):[];
    const callAuthorities=scopedAuthority?(await client.query<{call_id:string;scoped_admission_id:string;funding_receipt_id:string|null}>(`SELECT c.id call_id,a.id scoped_admission_id,b.funding_receipt_id FROM signal_labeling_calls c
      JOIN signal_mass_labeling_scoped_admissions a ON a.target_id=c.run_id LEFT JOIN signal_mass_labeling_call_authorities b ON b.call_id=c.id WHERE c.run_id=$1 ORDER BY c.created_at,c.id`,[run.id])).rows:[];
    return {scoped_authority:scopedAuthority?{...scopedAuthority,funding_receipts:fundingReceipts,call_authorities:callAuthorities,
      effective_total_cap_micro_usd:fundingReceipts.at(-1)?.total_cap_micro_usd??String(run.cap_micro_usd)}:null,contract_version: "mass-labeling-private-export-v1", exported_at: new Date().toISOString(),
      map, run, items, calls, stage_receipts: {embeddings: embedding, engine, editorial_calls: editorialCalls, consolidation_artifact: consolidationArtifact, global_receipt_recovery_decision: globalReceiptDecision}};
  });
}

export async function loadMassLabelingServingContextV1(client: Pick<PoolClient,"query">, workspace: string) {
  const selected = (await client.query<{map_id: string; revision: number; selected_topic_keys: string[]; run_id: string}>(`SELECT
    selection.map_id,selection.revision,selection.selected_topic_keys,mass.run_id
    FROM signal_mass_labeling_selections selection
    JOIN signal_mass_labeling_runs mass ON mass.workspace_id=selection.workspace_id AND mass.map_id=selection.map_id
    JOIN signal_labeling_runs run ON run.id=mass.run_id AND run.workspace_id=mass.workspace_id AND run.status='completed'
    WHERE selection.workspace_id=$1 AND mass.smoke_root_limit IS NULL`, [workspace])).rows[0];
  if (!selected) return null;
  const map = (await client.query<MassLabelingMapV1>("SELECT * FROM signal_mass_labeling_maps WHERE workspace_id=$1 AND id=$2", [workspace, selected.map_id])).rows[0]!;
  let current = true;
  try {await mapCurrent(client, workspace, selected.map_id);}
  catch (error) {
    if (error instanceof SignalLabelingError && ["mass_labeling_map_stale","mass_labeling_context_changed"].includes(error.code)) current = false;
    else throw error;
  }
  const state = (await client.query<{value: string}>(`SELECT signal_labeling_digest_v1(jsonb_build_object(
    'map',$1::uuid::text,'revision',$2::int,'results',(SELECT count(*) FROM signal_mass_labeling_results WHERE map_id=$1::uuid),
    'overrides',COALESCE((SELECT jsonb_agg(jsonb_build_array(id,root_id,topic_key,belongs) ORDER BY created_at,id)
      FROM signal_mass_labeling_overrides WHERE map_id=$1::uuid),'[]'::jsonb))) value`, [map.id, selected.revision])).rows[0]!.value;
  return {map, revision: selected.revision, selected_topic_keys: selected.selected_topic_keys,
    run_id: selected.run_id, is_current: current, state_digest: state};
}

/** Freeze the smoke observation before the operator explicitly expands this same run. */
export async function measureMassLabelingSmokeV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; run_id: string;
}) {
  return transaction(args.database, async client => {
    await authorize(client, args.workspace_id, args.actor_user_id, true);
    const run = (await client.query<{map_id: string; smoke_root_limit: number | null; smoke_metrics: Record<string,unknown> | null; smoke_metrics_digest: string | null}>(
      "SELECT * FROM signal_mass_labeling_runs WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE", [args.workspace_id, args.run_id])).rows[0];
    if (!run) fail("mass_labeling_run_unavailable", 404);
    if (run.smoke_metrics) return {metrics: run.smoke_metrics, metrics_digest: run.smoke_metrics_digest, replayed: true};
    if (run.smoke_root_limit === null) fail("mass_labeling_smoke_not_configured");
    const map = await mapCurrent(client, args.workspace_id, run.map_id);
    const rows = (await client.query<{root_id: string; status: string | null; candidates:Array<{topic_key:string}>;
      probabilities: Record<string,{type:string;noul?:number;probabilities?:Record<string,number>}> | null}>(
      `SELECT item.root_id,item.candidates,result.status,result.probabilities FROM signal_mass_labeling_items item
       LEFT JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id
       WHERE item.map_id=$1 AND item.ordinal<=$2 ORDER BY item.ordinal`, [run.map_id, run.smoke_root_limit])).rows;
    const expected = Math.min(1000, map.root_count);
    if (rows.length !== expected || rows.some(row => row.status === null)) fail("mass_labeling_smoke_incomplete");
    const byQuestion = new Map<string,number[]>(), byTopic = new Map<string,number[]>();
    let errors = 0, positive = 0, intermediate = 0, noTopic = 0;
    for (const row of rows) {
      if (row.status !== "labeled") {errors++; continue;}
      const topics: number[] = [];
      for (const [key,answer] of Object.entries(row.probabilities ?? {})) {
        if (answer.type === "noul" && typeof answer.noul === "number") {
          const values = byQuestion.get(key) ?? []; values.push(answer.noul); byQuestion.set(key, values);
          if (key.startsWith("topic_")) {
            topics.push(answer.noul);
            const topicKey=row.candidates[Number(key.slice(6))]?.topic_key;
            if(topicKey){const scores=byTopic.get(topicKey)??[];scores.push(answer.noul);byTopic.set(topicKey,scores);}
          }
        }
        if (answer.type === "choice") for (const [choice,p] of Object.entries(answer.probabilities ?? {})) {
          const question = `${key}.${choice}`, values = byQuestion.get(question) ?? [];
          values.push(p); byQuestion.set(question, values);
        }
      }
      if (topics.some(p => p>0.7)) positive++;
      else if (topics.some(p => p>=0.3 && p<=0.7)) intermediate++;
      else noTopic++;
    }
    const distributions = (observations:Map<string,number[]>) => Object.fromEntries([...observations.entries()].map(([key,values]) => {
      const mean = values.reduce((sum,p) => sum+p,0)/values.length;
      const histogram = Array.from({length:10},() => 0);
      for (const p of values) histogram[Math.min(9,Math.floor(p*10))]!++;
      return [key,{count:values.length,min:Math.min(...values),max:Math.max(...values),mean,
        stddev:Math.sqrt(values.reduce((sum,p)=>sum+(p-mean)**2,0)/values.length),histogram}];
    }));
    const topicProbabilities = [...byQuestion.entries()].filter(([key])=>key.startsWith("topic_")).flatMap(([,values])=>values);
    const nearHalf = topicProbabilities.length ? topicProbabilities.filter(p=>p>=0.49&&p<=0.51).length/topicProbabilities.length : 0;
    const metrics = {contract_version:"mass-labeling-smoke-metrics-v1",root_count:expected,error_roots:errors,
      positive_roots:positive,intermediate_roots:intermediate,no_topic_roots:noTopic,
      error_fraction:errors/expected,intermediate_fraction:intermediate/expected,
      near_half_topic_probability_fraction:nearHalf,questions:distributions(byQuestion),topics:distributions(byTopic),
      technical_failure:errors/expected>0.02 || intermediate/expected>0.4 || nearHalf>=0.95};
    const metricsDigest = digest(metrics);
    await client.query("UPDATE signal_mass_labeling_runs SET smoke_metrics=$2::jsonb,smoke_metrics_digest=$3 WHERE run_id=$1",
      [args.run_id, JSON.stringify(metrics), metricsDigest]);
    return {metrics,metrics_digest:metricsDigest,replayed:false};
  });
}
