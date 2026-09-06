"use client";

import React,{ useCallback,useEffect,useRef,useState,type MouseEvent } from "react";
import { useLocale,useTranslations } from "next-intl";
import { formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { cohortSelectionEqual,cohortSelectionFromSource,cohortSelectionFromStore,cohortSelectionIsCurrent,
  loadTopicCohortPage,requestTopicCohortJson,topicCohortPendingSchema,topicCohortSaveSchema,
  parseTopicCohortMutationResult,TopicCohortRequestError,
  type TopicCohortPage,type TopicCohortPending,type TopicCohortSelection,type TopicCohortSource,
  type TopicCohortSafeError } from "@/lib/data-os/signal-topic-rule-cohort-management";

type Props={workspaceId:string;runKey:string;refreshVersion:number;editorBusy:boolean;
  onBusyChange:(value:boolean)=>void;onOpenCandidate:(key:string,event:MouseEvent<HTMLButtonElement>)=>void};
type Cas={revision:number;digest:string|null};
type Translate=(key:string,values?:Record<string,string|number>)=>string;
const storageKey=(url:string)=>`noisia:topic-cohort-pending-v1:${url}`;
function retain(url:string,pending:TopicCohortPending|null){
  if(pending)sessionStorage.setItem(storageKey(url),JSON.stringify(pending));else sessionStorage.removeItem(storageKey(url));
}

// Remount the state machine on scope change. Old responses cannot mutate the new workspace/run.
export function TopicRuleCohortManager(props:Props){return<TopicRuleCohortController key={`${props.workspaceId}:${props.runKey}`} {...props}/>;}
function TopicRuleCohortController({workspaceId,runKey,refreshVersion,editorBusy,onBusyChange,onOpenCandidate}:Props){
  const t=useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates.cohort"),locale=useLocale();
  const url=`/api/data-os/signal/${workspaceId}/topic-evaluation/full-evidence/cohorts/${encodeURIComponent(runKey)}`;
  const[page,setPage]=useState<TopicCohortPage|null>(null),[rows,setRows]=useState<TopicCohortSource[]>([]);
  const[current,setCurrent]=useState<Record<string,TopicCohortSource>>({});
  const[selected,setSelected]=useState<TopicCohortSelection[]>([]),[baseline,setBaseline]=useState<Cas>({revision:0,digest:null});
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[readChecked,setReadChecked]=useState(false);
  const[pending,setPending]=useState<TopicCohortPending|null>(null),[error,setError]=useState<TopicCohortSafeError|null>(null);
  const[storageBlocked,setStorageBlocked]=useState(false),[success,setSuccess]=useState<"saved"|"tested"|null>(null);
  const selection=useRef<TopicCohortSelection[]>([]),pendingRef=useRef<TopicCohortPending|null>(null);
  const mounted=useRef(true),inFlight=useRef(false),initialized=useRef(false),read=useRef<AbortController|null>(null);
  const initialRefresh=useRef(refreshVersion);
  const setSelection=(next:TopicCohortSelection[])=>{selection.current=next;setSelected(next);};
  const load=useCallback(async(cursor:string|null=null)=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;
    setLoading(true);setReadChecked(false);setError(null);
    try{
      let keys=selection.current.map(row=>row.candidate_key);
      let next=await loadTopicCohortPage(url,workspaceId,runKey,keys,cursor,controller.signal);
      if(controller.signal.aborted||!mounted.current)return;
      if(!initialized.current){
        const originalBaseline={revision:next.cohort?.cohort_revision??0,digest:next.cohort?.cohort_digest??null};
        const original=cohortSelectionFromStore(next.cohort);keys=original.map(row=>row.candidate_key);
        // A saved catalog can refer to another source page. Refresh those exact sources as well.
        if(keys.length){next=await loadTopicCohortPage(url,workspaceId,runKey,keys,cursor,controller.signal);
          if(controller.signal.aborted||!mounted.current)return;}
        selection.current=original;setSelected(original);initialized.current=true;
        // Keep the baseline from the SAME response as the retained selection. A newer GET2
        // catalog must surface familyChanged, not silently supply a newer write CAS.
        setBaseline(originalBaseline);
      }
      setPage(next);setRows(prior=>cursor?[...new Map([...prior,...next.sources.items].map(row=>[row.candidate_key,row])).values()]:next.sources.items);
      setCurrent(prior=>{const result={...prior};
        keys.forEach(key=>{delete result[key];});
        [...next.sources.items,...next.sources.selected].forEach(row=>{result[row.candidate_key]=row;});return result;});
      setReadChecked(true);
    }catch(cause){if(controller.signal.aborted||!mounted.current)return;
      setPage(null);setReadChecked(false);setError(cause instanceof TopicCohortRequestError?cause.code:"topic_rule_cohort_operation_failed");
    }finally{if(!controller.signal.aborted&&mounted.current)setLoading(false);}
  },[url,workspaceId,runKey]);
  useEffect(()=>{
    mounted.current=true;
    try{const raw=sessionStorage.getItem(storageKey(url));if(raw){const prior=topicCohortPendingSchema.parse(JSON.parse(raw));
      if(prior.body.run_key!==runKey)throw new Error("scope_mismatch");
      pendingRef.current=prior;setPending(prior);
      if(prior.kind==="save"){selection.current=prior.body.sources;setSelected(prior.body.sources);initialized.current=true;
        setBaseline({revision:prior.body.expected_cohort_revision,digest:prior.body.expected_cohort_digest});}
    }}catch{setStorageBlocked(true);}
    void load();return()=>{mounted.current=false;read.current?.abort();onBusyChange(false);};
  },[load,url,runKey,onBusyChange]);
  useEffect(()=>{if(initialRefresh.current!==refreshVersion){initialRefresh.current=refreshVersion;void load();}},[refreshVersion,load]);
  const sourceChanged=selected.some(row=>!cohortSelectionIsCurrent(row,current[row.candidate_key]));
  const familyChanged=!!page&&(baseline.revision!==(page.cohort?.cohort_revision??0)||baseline.digest!==(page.cohort?.cohort_digest??null));
  const dirty=!cohortSelectionEqual(selected,cohortSelectionFromStore(page?.cohort??null));
  const blocked=loading||busy||editorBusy||!page||storageBlocked||!!pending;
  const valid=selected.length>=2&&selected.length<=15&&!sourceChanged&&!familyChanged;
  async function submit(operation:TopicCohortPending){
    if(inFlight.current)return;
    try{retain(url,operation);}catch{setStorageBlocked(true);setError("topic_rule_cohort_operation_failed");return;}
    inFlight.current=true;read.current?.abort();pendingRef.current=operation;setPending(operation);setReadChecked(false);
    setBusy(true);onBusyChange(true);setSuccess(null);setError(null);
    try{
      const value=await requestTopicCohortJson(operation.kind==="trial"?`${url}/trial`:url,{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key},body:JSON.stringify(operation.body)});
      if(!mounted.current)return;
      const result=parseTopicCohortMutationResult(value,operation,workspaceId);
      if("binding" in result){
        setBaseline({revision:result.cohort_revision,digest:result.cohort_digest});
      }
      retain(url,null);pendingRef.current=null;setPending(null);setSuccess(operation.kind==="save"?"saved":"tested");
      await load();
    }catch(cause){if(!mounted.current)return;
      if(cause instanceof TopicCohortRequestError&&!cause.ambiguous){
        try{retain(url,null);pendingRef.current=null;setPending(null);}catch{/* Keep the original request if storage removal fails. */}}
      setError(cause instanceof TopicCohortRequestError?cause.code:"topic_rule_cohort_operation_failed");
    }finally{inFlight.current=false;if(mounted.current){setBusy(false);onBusyChange(false);}}
  }
  function toggle(source:TopicCohortSource){if(blocked)return;const existing=selected.some(row=>row.candidate_key===source.candidate_key);
    if(existing)setSelection(selected.filter(row=>row.candidate_key!==source.candidate_key));
    else{const item=cohortSelectionFromSource(source);if(item&&selected.length<15)setSelection([...selected,item]);}setSuccess(null);}
  function reconcile(){if(blocked||!page)return;
    // Explicit operator action, never a side effect of paging or refresh.
    setSelection(selected.map(row=>{const source=current[row.candidate_key];return(source&&cohortSelectionFromSource(source))||row;}));
    setBaseline({revision:page.cohort?.cohort_revision??0,digest:page.cohort?.cohort_digest??null});setSuccess(null);
  }
  function save(){if(blocked||!valid||pendingRef.current||(!dirty&&!page?.cohort?.is_stale))return;
    const body=topicCohortSaveSchema.parse({run_key:runKey,expected_cohort_revision:baseline.revision,
      expected_cohort_digest:baseline.digest,sources:selected});
    void submit({kind:"save",key:`topic-cohort:save:${crypto.randomUUID()}`,body});
  }
  function trial(){const cohort=page?.cohort;if(blocked||!valid||dirty||!cohort||cohort.is_stale||pendingRef.current)return;
    void submit({kind:"trial",key:`topic-cohort:trial:${crypto.randomUUID()}`,body:{run_key:runKey,
      expected_cohort_revision:cohort.cohort_revision,expected_cohort_digest:cohort.cohort_digest,
      max_memberships:25000,example_limit:10,timeout_ms:15000}});
  }
  return<TopicRuleCohortManagerView page={page} rows={rows} current={current} selected={selected} t={t} locale={locale}
    loading={loading} busy={busy} blocked={blocked} valid={valid} dirty={dirty} sourceChanged={sourceChanged} familyChanged={familyChanged}
    error={storageBlocked?"topic_rule_cohort_operation_failed":error} pending={!!pending} readChecked={readChecked} success={success}
    onToggle={toggle} onRemove={key=>{if(!blocked)setSelection(selected.filter(row=>row.candidate_key!==key));}}
    onOpenCandidate={onOpenCandidate} onSave={save} onTrial={trial} onReconcile={reconcile}
    onRefresh={()=>{if(!busy&&!editorBusy){setSuccess(null);void load();}}} onMore={()=>{if(!blocked&&page?.sources.next_cursor)void load(page.sources.next_cursor);}}
    onRecover={()=>{if(!busy&&!editorBusy&&readChecked&&pendingRef.current)void submit(pendingRef.current);}}/>;
}

