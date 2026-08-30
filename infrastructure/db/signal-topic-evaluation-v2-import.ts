import { createHash, createHmac, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { inflateRawSync } from "node:zlib";

import type { Pool } from "pg";

import {
  SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
  signalTopicEvaluationDigestV2,
  signalTopicEvidenceClusterProfileSchemaV2
} from "@noisia/query-engine";

import { SignalTopicEvaluationV2Error, type SignalTopicEvaluationActorV2 } from "./signal-topic-evaluation-v2";

const SOURCE_RUN_KEY = "backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17";
const SOURCE_ROOT = ".data/signal-semantic-lab/backend-10c2c/run-2026-08-21T020023-0600";
const MODEL_ROOT = `${SOURCE_ROOT}/model-run-final-2`;
const PACKET_PATH = ".data/signal-semantic-lab/backend-10c3a/run-2026-08-21T100838-0600/operator-review/blind-review-packet.private.json";
const IMPORT_CONTRACT = "signal-topic-evaluation-frozen-membership-import-v1";
const EXPECTED = {
  source_export: "sha256:3cf49523ebe80a0044eaac6f03de47c787f62e5908a696519d54288de6c4afd9",
  source_manifest: "sha256:4244d4227087f28c93ca72946205b9e40cd69c3edd5df118599b1e233d868720",
  // This is the 10C.2C evidence manifest registered on the downstream review packet.
  // It inventories the distinct model source-export manifest above.
  packet_source_manifest: "sha256:9300ea7a0e50870bf2b4dffe58e3e186628b2577692dccf27f5137177bdaed8b",
  assignment: "sha256:59b7e6833192fd6bcae1291b9cc42dc11d98cb22c31587e1acedc67d0587a8c3",
  result: "sha256:33a24cc7dd510ce317d5ec056aa464d55ddd1f0b5590efb32e8118268a102707",
  packet_file: "sha256:cf249fa062ee6104c7d4c9f2325b0ea27bd7a2705a2807e262d4cfd1851f1847",
  packet: "sha256:49115e8a14c23c09cb1aad84d2a78a070fb177a80bb4712e161c7161cab3119f",
  export_records: "sha256:8797f063ecfef306f84cde3d0ebdeffff46b690284f51bfb14dd7df63f3f4172",
  content: "sha256:76c232dadc63a2f1da659efbdfaed67fdda23bea6308d93e6283bbed60c5e71c",
  provenance: "sha256:8f4902ef5aca4c049c2655e364dcf6ad38e2fb577d74a690f4cf2607f877b4d8"
} as const;

type Digest = `sha256:${string}`;
type PartitionMembership = { partition_key:string; scope:string; declared_market:string;
  provenance_digest:Digest; authority_digest:Digest };
type SourceRecord = { record_key:Digest;canonical_family_key:Digest;canonical_alias_count:number;
  content_hash:Digest;published_at:string;month:string;language:string;country:string;platform:string;
  partition_memberships:PartitionMembership[];authority_digest:Digest };
type PacketTopic = { topic_label:string;sealed_packet:{cluster_key:Digest;cluster_content_digest:Digest;
  cluster_member_count:number;local_terms:string[];local_phrases:string[];limitations:string[];
  distributions:Record<string,unknown>;coverage:{breadth_state?:string}} };
type VerifiedArtifacts = { root:string;source_manifest_digest:Digest;source_export_digest:Digest;
  packet_source_manifest_digest:Digest;
  assignment_digest:Digest;result_digest:Digest;packet_file_digest:Digest;packet_digest:Digest;
  packet_policy_digest:Digest;records:SourceRecord[];labels:Int32Array;strengths:Float32Array;
  topics:PacketTopic[];artifact_binding_digest:Digest;assigned_count:number;outlier_count:number };
type CanonicalRow = { id:string;text_hash:string;text_clean:string;language:string|null;country:string|null;
  platform:string;published_at:string|Date;canonical_alias_count:number };
type BoundMember = { mention_id:string;cluster_key:string;source_record_key:Digest;
  source_record_digest:Digest;source_content_hash:Digest;canonical_text_hash:string;
  canonical_binding_digest:Digest;assignment_index:number;assignment_label:number;
  assignment_strength:number|null;language:string|null;markets:string[];scopes:string[];
  published_month:string;stratum:"central"|"edge"|"minority";cluster_rank:number };
type Cluster = { cluster_key:string;proposal_key:string|null;profile:unknown;members:BoundMember[] };

export class SignalTopicEvaluationFrozenImportError extends SignalTopicEvaluationV2Error {
  constructor(code:string, public readonly aggregate:Record<string,number|string>={}) { super(code,422); }
}

/** The only production seal path. The caller selects a registered immutable source run, never rows or digests. */
export async function importRegisteredSignalTopicEvaluationEvidenceSnapshotV2(args:{
  pool:Pick<Pool,"connect">;workspace_id:string;actor:SignalTopicEvaluationActorV2;snapshot_key:string;
  packet_artifact_id:string;semantic_context_generation_id:string;rights_digest:string;
  semantic_context_authority_digest:string;source_run_key:string
}) {
  if (args.actor.user_type!=="noisia_internal") throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_import_actor_invalid");
  if(args.source_run_key!==SOURCE_RUN_KEY)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_source_run_unregistered");
  const artifacts=await verifyRegisteredSignalTopicEvaluationArtifactsV2(args.source_run_key);
  const client=await args.pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const proposals=await client.query<{proposal_key:string;cluster_key:string;content:unknown}>(`SELECT
      proposal.artifact_key proposal_key,proposal.metadata->>'cluster_key' cluster_key,proposal.content
      FROM signal_topic_discovery_review_packets packet
      JOIN analysis_artifact_relations relation ON relation.source_artifact_id=packet.artifact_id
        AND relation.relation_type='contains_proposal'
      JOIN analysis_artifacts proposal ON proposal.id=relation.target_artifact_id
      WHERE packet.artifact_id=$1::uuid AND packet.workspace_id=$2::uuid
        AND packet.packet_digest=$3 AND packet.proposal_count=115 AND packet.modeling_denominator=21195
        AND packet.rights_digest=$4 AND packet.packet_file_digest=$5 AND packet.source_manifest_digest=$6
      ORDER BY proposal.artifact_key`,[args.packet_artifact_id,args.workspace_id,
      artifacts.packet_digest,args.rights_digest,artifacts.packet_file_digest,artifacts.packet_source_manifest_digest]);
    if(proposals.rows.length!==115)throw new SignalTopicEvaluationFrozenImportError(
      "topic_evaluation_v2_packet_proposals_incomplete",{actual:proposals.rows.length,expected:115});
    const canonical=await client.query<CanonicalRow>(`SELECT mention.id::text,mention.text_hash,
      mention.text_clean,mention.language,mention.country,COALESCE(mention.resolved_platform,mention.platform) platform,
      mention.published_at,greatest(count(alias.id)::int-1,0) canonical_alias_count
      FROM mentions mention JOIN data_sources source ON source.id=mention.data_source_id
      JOIN mentions alias ON alias.workspace_id=mention.workspace_id AND alias.canonical_mention_id=mention.id
      WHERE mention.workspace_id=$1::uuid AND mention.id=mention.canonical_mention_id
        AND mention.inclusion_status='included' AND source.workspace_id=mention.workspace_id AND source.status='active'
      GROUP BY mention.id ORDER BY mention.id`,[args.workspace_id]);
    const key=await readPrivateKey(artifacts.root);
    let bound:BoundMember[];
    try{bound=bindCanonicalMentions(artifacts,canonical.rows,key,args.workspace_id);}
    finally{key.fill(0);}
    const clusters=buildClusters(artifacts,bound,proposals.rows);
    const membershipBindingDigest=digestLines(bound.sort((a,b)=>a.assignment_index-b.assignment_index).map(
      (member)=>[member.assignment_index,member.assignment_label,member.source_record_key,
        member.canonical_binding_digest].join("|")));
    const snapshotDigest=signalTopicEvaluationDigestV2({contract_version:SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,
      import_contract_version:IMPORT_CONTRACT,source_run_key:args.source_run_key,workspace_id:args.workspace_id,
      snapshot_key:args.snapshot_key,source_manifest_digest:artifacts.source_manifest_digest,
      packet_source_manifest_digest:artifacts.packet_source_manifest_digest,
      source_export_digest:artifacts.source_export_digest,source_assignment_digest:artifacts.assignment_digest,
      source_result_digest:artifacts.result_digest,source_packet_file_digest:artifacts.packet_file_digest,
      packet_digest:artifacts.packet_digest,rights_digest:args.rights_digest,
      semantic_context_authority_digest:args.semantic_context_authority_digest,
      artifact_binding_digest:artifacts.artifact_binding_digest,membership_binding_digest:membershipBindingDigest});
    const id=randomUUID();
    await client.query(`INSERT INTO signal_topic_evaluation_v2_snapshots(id,workspace_id,created_by_user_id,
      snapshot_key,import_contract_version,source_run_key,source_algorithm_key,source_seed,
      source_manifest_digest,packet_source_manifest_digest,source_assignment_digest,source_export_digest,source_result_digest,
      source_packet_file_digest,artifact_binding_digest,membership_binding_digest,packet_artifact_id,
      packet_digest,rights_digest,semantic_context_generation_id,semantic_context_authority_digest,
      cluster_count,membership_count,snapshot_digest) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,
      'bertopic-bge-detail',17,$7,$8,$9,$10,$11,$12,$13,$14,$15::uuid,$16,$17,$18::uuid,$19,116,21195,$20)`,
    [id,args.workspace_id,args.actor.id,args.snapshot_key,IMPORT_CONTRACT,args.source_run_key,
      artifacts.source_manifest_digest,artifacts.packet_source_manifest_digest,artifacts.assignment_digest,
      artifacts.source_export_digest,artifacts.result_digest,artifacts.packet_file_digest,
      artifacts.artifact_binding_digest,membershipBindingDigest,args.packet_artifact_id,
      artifacts.packet_digest,args.rights_digest,args.semantic_context_generation_id,
      args.semantic_context_authority_digest,snapshotDigest]);
    for(const cluster of clusters){
      const profile=signalTopicEvidenceClusterProfileSchemaV2.parse(cluster.profile);
      await client.query(`INSERT INTO signal_topic_evaluation_v2_clusters(snapshot_id,workspace_id,
        cluster_key,proposal_key,member_count,profile,profile_digest) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7)`,
      [id,args.workspace_id,cluster.cluster_key,cluster.proposal_key,cluster.members.length,
        JSON.stringify(profile),signalTopicEvaluationDigestV2(profile)]);
      for(let offset=0;offset<cluster.members.length;offset+=400){
        const chunk=cluster.members.slice(offset,offset+400);const values:unknown[]=[];
        const rows=chunk.map((member,index)=>{const base=index*21;values.push(id,args.workspace_id,
          cluster.cluster_key,member.mention_id,signalTopicEvaluationDigestV2({snapshot_digest:snapshotDigest,
            assignment_index:member.assignment_index,source_record_key:member.source_record_key,
            canonical_binding_digest:member.canonical_binding_digest}),member.source_record_key,
          member.source_record_digest,member.source_content_hash,member.canonical_text_hash,
          member.canonical_binding_digest,member.assignment_index,member.assignment_label,
          member.assignment_strength,member.language,member.markets.length===1?member.markets[0]:null,
          member.scopes.length===1?member.scopes[0]:null,member.markets,member.scopes,member.published_month,
          member.stratum,member.cluster_rank);return `(${Array.from({length:21},(_,i)=>`$${base+i+1}`).join(",")})`;});
        await client.query(`INSERT INTO signal_topic_evaluation_v2_cluster_memberships(snapshot_id,
          workspace_id,cluster_key,mention_id,member_ref,source_record_key,source_record_digest,
          source_content_hash,canonical_text_hash,canonical_binding_digest,assignment_index,
          assignment_label,assignment_strength,language,market,scope,markets,scopes,published_month,stratum,cluster_rank)
          VALUES ${rows.join(",")}`,values);
      }
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");await client.query("COMMIT");
    return{snapshot_key:args.snapshot_key,snapshot_digest:snapshotDigest,cluster_count:116,
      membership_count:21195,assigned_count:11186,outlier_count:10009,
      artifact_binding_digest:artifacts.artifact_binding_digest,membership_binding_digest:membershipBindingDigest};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}

export async function verifyRegisteredSignalTopicEvaluationArtifactsV2(sourceRunKey:string) {
  if(sourceRunKey!==SOURCE_RUN_KEY)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_source_run_unregistered");
  return verifyBundle(resolveRepoRoot());
}

async function verifyBundle(repoRoot:string):Promise<VerifiedArtifacts>{
  const root=resolve(repoRoot,MODEL_ROOT);const paths={
    source:join(root,"source-export.private.jsonl"),manifest:join(root,"source-export.manifest.private.json"),
    packetSourceManifest:resolve(repoRoot,SOURCE_ROOT,"manifest.sanitized.json"),
    assignment:join(root,"full/bertopic-bge-detail.seed-17.assignments.npz"),
    result:join(root,"full/bertopic-bge-detail.seed-17.result.json"),packet:resolve(repoRoot,PACKET_PATH),
    key:resolve(repoRoot,SOURCE_ROOT,"remote-export/pseudonym-key.private.bin")};
  for(const path of Object.values(paths))await requirePrivateFile(path);
  const digests=await Promise.all([paths.source,paths.manifest,paths.packetSourceManifest,paths.assignment,paths.result,paths.packet]
    .map(fileDigest));
  const actual={source_export:digests[0],source_manifest:digests[1],packet_source_manifest:digests[2],
    assignment:digests[3],result:digests[4],packet_file:digests[5]};
  for(const key of Object.keys(actual) as Array<keyof typeof actual>)if(actual[key]!==EXPECTED[key])
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_artifact_checksum_mismatch",{artifact:key});
  const manifest=parseObject(JSON.parse(await readFile(paths.manifest,"utf8")),"source_manifest");
  if(manifest.contract_version!=="signal-semantic-benchmark-export-v2"
    ||manifest.export_file_sha256!==EXPECTED.source_export||manifest.export_records_digest!==EXPECTED.export_records
    ||manifest.content_digest!==EXPECTED.content||manifest.provenance_digest!==EXPECTED.provenance
    ||manifest.modeling_population!==21195||manifest.read_only!==true||manifest.writes_performed!==false)
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_source_manifest_invalid");
  const packetSourceManifest=parseObject(JSON.parse(await readFile(paths.packetSourceManifest,"utf8")),
    "packet_source_manifest");
  const packetSourceFiles=Array.isArray(packetSourceManifest.files) ? packetSourceManifest.files : [];
  const packetSourceHas=(path:string,digest:Digest)=>packetSourceFiles.some((item)=>{
    const file=parseObject(item,"packet_source_manifest_file");return file.path===path&&file.sha256===digest;
  });
  if(packetSourceManifest.contract_version!=="signal-local-modeling-evidence-manifest-v1"
    ||packetSourceManifest.all_files_private!==true
    ||!packetSourceHas("model-run-final-2/source-export.manifest.private.json",EXPECTED.source_manifest)
    ||!packetSourceHas("model-run-final-2/source-export.private.jsonl",EXPECTED.source_export)
    ||!packetSourceHas("model-run-final-2/full/bertopic-bge-detail.seed-17.assignments.npz",EXPECTED.assignment)
    ||!packetSourceHas("model-run-final-2/full/bertopic-bge-detail.seed-17.result.json",EXPECTED.result))
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_packet_source_manifest_invalid");
  const records=await loadSourceRecords(paths.source);
  const recordDigest=digestLines(records.map((record)=>[record.record_key,record.content_hash,
    record.authority_digest,record.partition_memberships.map((membership)=>`${membership.partition_key}:${membership.provenance_digest}:${membership.authority_digest}`).join(",")].join("|")));
  if(recordDigest!==EXPECTED.export_records)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_export_records_digest_mismatch");
  const {labels,strengths}=readNpz(await readFile(paths.assignment));
  const result=parseObject(JSON.parse(await readFile(paths.result,"utf8")),"result");
  const artifactManifest=parseObject(result.artifact_manifest,"result_artifact_manifest");
  const metrics=parseObject(result.metrics,"result_metrics");
  if(result.candidate_key!=="bertopic-bge-detail"||result.seed!==17||result.assignments_sha256!==EXPECTED.assignment
    ||artifactManifest.artifact_key!=="bertopic-bge-detail"||artifactManifest.seed!==17
    ||artifactManifest.output_digest!==EXPECTED.assignment||metrics.denominator!==21195
    ||metrics.assigned!==11186||metrics.outliers!==10009||metrics.topic_count!==115)
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_result_authority_invalid");
  const packet=parseObject(JSON.parse(await readFile(paths.packet,"utf8")),"packet");
  const candidates=Array.isArray(packet.candidates)?packet.candidates:[];
  const candidate=candidates.length===1?parseObject(candidates[0],"packet_candidate"):null;
  const topics=candidate&&Array.isArray(candidate.topics)?candidate.topics as PacketTopic[]:[];
  if(packet.packet_digest!==EXPECTED.packet||packet.seed!==17||packet.reference_seed!==17
    ||packet.modeling_record_count!==21195||packet.population_denominator!==23296
    ||candidate?.reviewed_cluster_population_count!==11186||candidate?.outlier_count!==10009||topics.length!==115
    ||!isDigest(packet.packet_policy_digest))
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_packet_authority_invalid");
  validateAssignments(records,labels,strengths,topics,String(packet.packet_policy_digest));
  validateTopicProfiles(records,labels,topics,parseObject(result.terms,"result_terms"));
  const assignedCount=[...labels].filter((label)=>label>=0).length;const outlierCount=labels.length-assignedCount;
  const artifactBindingDigest=signalTopicEvaluationDigestV2({contract_version:IMPORT_CONTRACT,
    source_run_key:SOURCE_RUN_KEY,source_manifest_digest:EXPECTED.source_manifest,
    packet_source_manifest_digest:EXPECTED.packet_source_manifest,
    source_export_digest:EXPECTED.source_export,source_records_digest:EXPECTED.export_records,
    source_assignment_digest:EXPECTED.assignment,source_result_digest:EXPECTED.result,
    source_packet_file_digest:EXPECTED.packet_file,packet_digest:EXPECTED.packet,algorithm:"bertopic-bge-detail",seed:17,
    membership_count:records.length,assigned_count:assignedCount,outlier_count:outlierCount,proposal_count:topics.length}) as Digest;
  return{root,source_manifest_digest:EXPECTED.source_manifest,source_export_digest:EXPECTED.source_export,
    packet_source_manifest_digest:EXPECTED.packet_source_manifest,
    assignment_digest:EXPECTED.assignment,result_digest:EXPECTED.result,packet_file_digest:EXPECTED.packet_file,
    packet_digest:EXPECTED.packet,packet_policy_digest:String(packet.packet_policy_digest) as Digest,
    records,labels,strengths,topics,artifact_binding_digest:artifactBindingDigest,assigned_count:assignedCount,
    outlier_count:outlierCount};
}

async function loadSourceRecords(path:string){
  const records:SourceRecord[]=[];const keys=new Set<string>();
  const reader=createInterface({input:createReadStream(path,{encoding:"utf8"}),crlfDelay:Infinity});
  for await(const line of reader){if(!line)continue;const raw=parseObject(JSON.parse(line),"source_record");
    const text=typeof raw.text==="string"?normalizeText(raw.text):"";
    if(!isDigest(raw.record_key)||raw.canonical_family_key!==raw.record_key||!isDigest(raw.content_hash)
      ||raw.content_hash!==digestText(text)||!Number.isInteger(raw.canonical_alias_count)
      ||typeof raw.published_at!=="string"||typeof raw.month!=="string"||raw.published_at.slice(0,7)!==raw.month
      ||typeof raw.language!=="string"||typeof raw.country!=="string"||typeof raw.platform!=="string"
      ||raw.quality_disposition!=="included"||raw.authority_usage!=="strategic-analysis"
      ||!isDigest(raw.authority_digest)||!Array.isArray(raw.partition_memberships))
      throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_source_record_invalid",{record_index:records.length});
    if(keys.has(raw.record_key))throw new SignalTopicEvaluationFrozenImportError(
      "topic_evaluation_v2_source_record_duplicate",{duplicate_count:1});keys.add(raw.record_key);
    const partitions=raw.partition_memberships.map((item)=>{const part=parseObject(item,"partition_membership");
      if(typeof part.partition_key!=="string"||typeof part.scope!=="string"||typeof part.declared_market!=="string"
        ||!isDigest(part.provenance_digest)||!isDigest(part.authority_digest))throw new SignalTopicEvaluationFrozenImportError(
        "topic_evaluation_v2_partition_membership_invalid",{record_index:records.length});
      return{partition_key:part.partition_key,scope:part.scope,declared_market:part.declared_market,
        provenance_digest:part.provenance_digest,authority_digest:part.authority_digest} as PartitionMembership;});
    records.push({record_key:raw.record_key,canonical_family_key:raw.canonical_family_key,
      canonical_alias_count:raw.canonical_alias_count,content_hash:raw.content_hash,published_at:raw.published_at,
      month:raw.month,language:raw.language,country:raw.country,platform:raw.platform,
      partition_memberships:partitions,authority_digest:raw.authority_digest});
  }
  if(records.length!==21195)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_source_record_count_mismatch",{actual:records.length,expected:21195});
  if(records.some((record,index)=>index>0&&records[index-1]!.record_key.localeCompare(record.record_key)>=0))
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_source_order_invalid");
  return records;
}

function validateAssignments(records:SourceRecord[],labels:Int32Array,strengths:Float32Array,
  topics:PacketTopic[],packetPolicyDigest:string){
  if(labels.length!==21195||strengths.length!==21195)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_assignment_shape_mismatch",{labels:labels.length,strengths:strengths.length});
  const unique=[...new Set(labels)].sort((a,b)=>a-b);if(unique.length!==116||unique[0]!==-1
    ||unique.filter((label)=>label>=0).length!==115)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_assignment_labels_invalid",{unique_labels:unique.length});
  const runKey=signalTopicEvaluationDigestV2({assignment_digest:EXPECTED.assignment,
    packet_policy_digest:packetPolicyDigest});
  const byContent=new Map(topics.map((topic)=>[topic.sealed_packet.cluster_content_digest,topic]));
  for(const label of unique.filter((value)=>value>=0)){
    const content=records.filter((_record,index)=>labels[index]===label).map((record)=>record.content_hash).sort();
    const contentDigest=signalTopicEvaluationDigestV2(content) as Digest;const topic=byContent.get(contentDigest);
    const expectedKey=digestText(`${runKey}:${contentDigest}`);
    if(!topic||topic.sealed_packet.cluster_key!==expectedKey||topic.sealed_packet.cluster_member_count!==content.length)
      throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_assignment_packet_mismatch",
        {assignment_label:label,member_count:content.length,matched_packet_topics:topic?1:0});
  }
}

function validateTopicProfiles(records:SourceRecord[],labels:Int32Array,topics:PacketTopic[],
  resultTerms:Record<string,unknown>){
  const byContent=new Map(topics.map((topic)=>[topic.sealed_packet.cluster_content_digest,topic]));
  for(const label of [...new Set(labels)].filter((value)=>value>=0)){
    const contentDigest=signalTopicEvaluationDigestV2(records.filter((_record,index)=>labels[index]===label)
      .map((record)=>record.content_hash).sort()) as Digest;const topic=byContent.get(contentDigest);
    const terms=Array.isArray(resultTerms[String(label)])?resultTerms[String(label)] as unknown[]:[];
    const safe=terms.filter((value):value is string=>typeof value==="string");
    const localTerms=safe.filter((value)=>!value.includes("_")).slice(0,15);
    const localPhrases=safe.filter((value)=>value.includes("_")).map((value)=>value.replaceAll("_"," ")).slice(0,15);
    if(!topic||JSON.stringify(topic.sealed_packet.local_terms)!==JSON.stringify(localTerms)
      ||JSON.stringify(topic.sealed_packet.local_phrases)!==JSON.stringify(localPhrases))
      throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_result_packet_profile_mismatch",
        {assignment_label:label});
  }
}

