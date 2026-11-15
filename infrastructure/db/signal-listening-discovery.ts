import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {authorizeSignalListeningV1,listeningTransactionV1,loadSignalListeningConfigurationWithClientV1,listeningFailV1,type SignalListeningAccessV1} from './signal-listening-configuration';
import {mapCurrent} from './signal-mass-labeling';
export type ListeningDiscoveryBindingV1={question_key:string;source_topic_key:string};
export type ListeningDiscoveryGenerationV1={id:string;workspace_id:string;configuration_id:string;map_id:string;preparation_run_id:string;input_revision:string;
 embedding_config_digest:string;entity_context_digest:string;configuration_digest:string;round:number;kind:'legacy_seed'|'source_seed'|'confirmed_members';
 source_generation_id:string|null;status:'building'|'ready';counts:Record<string,number>;snapshot_digest:string};
export type ListeningDiscoverySeedV1={question_key:string;source_topic_keys?:string[];orphan_subset_id?:string;orphan_root_ids?:string[];group_digest?:string};
function fail(code:string,status=409):never{return listeningFailV1(code,status);}
const hash=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
/** External map identities are immutable; only the listening question key is aliased. */
export function signalListeningDiscoveryAliasV1(mapId:string,sourceKey:string,occupied:Iterable<string>=[]){
 if(!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(sourceKey))fail('listening_discovery_source_key_invalid',422);
 const used=new Set([...occupied,'voice','promotion']);
 if(/^[a-z][a-z0-9_]{0,63}$/u.test(sourceKey)&&!used.has(sourceKey))return sourceKey;
 for(let attempt=0;attempt<32;attempt++){const alias='mfp_'+hash(JSON.stringify([mapId,sourceKey,attempt])).slice(7,67);if(!used.has(alias))return alias;}
 return fail('listening_discovery_alias_conflict');
}
async function tx<T>(args:SignalListeningAccessV1,work:(c:PoolClient)=>Promise<T>){
 return listeningTransactionV1(args.database,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await authorizeSignalListeningV1(c,args,'process');return work(c);});
}
async function context(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string}){
 const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
 if(!cfg||cfg.state!=='published')return fail('listening_discovery_configuration_unavailable');
 const map=await mapCurrent(c,args.workspace_id,args.map_id);return{cfg,map};
}
export async function proposeSignalListeningDiscoveryBootstrapV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string}){
 return tx(args,async c=>{const {cfg,map}=await context(c,args);
  if(cfg.configuration.questions.some(q=>q.topic_source==='discovered'))fail('listening_discovery_bootstrap_already_configured');
  const configuration=structuredClone(cfg.configuration),occupied=new Set([...configuration.questions.map(q=>q.key),...configuration.retired_question_keys]);
  const bindings:ListeningDiscoveryBindingV1[]=[];
  for(const source of map.catalog){const key=signalListeningDiscoveryAliasV1(map.id,source.topic_key,occupied);occupied.add(key);
   const frozen=(await c.query(`SELECT 1 FROM signal_mass_labeling_overrides WHERE workspace_id=$1 AND map_id=$2 AND topic_key=$3 AND decided_via='human_ui' LIMIT 1`,[args.workspace_id,map.id,source.topic_key])).rows.length>0;
   configuration.questions.push({key,type:'noul',text:'Does this text discuss '+source.name+'?',positive:source.definition,negative:'Text unrelated to '+source.name,
    scope:'all',origin:'agent',human_locked:frozen,topic_source:'discovered',domain:'category',...(source.localization?{localization:source.localization}:{})});
   bindings.push({question_key:key,source_topic_key:source.topic_key});
  }
  return{configuration:validateSignalListeningConfigurationV1(configuration),bindings,source_digest:map.map_digest};
 });
}
async function start(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string;round:number},kind:ListeningDiscoveryGenerationV1['kind'],source:string|null){
 const {cfg,map}=await context(c,args),id=randomUUID();
 const row=(await c.query<ListeningDiscoveryGenerationV1>(`INSERT INTO signal_listening_discovery_generations(id,workspace_id,configuration_id,map_id,
  preparation_run_id,input_revision,embedding_config_digest,entity_context_digest,configuration_digest,round,kind,source_generation_id,created_by_user_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[id,args.workspace_id,cfg.id,map.id,map.preparation_run_id,map.input_revision,map.embedding_config_digest,map.entity_context_digest,
  cfg.configuration_digest,args.round,kind,source,args.actor_user_id])).rows[0]!;
 return{row,cfg,map};
}
async function roots(c:PoolClient,g:ListeningDiscoveryGenerationV1){
 await c.query(`INSERT INTO signal_listening_discovery_roots(generation_id,workspace_id,root_id,proof,proof_digest)
 SELECT $1,$2,p.root_id,p.proof,signal_labeling_digest_v1(p.proof) FROM signal_listening_discovery_root_proofs_v1($1,NULL::uuid[]) p`,[g.id,g.workspace_id]);
}
async function seal(c:PoolClient,g:ListeningDiscoveryGenerationV1){
 await c.query(`UPDATE signal_listening_discovery_topics t SET centroid=signal_listening_discovery_centroid_v1(t.generation_id,t.question_key),
  member_count=(SELECT count(*) FROM signal_listening_discovery_members WHERE generation_id=t.generation_id AND question_key=t.question_key)
 WHERE t.generation_id=$1 AND t.kind<>'legacy_seed'`,[g.id]);
 return(await c.query<ListeningDiscoveryGenerationV1>(`UPDATE signal_listening_discovery_generations SET status='ready',counts=signal_listening_discovery_counts_v1(id),
  snapshot_digest=signal_listening_discovery_digest_v1(id) WHERE id=$1 RETURNING *`,[g.id])).rows[0]!;
}
/** Initial base/defined-only listening has no discovered topic to bind. Freeze
 * the genuine native source census in the caller's request transaction instead
 * of requiring an operator to manufacture a discovered configuration first. */
export async function bootstrapEmptySignalListeningDiscoveryWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string}){
 await authorizeSignalListeningV1(c,args,'process');
 const {cfg}=await context(c,args);
 if(cfg.configuration.questions.some(q=>q.topic_source==='discovered'))fail('listening_discovery_initial_seed_required');
 const {row:g}=await start(c,{...args,round:0},'legacy_seed',null);
 await roots(c,g);return seal(c,g);
}
export async function bootstrapSignalListeningDiscoveryV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;bindings:ListeningDiscoveryBindingV1[]}){
 return tx(args,async c=>{const {row:g,cfg,map}=await start(c,{...args,round:0},'legacy_seed',null);
  const qs=cfg.configuration.questions.filter(q=>q.topic_source==='discovered');
  if(!qs.length||args.bindings.length!==qs.length||new Set(args.bindings.map(b=>b.question_key)).size!==qs.length||new Set(args.bindings.map(b=>b.source_topic_key)).size!==qs.length)fail('listening_discovery_bindings_invalid');
  for(const binding of args.bindings){const q=qs.find(q=>q.key===binding.question_key),source=map.catalog.find(t=>t.topic_key===binding.source_topic_key);
   if(!q||q.type!=='noul'||!source||q.positive!==source.definition)fail('listening_discovery_legacy_definition_changed');
   await c.query(`INSERT INTO signal_listening_discovery_topics(generation_id,workspace_id,configuration_id,question_key,question_digest,kind,source_map_id,source_topic_key,centroid,lineage)
    SELECT $1,$2,$3,$4,$5,'legacy_seed',map_id,topic_key,centroid,jsonb_build_object('source_map_id',map_id,'source_topic_key',topic_key,'source_definition_digest',definition_digest)
    FROM signal_mass_labeling_topics WHERE workspace_id=$2 AND map_id=$6 AND topic_key=$7`,[g.id,g.workspace_id,cfg.id,q.key,signalListeningQuestionDigestV1(cfg.configuration,q),map.id,source.topic_key]);
  }
  await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,source_override_id,created_by_user_id)
   SELECT g.workspace_id,g.configuration_id,g.map_id,t.question_key,t.question_digest,source.root_id,p.input_digest,g.entity_context_digest,source.belongs,source.id,$2
   FROM signal_listening_discovery_generations g JOIN signal_listening_discovery_topics t ON t.generation_id=g.id
   CROSS JOIN LATERAL(SELECT DISTINCT ON(root_id) old.* FROM signal_mass_labeling_overrides old WHERE old.workspace_id=g.workspace_id AND old.map_id=t.source_map_id AND old.topic_key=t.source_topic_key AND old.decided_via='human_ui' ORDER BY root_id,created_at DESC,id DESC) source
   CROSS JOIN LATERAL signal_listening_population_roots_v1(g.workspace_id,g.configuration_id,g.map_id,g.entity_context_digest,ARRAY[source.root_id],'llm-processing') p
   WHERE g.id=$1 AND p.question_key=t.question_key AND p.scope_state='included'`,[g.id,args.actor_user_id]);
  await roots(c,g);return seal(c,g);
 });
}
async function emptyTopics(c:PoolClient,g:ListeningDiscoveryGenerationV1,configuration:SignalListeningConfigurationV1,kind:'source_seed'|'confirmed_members',seeds:ListeningDiscoverySeedV1[]=[]){
 for(const q of configuration.questions.filter(q=>q.topic_source==='discovered')){
  const seed=seeds.find(s=>s.question_key===q.key);
  if(kind==='source_seed'&&!seed)fail('listening_discovery_seed_missing');
  const emptySource=kind==='source_seed'&&!seed?.orphan_root_ids?.length&&!!seed?.source_topic_keys?.length&&(await c.query<{valid:boolean}>(`SELECT count(*)=cardinality($2::text[]) AND bool_and(t.member_count=0 AND t.centroid IS NULL) valid
   FROM signal_listening_discovery_topics t JOIN signal_listening_discovery_generations source ON source.id=t.generation_id AND source.kind='confirmed_members' AND source.status='ready'
   WHERE t.generation_id=$1 AND t.workspace_id=$3 AND t.question_key=ANY($2::text[])`,[g.source_generation_id,seed.source_topic_keys,g.workspace_id])).rows[0]?.valid===true;
  await c.query(`INSERT INTO signal_listening_discovery_topics(generation_id,workspace_id,configuration_id,question_key,question_digest,kind,lineage)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[g.id,g.workspace_id,g.configuration_id,q.key,signalListeningQuestionDigestV1(configuration,q),kind,
   JSON.stringify(kind==='confirmed_members'?{source_generation_id:g.source_generation_id,approval:0.7}:{source_generation_id:g.source_generation_id,source_topic_keys:seed?.source_topic_keys??[],...(emptySource?{no_confirmed_members:true}:{}),
    ...(seed?.orphan_subset_id?{subset_id:seed.orphan_subset_id,orphan_root_ids:[...new Set(seed.orphan_root_ids??[])].sort(),group_digest:signalListeningDiscoveryOrphanGroupDigestV1(seed.orphan_subset_id,seed.orphan_root_ids??[])}: {})})]);
 }
}
export async function refreshSignalListeningDiscoveryV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;round:number;source_generation_id:string}){
 return tx(args,c=>refreshSignalListeningDiscoveryWithClientV1(c,args));
}
/** Internal caller owns one real transaction and the original source binding. */
export async function refreshSignalListeningDiscoveryWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string;round:number;source_generation_id:string}){
 await authorizeSignalListeningV1(c,args,'process');const {row:g,cfg}=await start(c,args,'confirmed_members',args.source_generation_id);await emptyTopics(c,g,cfg.configuration,'confirmed_members');await roots(c,g);
  await c.query(`INSERT INTO signal_listening_discovery_members(generation_id,workspace_id,question_key,root_id,evidence)
   SELECT r.generation_id,r.workspace_id,e->>'question_key',r.root_id,jsonb_build_object('kind',CASE WHEN e->>'manual_id' IS NULL THEN 'jev' ELSE 'manual' END,'evaluation',e)
   FROM signal_listening_discovery_roots r CROSS JOIN LATERAL jsonb_array_elements(r.proof->'evaluations') e
   JOIN signal_listening_discovery_topics t ON t.generation_id=r.generation_id AND t.question_key=e->>'question_key'
   WHERE r.generation_id=$1 AND r.proof->>'embedding_call_id' IS NOT NULL AND (e->>'probability')::double precision>=0.7`,[g.id]);
  return seal(c,g);
}
export async function seedSignalListeningDiscoveryV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;round:number;source_generation_id:string;seeds:ListeningDiscoverySeedV1[]}){
 return tx(args,c=>seedSignalListeningDiscoveryWithClientV1(c,args));
}

/** Caller owns BEGIN/COMMIT; source and authority guards are unchanged. */
export async function seedSignalListeningDiscoveryWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{configuration_id:string;map_id:string;round:number;source_generation_id:string;seeds:ListeningDiscoverySeedV1[]}){
 await authorizeSignalListeningV1(c,args,'process');const {row:g,cfg}=await start(c,args,'source_seed',args.source_generation_id);
  if(new Set(args.seeds.map(s=>s.question_key)).size!==args.seeds.length||args.seeds.length!==cfg.configuration.questions.filter(q=>q.topic_source==='discovered').length)fail('listening_discovery_seeds_invalid');
  await emptyTopics(c,g,cfg.configuration,'source_seed',args.seeds);await roots(c,g);
  for(const seed of args.seeds){
   if(!seed.source_topic_keys?.length&&!seed.orphan_root_ids?.length)fail('listening_discovery_seed_missing');
   if(seed.source_topic_keys?.length)await c.query(`INSERT INTO signal_listening_discovery_members(generation_id,workspace_id,question_key,root_id,evidence)
    SELECT $1,$2,$3,source.root_id,jsonb_build_object('kind','source_confirmed','generation_id',source.generation_id,'question_key',min(source.question_key))
    FROM signal_listening_discovery_members source WHERE source.generation_id=$4 AND source.question_key=ANY($5::text[]) AND source.evidence->>'kind' IN('jev','manual')
    GROUP BY source.generation_id,source.root_id ON CONFLICT DO NOTHING`,[g.id,g.workspace_id,seed.question_key,args.source_generation_id,seed.source_topic_keys]);
   if(seed.orphan_root_ids?.length){if(!seed.orphan_subset_id||seed.group_digest&&seed.group_digest!==signalListeningDiscoveryOrphanGroupDigestV1(seed.orphan_subset_id,seed.orphan_root_ids))fail('listening_discovery_orphan_group_invalid');
    await c.query(`INSERT INTO signal_listening_discovery_members(generation_id,workspace_id,question_key,root_id,evidence)
     SELECT $1,$2,$3,root_id,jsonb_build_object('kind','orphan_seed','subset_id',$4::uuid,'group_digest',$5::text)
     FROM unnest($6::uuid[]) r(root_id) ON CONFLICT DO NOTHING`,[g.id,g.workspace_id,seed.question_key,seed.orphan_subset_id,signalListeningDiscoveryOrphanGroupDigestV1(seed.orphan_subset_id,seed.orphan_root_ids),seed.orphan_root_ids]);
   }
  }return seal(c,g);
}
export async function setSignalListeningDiscoveryManualV1(args:SignalListeningAccessV1&{configuration_id:string;map_id:string;question_key:string;root_id:string;belongs:boolean}){
 return tx(args,async c=>{const {cfg,map}=await context(c,args),q=cfg.configuration.questions.find(q=>q.key===args.question_key);
  if(q?.topic_source!=='discovered'||!q.human_locked)fail('listening_discovery_manual_topic_must_be_frozen');
  const p=(await c.query<{input_digest:string}>(`SELECT input_digest FROM signal_listening_population_roots_v1($1,$2,$3,$4,ARRAY[$5::uuid],'llm-processing') WHERE question_key=$6 AND scope_state='included'`,
   [args.workspace_id,cfg.id,map.id,map.entity_context_digest,args.root_id,q.key])).rows[0];if(!p)fail('listening_discovery_manual_root_unavailable');
  return(await c.query<{id:string}>(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[args.workspace_id,cfg.id,map.id,q.key,signalListeningQuestionDigestV1(cfg.configuration,q),args.root_id,p.input_digest,map.entity_context_digest,args.belongs,args.actor_user_id])).rows[0]!;
 });
}

export const signalListeningDiscoveryOrphanGroupDigestV1=(subset_id:string,root_ids:string[])=>digest({subset_id,root_ids:[...new Set(root_ids)].sort()});
export async function getSignalListeningDiscoveryGenerationV1(args:SignalListeningAccessV1&{generation_id:string}){
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args);
  return(await c.query<ListeningDiscoveryGenerationV1>('SELECT * FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND id=$2 AND status=\'ready\'',[args.workspace_id,args.generation_id])).rows[0]??null;
 });
}
export async function snapshotSignalListeningDiscoveryOrphansV1(args:SignalListeningAccessV1&{generation_id:string}){
 return tx(args,c=>snapshotSignalListeningDiscoveryOrphansWithClientV1(c,args));
}

/** Caller owns BEGIN/COMMIT; source and authority guards are unchanged. */
export async function snapshotSignalListeningDiscoveryOrphansWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{generation_id:string}){
 await authorizeSignalListeningV1(c,args,'process');const id=randomUUID();
  await c.query(`INSERT INTO signal_listening_discovery_subsets(id,workspace_id,generation_id,created_by_user_id) VALUES($1,$2,$3,$4)`,[id,args.workspace_id,args.generation_id,args.actor_user_id]);
  await c.query(`INSERT INTO signal_listening_discovery_subset_roots(subset_id,generation_id,root_id,proof_digest)
   SELECT $1,generation_id,root_id,proof_digest FROM signal_listening_discovery_roots r WHERE generation_id=$2 AND workspace_id=$3
    AND proof->'in_category'='true'::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'evaluations') e WHERE e->>'probability' IS NULL OR(e->>'probability')::double precision>=0.7)`,[id,args.generation_id,args.workspace_id]);
  return(await c.query<{id:string;workspace_id:string;generation_id:string;root_count:number;cached_count:number;subset_digest:string}>(`UPDATE signal_listening_discovery_subsets s SET status='ready',root_count=totals.n,cached_count=totals.cached,
   subset_digest=signal_labeling_digest_v1(jsonb_build_object('workspace_id',s.workspace_id,'generation_id',s.generation_id,'roots',totals.roots))
   FROM(SELECT count(*)::integer n,count(*) FILTER(WHERE r.proof->>'embedding_call_id' IS NOT NULL)::integer cached,
    COALESCE(jsonb_agg(jsonb_build_array(r.root_id,r.proof_digest) ORDER BY r.root_id),'[]'::jsonb) roots
    FROM signal_listening_discovery_subset_roots chosen JOIN signal_listening_discovery_roots r ON r.generation_id=chosen.generation_id AND r.root_id=chosen.root_id WHERE chosen.subset_id=$1) totals
   WHERE s.id=$1 RETURNING s.*`,[id])).rows[0]!;
}
export async function readSignalListeningDiscoveryRootsV1(args:SignalListeningAccessV1&{generation_id:string;root_ids?:string[];after_root_id?:string;limit?:number}){
 const limit=args.limit??200;if(!Number.isSafeInteger(limit)||limit<1||limit>1024||args.root_ids&&(args.root_ids.length>1024||new Set(args.root_ids).size!==args.root_ids.length||args.after_root_id))fail('listening_discovery_page_invalid',422);
 return tx(args,async c=>{
  const g=(await c.query<ListeningDiscoveryGenerationV1>("SELECT * FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND id=$2 AND status='ready'",[args.workspace_id,args.generation_id])).rows[0];if(!g)fail('listening_discovery_generation_unavailable');
  await mapCurrent(c,args.workspace_id,g.map_id);
  const rows=(await c.query<{root_id:string;proof:Record<string,unknown>;proof_json:string;proof_digest:string;text:string;vector:string|null;allowed:boolean;source_sha:string;vector_sha:string|null}>(`SELECT r.root_id,r.proof,signal_labeling_json_v1(r.proof) proof_json,r.proof_digest,i.text,
   CASE WHEN receipt.status='settled' THEN e.embedding::text END vector,signal_listening_root_right_v1($1,r.root_id,'llm-processing') allowed,
   'sha256:'||encode(sha256(convert_to(i.text,'UTF8')),'hex') source_sha,
   CASE WHEN receipt.status='settled' THEN 'sha256:'||encode(sha256(convert_to(e.embedding::text,'UTF8')),'hex') END vector_sha
   FROM signal_listening_discovery_roots r JOIN signal_mass_labeling_items i ON i.workspace_id=r.workspace_id AND i.map_id=$3 AND i.root_id=r.root_id
   LEFT JOIN signal_workspace_chunk_embeddings e ON e.workspace_id=r.workspace_id AND e.config_digest=$4 AND e.chunk_sha256=r.proof->>'chunk_sha256'
   LEFT JOIN signal_workspace_embedding_calls receipt ON receipt.workspace_id=r.workspace_id AND receipt.id=e.call_id
   WHERE r.workspace_id=$1 AND r.generation_id=$2 AND($5::uuid[] IS NULL OR r.root_id=ANY($5)) AND($6::uuid IS NULL OR r.root_id>$6)
   ORDER BY r.root_id LIMIT $7`,[args.workspace_id,g.id,g.map_id,g.embedding_config_digest,args.root_ids??null,args.after_root_id??null,limit])).rows;
  if(args.root_ids&&rows.length!==args.root_ids.length||rows.some(r=>!r.allowed||r.source_sha!==r.proof.source_text_sha256||r.vector_sha!==r.proof.embedding_sha256))fail('listening_discovery_snapshot_stale');
  return{generation:g,roots:rows.map(r=>({root_id:r.root_id,proof:r.proof,proof_json:r.proof_json,proof_digest:r.proof_digest,text:r.text,vector_json:r.vector,vector:r.vector?JSON.parse(r.vector) as number[]:null})),next_root_id:rows.at(-1)?.root_id??null};
 });
}
export async function readSignalListeningDiscoveryOrphanSubsetV1(args:SignalListeningAccessV1&{subset_id:string;after_root_id?:string;limit?:number}){
 const limit=args.limit??200;if(!Number.isSafeInteger(limit)||limit<1||limit>1024)fail('listening_discovery_page_invalid',422);
 const source=await tx(args,async c=>{
  const subset=(await c.query<{id:string;generation_id:string;root_count:number;cached_count:number;subset_digest:string}>("SELECT * FROM signal_listening_discovery_subsets WHERE workspace_id=$1 AND id=$2 AND status='ready'",[args.workspace_id,args.subset_id])).rows[0];if(!subset)fail('listening_discovery_subset_unavailable');
  const ids=(await c.query<{root_id:string}>('SELECT root_id FROM signal_listening_discovery_subset_roots WHERE subset_id=$1 AND($2::uuid IS NULL OR root_id>$2) ORDER BY root_id LIMIT $3',[subset.id,args.after_root_id??null,limit])).rows.map(r=>r.root_id);
  return{subset,ids};
 });
 const page=await readSignalListeningDiscoveryRootsV1({...args,generation_id:source.subset.generation_id,root_ids:source.ids,after_root_id:undefined,limit});
 return{...page,subset:source.subset};
}

export async function readSignalListeningDiscoveryTopicsV1(args:SignalListeningAccessV1&{generation_id:string}){
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args);
  const rows=(await c.query<{question_key:string;question_digest:string;kind:ListeningDiscoveryGenerationV1['kind'];centroid:string|null;centroid_sha256:string|null;member_count:number;lineage:Record<string,unknown>;source_map_id:string|null;source_topic_key:string|null}>(
   `SELECT t.question_key,t.question_digest,t.kind,t.centroid::text,t.centroid_sha256,t.member_count,t.lineage,t.source_map_id,t.source_topic_key
    FROM signal_listening_discovery_topics t JOIN signal_listening_discovery_generations g ON g.id=t.generation_id AND g.workspace_id=t.workspace_id
    WHERE g.workspace_id=$1 AND g.id=$2 AND g.status='ready' ORDER BY t.question_key`,[args.workspace_id,args.generation_id])).rows;
  return rows.map(r=>({...r,centroid:r.centroid?JSON.parse(r.centroid) as number[]:null,
   centroid_status:r.centroid?r.kind:r.member_count?'cancelled_vectors' as const:'no_confirmed_members' as const}));
 });
}