export function TopicRuleCohortManagerView({page,rows,current,selected,t,locale,loading,busy,blocked,valid,dirty,
  sourceChanged,familyChanged,error,pending,readChecked,success,onToggle,onRemove,onOpenCandidate,onSave,onTrial,
  onReconcile,onRefresh,onMore,onRecover}:{page:TopicCohortPage|null;rows:TopicCohortSource[];current:Record<string,TopicCohortSource>;
  selected:TopicCohortSelection[];t:Translate;locale:string;loading:boolean;busy:boolean;blocked:boolean;valid:boolean;dirty:boolean;
  sourceChanged:boolean;familyChanged:boolean;error:TopicCohortSafeError|null;pending:boolean;readChecked:boolean;success:"saved"|"tested"|null;
  onToggle:(source:TopicCohortSource)=>void;onRemove:(key:string)=>void;onOpenCandidate:Props["onOpenCandidate"];
  onSave:()=>void;onTrial:()=>void;onReconcile:()=>void;onRefresh:()=>void;onMore:()=>void;onRecover:()=>void}){
  const trial=page?.trial,cohort=page?.cohort,number=(value:number)=>formatAdminNumber(value,locale);
  const label=(key:string)=>current[key]?.title??cohort?.binding.rules.find(row=>row.candidate_key===key)?.rule_spec.label??key;
  const measuredLabel=(key:string)=>cohort?.binding.rules.find(row=>row.candidate_key===key)?.rule_spec.label??key;
  const canReconcile=familyChanged||selected.some(row=>{const source=current[row.candidate_key];return source?.eligibility==="eligible"
    &&!cohortSelectionIsCurrent(row,source);});
  const needsRuleSave=selected.some(row=>!cohortSelectionIsCurrent(row,current[row.candidate_key])&&current[row.candidate_key]?.eligibility!=="eligible");
  return<section className="topic-cohort-manager" aria-label={t("title")}>
    <header><h3>{t("title")}</h3><p>{t("body")}</p></header>
    {loading?<div className="semantic-context-pack__preflight-loading" role="status" aria-busy="true">{t("loading")}</div>:null}
    {error?<p className="workspace-form__error" role="alert">{t(`errors.${error}`)}</p>:null}
    {page?<><p className="admin-drawer-form__hint">{t("selected",{count:selected.length,total:page.sources.total})}</p>
      <div className="topic-evaluation-manager__list">{rows.map(source=>{
        const checked=selected.some(row=>row.candidate_key===source.candidate_key);
        return<div className="topic-cohort-manager__source" key={source.candidate_key}>
          <input type="checkbox" aria-label={t("selectCandidate",{title:source.title})} checked={checked}
            disabled={blocked||(!checked&&(source.eligibility!=="eligible"||selected.length>=15))} onChange={()=>onToggle(source)}/>
          <button className="topic-evaluation-manager__candidate" type="button" disabled={busy}
            onClick={event=>onOpenCandidate(source.candidate_key,event)}><span><strong>{source.title}</strong><small>{source.description}</small></span>
            <span className="topic-evaluation-manager__candidate-meta"><small>{t(`eligibility.${source.eligibility}`)}</small>
              {source.draft?<small>{t("ruleVersion",{revision:source.draft.revision})}</small>:null}</span></button>
        </div>;})}</div>
      {!rows.length?<p>{t("empty")}</p>:null}
      {page.sources.next_cursor?<button className="admin-button" type="button" disabled={blocked} onClick={onMore}>{t("actions.more")}</button>:null}
      {selected.length?<details className="topic-cohort-manager__selection" open={sourceChanged||undefined}><summary>{t("selectionTitle",{count:selected.length})}</summary>
        <ul>{selected.map(row=><li key={row.candidate_key}><span>{label(row.candidate_key)} · {t("ruleVersion",{revision:row.expected_draft_revision})}
          {!cohortSelectionIsCurrent(row,current[row.candidate_key])?<small>{t("selectedChanged")}</small>:null}</span>
          <button className="admin-button" type="button" disabled={blocked} onClick={()=>onRemove(row.candidate_key)}
            aria-label={t("removeCandidate",{title:label(row.candidate_key)})}>{t("actions.remove")}</button></li>)}</ul></details>:null}
      {dirty?<p role="status">{t("dirty")}</p>:null}
      {sourceChanged||familyChanged?<div role="status"><p>{t(sourceChanged?"sourceChanged":"familyChanged")}</p>
        {needsRuleSave?<p>{t("needsRuleSave")}</p>:null}
        <button className="admin-button" type="button" disabled={blocked||!canReconcile} onClick={onReconcile}>{t("actions.reconcile")}</button></div>:null}
      {cohort?<p>{t("catalogVersion",{revision:cohort.cohort_revision,profile:cohort.profile_version})}</p>:<p>{t("noCatalog")}</p>}
      {cohort?.is_stale?<p role="status">{t("stale")}</p>:null}
      {cohort&&!trial?<p>{t("untested")}</p>:null}</>:null}
    {pending?<p role="status">{t("pending")}</p>:null}{success?<p role="status">{t(success)}</p>:null}
    <div className="admin-drawer-form__actions"><button className="admin-button admin-button--primary" type="button"
      disabled={blocked||!valid||(!dirty&&!cohort?.is_stale)} onClick={onSave}>{t("actions.save")}</button>
      <button className="admin-button" type="button" disabled={blocked||!valid||dirty||!cohort||cohort.is_stale} onClick={onTrial}>{t("actions.trial")}</button>
      <button className="admin-button" type="button" disabled={busy||loading} onClick={onRefresh}>{t("actions.refresh")}</button>
      {pending?<button className="admin-button" type="button" disabled={busy||loading||!readChecked} onClick={onRecover}>{t("actions.recover")}</button>:null}</div>
    <p className="admin-drawer-form__hint">{t("limits")}</p>
    {trial?<section className="topic-cohort-manager__results" aria-label={t("results")}><h4>{t("results")}</h4>
      <p>{t("receipt",{time:new Date(trial.created_at).toLocaleString(locale)})}</p>
      {trial.is_stale?<p role="status">{t("staleResults")}</p>:null}
      <dl className="topic-cohort-manager__counts">{Object.entries(trial.counts).map(([key,value])=><div key={key}>
        <dt>{t(`counts.${key}`)}</dt><dd>{number(value)}</dd></div>)}</dl>
      <p className="admin-drawer-form__hint">{t("denominators")}</p>
      <div className="topic-cohort-manager__table"><table><caption>{t("perRule")}</caption><thead><tr><th>{t("candidate")}</th>
        <th>{t("matched")}</th><th>{t("exclusive")}</th><th>{t("shared")}</th></tr></thead><tbody>
        {trial.per_rule.map(row=><tr key={row.candidate_key}><th scope="row">{measuredLabel(row.candidate_key)}</th>
          <td>{number(row.matched)}</td><td>{number(row.exclusive)}</td><td>{number(row.shared)}</td></tr>)}</tbody></table></div>
      <details><summary>{t("pairs")}</summary><p>{t("pairsHint")}</p><ul className="topic-cohort-manager__pairs">
        {trial.pairs.map(row=><li key={`${row.left_candidate_key}:${row.right_candidate_key}`}>
          <span>{measuredLabel(row.left_candidate_key)} / {measuredLabel(row.right_candidate_key)}</span><strong>{number(row.intersection)}</strong></li>)}</ul></details>
      <h4>{t("examples")}</h4><p>{t("availability",trial.example_availability)}</p>
      {!trial.examples.length?<p>{t("noExamples")}</p>:null}
      {trial.examples.map(example=><article className="topic-evaluation-manager__evidence" key={example.evidence_ref}>
        <strong>{t(`outcomes.${example.outcome}`)}</strong><p>{example.excerpt}</p>
        {example.matched_candidate_keys.length?<p>{example.matched_candidate_keys.map(measuredLabel).join(" · ")}</p>:null}
        <small>{[example.language,example.market,example.scope,example.month].filter(Boolean).join(" · ")}</small></article>)}
    </section>:null}
    <p className="admin-drawer-form__hint">{t("boundary")}</p>
  </section>;
}