function bindCanonicalMentions(artifacts:VerifiedArtifacts,canonical:CanonicalRow[],key:Buffer,workspaceId:string){
  const sourceByKey=new Map(artifacts.records.map((record,index)=>[record.record_key,{record,index}]));
  const bound:BoundMember[]=[];let contentMismatch=0,metadataMismatch=0,aliasMismatch=0,duplicate=0;
  const seen=new Set<string>();
  for(const row of canonical){const recordKey=hmac(key,`root:${row.id}`);const source=sourceByKey.get(recordKey);
    if(!source)continue;if(seen.has(recordKey)){duplicate+=1;continue;}seen.add(recordKey);
    const canonicalContent=digestText(normalizeText(row.text_clean));const month=iso(row.published_at).slice(0,7);
    if(canonicalContent!==source.record.content_hash){contentMismatch+=1;continue;}
    if(normalizeFacet(row.language,"und")!==source.record.language||normalizeCountry(row.country)!==source.record.country
      ||normalizeFacet(row.platform,"unknown")!==source.record.platform||month!==source.record.month){metadataMismatch+=1;continue;}
    if(Number(row.canonical_alias_count)!==source.record.canonical_alias_count){aliasMismatch+=1;continue;}
    const sourceRecordDigest=signalTopicEvaluationDigestV2({record_key:source.record.record_key,
      content_hash:source.record.content_hash,authority_digest:source.record.authority_digest,
      partition_memberships:source.record.partition_memberships}) as Digest;
    const scopes=[...new Set(source.record.partition_memberships.map((item)=>item.scope))].sort();
    const markets=[...new Set(source.record.partition_memberships.map((item)=>item.declared_market))].sort();
    const canonicalBindingDigest=signalTopicEvaluationDigestV2({contract_version:IMPORT_CONTRACT,
      workspace_id:workspaceId,mention_id:row.id,canonical_text_hash:row.text_hash,
      source_record_key:source.record.record_key,source_record_digest:sourceRecordDigest,
      source_content_hash:source.record.content_hash,language:source.record.language,markets,scopes,
      published_month:source.record.month,assignment_index:source.index,
      assignment_label:artifacts.labels[source.index]}) as Digest;
    bound.push({mention_id:row.id,cluster_key:"",source_record_key:source.record.record_key,
      source_record_digest:sourceRecordDigest,source_content_hash:source.record.content_hash,
      canonical_text_hash:row.text_hash,canonical_binding_digest:canonicalBindingDigest,
      assignment_index:source.index,assignment_label:artifacts.labels[source.index]!,
      assignment_strength:finite(artifacts.strengths[source.index]),language:source.record.language,
      markets,scopes,published_month:source.record.month,stratum:"central",cluster_rank:0});
  }
  const missing=artifacts.records.length-seen.size;
  if(missing||contentMismatch||metadataMismatch||aliasMismatch||duplicate||bound.length!==21195)
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_canonical_mapping_incomplete",
      {expected:21195,mapped:bound.length,missing,content_mismatch:contentMismatch,
        metadata_mismatch:metadataMismatch,alias_mismatch:aliasMismatch,duplicate});
  return bound;
}

