import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1,saveSignalListeningConfigurationWithClientV1,
 listeningTransactionV1,listeningFailV1 as nativeFail,type SignalListeningAccessV1,type SignalListeningConfigurationRecordV1} from './signal-listening-configuration';
import {mapCurrent} from './signal-mass-labeling';

type Access=SignalListeningAccessV1;
function fail(code:string,status=409):never{return nativeFail(code,status);}
export type SignalListeningHumanExpectedV1={base_snapshot_id:string;configuration_id:string;configuration_digest:string;
 source_generation_id:string;source_generation_digest:string;map_id:string;source_digest:string;
 policy_version_id:string;policy_digest:string;human_revision_digest:string;edit_revision:number;previous_edit_id:string|null};
export type SignalListeningHumanEditReceiptV1={id:string;workspace_id:string;revision:number;configuration_id:string;generation_id:string;
 snapshot_digest:string;operation:'remove'|'move'|'merge';decision_count:number;replayed:boolean};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu,sha=/^sha256:[a-f0-9]{64}$/u,key=/^[a-z][a-z0-9_]{0,63}$/u;
function validExpected(e:SignalListeningHumanExpectedV1){
 if(!e||![e.base_snapshot_id,e.configuration_id,e.source_generation_id,e.map_id,e.policy_version_id].every(x=>typeof x==='string'&&uuid.test(x))
  ||![e.configuration_digest,e.source_generation_digest,e.source_digest,e.policy_digest,e.human_revision_digest].every(x=>typeof x==='string'&&sha.test(x))
  ||!Number.isSafeInteger(e.edit_revision)||e.edit_revision<0||e.previous_edit_id!==null&&!uuid.test(e.previous_edit_id))fail('listening_human_expected_invalid',422);
}
type Base={id:string;configuration_id:string;generation_id:string;classification_run_id:string;map_id:string;snapshot_digest:string;
 policy_version_id:string;policy_digest:string;execution_status:string};
