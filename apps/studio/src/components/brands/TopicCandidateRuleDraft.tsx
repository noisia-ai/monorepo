"use client";

import React,{ useCallback,useEffect,useRef,useState } from "react";
import { useLocale,useTranslations } from "next-intl";
import { formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { emptyTopicRuleFields,loadTopicRuleDraftPage,requestTopicRuleJson,TopicRuleRequestError,
  topicRuleDraftSchema,topicRuleTrialSchema,topicRulePendingSchema,topicRuleFieldsFromSpec,topicRuleSpecFromFields,
  type TopicRuleDraftPage,type TopicRuleFields,type TopicRulePending,type TopicRuleSafeError } from "@/lib/data-os/signal-topic-rule-draft-management";
import type { SignalTopicEvaluationV2Candidate } from "@/lib/data-os/signal-topic-evaluation-v2-management";

type Translate=(key:string,values?:Record<string,string|number>)=>string;
type Candidate=Pick<SignalTopicEvaluationV2Candidate,"candidate_key"|"title"|"description"|"revision"|"state_token"|"review_state">;
function storageKey(endpoint:string){return`noisia:topic-rule-pending-v1:${endpoint}`;}
function retainPending(endpoint:string,pending:TopicRulePending|null){
  if(pending)sessionStorage.setItem(storageKey(endpoint),JSON.stringify(pending));
  else sessionStorage.removeItem(storageKey(endpoint));
}

export function TopicCandidateRuleDraft({endpoint,runKey,candidate,editorDirty,editorBusy,onBusyChange,onRefreshCandidate,onRuleSaved}:{
  endpoint:string;runKey:string;candidate:Candidate;editorDirty:boolean;editorBusy:boolean;
  onBusyChange:(busy:boolean)=>void;onRefreshCandidate:()=>Promise<void>;onRuleSaved?:()=>void}){
  const t=useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates.ruleDraft"),locale=useLocale();
  const url=`${endpoint}/${encodeURIComponent(candidate.candidate_key)}/rule-draft`;
  const[page,setPage]=useState<TopicRuleDraftPage|null>(null),[fields,setFields]=useState<TopicRuleFields>(emptyTopicRuleFields);
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const[error,setError]=useState<TopicRuleSafeError|null>(null),[pending,setPending]=useState<TopicRulePending|null>(null);
  const[readChecked,setReadChecked]=useState(false),[success,setSuccess]=useState<"saved"|"tested"|null>(null);
  const[storageBlocked,setStorageBlocked]=useState(false);
  const inFlight=useRef(false),mounted=useRef(true),read=useRef<AbortController|null>(null);
  const pendingRef=useRef<TopicRulePending|null>(null);
  const load=useCallback(async(replaceFields=false)=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;
    setLoading(true);setError(null);
    try{const next=await loadTopicRuleDraftPage(url,runKey,candidate.candidate_key,controller.signal);
      if(controller.signal.aborted||!mounted.current)return;
      setPage(next);if(replaceFields)setFields(next.draft?topicRuleFieldsFromSpec(next.draft.rule_spec):emptyTopicRuleFields());
      setReadChecked(true);
    }catch(cause){if(controller.signal.aborted||!mounted.current)return;
      setPage(null);setReadChecked(false);setError(cause instanceof TopicRuleRequestError?cause.code:"topic_rule_operation_failed");
    }finally{if(!controller.signal.aborted&&mounted.current)setLoading(false);}
  },[url,runKey,candidate.candidate_key]);
  useEffect(()=>{
    mounted.current=true;
    try{const raw=sessionStorage.getItem(storageKey(url));if(raw){const prior=topicRulePendingSchema.parse(JSON.parse(raw));
      if(prior.body.run_key===runKey&&prior.body.candidate_key===candidate.candidate_key){
        pendingRef.current=prior;setPending(prior);
      }else{setStorageBlocked(true);setError("topic_rule_scope_mismatch");}}}
    catch{setStorageBlocked(true);setError("topic_rule_operation_failed");}
    void load(true);
    return()=>{mounted.current=false;read.current?.abort();onBusyChange(false);};
  },[load,url,runKey,candidate.candidate_key,onBusyChange]);
  const draft=page?.draft;
  const dirty=JSON.stringify(fields)!==JSON.stringify(draft?topicRuleFieldsFromSpec(draft.rule_spec):emptyTopicRuleFields());
  const sourceStale=!!page&&(page.candidate.state_token!==candidate.state_token||page.candidate.revision!==candidate.revision);
  let valid=false;try{topicRuleSpecFromFields(candidate,fields);valid=true;}catch{/* Inline bounded form feedback. */}
  const blocked=busy||loading||editorBusy||editorDirty||!page||sourceStale||storageBlocked||candidate.review_state!=="pending";

  async function submit(operation:TopicRulePending){
    if(inFlight.current)return;
    // Store the exact request/key before transport; failure to retain it means zero POSTs.
    try{retainPending(url,operation);}catch{setError("topic_rule_operation_failed");return;}
    inFlight.current=true;pendingRef.current=operation;setPending(operation);setReadChecked(false);
    setBusy(true);onBusyChange(true);setError(null);setSuccess(null);
    try{const value=await requestTopicRuleJson(operation.kind==="trial"?`${url}/trial`:url,{
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key},
      body:JSON.stringify(operation.body)});
      const result=operation.kind==="save"?topicRuleDraftSchema.parse(value):topicRuleTrialSchema.parse(value);
      if(operation.kind==="save"&&"source" in result&&(result.source.run_key!==runKey
        ||result.source.candidate_key!==candidate.candidate_key
        ||result.source.revision!==operation.body.expected_candidate_revision
        ||result.revision!==operation.body.expected_draft_revision+1))throw new Error("scope_mismatch");
      if(operation.kind==="trial"&&"draft_revision" in result&&(result.draft_id!==operation.body.draft_id
        ||result.draft_revision!==operation.body.expected_draft_revision||result.draft_digest!==operation.body.expected_draft_digest))
        throw new Error("scope_mismatch");
      retainPending(url,null);pendingRef.current=null;
      if(!mounted.current)return;setPending(null);setSuccess(operation.kind==="save"?"saved":"tested");
      if(operation.kind==="save")onRuleSaved?.();
      await load(operation.kind==="save");
    }catch(cause){
      if(!mounted.current)return;
      // Known rejected requests did not commit. Unknown transport/parse/5xx outcomes retain the exact key.
      if(cause instanceof TopicRuleRequestError&&!cause.ambiguous){
        try{retainPending(url,null);pendingRef.current=null;setPending(null);}catch{/* Retain pending if storage fails. */}
      }
      setError(cause instanceof TopicRuleRequestError?cause.code:"topic_rule_operation_failed");
    }finally{inFlight.current=false;if(mounted.current){setBusy(false);onBusyChange(false);}}
  }
  function save(){if(blocked||pendingRef.current||!valid)return;
    const body={run_key:runKey,candidate_key:candidate.candidate_key,
      expected_candidate_revision:candidate.revision,expected_candidate_state_token:candidate.state_token,
      expected_draft_revision:draft?.revision??0,expected_draft_digest:draft?.draft_digest??null,
      rule_spec:topicRuleSpecFromFields(candidate,fields)};
    void submit({kind:"save",key:`topic-rule:save:${crypto.randomUUID()}`,body});
  }
  function trial(){if(blocked||pendingRef.current||dirty||!draft||draft.is_stale)return;
    void submit({kind:"trial",key:`topic-rule:trial:${crypto.randomUUID()}`,body:{run_key:runKey,
      candidate_key:candidate.candidate_key,expected_candidate_revision:candidate.revision,
      expected_candidate_state_token:candidate.state_token,draft_id:draft.draft_id,
      expected_draft_revision:draft.revision,expected_draft_digest:draft.draft_digest,
      max_memberships:25000,example_limit:10,timeout_ms:15000}});
  }
  async function refresh(){if(busy)return;setSuccess(null);
    if(sourceStale&&!editorDirty)await onRefreshCandidate();
    // Always reconcile the receipt snapshot after the parent identity refresh; keep authored phrases.
    await load(false);
  }
  return<TopicCandidateRuleDraftView candidate={candidate} page={page} fields={fields} t={t} locale={locale}
    loading={loading} busy={busy} blocked={blocked} dirty={dirty} valid={valid} editorDirty={editorDirty}
    sourceStale={sourceStale} error={storageBlocked?"topic_rule_operation_failed":error} pending={pending!==null} readChecked={readChecked} success={success}
    onFields={(next)=>{setFields(next);setSuccess(null);}} onSave={save} onTrial={trial} onRefresh={()=>void refresh()}
    onRecover={()=>{if(pendingRef.current&&readChecked&&!busy)void submit(pendingRef.current);}}/>;
}