function buildClusters(artifacts:VerifiedArtifacts,bound:BoundMember[],proposals:Array<{proposal_key:string;
  cluster_key:string;content:unknown}>):Cluster[]{
  const proposalByCluster=new Map(proposals.map((proposal)=>[proposal.cluster_key,proposal]));
  const topicByContent=new Map(artifacts.topics.map((topic)=>[topic.sealed_packet.cluster_content_digest,topic]));
  const grouped=new Map<number,BoundMember[]>();for(const member of bound){const group=grouped.get(member.assignment_label)??[];
    group.push(member);grouped.set(member.assignment_label,group);}
  const clusters:Cluster[]=[];
  for(const [label,members] of [...grouped.entries()].sort(([a],[b])=>a-b)){
    if(label===-1){rankMembers(members,"outlier-reservoir");clusters.push({cluster_key:"outlier-reservoir",
      proposal_key:null,profile:{label:"Outlier reservoir",terms:["outlier"],phrases:[],
        limitations:["No assigned cluster"],distributions:distributions(members),centrality_available:false},members});continue;}
    const contentDigest=signalTopicEvaluationDigestV2(members.map((member)=>artifacts.records[member.assignment_index]!.content_hash).sort()) as Digest;
    const topic=topicByContent.get(contentDigest);if(!topic)throw new SignalTopicEvaluationFrozenImportError(
      "topic_evaluation_v2_assignment_packet_mismatch",{assignment_label:label});
    const proposal=proposalByCluster.get(topic.sealed_packet.cluster_key);if(!proposal)
      throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_proposal_cluster_mismatch",
        {missing_proposal_count:1});
    const proposalContent=parseObject(proposal.content,"proposal_content");
    if(Number(proposalContent.cluster_member_count)!==members.length
      ||JSON.stringify(proposalContent.local_terms)!==JSON.stringify(topic.sealed_packet.local_terms)
      ||JSON.stringify(proposalContent.local_phrases)!==JSON.stringify(topic.sealed_packet.local_phrases)
      ||JSON.stringify(proposalContent.limitations)!==JSON.stringify(topic.sealed_packet.limitations))
      throw new SignalTopicEvaluationFrozenImportError(
      "topic_evaluation_v2_proposal_profile_mismatch",{assignment_label:label});
    rankMembers(members,topic.sealed_packet.cluster_key);clusters.push({cluster_key:topic.sealed_packet.cluster_key,
      proposal_key:proposal.proposal_key,profile:{label:topic.topic_label,terms:topic.sealed_packet.local_terms,
        phrases:topic.sealed_packet.local_phrases,limitations:topic.sealed_packet.limitations,
        distributions:distributions(members),centrality_available:true},members});
  }
  if(clusters.length!==116||clusters.filter((cluster)=>cluster.proposal_key).length!==115
    ||clusters.find((cluster)=>cluster.cluster_key==="outlier-reservoir")?.members.length!==10009)
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_cluster_count_invalid");
  return clusters;
}

