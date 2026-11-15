'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useTranslations} from 'next-intl';
import type {SignalListeningConfigurationV1,SignalListeningQuestionV1} from '@noisia/query-engine';
import {ListeningLexiconSuggestions} from './ListeningLexiconSuggestions';

type Status={configuration:{id:string;revision:number;configuration:SignalListeningConfigurationV1}|null;
  discovery?:{intent_id:string;status:string;execution_status:string|null}|null;
  map:{id:string;root_count:number}|null;run:{id:string;status:string;unknown_micro_usd?:string}|null;preparation?:{id:string;status:string}|null;map_stale?:boolean;capabilities:{can_edit_topics:boolean;can_request_processing:boolean}};
export function SignalListeningConfiguration({workspaceId,editable=true}:{workspaceId:string;editable?:boolean}){
  const t=useTranslations('Listening'),tSettings=useTranslations('LabelingStudySettings'),[status,setStatus]=useState<Status|null>(null),[draft,setDraft]=useState<SignalListeningConfigurationV1|null>(null);
  const [draftRevision,setDraftRevision]=useState(0),[category,setCategory]=useState(''),[lexicon,setLexicon]=useState(''),[budget,setBudget]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false),[unavailable,setUnavailable]=useState(false),[retry,setRetry]=useState(0);
  const key=useRef<string|null>(null),generation=useRef(0);
  const draftValue=useRef<SignalListeningConfigurationV1|null>(null),draftBase=useRef<Status['configuration']>(null);
  const statusValue=useRef<Status|null>(null);
  const updateStatus=useCallback((next:Status|null)=>{statusValue.current=next;setStatus(next);},[]);
  const updateDraft=useCallback((next:SignalListeningConfigurationV1|null|((current:SignalListeningConfigurationV1|null)=>SignalListeningConfigurationV1|null))=>{
    const value=typeof next==='function'?next(draftValue.current):next;
    draftValue.current=value;setDraft(value);
  },[]);
  const adoptConfiguration=useCallback((next:Status['configuration'])=>{
    draftBase.current=next;updateDraft(next?.configuration??null);setDraftRevision(next?.revision??0);
  },[updateDraft]);
  const reconcileStatus=useCallback((next:Status)=>{
    const current=statusValue.current?.configuration;
    // A newer request can still read an older transaction snapshot. Neither
    // the draft nor processing/permission status may move back to that revision.
    if(current&&(!next.configuration||next.configuration.revision<current.revision))return;
    // Compare with the draft's own base, never with the newly published map.
    // A response arriving after a local edit must preserve that edit and its CAS.
    if(JSON.stringify(draftValue.current)===JSON.stringify(draftBase.current?.configuration??null)
      &&next.configuration?.id!==draftBase.current?.id){
      adoptConfiguration(next.configuration);setSaved(false);key.current=null;
    }
    updateStatus(next);
  },[adoptConfiguration,updateStatus]);
  const url=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening`;
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;
    updateStatus(null);adoptConfiguration(null);setError(false);setSaved(false);setUnavailable(false);setBusy(false);key.current=null;
    fetch(url,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if([403,404].includes(response.status)){if(generation.current===current)setUnavailable(true);return;}
      if(!response.ok)throw Error();const result=await response.json()as Status;
      if(generation.current===current){updateStatus(result);adoptConfiguration(result.configuration);}
    }).catch(()=>{if(!controller.signal.aborted&&generation.current===current)setError(true);});
    return()=>{controller.abort();generation.current=current+1;};
  },[url,retry,adoptConfiguration,updateStatus]);
  const runId=status?.run?.id,runState=status?.run?.status,preparationId=status?.preparation?.id,preparationState=status?.preparation?.status;
  const preparing=Boolean(preparationState&&['preparing','waiting_prototypes','ready_for_labeling','labeling'].includes(preparationState));
  const discoveryState=status?.discovery?.status,executionState=status?.discovery?.execution_status;
  const discovering=Boolean(discoveryState&&['preparing','admitted','waiting_recovery'].includes(discoveryState)||executionState==='active');
  useEffect(()=>{
    if((!runId||!['queued','running'].includes(runState??''))&&(!preparationId||!preparing)&&!discovering)return;
    const controller=new AbortController();let issued=0,received=0;
    const timer=setInterval(()=>{const request=++issued;fetch(url,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(response.ok){const result=await response.json()as Status;
        if(!controller.signal.aborted&&request>received){received=request;reconcileStatus(result);}}
    }).catch(()=>undefined);},3000);
    return()=>{clearInterval(timer);controller.abort();};
  },[url,runId,runState,preparationId,preparing,discovering,reconcileStatus]);
  const canEdit=editable&&Boolean(status?.capabilities.can_edit_topics);
  const canProcess=canEdit&&Boolean(status?.capabilities.can_request_processing);
  function change(question:SignalListeningQuestionV1,index:number){
    updateDraft(current=>current?{...current,questions:current.questions.map((row,i)=>i===index?{...question,human_locked:true}:row)}:current);
    setSaved(false);key.current=null;
  }
  async function save(){
    const current=generation.current;setBusy(true);setError(false);setSaved(false);
    try{
      const body=draft?{expected_revision:draftRevision,configuration:draft}
        :{expected_revision:0,category,lexicon_terms:lexicon.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean)};
      const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw Error();
      const latest=await fetch(url,{cache:'no-store'});if(!latest.ok)throw Error();const result=await latest.json()as Status;
      if(generation.current===current){updateStatus(result);adoptConfiguration(result.configuration);setSaved(true);key.current=null;}
    }catch{if(generation.current===current)setError(true);}finally{if(generation.current===current)setBusy(false);}
  }
  async function run(){
    if(!status?.configuration)return;const current=generation.current;
    const amount=/^\d+(?:\.\d{1,6})?$/.test(budget)?Math.round(Number(budget)*1_000_000):0;
    if(!Number.isSafeInteger(amount)||amount<=0){setError(true);return;}
    key.current??=crypto.randomUUID();setBusy(true);setError(false);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key.current},
        body:JSON.stringify({configuration_id:status.configuration.id,cap_micro_usd:amount,auto_discovery:true})});
      if(!response.ok)throw Error();
      const latest=await fetch(url,{cache:'no-store'});if(!latest.ok)throw Error();const result=await latest.json()as Status;
      if(generation.current===current){reconcileStatus(result);key.current=null;}
    }catch{if(generation.current===current)setError(true);}finally{if(generation.current===current)setBusy(false);}
  }
  const dirty=Boolean(draft&&status?.configuration&&JSON.stringify(draft)!==JSON.stringify(status.configuration.configuration));
  const conflict=Boolean(status?.configuration&&draftRevision!==status.configuration.revision);
  const unresolved=Number(status?.run?.unknown_micro_usd??0)>0||executionState==='outcome_unknown'||discoveryState==='waiting_recovery';
  const running=preparing||discovering||Boolean(status?.run&&['queued','running'].includes(status.run.status));
  if(unavailable)return null;
  return <section className="admin-section workspace-resource-section" aria-busy={busy}>
    <header className="admin-section__head"><div><h2>{t('title')}</h2><p>{t('description')}</p></div></header>
    {error?<p role="alert">{t('error')} <button className="admin-button" type="button" onClick={()=>setRetry(value=>value+1)}>{t('retry')}</button></p>:null}
    {conflict?<p role="alert">{tSettings('conflict')}</p>:null}
    {saved?<p role="status">{t('saved')}</p>:null}
    {unresolved?<p role="status">{t('unresolved')}</p>:null}
    {!status&&!error?<p role="status">{t('loading')}</p>:null}
    {status&&!draft?<><label className="admin-form-field"><span>{t('category')}</span><input value={category} disabled={!canEdit||busy} onChange={event=>setCategory(event.target.value)}/></label>
      <label className="admin-form-field"><span>{t('lexicon')}</span><textarea value={lexicon} disabled={!canEdit||busy} onChange={event=>setLexicon(event.target.value)}/></label></>:null}
    {draft?<>
      <label className="admin-form-field"><span>{t('category')}</span><input value={draft.category} disabled={!canEdit||busy} onChange={event=>{updateDraft({...draft,category:event.target.value});setSaved(false);}}/></label>
      <label className="admin-form-field"><span>{t('lexicon')}</span><textarea value={draft.lexicon_terms.join('\n')} disabled={!canEdit||busy}
        onChange={event=>{updateDraft({...draft,lexicon_terms:event.target.value.split('\n')});setSaved(false);}}/></label>
      {status?.configuration&&canEdit?<ListeningLexiconSuggestions workspaceId={workspaceId} configurationId={status.configuration.id}
        disabled={busy||dirty||running||draft.lexicon_terms.length>=500} onAccept={term=>{
          if(!draft.lexicon_terms.some(value=>value.trim().toLocaleLowerCase()===term.toLocaleLowerCase())){
            updateDraft({...draft,lexicon_terms:[...draft.lexicon_terms,term]});setSaved(false);key.current=null;
          }
        }}/>:null}
      <label className="admin-form-field"><span>{t('instructions')}</span><textarea value={draft.instructions} disabled={!canEdit||busy} onChange={event=>{updateDraft({...draft,instructions:event.target.value});setSaved(false);}}/></label>
      {draft.questions.map((question,index)=><fieldset key={`${index}:${question.type}`} disabled={!canEdit||busy} className="admin-section">
        <legend>{question.topic_source?t('topic'):t('question')}</legend>
        <label className="admin-form-field"><span>{t('key')}</span><input value={question.key} disabled={question.origin==='base'} onChange={event=>change({...question,key:event.target.value},index)}/></label>
        <label className="admin-form-field"><span>{t('wording')}</span><textarea value={question.text} onChange={event=>change({...question,text:event.target.value},index)}/></label>
        <label className="admin-form-field"><span>{t('scope')}</span><select value={question.scope} disabled={question.origin==='base'} onChange={event=>change({...question,scope:event.target.value as 'all'|'consumer_category'},index)}>
          <option value="all">{t('all')}</option><option value="consumer_category">{t('consumer')}</option></select></label>
        {question.type==='choice'?question.options.map((option,optionIndex)=><div key={optionIndex} className="admin-form">
          <label className="admin-form-field"><span>{t('option')}</span><input value={option.key} onChange={event=>change({...question,options:question.options.map((row,i)=>i===optionIndex?{...row,key:event.target.value}:row)},index)}/></label>
          <label className="admin-form-field"><span>{t('definition')}</span><textarea value={option.definition} onChange={event=>change({...question,options:question.options.map((row,i)=>i===optionIndex?{...row,definition:event.target.value}:row)},index)}/></label>
        </div>):<><label className="admin-form-field"><span>{t('positive')}</span><textarea value={question.positive} onChange={event=>change({...question,positive:event.target.value},index)}/></label>
          <label className="admin-form-field"><span>{t('negative')}</span><textarea value={question.negative} onChange={event=>change({...question,negative:event.target.value},index)}/></label></>}
        {question.type==='choice'?<button className="admin-button" type="button" onClick={()=>change({...question,options:[...question.options,{key:`option_${question.options.length+1}`,definition:''}]},index)}>{t('addOption')}</button>:null}
        {question.localization?(['original','en','es']as const).map(language=><div key={language} className="admin-form">
          <label className="admin-form-field"><span>{t('nameLanguage',{language})}</span><input value={question.localization![language].name} onChange={event=>change({...question,localization:{...question.localization!,[language]:{...question.localization![language],name:event.target.value}}},index)}/></label>
          <label className="admin-form-field"><span>{t('definitionLanguage',{language})}</span><textarea value={question.localization![language].definition} onChange={event=>change({...question,localization:{...question.localization!,[language]:{...question.localization![language],definition:event.target.value}}},index)}/></label>
        </div>):null}
        {question.origin!=='base'?<button className="admin-button" type="button" onClick={()=>{updateDraft({...draft,questions:draft.questions.filter((_,i)=>i!==index)});setSaved(false);}}>{t('remove')}</button>:null}
      </fieldset>)}
      {canEdit?<div className="admin-form-actions">
        <button className="admin-button" type="button" disabled={busy} onClick={()=>{updateDraft({...draft,questions:[...draft.questions,{key:`question_${draft.questions.length+1}`,type:'choice',text:'',scope:'all',origin:'brand_os',human_locked:true,options:[{key:'yes',definition:''},{key:'no',definition:''}]}]});setSaved(false);}}>{t('addQuestion')}</button>
        <button className="admin-button" type="button" disabled={busy} onClick={()=>{updateDraft({...draft,questions:[...draft.questions,{key:`topic_${draft.questions.length+1}`,type:'noul',text:'',positive:'',negative:'',scope:'all',origin:'brand_os',human_locked:true,topic_source:'defined',localization:{original_language:'und',original:{name:'',definition:''},en:{name:'',definition:''},es:{name:'',definition:''}}}]});setSaved(false);}}>{t('addTopic')}</button>
      </div>:null}
    </>:null}
    {canEdit&&status?<div className="admin-form-actions"><button className="admin-button admin-button--primary" type="button" disabled={busy||running} onClick={save}>{t('save')}</button></div>:null}
    {canProcess&&status?.configuration?<div className="admin-form">
      <label className="admin-form-field"><span>{t('budget')}</span><input inputMode="decimal" value={budget} disabled={busy||running} onChange={event=>{setBudget(event.target.value);key.current=null;}}/></label>
      <p>{t('incremental')}</p>
      <button className="admin-button" type="button" disabled={busy||running||unresolved||dirty||!status.map||status.map_stale||!budget} onClick={run}>{running?t('running'):t('run')}</button>
    </div>:null}
  </section>;
}