async function context(c:PoolClient,args:Access,mode:'view'|'edit'='view'){
 const capabilities=await authorizeSignalListeningV1(c,args,mode);
 const base=(await c.query<Base>(`SELECT s.*,p.policy_version_id,policy.policy_digest,p.status execution_status FROM signal_listening_serving_snapshots s
  JOIN signal_listening_discovery_executions p ON p.id=s.execution_id AND p.workspace_id=s.workspace_id
  JOIN signal_processing_policy_versions policy ON policy.id=p.policy_version_id
  WHERE s.workspace_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,[args.workspace_id])).rows[0];
 if(!base)fail('listening_human_snapshot_unavailable',404);
 const last=(await c.query<{id:string;configuration_id:string;generation_id:string}>('SELECT id,configuration_id,generation_id FROM signal_listening_human_edits WHERE workspace_id=$1 AND base_snapshot_id=$2 ORDER BY revision DESC LIMIT 1',[args.workspace_id,base.id])).rows[0];
 const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,last?.configuration_id??base.configuration_id);
 if(!cfg||cfg.state!=='published')return fail('listening_human_configuration_unavailable');
 const current=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id);
 const generation=(await c.query<{id:string;snapshot_digest:string;source_current:boolean}>(`SELECT id,snapshot_digest,signal_listening_discovery_source_current_v1(id) source_current
  FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND id=$2 AND configuration_id=$3 AND status='ready'`,[args.workspace_id,last?.generation_id??base.generation_id,cfg.id])).rows[0];
 if(!generation?.source_current)fail('listening_human_source_stale');
 const map=await mapCurrent(c,args.workspace_id,base.map_id);
 const latestEdit=(await c.query<{id:string;revision:string}>('SELECT id,revision::text FROM signal_listening_human_edits WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 1',[args.workspace_id])).rows[0];
 const human=(await c.query<{digest:string}>('SELECT signal_listening_discovery_human_revision_v1($1) digest',[cfg.id])).rows[0]!.digest;
 const expected:SignalListeningHumanExpectedV1={base_snapshot_id:base.id,configuration_id:cfg.id,configuration_digest:cfg.configuration_digest,
  source_generation_id:generation.id,source_generation_digest:generation.snapshot_digest,map_id:map.id,source_digest:base.snapshot_digest,
  policy_version_id:base.policy_version_id,policy_digest:base.policy_digest,human_revision_digest:human,edit_revision:Number(latestEdit?.revision??0),previous_edit_id:latestEdit?.id??null};
 const ready=base.execution_status==='completed'&&current?.id===cfg.id;
 if(mode==='edit'&&!ready)fail('listening_human_processing_not_completed');
 return{expected,configuration:cfg,map,base,capabilities,ready,human_snapshot_id:last?.id??null};
}
export async function getSignalListeningHumanEditContextV1(args:Access){return listeningTransactionV1(args.database,async c=>{
 const value=await context(c,args);return{contract_version:'signal-listening-human-edit-context-v1' as const,expected:value.expected,
  configuration:value.configuration.configuration,can_edit:value.ready&&value.capabilities.can_edit_topics,human_snapshot_id:value.human_snapshot_id};});}

type EditArgs=Access&{expected:SignalListeningHumanExpectedV1;idempotency_key:string};
type Payload={root_id:string;from_question_key:string;to_question_key?:string}|{source_question_keys:string[];target_question_key:string};
function topic(configuration:SignalListeningConfigurationV1,k:string){const q=configuration.questions.find(q=>q.key===k);
 if(!q||q.type!=='noul'||!q.topic_source)fail('listening_human_topic_unavailable',404);return q;}
async function receipt(c:PoolClient,id:string,replayed:boolean):Promise<SignalListeningHumanEditReceiptV1>{
 const row=(await c.query<Omit<SignalListeningHumanEditReceiptV1,'replayed'>>(`SELECT e.id,e.workspace_id,e.revision::int,e.configuration_id,e.generation_id,e.snapshot_digest,e.operation,
  (SELECT count(*)::int FROM signal_listening_human_memberships WHERE edit_id=e.id) decision_count FROM signal_listening_human_edits e WHERE e.id=$1`,[id])).rows[0];
 if(!row)fail('listening_human_edit_unavailable');return{...row,replayed};
}
async function edit(args:EditArgs,operation:SignalListeningHumanEditReceiptV1['operation'],payload:Payload){
 validExpected(args.expected);if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('listening_human_idempotency_invalid',422);
 const request_digest=digest({contract_version:'signal-listening-human-edit-v1',workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,expected:args.expected,operation,payload});
 return listeningTransactionV1(args.database,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[args.workspace_id]);
  await authorizeSignalListeningV1(c,args,'edit');
  const prior=(await c.query<{id:string;request_digest:string}>('SELECT id,request_digest FROM signal_listening_human_edits WHERE workspace_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.request_digest!==request_digest)fail('listening_human_idempotency_conflict');return receipt(c,prior.id,true);}
  const source=await context(c,args,'edit');if(digest(source.expected)!==digest(args.expected))fail('listening_human_context_changed');
  const configuration=structuredClone(source.configuration.configuration);
  if(operation==='merge'){
   const p=payload as Extract<Payload,{source_question_keys:string[]}>;
   const qs=p.source_question_keys.map(k=>topic(configuration,k));topic(configuration,p.target_question_key);
   if(!p.source_question_keys.includes(p.target_question_key)||new Set(qs.map(q=>q.scope)).size!==1)fail('listening_human_merge_scope_invalid',422);
   configuration.questions=configuration.questions.filter(q=>!p.source_question_keys.includes(q.key)||q.key===p.target_question_key)
    .map(q=>q.key===p.target_question_key?{...q,human_locked:true}:q);
  }else{
   const p=payload as Extract<Payload,{root_id:string}>;topic(configuration,p.from_question_key);if(p.to_question_key)topic(configuration,p.to_question_key);
   await c.query('SELECT id FROM mentions WHERE workspace_id=$1 AND id=$2 FOR SHARE',[args.workspace_id,p.root_id]);
   const rows=(await c.query<{question_key:string;effective_belongs:boolean|null;scope_state:string}>(`SELECT question_key,effective_belongs,scope_state FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,ARRAY[$5::uuid],'client-derived-metrics')`,
    [args.workspace_id,source.configuration.id,source.map.id,source.map.entity_context_digest,p.root_id])).rows;
   if(!rows.some(r=>r.question_key===p.from_question_key&&r.scope_state==='included'&&r.effective_belongs===true)
    ||p.to_question_key&&!rows.some(r=>r.question_key===p.to_question_key&&r.scope_state==='included'))fail('listening_human_membership_unavailable');
   configuration.questions=configuration.questions.map(q=>q.key===p.from_question_key||q.key===p.to_question_key?{...q,human_locked:true}:q);
  }
  const id=randomUUID(),generation_id=randomUUID(),revision=args.expected.edit_revision+1;
  await c.query("SELECT set_config('noisia.listening_human_edit_v1',$1,true)",[JSON.stringify({edit_id:id,actor_user_id:args.actor_user_id})]);
  const saved=await saveSignalListeningConfigurationWithClientV1(c,{...args,configuration,expected_revision:source.configuration.revision,provenance:'human'});
  const snapshot_digest=digest({contract_version:'signal-listening-human-snapshot-v1',workspace_id:args.workspace_id,base_snapshot_id:source.base.id,
   configuration_id:saved.id,configuration_digest:saved.configuration_digest,generation_id,revision,operation,payload,source_digest:source.base.snapshot_digest});
  await c.query(`INSERT INTO signal_listening_human_edits(id,workspace_id,revision,base_snapshot_id,source_configuration_id,configuration_id,source_generation_id,generation_id,map_id,
   expected_revision,previous_edit_id,operation,payload,idempotency_key,request_digest,source_digest,source_generation_digest,policy_version_id,policy_digest,human_revision_digest,snapshot_digest,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
   [id,args.workspace_id,revision,source.base.id,source.configuration.id,saved.id,source.expected.source_generation_id,generation_id,source.map.id,args.expected.edit_revision,args.expected.previous_edit_id,
    operation,JSON.stringify(payload),args.idempotency_key,request_digest,source.base.snapshot_digest,source.expected.source_generation_digest,source.expected.policy_version_id,source.expected.policy_digest,source.expected.human_revision_digest,snapshot_digest,args.actor_user_id]);
  if(operation==='merge'){
   const p=payload as Extract<Payload,{source_question_keys:string[]}>;
   await c.query(`SELECT m.id FROM mentions m WHERE m.workspace_id=$1 AND m.id IN(SELECT p.root_id FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,NULL,'client-derived-metrics') p
    WHERE p.question_key=ANY($5::text[]) AND p.scope_state='included' AND p.effective_belongs) ORDER BY m.id FOR SHARE OF m`,[args.workspace_id,source.configuration.id,source.map.id,source.map.entity_context_digest,p.source_question_keys]);
   await c.query(`INSERT INTO signal_listening_human_memberships(workspace_id,edit_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,source_evidence)
    SELECT $1,$2,$3,$6,q.question_digest,p.root_id,max(p.input_digest),$4,true,signal_listening_human_source_evidence_v1($2,p.root_id)
    FROM signal_listening_effective_population_roots_v2($1,$7,$3,$4,NULL,'client-derived-metrics') p
    JOIN signal_listening_questions q ON q.configuration_id=$8 AND q.question_key=$6
    WHERE p.question_key=ANY($5::text[]) AND p.scope_state='included' AND p.effective_belongs GROUP BY q.question_digest,p.root_id`,
    [args.workspace_id,id,source.map.id,source.map.entity_context_digest,p.source_question_keys,p.target_question_key,source.configuration.id,saved.id]);
   await c.query(`INSERT INTO signal_listening_human_aliases(workspace_id,edit_id,source_key,target_key) SELECT $1,$2,k,$4 FROM unnest($3::text[]) keys(k) WHERE k<>$4`,[args.workspace_id,id,p.source_question_keys,p.target_question_key]);
  }else{
   const p=payload as Extract<Payload,{root_id:string}>;
   await c.query(`INSERT INTO signal_listening_human_memberships(workspace_id,edit_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,source_evidence)
    SELECT $1,$2,$3,q.question_key,q.question_digest,$4,p.input_digest,$5,COALESCE(q.question_key=$7,false),signal_listening_human_source_evidence_v1($2,$4)
    FROM signal_listening_questions q CROSS JOIN LATERAL signal_listening_effective_population_roots_v2($1,$8,$3,$5,ARRAY[$4::uuid],'client-derived-metrics') p
    WHERE q.configuration_id=$9 AND q.question_key=ANY($6::text[]) AND p.question_key=$10`,
    [args.workspace_id,id,source.map.id,p.root_id,source.map.entity_context_digest,[p.from_question_key,...(p.to_question_key?[p.to_question_key]:[])],p.to_question_key??null,source.configuration.id,saved.id,p.from_question_key]);
  }
  await materialize(c,args,{id,generation_id,saved,source_generation_id:source.expected.source_generation_id});
  await c.query("SELECT set_config('noisia.listening_human_edit_v1','',true)");
  return receipt(c,id,false);
 });
}
async function materialize(c:PoolClient,args:Access,a:{id:string;generation_id:string;saved:SignalListeningConfigurationRecordV1;source_generation_id:string}){
 await c.query(`INSERT INTO signal_listening_discovery_generations(id,workspace_id,configuration_id,map_id,preparation_run_id,input_revision,embedding_config_digest,entity_context_digest,
  configuration_digest,round,kind,source_generation_id,created_by_user_id,human_edit_id)
  SELECT $1,$2,$3,g.map_id,g.preparation_run_id,g.input_revision,g.embedding_config_digest,g.entity_context_digest,$4,g.round,'confirmed_members',g.id,$5,$6
  FROM signal_listening_discovery_generations g WHERE g.id=$7 AND g.workspace_id=$2`,[a.generation_id,args.workspace_id,a.saved.id,a.saved.configuration_digest,args.actor_user_id,a.id,a.source_generation_id]);
 await c.query(`INSERT INTO signal_listening_discovery_topics(generation_id,workspace_id,configuration_id,question_key,question_digest,kind,lineage)
  SELECT $1,$2,$3,q.question_key,q.question_digest,'confirmed_members',jsonb_build_object('source_generation_id',$4::uuid,'approval',0.7)
  FROM signal_listening_questions q WHERE q.configuration_id=$3 AND q.definition->>'topic_source'='discovered'`,[a.generation_id,args.workspace_id,a.saved.id,a.source_generation_id]);
 await c.query(`INSERT INTO signal_listening_discovery_roots(generation_id,workspace_id,root_id,proof,proof_digest) SELECT $1,$2,p.root_id,p.proof,signal_labeling_digest_v1(p.proof)
  FROM signal_listening_discovery_root_proofs_v1($1,NULL::uuid[]) p`,[a.generation_id,args.workspace_id]);
 await c.query(`UPDATE signal_listening_discovery_generations SET status='ready',counts=signal_listening_discovery_counts_v1(id),snapshot_digest=signal_listening_discovery_digest_v1(id) WHERE id=$1`,[a.generation_id]);
}
export function correctSignalListeningTopicMembershipV1(args:EditArgs&{root_id:string;from_question_key:string;to_question_key?:string|null}){
 if(!uuid.test(args.root_id)||!key.test(args.from_question_key)||args.to_question_key!=null&&(!key.test(args.to_question_key)||args.to_question_key===args.from_question_key))fail('listening_human_membership_invalid',422);
 return edit(args,args.to_question_key?'move':'remove',{root_id:args.root_id,from_question_key:args.from_question_key,...(args.to_question_key?{to_question_key:args.to_question_key}:{})});
}
export function mergeSignalListeningTopicsV1(args:EditArgs&{source_question_keys:string[];target_question_key:string}){
 if(!Array.isArray(args.source_question_keys)||args.source_question_keys.length<2||args.source_question_keys.length>256||new Set(args.source_question_keys).size!==args.source_question_keys.length
  ||args.source_question_keys.some(k=>!key.test(k))||!key.test(args.target_question_key))fail('listening_human_merge_invalid',422);
 return edit(args,'merge',{source_question_keys:[...args.source_question_keys].sort(),target_question_key:args.target_question_key});
}