function rankMembers(members:BoundMember[],clusterKey:string){
  members.sort((left,right)=>(right.assignment_strength??-1)-(left.assignment_strength??-1)
    ||left.source_record_key.localeCompare(right.source_record_key));
  const groups=new Map<string,number>();for(const member of members){const key=[member.language,
    member.markets.join(","),member.scopes.join(","),member.published_month].join("|");
    groups.set(key,(groups.get(key)??0)+1);}
  const minorityLimit=Math.max(2,Math.ceil(members.length*0.02));
  members.forEach((member,index)=>{const group=[member.language,member.markets.join(","),
    member.scopes.join(","),member.published_month].join("|");member.cluster_key=clusterKey;
    member.cluster_rank=index+1;member.stratum=(groups.get(group)??0)<=minorityLimit?"minority"
      :index>=Math.floor(members.length*0.8)?"edge":"central";});
}

function distributions(members:BoundMember[]){const count=(values:string[])=>Object.fromEntries([...new Set(values)]
  .sort().map((value)=>[value,values.filter((item)=>item===value).length]));return{
    language:count(members.flatMap((member)=>member.language?[member.language]:[])),
    market:count(members.flatMap((member)=>member.markets)),scope:count(members.flatMap((member)=>member.scopes)),
    month:count(members.map((member)=>member.published_month))};}

