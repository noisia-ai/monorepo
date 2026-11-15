'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import type {SignalListeningQuestionV1} from '@noisia/query-engine';
import type {SignalListeningHumanEditContextV1,SignalMentionListeningLabelsV1} from '@/lib/data-os/signal-listening-human-contract';

type Context=SignalListeningHumanEditContextV1;
type Mutation={operation:'membership';expected:Context['expected'];root_id:string;from_question_key:string;to_question_key:string|null}
 |{operation:'merge';expected:Context['expected'];source_question_keys:string[];target_question_key:string};
type Refresh=()=>Promise<Context|null>;
type OnSaved=()=>Promise<boolean|void>;
type Phase='idle'|'sending'|'uncertain'|'refreshing'|'saved'|'conflict'|'denied'|'invalid'|'refresh_failed';
const endpoint=(workspaceId:string)=>`/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening/human-edits`;
const language=(locale:string)=>locale.startsWith('es')?'es':locale.startsWith('en')?'en':'original';
function topicName(question:SignalListeningQuestionV1,locale:string){
 return question.localization?.[language(locale)].name??question.text;
}
function useHumanContext(workspaceId:string){
 const [context,setContext]=useState<Context|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(false);
 const request=useRef<AbortController|null>(null),sequence=useRef(0),contextWorkspace=useRef<string|null>(null);
 const invalidate=useCallback(()=>{sequence.current++;request.current?.abort();},[]);
 const refresh=useCallback(async()=>{
  request.current?.abort();const controller=new AbortController(),version=++sequence.current;request.current=controller;
  setLoading(true);setError(false);
  try{
   const response=await fetch(endpoint(workspaceId),{cache:'no-store',signal:controller.signal});
   if(controller.signal.aborted||version!==sequence.current)return null;
   if([401,403,404].includes(response.status)){setContext(null);return null;}
   if(!response.ok)throw Error('unavailable');
   const value=await response.json()as Context;
   if(controller.signal.aborted||version!==sequence.current)return null;
   if(value.contract_version!=='signal-listening-human-edit-context-v1'||!value.expected||!Array.isArray(value.configuration?.questions)
    ||typeof value.can_edit!=='boolean')throw Error('invalid_context_contract');
   contextWorkspace.current=workspaceId;setContext(value);return value;
  }catch{if(!controller.signal.aborted&&version===sequence.current){setContext(null);setError(true);}return null;}
  finally{if(version===sequence.current)setLoading(false);}
 },[workspaceId]);
 useEffect(()=>{contextWorkspace.current=null;setContext(null);void refresh();return invalidate;},[refresh,invalidate]);
 return{context:contextWorkspace.current===workspaceId?context:null,loading,error,refresh};
}
function useHumanMutation(workspaceId:string,refresh:Refresh,onSaved?:OnSaved){
 const [phase,setPhase]=useState<Phase>('idle');
 const pending=useRef<{body:string;key:string;workspaceId:string}|null>(null),sending=useRef(false),generation=useRef(0),confirmed=useRef(false);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 useEffect(()=>{generation.current++;pending.current=null;sending.current=false;confirmed.current=false;setPhase('idle');return invalidate;},[workspaceId,invalidate]);
 const refreshSaved=async()=>{
  const current=generation.current;setPhase('refreshing');
  try{if(!await refresh()||await onSaved?.()===false)throw Error('refresh');if(current===generation.current)setPhase(confirmed.current?'saved':'idle');}
  catch{if(current===generation.current)setPhase('refresh_failed');}
 };
 const send=async()=>{
  const frozen=pending.current;if(!frozen||frozen.workspaceId!==workspaceId||sending.current)return;
  const current=generation.current;sending.current=true;setPhase('sending');
  try{
   const response=await fetch(endpoint(workspaceId),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':frozen.key},body:frozen.body});
   if(current!==generation.current)return;
   if(response.status>=400&&response.status<500){
    pending.current=null;setPhase([401,403].includes(response.status)?'denied':response.status===409?'conflict':'invalid');await refresh();return;
   }
   if(!response.ok)throw Error('uncertain');
   const receipt=await response.json()as {id?:string;revision?:number;configuration_id?:string;operation?:string};
   const original=JSON.parse(frozen.body)as Mutation,operation=original.operation==='merge'?'merge':original.to_question_key?'move':'remove';
   if(!receipt.id||!receipt.configuration_id||!Number.isSafeInteger(receipt.revision)||receipt.operation!==operation)throw Error('uncertain');
   if(current!==generation.current)return;
   pending.current=null;confirmed.current=true;await refreshSaved();
  }catch{if(current===generation.current)setPhase('uncertain');}
  finally{if(current===generation.current)sending.current=false;}
 };
 const submit=(body:Mutation)=>{
  if(pending.current||sending.current||phase==='refresh_failed')return;
  confirmed.current=false;pending.current={body:JSON.stringify(body),key:crypto.randomUUID(),workspaceId};void send();
 };
 return{phase,submit,retry:()=>void send(),refreshSaved:()=>void refreshSaved(),locked:['sending','uncertain','refreshing','refresh_failed'].includes(phase)};
}
function MutationStatus({mutation}:{mutation:ReturnType<typeof useHumanMutation>}){
 const t=useTranslations('ListeningHuman'),{phase}=mutation;
 if(phase==='idle')return null;
 return <div role={['conflict','denied','invalid','uncertain','refresh_failed'].includes(phase)?'alert':'status'}>
  <p>{t(phase)}</p>
  {phase==='uncertain'?<button type="button" className="admin-button" onClick={mutation.retry}>{t('retrySame')}</button>:null}
  {phase==='refresh_failed'?<button type="button" className="admin-button" onClick={mutation.refreshSaved}>{t('refresh')}</button>:null}
 </div>;
}
function bindingMatches(labels:SignalMentionListeningLabelsV1,context:Context){
 return labels.binding.snapshot_id===(context.human_snapshot_id??context.expected.base_snapshot_id)
  &&labels.binding.configuration_id===context.expected.configuration_id
  &&labels.binding.generation_id===context.expected.source_generation_id&&labels.binding.map_id===context.expected.map_id
  &&labels.binding.human_snapshot_id===context.human_snapshot_id;
}

/** This section reads only native Listening labels. Legacy tags and T&B codings
 * never become thematic membership or a synthetic model probability here. */
export function ListeningMentionLabels({labels,compact=false}:{labels:SignalMentionListeningLabelsV1;compact?:boolean}){
 const t=useTranslations('ListeningHuman'),locale=useLocale(),visible=labels.labels.filter(label=>label.domain!=='outside'&&(!compact||label.effective_belongs===true));
 return <section className="signal-v2-mention-drawer__section" aria-label={t('labelsTitle')}>
  <h3>{t('labelsTitle')}</h3>
  {visible.length?<ul>{visible.map(label=><li key={label.question_key}>
   <strong>{label.names?.[language(locale)]??label.name}</strong>{' '}
   <span>{t(label.effective_belongs===true?'belongs':label.effective_belongs===false?'doesNotBelong':'unasked')}</span>
   {!compact?<><small>{t('jevProbability',{value:label.probability===null?'—':new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(label.probability)})}</small>{' '}
    <small>{t(label.human_belongs!==null||label.human_decision_id!==null||label.label_source==='human'?'humanDecision':'modelDecision')}</small></>:null}
  </li>)}</ul>:<p>{t('noPositiveLabels')}</p>}
 </section>;
}

export function ListeningMentionActions({workspaceId,rootId,labels,onSaved}:{workspaceId:string;rootId:string;labels:SignalMentionListeningLabelsV1;onSaved:OnSaved}){
 const t=useTranslations('ListeningHuman'),locale=useLocale(),{context,loading,error,refresh}=useHumanContext(workspaceId);
 const mutation=useHumanMutation(workspaceId,refresh,onSaved),[destinations,setDestinations]=useState<Record<string,string>>({});
 useEffect(()=>setDestinations({}),[rootId,context?.expected.configuration_id]);
 const matches=context&&bindingMatches(labels,context),canEdit=Boolean(context?.can_edit&&matches);
 const topics=context?.configuration.questions.filter(question=>question.type==='noul'&&question.topic_source&&question.domain!=='outside')??[];
 const positive=labels.labels.filter(label=>label.domain!=='outside'&&label.effective_belongs===true);
 return <section className="signal-v2-mention-drawer__section" aria-label={t('correctionsTitle')} aria-busy={loading||mutation.phase==='sending'||mutation.phase==='refreshing'}>
  <MutationStatus mutation={mutation}/>
  {error?<p role="alert">{t('unavailable')}</p>:null}
  {context&&!matches?<p role="status">{t('staleLabels')} <button className="admin-button" type="button" disabled={mutation.locked} onClick={()=>void mutation.refreshSaved()}>{t('refresh')}</button></p>:null}
  {canEdit&&positive.length?<><h3>{t('correctionsTitle')}</h3><p>{t('correctionsHelp')}</p>
   {positive.map(label=><fieldset key={label.question_key} disabled={loading||mutation.locked} className="admin-section">
    <legend>{label.names?.[language(locale)]??label.name}</legend>
    <button className="admin-button" type="button" disabled={loading||mutation.locked} onClick={()=>mutation.submit({operation:'membership',expected:context!.expected,root_id:rootId,from_question_key:label.question_key,to_question_key:null})}>{t('remove')}</button>
    <label className="admin-form-field"><span>{t('moveTo')}</span><select disabled={loading||mutation.locked} value={destinations[label.question_key]??''} onChange={event=>setDestinations(current=>({...current,[label.question_key]:event.target.value}))}>
     <option value="">{t('chooseTopic')}</option>
     {topics.filter(topic=>topic.key!==label.question_key&&labels.labels.some(candidate=>candidate.question_key===topic.key)).map(topic=><option key={topic.key} value={topic.key}>{topicName(topic,locale)}</option>)}
    </select></label>
    <button className="admin-button" type="button" disabled={loading||mutation.locked||!destinations[label.question_key]} onClick={()=>mutation.submit({operation:'membership',expected:context!.expected,root_id:rootId,from_question_key:label.question_key,to_question_key:destinations[label.question_key]!})}>{t('move')}</button>
   </fieldset>)}
  </>:null}
 </section>;
}

/** A versioned published catalogue, independent of the historical term_key map.
 * Counts are intentionally absent: this endpoint supplies definitions, not an
 * aggregate population. Human edits require its native completed snapshot. */
export function PublishedListeningTopics({workspaceId,allowMerge=false,disabled=false,onSaved}:{workspaceId:string;allowMerge?:boolean;disabled?:boolean;onSaved?:OnSaved}){
 const t=useTranslations('ListeningHuman'),locale=useLocale(),{context,loading,error,refresh}=useHumanContext(workspaceId);
 const mutation=useHumanMutation(workspaceId,refresh,onSaved),[outside,setOutside]=useState(false),[selected,setSelected]=useState<string[]>([]),[target,setTarget]=useState('');
 useEffect(()=>{setSelected([]);setTarget('');},[workspaceId,context?.expected.configuration_id]);
 const topics=context?.configuration.questions.filter(question=>question.type==='noul'&&question.topic_source)??[];
 const visible=topics.filter(question=>outside||question.domain!=='outside'),selectedTopics=visible.filter(question=>selected.includes(question.key));
 const canMerge=allowMerge&&context?.can_edit,locked=disabled||loading||mutation.locked;
 if(!context)return error||mutation.phase!=='idle'?<section className="signal-v2-card">
  <MutationStatus mutation={mutation}/>
  {error&&mutation.phase==='idle'?<><p role="status">{t('unavailable')}</p><button className="admin-button" type="button" onClick={()=>void refresh()}>{t('refresh')}</button></>:null}
 </section>:null;
 const groups=[...context.configuration.themes.map(theme=>({key:theme.key,name:theme.localization?.[language(locale)].name??theme.name})),{key:'',name:t('withoutTheme')}];
 return <section className="signal-v2-card admin-section" aria-label={t('publishedTitle')} aria-busy={loading||mutation.phase==='sending'||mutation.phase==='refreshing'}>
  <header className="signal-v2-card__heading"><div><h2>{t('publishedTitle')}</h2><p>{t('publishedHelp')}</p></div></header>
  <MutationStatus mutation={mutation}/>
  <label><input type="checkbox" checked={outside} disabled={locked} onChange={event=>{setOutside(event.target.checked);setSelected([]);setTarget('');}}/>{t('showOutside')}</label>
  {!visible.length?<p>{t('emptyCatalogue')}</p>:groups.map(group=>{
   const members=visible.filter(question=>(question.parent_theme_key??'')===group.key);if(!members.length)return null;
   return <section key={group.key} className="admin-section"><h3>{group.name}</h3><ul>{members.map(question=><li key={question.key}>
    {canMerge?<label><input type="checkbox" checked={selected.includes(question.key)} disabled={locked||Boolean(selectedTopics.length&&selectedTopics[0]!.scope!==question.scope)}
     aria-label={t('selectMerge',{topic:topicName(question,locale)})} onChange={event=>{setSelected(current=>event.target.checked?[...current,question.key]:current.filter(key=>key!==question.key));if(target===question.key)setTarget('');}}/>{topicName(question,locale)}</label>:<strong>{topicName(question,locale)}</strong>}
    {' '}<span>{t(question.topic_source==='defined'?'defined':'discovered')}</span>{' '}<span>{t(question.domain??'category')}</span>{' '}<span>{t(question.scope)}</span>
    <p>{question.localization?.[language(locale)].definition??(question.type==='noul'?question.positive:question.text)}</p>
   </li>)}</ul></section>;
  })}
  {canMerge&&topics.length>=2?<fieldset className="admin-section" disabled={locked}><legend>{t('mergeTitle')}</legend><p>{t('mergeHelp')}</p>
   <label className="admin-form-field"><span>{t('mergeTarget')}</span><select disabled={locked} value={target} onChange={event=>setTarget(event.target.value)}>
    <option value="">{t('chooseTopic')}</option>{selectedTopics.map(question=><option key={question.key} value={question.key}>{topicName(question,locale)}</option>)}
   </select></label>
   <button type="button" className="admin-button" disabled={locked||selectedTopics.length<2||!selected.includes(target)}
    onClick={()=>mutation.submit({operation:'merge',expected:context.expected,source_question_keys:selectedTopics.map(question=>question.key),target_question_key:target})}>{t('merge')}</button>
  </fieldset>:null}
 </section>;
}