export function TopicCandidateRuleDraftView({candidate,page,fields,t,locale,loading,busy,blocked,dirty,valid,
  editorDirty,sourceStale,error,pending,readChecked,success,onFields,onSave,onTrial,onRefresh,onRecover}:{
  candidate:Candidate;page:TopicRuleDraftPage|null;fields:TopicRuleFields;t:Translate;locale:string;
  loading:boolean;busy:boolean;blocked:boolean;dirty:boolean;valid:boolean;editorDirty:boolean;sourceStale:boolean;
  error:TopicRuleSafeError|null;pending:boolean;readChecked:boolean;success:"saved"|"tested"|null;
  onFields:(fields:TopicRuleFields)=>void;onSave:()=>void;onTrial:()=>void;onRefresh:()=>void;onRecover:()=>void}){
  const trial=page?.trial,draft=page?.draft,disabled=blocked||pending;
  const number=(value:number)=>formatAdminNumber(value,locale);
  return<section className="topic-evaluation-manager__evidence admin-drawer-form" aria-label={t("title")}>
    <h3>{t("title")}</h3><p>{t("body")}</p>
    <p><strong>{t("savedIdentity")}: {candidate.title}</strong></p><p>{candidate.description}</p>
    {loading?<div className="semantic-context-pack__preflight-loading" role="status" aria-busy="true">{t("loading")}</div>:null}
    {!loading&&page&&!draft?<p>{t("empty")}</p>:null}
    {editorDirty?<p role="status">{t("editorDirty")}</p>:null}
    {candidate.review_state==="rejected"?<p role="status">{t("rejected")}</p>:null}
    {sourceStale||draft?.is_stale?<p role="status">{t("stale")}</p>:null}
    {(["any","all","not"]as const).map((field)=><label className="workspace-field" key={field}>
      <span>{t(`fields.${field}`)}</span><textarea className="workspace-control" rows={3}
        disabled={disabled} value={fields[field]} onChange={(event)=>onFields({...fields,[field]:event.target.value})}/>
      <small className="admin-drawer-form__hint">{t(`hints.${field}`)}</small></label>)}
    <p className="admin-drawer-form__hint">{t("phraseLimits")}</p>
    <details><summary>{t("filters")}</summary><p className="admin-drawer-form__hint">{t("filtersHint")}</p>
      {(["languages","markets"]as const).map((field)=><label className="workspace-field" key={field}>
        <span>{t(`fields.${field}`)}</span><textarea className="workspace-control" rows={2} disabled={disabled}
          value={fields[field]} onChange={(event)=>onFields({...fields,[field]:event.target.value})}/>
        <small className="admin-drawer-form__hint">{t(`hints.${field}`)}</small></label>)}
      {fields.scopes.length?<p>{t("existingScopes",{values:fields.scopes.join(", ")})}</p>:null}
    </details>
    {dirty&&!valid?<p className="workspace-form__error" role="alert">{t("invalid")}</p>:null}
    {dirty&&valid?<p role="status">{t("dirty")}</p>:null}
    {error?<p className="workspace-form__error" role="alert">{t(`errors.${error}`)}</p>:null}
    {pending?<p role="status">{t("ambiguous")}</p>:null}
    {success?<p role="status">{t(success)}</p>:null}
    <div className="admin-drawer-form__actions">
      <button className="admin-button" type="button" disabled={disabled||!valid||(!dirty&&!draft?.is_stale)} onClick={onSave}>
        {t("save")}</button>
      <button className="admin-button admin-button--primary" type="button"
        disabled={disabled||dirty||!draft||draft.is_stale} onClick={onTrial}>{busy?t("working"):t("test")}</button>
      <button className="admin-button" type="button" disabled={busy||loading||(sourceStale&&editorDirty)} onClick={onRefresh}>{t("refresh")}</button>
      {pending?<button className="admin-button" type="button" disabled={busy||loading||!readChecked} onClick={onRecover}>{t("recover")}</button>:null}
    </div>
    <p className="admin-drawer-form__hint">{t("cap",{count:number(25000)})}</p>
    {trial?<section className="topic-evaluation-manager__evidence" aria-label={t("results")}>
      <h4>{t("results")}</h4><p>{t("historicalCounts")}</p>
      {trial.is_stale||!trial.is_latest_draft||dirty?<p role="status">{t("resultsStale")}</p>:null}
      <dl>{(["total","considered","matched","abstained","filter_excluded","unavailable","not_tested"]as const).map((key)=><div key={key}>
        <dt>{t(`counts.${key}`)}</dt><dd>{number(trial.counts[key])}</dd></div>)}</dl>
      <p>{t("measuredCap",{count:number(trial.max_memberships)})}</p>
      {trial.counts.matched===0?<p>{t("zeroMatches")}</p>:null}
      <p>{t("availability",{stored:trial.example_availability.stored,available:trial.example_availability.available,
        unavailable:trial.example_availability.unavailable})}</p>
      {trial.examples.map((example)=><article key={example.evidence_ref} className="topic-evaluation-manager__evidence">
        <strong>{t(`examples.${example.outcome}`)}</strong><blockquote>{example.excerpt}</blockquote>
        <p className="admin-drawer-form__hint">{[example.language,example.market,example.month].filter(Boolean).join(" · ")}</p>
      </article>)}
      {trial.examples.length===0?<p>{t("noExamples")}</p>:null}
    </section>:draft?<p>{t("untested")}</p>:null}
  </section>;
}