/** Explicit human/native binding; selecting an old human snapshot never silently
 * applies newer decisions. The returned generation is sealed for this revision. */
export async function getSignalListeningEffectiveServingSnapshotV1(args:Access&{human_snapshot_id?:string}){
 if(args.human_snapshot_id&&!uuid.test(args.human_snapshot_id))fail('listening_human_snapshot_invalid',422);
 return listeningTransactionV1(args.database,async c=>{
  await authorizeSignalListeningV1(c,args);
  if(args.human_snapshot_id){
   const row=(await c.query<{id:string;configuration_id:string;generation_id:string;map_id:string;snapshot_digest:string;revision:number;source_current:boolean;classification_run_id:string}>(`SELECT e.id,e.configuration_id,e.generation_id,e.map_id,e.snapshot_digest,e.revision::int,
    signal_listening_discovery_source_current_v1(e.generation_id) source_current,s.classification_run_id
    FROM signal_listening_human_edits e JOIN signal_listening_serving_snapshots s ON s.id=e.base_snapshot_id AND s.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.id=$2`,[args.workspace_id,args.human_snapshot_id])).rows[0];
   if(!row?.source_current)return null;await mapCurrent(c,args.workspace_id,row.map_id);const{source_current:_,...binding}=row;
   return{...binding,binding_kind:'human' as const,human_snapshot_id:row.id};
  }
  const value=await context(c,args),id=value.human_snapshot_id??value.base.id;
  return{id,configuration_id:value.configuration.id,generation_id:value.expected.source_generation_id,map_id:value.map.id,
   snapshot_digest:value.human_snapshot_id?(await c.query<{snapshot_digest:string}>('SELECT snapshot_digest FROM signal_listening_human_edits WHERE id=$1',[id])).rows[0]!.snapshot_digest:value.base.snapshot_digest,
   classification_run_id:value.base.classification_run_id,binding_kind:value.human_snapshot_id?'human' as const:'native' as const,
   human_snapshot_id:value.human_snapshot_id,configuration_is_latest:value.ready};
 });
}
export async function readSignalListeningEffectiveTopicLabelsV1(args:Access&{configuration_id:string;map_id:string;root_ids:string[];question_keys:string[]}){
 if(!uuid.test(args.configuration_id)||!uuid.test(args.map_id)||!Array.isArray(args.root_ids)||args.root_ids.length<1||args.root_ids.length>200
  ||new Set(args.root_ids).size!==args.root_ids.length||args.root_ids.some(id=>!uuid.test(id))||!Array.isArray(args.question_keys)||args.question_keys.length<1||args.question_keys.length>8
  ||new Set(args.question_keys).size!==args.question_keys.length||args.question_keys.some(k=>!key.test(k)))fail('listening_human_read_invalid',422);
 return listeningTransactionV1(args.database,async c=>{
  await authorizeSignalListeningV1(c,args);const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);
  if(!cfg||cfg.state!=='published')return fail('listening_human_configuration_unavailable');args.question_keys.forEach(k=>topic(cfg.configuration,k));
  const map=await mapCurrent(c,args.workspace_id,args.map_id);
  return(await c.query<{root_id:string;question_key:string;question_digest:string;input_digest:string;answer:unknown;cache_call_id:string|null;
   effective_belongs:boolean|null;human_belongs:boolean|null;human_decision_id:string|null;legacy_manual_id:string|null;label_source:string;human_edit_revision:string|null}>(
   `SELECT root_id,question_key,question_digest,input_digest,answer,cache_call_id,effective_belongs,human_belongs,human_decision_id,legacy_manual_id,label_source,human_edit_revision::text
    FROM signal_listening_effective_population_roots_v2($1,$2,$3,$4,$5::uuid[],'client-derived-metrics') WHERE question_key=ANY($6::text[]) AND scope_state='included'
    ORDER BY root_id,question_key`,[args.workspace_id,cfg.id,map.id,map.entity_context_digest,args.root_ids,args.question_keys])).rows;
 });
}
