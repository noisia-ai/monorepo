'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import type {SignalListeningQuestionV1} from '@noisia/query-engine';
import type {SignalStudyExecutionStatusV1,SignalStudyReportRowsV1,SignalStudyReportSectionV1} from '@noisia/db';
import {signalListeningDateBoundaryV1} from '@/lib/data-os/signal-listening-date';
import type {StudyMetadataV1,StudyOverviewV1,StudySourceV1} from '@/lib/data-os/signal-study-api';
type ListRow={study_id:string;subject_name:string;methodology:string;execution:SignalStudyExecutionStatusV1|null};
type Detail={configuration:StudyMetadataV1;configuration_is_latest:boolean;execution:SignalStudyExecutionStatusV1|null;overview:StudyOverviewV1|null;processing_ready:boolean;can_edit:boolean;can_execute:boolean;current_listening_revision:number|null};
type TopicLocalization=NonNullable<SignalListeningQuestionV1['localization']>;
type PromotionContext={execution_id:string;motives:Array<{key:string;name:string;definition:string;original_language:string}>};
type Pending={body:string;key:string};
const endpoint=(workspaceId:string)=>`/api/data-os/signal/${encodeURIComponent(workspaceId)}/studies`;
const active=(status:string)=>['building','queued','running','outcome_unknown'].includes(status);
/** Preserve the entire request across an uncertain acknowledgement, including
 * its idempotency key. GET refreshes never submit or resume paid work. */