async function readPrivateKey(root:string){const path=resolve(dirname(root),"remote-export/pseudonym-key.private.bin");
  await requirePrivateFile(path);const key=await readFile(path);if(key.length!==32)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_pseudonym_key_invalid",{bytes:key.length});return key;}
async function requirePrivateFile(path:string){const value=await stat(path).catch(()=>null);if(!value||!value.isFile())
  throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_artifact_missing");
  if((value.mode&0o777)!==0o600)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_artifact_permissions_invalid",{mode:(value.mode&0o777).toString(8)});}
async function fileDigest(path:string):Promise<Digest>{const hash=createHash("sha256");for await(const chunk of createReadStream(path))
  hash.update(chunk as Buffer);return`sha256:${hash.digest("hex")}`;}
function resolveRepoRoot(){let current=resolve(process.cwd());for(let index=0;index<6;index+=1){if(
    existsSync(resolve(current,".data")))return current;current=dirname(current);}
  throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_repo_root_unavailable");}

function readNpz(buffer:Buffer){const files=readZip(buffer);return{labels:readNpyInt32(files.get("labels.npy")),
  strengths:readNpyFloat32(files.get("strengths.npy"))};}
function readZip(buffer:Buffer){const files=new Map<string,Buffer>();const eocd=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(eocd<0)throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_assignment_zip_invalid");
  const count=buffer.readUInt16LE(eocd+10);let offset=buffer.readUInt32LE(eocd+16);
  for(let index=0;index<count;index+=1){if(buffer.readUInt32LE(offset)!==0x02014b50)throw new SignalTopicEvaluationFrozenImportError(
    "topic_evaluation_v2_assignment_zip_invalid");const method=buffer.readUInt16LE(offset+10);
    const compressed=buffer.readUInt32LE(offset+20),uncompressed=buffer.readUInt32LE(offset+24);
    const nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32);
    const local=buffer.readUInt32LE(offset+42),name=buffer.subarray(offset+46,offset+46+nameLength).toString("utf8");
    const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),start=local+30+localName+localExtra;
    const body=buffer.subarray(start,start+compressed);const value=method===0?body:method===8?inflateRawSync(body):null;
    if(!value||value.length!==uncompressed)throw new SignalTopicEvaluationFrozenImportError(
      "topic_evaluation_v2_assignment_zip_invalid");files.set(name,value);offset+=46+nameLength+extraLength+commentLength;}
  return files;}
function readNpyInt32(buffer:Buffer|undefined){const {body,descr}=readNpy(buffer);if(descr!=="<i4")throw new SignalTopicEvaluationFrozenImportError(
  "topic_evaluation_v2_assignment_dtype_invalid");const result=new Int32Array(body.length/4);for(let i=0;i<result.length;i+=1)result[i]=body.readInt32LE(i*4);return result;}
function readNpyFloat32(buffer:Buffer|undefined){const {body,descr}=readNpy(buffer);if(descr!=="<f4")throw new SignalTopicEvaluationFrozenImportError(
  "topic_evaluation_v2_assignment_dtype_invalid");const result=new Float32Array(body.length/4);for(let i=0;i<result.length;i+=1)result[i]=body.readFloatLE(i*4);return result;}
function readNpy(buffer:Buffer|undefined){if(!buffer||!buffer.subarray(0,6).equals(Buffer.from([0x93,0x4e,0x55,0x4d,0x50,0x59])))
  throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_assignment_npy_invalid");const major=buffer[6]!;
  const headerLength=major===1?buffer.readUInt16LE(8):buffer.readUInt32LE(8),start=major===1?10:12;
  const header=buffer.subarray(start,start+headerLength).toString("latin1");const descr=/'descr':\s*'([^']+)'/u.exec(header)?.[1];
  const shape=/'shape':\s*\((\d+),?\)/u.exec(header)?.[1];if(!descr||!shape||header.includes("'fortran_order': True"))
    throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_assignment_npy_invalid");const body=buffer.subarray(start+headerLength);
  if(body.length!==Number(shape)*4)throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_assignment_shape_mismatch");return{body,descr};}

