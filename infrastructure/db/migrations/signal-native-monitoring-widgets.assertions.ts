import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { signalProvenancePolicyBindingDefinitionHashV1, signalWorkspaceEmbeddingDigestV1 as digest } from "@noisia/query-engine";
import type { Pool } from "pg";
import { loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceMentionsV1,
  loadSignalWorkspaceMonitoringWindowsWithClientV1,loadSignalWorkspaceMonitoringWindowsForDispatchWithClientV1 } from "../signal-workspace-topics-serving";

export async function assertNativeMonitoringWidgetsV1(input: {
  access: { database: Pool; workspace_id: string; actor_user_id: string; timezone?: string };
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  map_id: string;
}) {
  const { access, query } = input;
  await query("SAVEPOINT native_monitoring_widgets");
  try {
    const roots = (await query("SELECT root_id FROM signal_mass_labeling_items WHERE map_id=$1 ORDER BY ordinal LIMIT 3", [input.map_id])).rows.map(row => row.root_id);
    await query(`UPDATE mentions SET provider_record_id=COALESCE(provider_record_id,'synthetic-monitor-'||id::text),sentiment_score=CASE id WHEN $2::uuid THEN 0.9 WHEN $3::uuid THEN -0.8 ELSE 0 END,
      content_type=CASE WHEN id=$3::uuid THEN 'comment' ELSE 'post' END,
      engagement=jsonb_build_object('interactions',CASE WHEN id=$2::uuid THEN 10 ELSE 0 END,'views',20),
      raw_metadata=jsonb_build_object('row',jsonb_build_object('thread id',CASE WHEN id=$4::uuid THEN 'other-thread' ELSE 'shared-thread' END,
        'total interactions',CASE WHEN id=$2::uuid THEN '10' ELSE '0' END,'views','20'))
      WHERE workspace_id=$1::uuid AND id=ANY($5::uuid[])`, [access.workspace_id, ...roots, roots]);
    const view = await loadSignalWorkspaceTopicsOverviewV1(access, { surface: "monitoring" });
    assert.ok(view?.monitoring);
    const data = view.monitoring;
    assert.equal(data.denominator, view.denominator);
    assert.equal(data.scope_digest, view.scope_digest);
    assert.deepEqual(data.sentiment, { positive: 1, neutral: 1, negative: 1, unclassified: 0 });
    assert.equal(data.summary.conversations, 2);
    assert.equal(data.summary.root_posts, 2);
    assert.equal(data.summary.comments, 1);
    assert.equal(data.summary.unknown_roles, 0);
    assert.equal(data.source_coverage.thread_id_known, 3);
    assert.equal(data.source_coverage.engagement_known_root_posts, 2);
    assert.equal(data.attention.total_interactions, 10);
    assert.equal(data.attention.total_views, 40);
    assert.equal(data.attention.median_interactions, 5);
    assert.equal(data.attention.active_ratio, 0.5);
    assert.equal(data.platforms.reduce((total, item) => total + item.count, 0), data.denominator);
    assert.equal(data.series.reduce((total, item) => total + item.mentions, 0), data.denominator);
    assert.ok(data.drivers.length > 0 && data.highlights.positive.length > 0 && data.highlights.negative.length > 0);
    assert.ok(data.drivers.every(item => item.text.length <= 420 && item.source_sha256.startsWith("sha256:")));
    assert.ok(data.drivers.length + data.highlights.positive.length + data.highlights.negative.length <= 10);
    const client=await access.database.connect();
    const windowAccess={workspace_id:access.workspace_id,actor_user_id:access.actor_user_id,timezone:access.timezone};
    assert.equal(typeof loadSignalWorkspaceMonitoringWindowsForDispatchWithClientV1,"function");
    await assert.rejects(loadSignalWorkspaceMonitoringWindowsWithClientV1(client,windowAccess),/workspace_monitoring_snapshot_required/);
    const windows=await loadSignalWorkspaceMonitoringWindowsForDispatchWithClientV1(client,windowAccess);
    assert.ok(windows?.current&&windows.previous&&windows.anchor_date);
    assert.equal(windows.available_dates.date_to,windows.anchor_date);
    assert.equal(windows.current.date_to,windows.anchor_date);
    assert.equal((Date.parse(windows.current.date_to)-Date.parse(windows.current.date_from))/86_400_000,29);
    assert.equal((Date.parse(windows.previous.date_to)-Date.parse(windows.previous.date_from))/86_400_000,29);
    assert.equal((Date.parse(windows.current.date_from)-Date.parse(windows.previous.date_to))/86_400_000,1);
    for(const window of [windows.current,windows.previous]) {
      const expected=await loadSignalWorkspaceTopicsOverviewV1({...access,date_from:window.date_from,date_to:window.date_to},{surface:"monitoring"});
      assert.ok(expected?.monitoring);
      assert.equal(window.monitoring.scope_digest,expected.scope_digest);
      assert.deepEqual(window.monitoring.summary,expected.monitoring.summary);
      assert.deepEqual(window.monitoring.sentiment,expected.monitoring.sentiment);
      assert.deepEqual(window.monitoring.attention,expected.monitoring.attention);
      assert.equal(window.monitoring.metadata_digest,expected.monitoring.metadata_digest);
      assert.deepEqual(window.monitoring.drivers,[]);
      assert.deepEqual(window.monitoring.highlights,{positive:[],negative:[]});
    }
    await query("SAVEPOINT sparse_monitoring_metadata");
    await query("UPDATE mentions SET sentiment_score=NULL,content_type='unknown',engagement='{}',raw_metadata='{}' WHERE id=$1 AND workspace_id=$2", [roots[0],access.workspace_id]);
    const sparse = await loadSignalWorkspaceTopicsOverviewV1(access, {surface:"monitoring"});
    assert.ok(sparse?.monitoring);
    assert.equal(sparse.monitoring.summary.unknown_roles,1);
    assert.equal(sparse.monitoring.source_coverage.content_type_known,2);
    assert.equal(sparse.monitoring.sentiment.unclassified,1);
    assert.equal(sparse.monitoring.source_coverage.engagement_known,2);
    assert.equal(sparse.monitoring.source_coverage.views_known,2);
    assert.equal(sparse.monitoring.source_coverage.thread_id_known,2);
    assert.notEqual(sparse.monitoring.metadata_digest,data.metadata_digest);
    await query("ROLLBACK TO SAVEPOINT sparse_monitoring_metadata; RELEASE SAVEPOINT sparse_monitoring_metadata");
    await query("SAVEPOINT monitor_role_aliases");
    await query("UPDATE mentions SET content_type=CASE WHEN id=$2 THEN 'comentarios' ELSE 'quote_tweet' END WHERE workspace_id=$1 AND id=ANY($3::uuid[])",
      [access.workspace_id,roots[1],roots]);
    const aliases=await loadSignalWorkspaceTopicsOverviewV1(access,{surface:"monitoring"});
    assert.ok(aliases?.monitoring);
    assert.equal(aliases.monitoring.summary.comments,1);
    assert.equal(aliases.monitoring.summary.root_posts,2);
    assert.equal(aliases.monitoring.summary.unknown_roles,0);
    await query("ROLLBACK TO SAVEPOINT monitor_role_aliases; RELEASE SAVEPOINT monitor_role_aliases");
    await query("SAVEPOINT duplicate_monitoring_observations");
    let previousObservation: unknown = null;
    for (const version of [1,2]) {
      previousObservation = (await query(`INSERT INTO signal_provider_mention_observations(workspace_id,data_source_id,import_batch_id,mention_id,
        provider_key,provider_record_key_hash,provider_schema_version,provider_header_hash,observation_version,
        observation_hash,published_at,provider_thread_key_hash,engagement_total,views_count,supersedes_observation_id)
        SELECT mention.workspace_id,batch.data_source_id,batch.id,mention.id,'sentione',
          'sha256:'||encode(sha256(convert_to(mention.provider_record_id,'UTF8')),'hex'),'sentione-csv-47-v1',$3,
          $5::int,$6,COALESCE(mention.published_at,now()),$4,7,99,$7::uuid
        FROM mentions mention JOIN import_batches batch ON batch.id=mention.source_file_id AND batch.workspace_id=mention.workspace_id
        WHERE mention.workspace_id=$1 AND mention.id=$2 RETURNING id`,
        [access.workspace_id,roots[0],digest("synthetic monitor header"),digest("shared-thread"),version,
          digest("synthetic monitor observation"),previousObservation])).rows[0]!.id;
    }
    const observed = await loadSignalWorkspaceTopicsOverviewV1(access,{surface:"monitoring"});
    assert.ok(observed?.monitoring);
    assert.equal(observed.monitoring.denominator,3);
    assert.equal(observed.monitoring.source_coverage.provider_observation_roots,1);
    assert.equal(observed.monitoring.attention.total_interactions,7,"latest canonical observation contributes once");
    assert.equal(observed.monitoring.attention.total_views,119);
    await query("ROLLBACK TO SAVEPOINT duplicate_monitoring_observations; RELEASE SAVEPOINT duplicate_monitoring_observations");
    // The evidence route keeps the exact segment through paging, focus and scope.
    const unfiltered = await loadSignalWorkspaceMentionsV1({ ...access, imported_fallback: true, limit: 1 });
    assert.ok(unfiltered);
    assert.equal(unfiltered.metric_denominator, 3);
    for (const segment of ["all", "conversation", "advertising", "hashtags"] as const) {
      const count = Number((await query(`SELECT count(*) n FROM signal_mass_labeling_root_segments
        WHERE workspace_id=$1 AND map_id=$2 AND ($3='all' OR conversation_segment=$3)`, [access.workspace_id,input.map_id,segment])).rows[0]!.n);
      const page = await loadSignalWorkspaceMentionsV1({ ...access, imported_fallback: true, conversation_segment: segment, limit: 1 });
      assert.ok(page);
      assert.equal(page.filters.conversation_segment, segment);
      assert.equal(page.metric_denominator, count);
      if (segment !== "all" && unfiltered.next_cursor) await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access,
        imported_fallback: true, conversation_segment: segment, limit: 1, cursor: unfiltered.next_cursor }), /workspace_mentions_scope_changed/);
      if (!count) await assert.rejects(loadSignalWorkspaceMentionsV1({ ...access, imported_fallback: true,
        conversation_segment: segment, focus_mention_id: String(roots[0]) }), /workspace_mentions_mention_unavailable/);
    }
    await query("SAVEPOINT outside_map_mention");
    const extra=randomUUID(),extraText="Synthetic root outside the frozen map";
    await query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
      source_system,source_file_id,text_hash,text_raw,text_clean,text_snippet,text_length,published_at,platform,inclusion_status,text_clean_sha256)
      SELECT $3::uuid,$1::uuid,data_source_id,$3::uuid,($3::uuid)::text,($3::uuid)::text,source_system,source_file_id,$4::text,$5::text,$5::text,$5::text,length($5::text),published_at,platform,'included',$4::text
      FROM mentions WHERE workspace_id=$1 AND id=$2`,[access.workspace_id,roots[0],extra,digest(extraText),extraText]);
    const wider=await loadSignalWorkspaceMentionsV1({...access,imported_fallback:true});
    assert.equal(wider?.metric_denominator,4,"omitted segment preserves the received global corpus");
    const frozen=await loadSignalWorkspaceMentionsV1({...access,imported_fallback:true,conversation_segment:"all"}).catch(error=>{
      assert.match(String(error),/workspace_mentions_stale/);return null;
    });
    if(frozen){assert.equal(frozen.metric_denominator,3);assert.equal(frozen.items.some(item=>item.mention_id===extra),false);}
    await query("ROLLBACK TO SAVEPOINT outside_map_mention; RELEASE SAVEPOINT outside_map_mention");
    await query("SAVEPOINT divergent_prepared_sha");
    await query(`UPDATE mentions SET text_clean=text_clean||' synthetic changed',
      text_clean_sha256='sha256:'||encode(sha256(convert_to(text_clean||' synthetic changed','UTF8')),'hex')
      WHERE workspace_id=$1 AND id=$2`,[access.workspace_id,roots[0]]);
    const changed=await loadSignalWorkspaceMentionsV1({...access,imported_fallback:true,conversation_segment:"all"}).catch(error=>{
      assert.match(String(error),/workspace_mentions_stale/);return null;
    });
    if(changed){assert.equal(changed.items.some(item=>item.mention_id===roots[0]),false);assert.equal(changed.integrity_withheld_count,1);}
    await query("ROLLBACK TO SAVEPOINT divergent_prepared_sha; RELEASE SAVEPOINT divergent_prepared_sha");
    const bindings = (await query("SELECT * FROM signal_provenance_policy_bindings WHERE workspace_id=$1 AND status='active'", [access.workspace_id])).rows;
    for (const binding of bindings) {
      const id = randomUUID();
      await query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
        approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key)
        SELECT $1,organization_id,workspace_id,$2,1,'draft',$3,$3,$4,$5
        FROM signal_licensing_policies WHERE id=$6`,
      [id, `synthetic-monitor-${id}`, digest("synthetic metrics-only approval"), access.actor_user_id, digest(id), binding.licensing_policy_id]);
      await query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
        SELECT workspace_id,$1,usage_purpose,CASE WHEN usage_purpose='client-derived-metrics' THEN 'allowed' ELSE 'prohibited' END
        FROM signal_licensing_policy_usages WHERE licensing_policy_id=$2`, [id, binding.licensing_policy_id]);
      await query("UPDATE signal_licensing_policies SET definition_hash=signal_licensing_policy_definition_hash(id) WHERE id=$1", [id]);
      await query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1", [id, access.actor_user_id]);
      await query("UPDATE signal_provenance_policy_bindings SET status='retired',effective_to=now(),updated_at=now() WHERE id=$1", [binding.id]);
      const value = { workspace_id: access.workspace_id, data_source_id: String(binding.data_source_id), import_batch_id: binding.import_batch_id as string|null,
        binding_version: Number(binding.binding_version)+1, quality_policy_id: String(binding.quality_policy_id), retention_policy_id: String(binding.retention_policy_id), licensing_policy_id: id };
      await query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,status,
        quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$9,now(),$10)`,
      [value.workspace_id,value.data_source_id,value.import_batch_id,value.binding_version,value.quality_policy_id,value.retention_policy_id,
        id,signalProvenancePolicyBindingDefinitionHashV1(value),access.actor_user_id,digest(randomUUID())]);
    }
    const withheld = await loadSignalWorkspaceTopicsOverviewV1(access, { surface: "monitoring" });
    assert.ok(withheld?.monitoring);
    assert.equal(withheld.monitoring.denominator, data.denominator);
    assert.deepEqual(withheld.monitoring.sentiment, data.sentiment);
    assert.equal(withheld.monitoring.source_coverage.evidence_eligible, 0);
    assert.equal(withheld.monitoring.source_coverage.llm_eligible_roots, 0);
    assert.deepEqual(withheld.monitoring.drivers, []);
    assert.deepEqual(withheld.monitoring.highlights, { positive: [], negative: [] });
  } finally {
    await query("ROLLBACK TO SAVEPOINT native_monitoring_widgets");
    await query("RELEASE SAVEPOINT native_monitoring_widgets");
  }
}