export function useStudyMutationV1(url:string,onSaved:(value:Record<string,unknown>)=>Promise<void>|void){
 const [pending,setPending]=useState<Pending|null>(null),[phase,setPhase]=useState<'idle'|'sending'|'uncertain'|'failed'|'saved'>('idle');
 const lock=useRef(false),epoch=useRef(0);
 const invalidate=useCallback(()=>{epoch.current++;},[]);
 useEffect(()=>{invalidate();setPending(null);setPhase('idle');return invalidate;},[url,invalidate]);
 const submit=async(body:unknown)=>{
  if(lock.current)return;lock.current=true;const generation=epoch.current;
  const frozen=pending??{body:JSON.stringify(body),key:crypto.randomUUID()};setPending(frozen);setPhase('sending');
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':frozen.key},body:frozen.body});
   if(generation!==epoch.current)return;
   // A server/network failure may have happened after commit. Keep the request.
   if(response.status>=500){setPhase('uncertain');return;}
   if(!response.ok){setPending(null);setPhase('failed');return;}
   const result=await response.json() as Record<string,unknown>;
   if(generation!==epoch.current)return;setPending(null);setPhase('saved');await onSaved(result);
  }catch{if(generation===epoch.current)setPhase('uncertain');}finally{lock.current=false;}
 };
 return{submit,phase,pending,locked:phase==='sending'||phase==='uncertain'};
}
export function StudioStudyList({workspaceId,brandId,brandName,timezone}:{workspaceId:string;brandId:string;brandName:string;timezone:string}){
 const t=useTranslations('StudioStudy'),router=useRouter(),url=endpoint(workspaceId);
 const [list,setList]=useState<ListRow[]>([]),[next,setNext]=useState<string|null>(null),[source,setSource]=useState<StudySourceV1|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true);
 const [canEdit,setCanEdit]=useState(false);
 const [kind,setKind]=useState<'category'|'own_brand'|'alternative'>('own_brand');
 const [name,setName]=useState(brandName),[category,setCategory]=useState(''),[ownBrand,setOwnBrand]=useState(brandName),[competitors,setCompetitors]=useState(''),[alternatives,setAlternatives]=useState(''),[conventional,setConventional]=useState('');
 const [formError,setFormError]=useState(false);
 const [question,setQuestion]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[zone,setZone]=useState(timezone);
 const controller=useRef<AbortController|null>(null),sequence=useRef(0);
 const load=useCallback(async(cursor?:string)=>{
  controller.current?.abort();const c=new AbortController(),seq=++sequence.current;controller.current=c;setLoading(true);setError(false);
  try{const [a,b]=await Promise.all([fetch(url+(cursor?`?after_study_id=${encodeURIComponent(cursor)}`:''),{cache:'no-store',signal:c.signal}),fetch(url+'?context=true',{cache:'no-store',signal:c.signal})]);
   if(!a.ok||!b.ok)throw Error();const [items,context]=await Promise.all([a.json(),b.json()]);
   if(c.signal.aborted||seq!==sequence.current)return;setList(items.studies);setNext(items.next_after_study_id);setSource(context.source);setCategory(context.source?.category??'');setCanEdit(context.can_edit===true);
  }catch{if(!c.signal.aborted&&seq===sequence.current)setError(true);}finally{if(!c.signal.aborted&&seq===sequence.current)setLoading(false);}
 },[url]);
 const invalidate=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 useEffect(()=>{setList([]);setSource(null);void load();return invalidate;},[load,invalidate]);
 const mutation=useStudyMutationV1(url,async result=>{router.push(`/studio/brands/${brandId}/studies/${String(result.study_id)}`);});
 const values=(value:string)=>value.split(',').map(v=>v.trim()).filter(Boolean);
 return <section className="admin-section"><h2>{t('title')}</h2><p>{t('separation')}</p>
  {error?<p role="alert">{t('loadFailed')} <button type="button" onClick={()=>void load()}>{t('refresh')}</button></p>:null}
  {loading?<p role="status">{t('loading')}</p>:null}
  <ul>{list.map(item=><li key={item.study_id}><Link href={`/studio/brands/${brandId}/studies/${item.study_id}`} prefetch={false}>{item.subject_name}</Link> — {item.methodology} · {t(`status.${item.execution?.status??'configured'}`)}</li>)}</ul>
  {next?<button type="button" onClick={()=>void load(next)} disabled={loading}>{t('next')}</button>:null}
  <h3>{t('create')}</h3>{!canEdit?<p>{t('readOnly')}</p>:null}<p>{t('template')}</p>
  {!source?<p>{t('sourceUnavailable')}</p>:<><p>{t('sourceRevision',{revision:source.revision})}</p>{source.binding_kind==='human_edit'?<p>{t('sourceHuman')}</p>:null}{!source.configuration_is_latest?<p>{t('historicalSource')}</p>:null}
  <form onSubmit={event=>{event.preventDefault();setFormError(false);try{const startAt=signalListeningDateBoundaryV1(start,zone),endAt=signalListeningDateBoundaryV1(end,zone,true);if(startAt>=endAt)throw Error();void mutation.submit({source:{binding_kind:source.binding_kind,snapshot_id:source.snapshot_id,configuration_id:source.configuration_id,configuration_digest:source.configuration_digest},subject:{kind,name,category,own_brand:ownBrand,competitors:values(competitors),alternatives:values(alternatives),...(kind==='alternative'?{conventional_category:conventional}:{})},business_question:question,cut:{start_at:startAt,end_at:endAt,timezone:zone}});}catch{setFormError(true);}}}>
   <fieldset className="admin-form" disabled={mutation.locked||!canEdit}><label className="admin-form-field">{t('kind')}<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{(['category','own_brand','alternative']as const).map(v=><option value={v} key={v}>{t(`kindValue.${v}`)}</option>)}</select></label>
   {[[t('subject'),name,setName],[t('category'),category,setCategory],[t('ownBrand'),ownBrand,setOwnBrand],[t('competitors'),competitors,setCompetitors],[t('alternatives'),alternatives,setAlternatives],[t('start'),start,setStart],[t('end'),end,setEnd],[t('timezone'),zone,setZone]].map(([label,value,setter],index)=><label className="admin-form-field" key={String(label)}>{String(label)}<input value={String(value)} onChange={e=>(setter as typeof setName)(e.target.value)} type={index===5||index===6?'date':'text'} readOnly={index===1} required={![3,4].includes(index)} maxLength={index===3||index===4?2400:240}/></label>)}
   {kind==='alternative'?<label className="admin-form-field">{t('conventional')}<input required value={conventional} onChange={e=>setConventional(e.target.value)} maxLength={240}/></label>:null}
   <label className="admin-form-field">{t('question')}<textarea required maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
   <button type="submit" className="admin-button">{t('save')}</button></fieldset>
  </form>{formError?<p role="alert">{t('invalidCut')}</p>:null}</>}
  {mutation.phase==='uncertain'?<p role="alert">{t('uncertain')} <button onClick={()=>void mutation.submit(null)}>{t('retrySame')}</button></p>:mutation.phase==='failed'?<p role="alert">{t('mutationFailed')} <button onClick={()=>void load()}>{t('refresh')}</button></p>:mutation.phase==='saved'?<p role="status">{t('saved')}</p>:null}
 </section>;
}
export function StudioStudyDetail({workspaceId,studyId}:{workspaceId:string;studyId:string}){
 const t=useTranslations('StudioStudy'),url=`${endpoint(workspaceId)}/${encodeURIComponent(studyId)}`;
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(false),[cap,setCap]=useState('');
 const request=useRef<AbortController|null>(null),sequence=useRef(0);
 const load=useCallback(async()=>{
  request.current?.abort();const c=new AbortController(),seq=++sequence.current;request.current=c;
  try{const r=await fetch(url,{cache:'no-store',signal:c.signal});if(!r.ok)throw Error();const value=await r.json() as Detail;
   if(c.signal.aborted||seq!==sequence.current)return null;setDetail(value);setError(false);return value;
  }catch{if(!c.signal.aborted&&seq===sequence.current){setError(true);setDetail(null);}return null;}
 },[url]);
 const invalidate=useCallback(()=>{sequence.current++;request.current?.abort();},[]);
 useEffect(()=>{setDetail(null);void load();return invalidate;},[load,invalidate]);
 const mutation=useStudyMutationV1(url,async()=>{await load();});
 const retryIsExecution=mutation.pending?(JSON.parse(mutation.pending.body)as{operation?:string}).operation==='execute':false;
 const canRetry=detail!==null&&(retryIsExecution?detail.processing_ready&&detail.can_execute:detail.can_edit);
 // An acknowledged queue request starts a fresh cancellable polling cycle.
 const executionId=detail?.execution?.id,status=detail?.execution?.status;
 useEffect(()=>{if(!executionId||!status||!active(status))return;let closed=false;let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{const value=await load();if(!closed&&value?.execution&&active(value.execution.status))timer=setTimeout(()=>void poll(),3000);};
  timer=setTimeout(()=>void poll(),3000);return()=>{closed=true;clearTimeout(timer);};
 },[executionId,status,load]);
 return <section className="admin-section">
  {error?<p role="alert">{t('loadFailed')} <button onClick={()=>void load()}>{t('refresh')}</button></p>:null}
  {!detail?(!error?<p role="status">{t('loading')}</p>:null):<>
   <h2>{detail.configuration.study.subject.name}</h2>{detail.configuration.listening_source?.kind==='human_edit'?<p>{t('sourceHuman')}</p>:null}{!detail.configuration_is_latest?<p>{t('historicalSource')}</p>:null}<p>{detail.configuration.study.business_question}</p>
   <dl><dt>{t('methodology')}</dt><dd>{detail.configuration.study.methodology.key} · {detail.configuration.study.methodology.version}</dd>
    <dt>{t('cut')}</dt><dd>{detail.configuration.study.cut.start_at} — {detail.configuration.study.cut.end_at} ({detail.configuration.study.cut.timezone})</dd>
    <dt>{t('corpus')}</dt><dd>{detail.configuration.study.corpus_id}</dd><dt>{t('revision')}</dt><dd>{detail.configuration.revision}</dd></dl>
   <p>{t('automatic')}</p>{!detail.can_edit?<p>{t('readOnly')}</p>:null}
   {detail.execution?<p role="status">{t(`status.${detail.execution.status}`)} · {t('roots',{count:detail.execution.source_roots})} · {t('steps',{done:detail.execution.steps_committed,total:detail.execution.steps_total})} · {t('exposure',{amount:(Number(detail.execution.exposure_micro_usd)/1e6).toFixed(4)})}</p>:null}
   {!detail.processing_ready?<p>{t('notReady')}</p>:null}{!detail.can_execute?<p>{t('processingNotAllowed')}</p>:null}
   {!detail.execution?<form onSubmit={event=>{event.preventDefault();if(!detail.can_execute||!detail.processing_ready||mutation.locked)return;const amount=Number(cap);if(Number.isFinite(amount)&&amount>0&&Number.isSafeInteger(Math.round(amount*1e6)))void mutation.submit({operation:'execute',configuration_id:detail.configuration.configuration_id,cap_micro_usd:Math.round(amount*1e6)});}}>
    <label className="admin-form-field">{t('cap')}<input type="number" min="0.000001" step="0.000001" required value={cap} onChange={e=>setCap(e.target.value)} disabled={mutation.locked}/></label><p>{t('capExplanation')}</p>
    <button disabled={!detail.processing_ready||!detail.can_execute||mutation.locked} type="submit">{t('run')}</button>
   </form>:null}
   {detail.overview?<StudyReport key={JSON.stringify([url,detail.overview.study_id,detail.overview.configuration_id,detail.overview.execution_id,detail.overview.output_digest,detail.overview.source_digest])} workspaceUrl={url} value={detail.overview} currentRevision={detail.current_listening_revision} onPromote={(keys,localizations)=>void mutation.submit({operation:'promote',execution_id:detail.overview!.execution_id,motive_keys:keys,expected_listening_revision:detail.current_listening_revision,localizations})} locked={mutation.locked||!detail.can_edit}/>:detail.execution?.status==='completed'?<p role="alert">{t('outputUnavailable')}</p>:null}
  </>}
  {mutation.phase==='uncertain'?<p role="alert">{t('uncertain')} <button disabled={!canRetry} onClick={()=>{if(canRetry)void mutation.submit(null);}}>{t('retrySame')}</button></p>:mutation.phase==='failed'?<p role="alert">{t('mutationFailed')} <button onClick={()=>void load()}>{t('refresh')}</button></p>:mutation.phase==='saved'?<p role="status">{t('saved')}</p>:null}
 </section>;
}
type Page={[S in SignalStudyReportSectionV1]:{section:S;rows:SignalStudyReportRowsV1[S];offset:number;next_offset:number|null;total:number}}[SignalStudyReportSectionV1];
function StudyReport({workspaceUrl,value,currentRevision,onPromote,locked}:{workspaceUrl:string;value:StudyOverviewV1;currentRevision:number|null;onPromote:(keys:string[],localizations:Record<string,TopicLocalization>)=>void;locked:boolean}){
 const t=useTranslations('StudioStudy'),[section,setSection]=useState<SignalStudyReportSectionV1>('motives'),[offset,setOffset]=useState(0),[loaded,setLoaded]=useState<{identity:string;page:Page}|null>(null),[errorIdentity,setErrorIdentity]=useState<string|null>(null),[retry,setRetry]=useState(0),[selected,setSelected]=useState<string[]>([]);
 const tListening=useTranslations('Listening'),[localizations,setLocalizations]=useState<Record<string,TopicLocalization>>({}),[promotionContext,setPromotionContext]=useState<(PromotionContext&{identity:string})|null>(null),[promotionError,setPromotionError]=useState(false),[promotionRetry,setPromotionRetry]=useState(0);
 const sequence=useRef(0),promotionSequence=useRef(0);
 const selectedIdentity=JSON.stringify(selected),promotionIdentity=JSON.stringify([workspaceUrl,value.execution_id,currentRevision,selected]);
 const currentPromotionContext=promotionContext?.identity===promotionIdentity?promotionContext:null;
 const identity=JSON.stringify([workspaceUrl,value.study_id,value.configuration_id,value.execution_id,value.output_digest,value.source_digest,section,offset,retry]);
 // Effects run after render: old rows must already be hidden in the render that
 // changes section, execution or pagination, before any request cleanup runs.
 const page=loaded?.identity===identity&&loaded.page.section===section&&loaded.page.offset===offset?loaded.page:null;
 const error=errorIdentity===identity,summary=value.overview.summary;
 useEffect(()=>{const c=new AbortController(),request=++sequence.current;setErrorIdentity(null);
  void(async()=>{try{
   const response=await fetch(`${workspaceUrl}?execution_id=${encodeURIComponent(value.execution_id)}&section=${section}&offset=${offset}&limit=30`,{cache:'no-store',signal:c.signal});
   if(!response.ok)throw Error();const body=await response.json() as Page;
   if(c.signal.aborted||request!==sequence.current)return;
   if(body.section!==section||body.offset!==offset||!Array.isArray(body.rows))throw Error('study_page_binding_invalid');
   setLoaded({identity,page:body});
  }catch{if(!c.signal.aborted&&request===sequence.current)setErrorIdentity(identity);}})();
  return()=>c.abort();
 },[workspaceUrl,value.execution_id,section,offset,retry,identity]);
 const move=(nextSection:SignalStudyReportSectionV1,nextOffset:number)=>{setLoaded(null);setErrorIdentity(null);setSection(nextSection);setOffset(nextOffset);};
 useEffect(()=>{setSelected([]);setLocalizations({});setPromotionContext(null);},[value.execution_id,currentRevision]);
 useEffect(()=>{
  const controller=new AbortController(),request=++promotionSequence.current;setPromotionContext(null);setPromotionError(false);
  const keys=JSON.parse(selectedIdentity)as string[];if(!keys.length||locked||currentRevision===null)return()=>controller.abort();
  const query=new URLSearchParams({promotion_context:'true',execution_id:value.execution_id,motive_keys:keys.join(',')});
  void(async()=>{try{
   const response=await fetch(`${workspaceUrl}?${query}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();
   const context=await response.json()as PromotionContext;
   if(controller.signal.aborted||request!==promotionSequence.current)return;
   if(context.execution_id!==value.execution_id||!Array.isArray(context.motives)||context.motives.length!==keys.length||new Set(context.motives.map(m=>m.key)).size!==keys.length||context.motives.some(m=>!keys.includes(m.key)||!m.name?.trim()||!m.definition?.trim()||!m.original_language?.trim()))throw Error();
   setPromotionContext({...context,identity:promotionIdentity});setLocalizations(prior=>Object.fromEntries(context.motives.map(m=>[m.key,{original_language:m.original_language,original:{name:m.name,definition:m.definition},en:prior[m.key]?.en??{name:'',definition:''},es:prior[m.key]?.es??{name:'',definition:''}}])));
  }catch{if(!controller.signal.aborted&&request===promotionSequence.current)setPromotionError(true);}})();
  return()=>controller.abort();
 },[workspaceUrl,value.execution_id,currentRevision,selectedIdentity,promotionIdentity,promotionRetry,locked]);
 const promotionReady=Boolean(currentPromotionContext&&selected.length===currentPromotionContext.motives.length&&selected.every(key=>{const item=localizations[key];return item&&(['original','en','es']as const).every(language=>item[language].name.trim()&&item[language].definition.trim());}));
 const directions=(counts:{trigger:number;barrier:number;mixed:number;none:number})=>(['trigger','barrier','mixed','none']as const).map(key=>`${t(`direction.${key}`)}: ${counts[key]}`).join(' · ');
 return <section><h3>{t('directional')}</h3><p>{t('denominator',{count:summary.denominator})}</p><p>{t('multilabel')}</p>
  <p>{t('subjectDirection')}: {directions(summary.subject_direction)}</p><p>{t('competitorDirection')}: {directions(summary.competitor_direction)}</p><p>{t('alternativeDirection')}: {directions(summary.alternative_direction)}</p>
  <p>{t('resolved',{resolved:summary.resolved_axes,unresolved:summary.unresolved_axes})}</p><p>{t('separateUses',{ironic:summary.figurative_or_ironic,other:summary.other_use})}</p>
  <h4>{t('layers')}</h4><ul>{summary.layers.map(layer=><li key={layer.key}>{t(`layer.${layer.key}`)}: {layer.mentions} · {(layer.share_of_cut*100).toFixed(1)}% · {directions(layer.direction)}</li>)}</ul>
  <p>{t('bias')}: {t(`biasValue.${value.overview.query_bias.status}`)}</p><p>{t(`biasReason.${value.overview.query_bias.status}`)}</p>{value.overview.query_bias.base_ratio!==null&&Number.isFinite(value.overview.query_bias.base_ratio)?<p>{t('baselineRatio',{subject:value.overview.query_bias.subject_roots,baseline:value.overview.query_bias.brand_baseline_roots,ratio:value.overview.query_bias.base_ratio})}</p>:null}<p>{t('stability')}: {value.overview.stability?.estimation_status==='complete'?String(value.overview.stability.kappa):t('notEstimable')}</p>
  <ul>{summary.limitations.map((text,index)=><li key={index}>{text}</li>)}</ul>
  <div role="group" aria-label={t('sections')}>{(['motives','topics','channels','series','evidence']as const).map(key=><button key={key} aria-pressed={section===key} onClick={()=>move(key,0)}>{t(`section.${key}`)} ({value.section_counts[key]})</button>)}</div>
  {error?<p role="alert">{t('loadFailed')} <button onClick={()=>setRetry(prior=>prior+1)}>{t('refresh')}</button></p>:null}
  {!page&&!error?<p role="status">{t('loading')}</p>:null}
  {page?.rows.length===0?<p>{t('emptySection')}</p>:null}
  {page?.section==='motives'?<><ul>{page.rows.map(row=><li key={row.key}>
   <label className="admin-form-field"><input type="checkbox" checked={selected.includes(row.key)} disabled={locked||currentRevision===null||!selected.includes(row.key)&&selected.length>=32} onChange={e=>setSelected(prior=>e.target.checked?[...prior,row.key]:prior.filter(k=>k!==row.key))}/>{row.name}</label> · {t(`layer.${row.layer}`)} · {t(`permission.${row.permission}`)} · {row.mentions} · {(row.share_of_cut*100).toFixed(1)}%
   <p>{t('subjectDirection')}: {directions(row.subject)}</p><p>{t('competitorDirection')}: {directions(row.competitor)}</p><p>{t('alternativeDirection')}: {directions(row.alternative)}</p><p>{t('tensions',{count:row.mixed})}</p>{row.permission_override_reason?<p>{t('permissionOverride')}: {row.permission_override_reason}</p>:null}
  </li>)}</ul><p>{t('promoteExplanation')}</p>
   {selected.length?<><p>{t('promotionLocalizationHelp')}</p>{promotionError?<p role="alert">{t('loadFailed')} <button disabled={locked} onClick={()=>setPromotionRetry(prior=>prior+1)}>{t('refresh')}</button></p>:!currentPromotionContext&&!locked?<p role="status">{t('loading')}</p>:null}
    {currentPromotionContext?.motives.map(motive=><fieldset key={motive.key} className="admin-form" disabled={locked}><legend>{motive.name}</legend>{(['original','en','es']as const).map(language=><div className="admin-form" key={language}>
     <label className="admin-form-field"><span>{tListening('nameLanguage',{language})}</span><input required maxLength={160} readOnly={language==='original'} value={localizations[motive.key]?.[language].name??''} onChange={event=>{const text=event.target.value;setLocalizations(prior=>({...prior,[motive.key]:{...prior[motive.key]!,[language]:{...prior[motive.key]![language],name:text}}}));}}/></label>
     <label className="admin-form-field"><span>{tListening('definitionLanguage',{language})}</span><textarea required maxLength={1200} readOnly={language==='original'} value={localizations[motive.key]?.[language].definition??''} onChange={event=>{const text=event.target.value;setLocalizations(prior=>({...prior,[motive.key]:{...prior[motive.key]!,[language]:{...prior[motive.key]![language],definition:text}}}));}}/></label>
    </div>)}</fieldset>)}</>:null}
   <button disabled={!promotionReady||locked||currentRevision===null} onClick={()=>{if(promotionReady&&!locked&&currentRevision!==null)onPromote(selected,Object.fromEntries(selected.map(key=>[key,localizations[key]!])));}}>{t('promote')}</button></>:null}
  {page?.section==='topics'?<ul>{page.rows.map((row,index)=><li key={index}>{row.motive_key} · {row.topic_key} · {t(`aggregate.${row.aggregate}`)}: {row.mentions}</li>)}</ul>:null}
  {page?.section==='channels'?<ul>{page.rows.map((row,index)=><li key={index}>{row.motive_key} · {row.channel} · {t(`aggregate.${row.aggregate}`)}: {row.mentions}</li>)}</ul>:null}
  {page?.section==='series'?<ul>{page.rows.map((row,index)=><li key={index}>{row.date} · {row.motive_key} · {t(`aggregate.${row.aggregate}`)}: {directions(row.direction)}</li>)}</ul>:null}
  {page?.section==='evidence'?<ul>{page.rows.map((row,index)=><li key={index}>{row.association?<p>{t('evidenceAssignment',{motive:row.association.motive_key,partition:row.association.partition_key})} · {t('assessedLayer')}: {t(`layer.${row.association.assessed_layer}`)} · {t(`evidenceRole.${row.association.role}`)} · {t('evidencePass',{pass:row.association.pass})}</p>:<p>{t('evidenceAssociationUnavailable')}</p>}<blockquote>{row.display_text}</blockquote><p>{row.channel} · {row.occurred_at} {row.redacted?t('redacted'):null}</p>{/^https?:\/\//u.test(row.source_url)?<a href={row.source_url} target="_blank" rel="noreferrer noopener">{t('source')}</a>:null}</li>)}</ul>:null}
  {page?<div><button disabled={offset===0} onClick={()=>move(section,Math.max(0,offset-30))}>{t('previous')}</button> <span>{Math.min(offset+1,page.total)}–{Math.min(offset+30,page.total)} / {page.total}</span> <button disabled={page.next_offset===null} onClick={()=>move(page.section,page.next_offset!)}>{t('next')}</button></div>:null}
 </section>;
}
