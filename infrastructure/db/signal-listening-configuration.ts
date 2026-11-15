import type {PoolClient} from 'pg';
import {validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,signalListeningJevIdentityV1,
 signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import type {LabelingDatabaseV1} from './signal-mention-facets';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {signalWorkspaceFeatureEnabledV1} from './signal-workspace-features';
import {SignalLabelingError} from './signal-labeling-runs';

export type SignalListeningAccessV1={database:LabelingDatabaseV1;workspace_id:string;actor_user_id:string};
export type SignalListeningConfigurationRecordV1={id:string;workspace_id:string;revision:number;configuration:SignalListeningConfigurationV1;
 configuration_digest:string;provenance:'human'|'agent';source_digest:string|null;state:'published'|'proposal';created_at:Date|string};
export const listeningFailV1=(code:string,status=409):never=>{throw new SignalLabelingError(code,status);};
export async function listeningTransactionV1<T>(database:LabelingDatabaseV1,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
 const c=await database.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}
 catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function authorizeSignalListeningV1(c:Pick<PoolClient,'query'>,args:Omit<SignalListeningAccessV1,'database'>,
 mode:'view'|'edit'|'process'='view'){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args,lock_authority:mode!=='view'});
 if(!caps.can_view||mode!=='view'&&!caps.can_edit_topics||mode==='process'&&!caps.can_request_processing)listeningFailV1('listening_forbidden',403);
 if(!await signalWorkspaceFeatureEnabledV1({queryable:c,workspace_id:args.workspace_id,feature:'mass_labeling'}))listeningFailV1('listening_not_enabled',404);
 return caps;
}
export async function loadSignalListeningConfigurationWithClientV1(c:Pick<PoolClient,'query'>,workspace:string,id?:string){
 const row=(await c.query<SignalListeningConfigurationRecordV1>(`SELECT * FROM signal_listening_configurations
  WHERE workspace_id=$1 AND ${id?'id=$2':'state=\'published\''} ORDER BY revision DESC LIMIT 1`,id?[workspace,id]:[workspace])).rows[0]??null;
 if(row)validateSignalListeningConfigurationV1(row.configuration);return row;
}
export async function getSignalListeningConfigurationV1(args:SignalListeningAccessV1&{configuration_id?:string}){
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args);
  return loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);});
}
export async function saveSignalListeningConfigurationV1(args:SignalListeningAccessV1&{expected_revision:number;
 configuration:SignalListeningConfigurationV1;provenance:'human'|'agent';source_digest?:string|null;state?:'published'|'proposal'}){
 validateSignalListeningConfigurationV1(args.configuration);
 if(!Number.isSafeInteger(args.expected_revision)||args.expected_revision<0||!['human','agent'].includes(args.provenance)
  ||args.provenance==='agent'&&!/^sha256:[0-9a-f]{64}$/u.test(args.source_digest??''))listeningFailV1('listening_configuration_invalid',422);
 return listeningTransactionV1(args.database,c=>saveSignalListeningConfigurationWithClientV1(c,args));
}

/** Caller owns the real transaction; all validation, CAS and human locks remain identical. */
export async function saveSignalListeningConfigurationWithClientV1(c:PoolClient,args:SignalListeningAccessV1&{expected_revision:number;
 configuration:SignalListeningConfigurationV1;provenance:'human'|'agent';source_digest?:string|null;state?:'published'|'proposal'}){
 const input=validateSignalListeningConfigurationV1(args.configuration);
 if(!Number.isSafeInteger(args.expected_revision)||args.expected_revision<0||!['human','agent'].includes(args.provenance)
  ||args.provenance==='agent'&&!/^sha256:[0-9a-f]{64}$/u.test(args.source_digest??''))listeningFailV1('listening_configuration_invalid',422);

  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[args.workspace_id]);
  await authorizeSignalListeningV1(c,args,'edit');
  const current=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id);
  if((current?.revision??0)!==args.expected_revision)listeningFailV1('listening_configuration_conflict');
  const next={...input,
   retired_question_keys:current?[...new Set([...current.configuration.retired_question_keys,...current.configuration.questions.filter(q=>!input.questions.some(i=>i.key===q.key)).map(q=>q.key)])].filter(k=>!input.questions.some(q=>q.key===k)).sort():input.retired_question_keys,
   retired_theme_keys:current?[...new Set([...current.configuration.retired_theme_keys,...current.configuration.themes.filter(t=>!input.themes.some(i=>i.key===t.key)).map(t=>t.key)])].filter(k=>!input.themes.some(t=>t.key===k)).sort():input.retired_theme_keys,
   questions:input.questions.map(q=>{
   const old=current?.configuration.questions.find(o=>o.key===q.key);
   return args.provenance==='human'&&(old?digest(old)!==digest(q)||signalListeningQuestionDigestV1(input,q)!==signalListeningQuestionDigestV1(current!.configuration,old):q.origin!=='base')?{...q,human_locked:true}:q;
  }),themes:input.themes.map(theme=>{const old=current?.configuration.themes.find(t=>t.key===theme.key);
    return args.provenance==='human'&&(!old||digest(old)!==digest(theme))?{...theme,human_locked:true}:theme;})};
  if(args.provenance==='agent'&&current&&(current.configuration.retired_question_keys.some(k=>input.questions.some(q=>q.key===k))
    ||current.configuration.retired_theme_keys.some(k=>input.themes.some(t=>t.key===k))))listeningFailV1('listening_human_edit_frozen');
  const frozenChanged=current?.configuration.questions.some(old=>old.human_locked&&!next.questions.some(q=>
   digest(q)===digest(old)&&signalListeningQuestionDigestV1(next,q)===signalListeningQuestionDigestV1(current.configuration,old)));
  if(args.provenance==='agent'&&args.state!=='proposal'&&(frozenChanged||current?.configuration.themes.some(old=>old.human_locked&&!next.themes.some(t=>digest(t)===digest(old)))))listeningFailV1('listening_human_edit_frozen');
  const revision=Number((await c.query<{revision:number}>(`SELECT COALESCE(max(revision),0)+1 revision FROM signal_listening_configurations
   WHERE workspace_id=$1`,[args.workspace_id])).rows[0]!.revision);
  const saved=(await c.query<SignalListeningConfigurationRecordV1>(`INSERT INTO signal_listening_configurations(workspace_id,revision,
   configuration,configuration_digest,provenance,source_digest,state,created_by_user_id) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8) RETURNING *`,
   [args.workspace_id,revision,JSON.stringify(next),digest(next),args.provenance,args.source_digest??null,args.state??'published',args.actor_user_id])).rows[0]!;
  await c.query(`INSERT INTO signal_listening_questions(workspace_id,configuration_id,question_key,question_digest,definition,wire,prototype_embedding_id)
   SELECT $1,$2,q->>'key',signal_listening_question_digest_v1($3::jsonb,q),q,signal_listening_wire_v1($3::jsonb,q),(q->>'prototype_embedding_id')::uuid
   FROM jsonb_array_elements($3::jsonb->'questions') q`,[args.workspace_id,saved.id,JSON.stringify(next)]);
  const verified=(await c.query<{question_key:string;question_digest:string}>(`SELECT question_key,question_digest FROM signal_listening_questions WHERE configuration_id=$1`,[saved.id])).rows;
  if(verified.some(q=>q.question_digest!==signalListeningQuestionDigestV1(next,next.questions.find(x=>x.key===q.question_key)!)))
   listeningFailV1('listening_question_digest_mismatch');
  signalListeningJevIdentityV1(saved.configuration);return saved;
}