function parseObject(value:unknown,label:string):Record<string,any>{if(!value||typeof value!=="object"||Array.isArray(value))
  throw new SignalTopicEvaluationFrozenImportError("topic_evaluation_v2_artifact_shape_invalid",{artifact:label});return value as Record<string,any>;}
function isDigest(value:unknown):value is Digest{return typeof value==="string"&&/^sha256:[0-9a-f]{64}$/u.test(value);}
function normalizeText(value:string){return value.normalize("NFKC").replace(/\s+/gu," ").trim();}
function normalizeFacet(value:string|null,fallback:string){return value?.normalize("NFKC").trim().toLowerCase()||fallback;}
function normalizeCountry(value:string|null){return value?.normalize("NFKC").trim().toUpperCase()||"UNKNOWN";}
function iso(value:string|Date){const date=new Date(value);if(!Number.isFinite(date.valueOf()))throw new SignalTopicEvaluationFrozenImportError(
  "topic_evaluation_v2_canonical_timestamp_invalid");return date.toISOString();}
function digestText(value:string):Digest{return`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function digestLines(values:string[]):Digest{return digestText(values.join("\n"));}
function hmac(key:Buffer,value:string):Digest{return`sha256:${createHmac("sha256",key).update(value).digest("hex")}`;}
function finite(value:number|undefined){return value!==undefined&&Number.isFinite(value)?Number(value):null;}

export const signalTopicEvaluationV2ImportTestOnly={readNpz,validateAssignments,bindCanonicalMentions,verifyBundle,
  expected:EXPECTED,sourceRunKey:SOURCE_RUN_KEY};
