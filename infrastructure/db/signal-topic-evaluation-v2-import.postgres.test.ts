import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  SignalTopicEvaluationFrozenImportError,
  importRegisteredSignalTopicEvaluationEvidenceSnapshotV2,
  signalTopicEvaluationV2ImportTestOnly,
  verifyRegisteredSignalTopicEvaluationArtifactsV2
} from "./signal-topic-evaluation-v2-import";

const DATABASE_URL=process.env.NOISIA_TOPIC_EVALUATION_V2_PROVENANCE_URL;
const APPROVED=process.env.NOISIA_TOPIC_EVALUATION_V2_PROVENANCE_APPROVED==="true";

test("0112 imports the real frozen assignment into canonical mention authority",{
  skip:!DATABASE_URL||!APPROVED,timeout:300_000
},async()=>{
  assert.ok(DATABASE_URL);assert.match(DATABASE_URL,/^(?:postgres(?:ql)?:\/\/)?(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//u,
    "provenance integration is local-only");
  const pool=new pg.Pool({connectionString:DATABASE_URL,ssl:false,max:3});
  try{
    const migration=await readFile(new URL("./migrations/0112_signal_topic_evaluation_full_evidence_control_plane.sql",
      import.meta.url),"utf8");
    const migrationPresent=(await pool.query<{present:boolean}>("SELECT to_regclass('signal_topic_evaluation_v2_snapshots') IS NOT NULL present")).rows[0]!.present;
    if(!migrationPresent)await pool.query(migration);
    assert.equal((await pool.query<{present:boolean}>("SELECT to_regclass('signal_topic_evaluation_v2_snapshots') IS NOT NULL present")).rows[0]!.present,true,
      "0112 is present before the real frozen-artifact import");
    const authority=(await pool.query<{workspace_id:string;actor_id:string;packet_artifact_id:string;
      packet_digest:string;rights_digest:string;generation_id:string;semantic_authority:string}>(`WITH packet AS(
        SELECT * FROM signal_topic_discovery_review_packets
        WHERE packet_digest='sha256:49115e8a14c23c09cb1aad84d2a78a070fb177a80bb4712e161c7161cab3119f'
      ),generation AS(SELECT generation.* FROM signal_semantic_context_generations generation,packet
        WHERE generation.workspace_id=packet.workspace_id AND generation.status='draft'
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations successor
            WHERE successor.supersedes_generation_id=generation.id)
        ORDER BY generation.generation_version DESC LIMIT 1)
      SELECT packet.workspace_id::text,run.requested_by_user_id::text actor_id,
        packet.artifact_id::text packet_artifact_id,packet.packet_digest,packet.rights_digest,
        generation.id::text generation_id,
        signal_topic_evaluation_v2_semantic_authority_digest_v1(generation.id) semantic_authority
      FROM packet,generation JOIN signal_topic_evaluation_runs run ON run.workspace_id=generation.workspace_id
      ORDER BY run.queued_at DESC LIMIT 1`)).rows[0];
    assert.ok(authority,"restored local database contains the sealed packet and current generation");
    const before=await protectedCounts(pool,authority.workspace_id);
    const result=await importRegisteredSignalTopicEvaluationEvidenceSnapshotV2({pool,
      workspace_id:authority.workspace_id,actor:{id:authority.actor_id,user_type:"noisia_internal"},
      snapshot_key:"r24a-real-artifact-import",packet_artifact_id:authority.packet_artifact_id,
      semantic_context_generation_id:authority.generation_id,rights_digest:authority.rights_digest,
      semantic_context_authority_digest:authority.semantic_authority,
      source_run_key:signalTopicEvaluationV2ImportTestOnly.sourceRunKey});
    assert.deepEqual({clusters:result.cluster_count,members:result.membership_count,
      assigned:result.assigned_count,outliers:result.outlier_count},
    {clusters:116,members:21195,assigned:11186,outliers:10009});
    const aggregate=(await pool.query<{members:number;records:number;mentions:number;indexes:number;
      proposals:number;assigned:number;outliers:number}>(`SELECT count(*)::int members,
      count(DISTINCT source_record_key)::int records,count(DISTINCT mention_id)::int mentions,
      count(DISTINCT assignment_index)::int indexes,
      count(*) FILTER(WHERE assignment_label>=0)::int assigned,
      count(*) FILTER(WHERE assignment_label=-1)::int outliers,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=snapshot.id
        AND proposal_key IS NOT NULL) proposals
      FROM signal_topic_evaluation_v2_snapshots snapshot
      JOIN signal_topic_evaluation_v2_cluster_memberships membership ON membership.snapshot_id=snapshot.id
      WHERE snapshot.snapshot_key='r24a-real-artifact-import' GROUP BY snapshot.id`)).rows[0]!;
    assert.deepEqual(aggregate,{members:21195,records:21195,mentions:21195,indexes:21195,
      proposals:115,assigned:11186,outliers:10009});
    assert.deepEqual(await protectedCounts(pool,authority.workspace_id),before,
      "local import changes no serving/readers/pointers/bindings state");

    const verified=await verifyRegisteredSignalTopicEvaluationArtifactsV2(
      signalTopicEvaluationV2ImportTestOnly.sourceRunKey);
    const canonical=(await pool.query(`SELECT mention.id::text,mention.text_hash,mention.text_clean,
      mention.language,mention.country,COALESCE(mention.resolved_platform,mention.platform) platform,
      mention.published_at,greatest(count(alias.id)::int-1,0) canonical_alias_count
      FROM mentions mention JOIN data_sources source ON source.id=mention.data_source_id
      JOIN mentions alias ON alias.workspace_id=mention.workspace_id AND alias.canonical_mention_id=mention.id
      WHERE mention.workspace_id=$1::uuid AND mention.id=mention.canonical_mention_id
        AND mention.inclusion_status='included' AND source.status='active'
      GROUP BY mention.id ORDER BY mention.id`,[authority.workspace_id])).rows;
    const key=await readFile(resolve(dirname(verified.root),"remote-export/pseudonym-key.private.bin"));
    assert.throws(()=>signalTopicEvaluationV2ImportTestOnly.bindCanonicalMentions(verified,
      canonical.slice(1) as never[],key,authority.workspace_id),
    (error)=>error instanceof SignalTopicEvaluationFrozenImportError
      &&error.code==="topic_evaluation_v2_canonical_mapping_incomplete"
      &&error.aggregate.missing===1,"one missing canonical mention fails with aggregate evidence only");
    assert.throws(()=>signalTopicEvaluationV2ImportTestOnly.bindCanonicalMentions(verified,
      [...canonical,canonical[0]] as never[],key,authority.workspace_id),
    (error)=>error instanceof SignalTopicEvaluationFrozenImportError
      &&error.code==="topic_evaluation_v2_canonical_mapping_incomplete"
      &&error.aggregate.duplicate===1,"duplicate canonical identity fails closed");key.fill(0);

    const snapshot=(await pool.query<{id:string}>(`SELECT id::text FROM signal_topic_evaluation_v2_snapshots
      WHERE snapshot_key='r24a-real-artifact-import'`)).rows[0]!;
    await assert.rejects(pool.query(`UPDATE signal_topic_evaluation_v2_cluster_memberships
      SET assignment_index=assignment_index+1 WHERE snapshot_id=$1::uuid AND assignment_index=0`,[snapshot.id]),
    /append-only/u,"sealed membership cannot be index-swapped");
    const forged=await pool.connect();try{await forged.query("BEGIN");const forgedId=randomUUID();
      await forged.query(`INSERT INTO signal_topic_evaluation_v2_snapshots SELECT $1::uuid,workspace_id,
        created_by_user_id,'r24a-forged',import_contract_version,source_run_key,source_algorithm_key,source_seed,
        source_manifest_digest,packet_source_manifest_digest,source_assignment_digest,source_export_digest,source_result_digest,
        source_packet_file_digest,artifact_binding_digest,membership_binding_digest,packet_artifact_id,
        packet_digest,rights_digest,semantic_context_generation_id,semantic_context_authority_digest,
        cluster_count,membership_count,$2,state,clock_timestamp()
        FROM signal_topic_evaluation_v2_snapshots WHERE id=$3::uuid`,[forgedId,
        `sha256:${"1".repeat(64)}`,snapshot.id]);
      await forged.query(`INSERT INTO signal_topic_evaluation_v2_clusters SELECT $1::uuid,workspace_id,
        cluster_key,proposal_key,member_count,profile,profile_digest FROM signal_topic_evaluation_v2_clusters
        WHERE snapshot_id=$2::uuid ORDER BY cluster_key LIMIT 1`,[forgedId,snapshot.id]);
      await assert.rejects(forged.query(`INSERT INTO signal_topic_evaluation_v2_cluster_memberships
        SELECT $1::uuid,workspace_id,cluster_key,mention_id,member_ref,source_record_key,$2,
          source_content_hash,canonical_text_hash,canonical_binding_digest,assignment_index,assignment_label,
          assignment_strength,language,market,scope,markets,scopes,published_month,stratum,cluster_rank
        FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=$3::uuid
        ORDER BY assignment_index LIMIT 1`,[forgedId,`sha256:${"2".repeat(64)}`,snapshot.id]),
      /canonical frozen membership authority is invalid/u,"direct SQL cannot forge the source record binding");
      await forged.query("ROLLBACK");}finally{forged.release();}
    await assert.rejects(importRegisteredSignalTopicEvaluationEvidenceSnapshotV2({pool,
      workspace_id:randomUUID(),actor:{id:authority.actor_id,user_type:"noisia_internal"},
      snapshot_key:"cross-workspace",packet_artifact_id:authority.packet_artifact_id,
      semantic_context_generation_id:authority.generation_id,rights_digest:authority.rights_digest,
      semantic_context_authority_digest:authority.semantic_authority,
      source_run_key:signalTopicEvaluationV2ImportTestOnly.sourceRunKey}),
    /topic_evaluation_v2_packet_proposals_incomplete/u,"cross-workspace import writes nothing");
  }finally{await pool.end();}
});

async function protectedCounts(pool:pg.Pool,workspaceId:string){
  const tables=["signal_workspace_population_pointers","signal_workspace_population_bindings",
    "signal_workspace_population_memberships","signal_serving_releases"] as const;
  const present=new Set((await pool.query<{relname:string}>(`SELECT relname FROM pg_class
    WHERE relkind='r' AND relname=ANY($1::text[])`,[tables])).rows.map((row)=>row.relname));
  const counts=await Promise.all(tables.map(async(table)=>present.has(table)
    ?(await pool.query<{count:number}>(`SELECT count(*)::int count FROM ${table} WHERE workspace_id=$1::uuid`,[workspaceId])).rows[0]!.count
    :0));
  return {pointers:counts[0],bindings:counts[1],memberships:counts[2],releases:counts[3]};
}
