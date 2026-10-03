"use client";

import React,{ useCallback,useEffect,useRef,useState } from "react";
import {TopicRuleSuggestionExecution} from "./TopicRuleSuggestionExecution";
import { useLocale,useTranslations } from "next-intl";
import { formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { emptyTopicRuleFields,loadTopicRuleDraftPage,requestTopicRuleJson,TopicRuleRequestError,
  topicRuleDraftSchema,topicRuleTrialSchema,topicRuleFieldsFromSpec,topicRuleSpecFromFields,
  type TopicRuleDraftPage,type TopicRuleFields,type TopicRuleSafeError } from "@/lib/data-os/signal-topic-rule-draft-management";
import {loadTopicRuleSuggestionPage,requestTopicRuleSuggestionJson,TopicRuleSuggestionRequestError,
  topicRuleSuggestionBridgeSchema,topicRuleSuggestionPendingSchema,topicRuleSuggestionFields,topicRuleSuggestionFormStale,
  type TopicRuleSuggestionPage,type TopicRuleSuggestionPending,type TopicRuleSuggestionSafeError} from "@/lib/data-os/signal-topic-rule-suggestion-management";
import type { SignalTopicEvaluationV2Candidate } from "@/lib/data-os/signal-topic-evaluation-v2-management";

type Translate=(key:string,values?:Record<string,string|number>)=>string;
type Candidate=Pick<SignalTopicEvaluationV2Candidate,"candidate_key"|"title"|"description"|"revision"|"state_token"|"review_state">;
function storageKey(endpoint:string){return`noisia:topic-rule-pending-v1:${endpoint}`;}
function retainPending(endpoint:string,pending:TopicRuleSuggestionPending|null){
  if(pending)sessionStorage.setItem(storageKey(endpoint),JSON.stringify(pending));
  else sessionStorage.removeItem(storageKey(endpoint));
}

export function TopicCandidateRuleDraft({endpoint,runKey,candidate,editorDirty,editorBusy,onBusyChange,onRefreshCandidate,onRuleSaved}:{
  endpoint:string;runKey:string;candidate:Candidate;editorDirty:boolean;editorBusy:boolean;
  onBusyChange:(busy:boolean)=>void;onRefreshCandidate:()=>Promise<void>;onRuleSaved?:()=>void}){
  const t=useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates.ruleDraft"),locale=useLocale();
  const url=`${endpoint}/${encodeURIComponent(candidate.candidate_key)}/rule-draft`;
  const suggestionUrl=`${endpoint}/${encodeURIComponent(candidate.candidate_key)}/rule-suggestions`;
  const scope=`${url}:${runKey}:${candidate.candidate_key}`;
  const[page,setPage]=useState<TopicRuleDraftPage|null>(null),[fields,setFields]=useState<TopicRuleFields>(emptyTopicRuleFields);
  const[suggestionPage,setSuggestionPage]=useState<TopicRuleSuggestionPage|null>(null);
  const[suggestionError,setSuggestionError]=useState<TopicRuleSuggestionSafeError|null>(null);
  const[usedReceipt,setUsedReceipt]=useState<string|null>(null),[beforeCopy,setBeforeCopy]=useState<{fields:TopicRuleFields;receipt:string|null}|null>(null);
  const[formBase,setFormBase]=useState<{candidate_revision:number;candidate_state_token:string;draft_revision:number;draft_digest:string|null}|null>(null);
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const[executionBusy,setExecutionBusy]=useState(false);
  const generationBusyChange=useCallback((value:boolean)=>{setExecutionBusy(value);onBusyChange(value);},[onBusyChange]);
  const[error,setError]=useState<TopicRuleSafeError|null>(null),[pending,setPending]=useState<TopicRuleSuggestionPending|null>(null);
  const[readChecked,setReadChecked]=useState(false),[success,setSuccess]=useState<"saved"|"tested"|null>(null);
  const[storageBlocked,setStorageBlocked]=useState(false);
  const inFlight=useRef(false),mounted=useRef(true),read=useRef<AbortController|null>(null),epoch=useRef(0);
  const pendingRef=useRef<TopicRuleSuggestionPending|null>(null),usedReceiptRef=useRef<string|null>(null);
  const load=useCallback(async(replaceFields=false,includeCitations=false,exactReceipt?:string)=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;
    setLoading(true);setError(null);setSuggestionError(null);
    try{let next:TopicRuleDraftPage,suggestions:TopicRuleSuggestionPage|null=null;
      const retained=pendingRef.current;
      const receipt_id=exactReceipt??usedReceiptRef.current??(retained?.kind==="suggestion"?retained.body.receipt_id:undefined);
      try{suggestions=await loadTopicRuleSuggestionPage(suggestionUrl,runKey,candidate.candidate_key,
        {receipt_id:receipt_id??undefined,include_citations:includeCitations,signal:controller.signal});next=suggestions.page;}
      catch(cause){if(!(cause instanceof TopicRuleSuggestionRequestError)||cause.code!=="topic_rule_suggestion_schema_unavailable")throw cause;
        next=await loadTopicRuleDraftPage(url,runKey,candidate.candidate_key,controller.signal);
        if(!controller.signal.aborted&&mounted.current)setSuggestionError(cause.code);}
      if(controller.signal.aborted||!mounted.current)return;
      setPage(next);setSuggestionPage(suggestions);
      if(replaceFields){setFields(next.draft?topicRuleFieldsFromSpec(next.draft.rule_spec):emptyTopicRuleFields());
        setFormBase({candidate_revision:next.candidate.revision,candidate_state_token:next.candidate.state_token,
          draft_revision:next.draft?.revision??0,draft_digest:next.draft?.draft_digest??null});setBeforeCopy(null);
        const linked=next.draft&&suggestions?.receipt&&!suggestions.receipt.is_stale
          &&suggestions.receipt.latest_link?.draft_id===next.draft.draft_id?suggestions.receipt.receipt_id:null;
        usedReceiptRef.current=linked;setUsedReceipt(linked);
        if(retained&&retained.kind!=="trial"){
          const request=retained.body;setFormBase({candidate_revision:request.expected_candidate_revision,
            candidate_state_token:request.expected_candidate_state_token,draft_revision:request.expected_draft_revision,
            draft_digest:request.expected_draft_digest});
          if(retained.kind==="save")setFields(topicRuleFieldsFromSpec(retained.body.rule_spec));
          else{usedReceiptRef.current=retained.body.receipt_id;setUsedReceipt(retained.body.receipt_id);
            if(retained.body.action==="save")setFields(topicRuleFieldsFromSpec({contract_version:"signal-topic-rule-spec-v1",kind:"topic",
              label:next.candidate.title,definition:next.candidate.description,lexical:retained.body.lexical,filters:retained.body.filters}));}
        }}
      setReadChecked(true);
    }catch(cause){if(controller.signal.aborted||!mounted.current)return;
      setPage(null);setSuggestionPage(null);setReadChecked(false);
      if(cause instanceof TopicRuleSuggestionRequestError){setSuggestionError(cause.code);
        if(cause.code==="topic_rule_suggestion_forbidden"||cause.code==="topic_rule_suggestion_not_found"){
          setFields(emptyTopicRuleFields());setBeforeCopy(null);setUsedReceipt(null);usedReceiptRef.current=null;}}
      else setError(cause instanceof TopicRuleRequestError?cause.code:"topic_rule_operation_failed");
    }finally{if(!controller.signal.aborted&&mounted.current)setLoading(false);}
  },[url,suggestionUrl,runKey,candidate.candidate_key]);
  useEffect(()=>{
    const activeEpoch=epoch.current+1;epoch.current=activeEpoch;mounted.current=true;
    inFlight.current=false;pendingRef.current=null;usedReceiptRef.current=null;
    setBusy(false);setPending(null);setUsedReceipt(null);setBeforeCopy(null);setFormBase(null);
    setPage(null);setSuggestionPage(null);setFields(emptyTopicRuleFields());setStorageBlocked(false);setReadChecked(false);
    try{const raw=sessionStorage.getItem(storageKey(url));if(raw){const prior=topicRuleSuggestionPendingSchema.parse(JSON.parse(raw));
      if(prior.body.run_key===runKey&&prior.body.candidate_key===candidate.candidate_key&&(prior.kind!=="suggestion"||prior.scope===scope)){
        pendingRef.current=prior;setPending(prior);
      }else{setStorageBlocked(true);setError("topic_rule_scope_mismatch");}}}
    catch{setStorageBlocked(true);setError("topic_rule_operation_failed");}
    void load(true);
    return()=>{mounted.current=false;epoch.current=activeEpoch+1;read.current?.abort();onBusyChange(false);};
  },[load,url,runKey,candidate.candidate_key,onBusyChange,scope]);
  const draft=page?.draft;
  const dirty=JSON.stringify(fields)!==JSON.stringify(draft?topicRuleFieldsFromSpec(draft.rule_spec):emptyTopicRuleFields());
  const sourceStale=!!page&&(page.candidate.state_token!==candidate.state_token||page.candidate.revision!==candidate.revision);
  const formStale=!!page&&!!formBase&&topicRuleSuggestionFormStale(page,formBase);
  const linkedStale=usedReceipt!==null&&(!suggestionPage?.receipt||suggestionPage.receipt.receipt_id!==usedReceipt||suggestionPage.receipt.is_stale);
  let valid=false;try{topicRuleSpecFromFields(candidate,fields);valid=true;}catch{/* Inline bounded form feedback. */}
  const blocked=busy||executionBusy||loading||editorBusy||editorDirty||!page||sourceStale||formStale||linkedStale||storageBlocked||candidate.review_state!=="pending";

  async function submit(input:TopicRuleSuggestionPending){
    if(inFlight.current)return;
    // Normalize once before BOTH persistence and the first send, so recovery after schema parsing keeps identical bytes.
    let operation:TopicRuleSuggestionPending;
    try{operation=topicRuleSuggestionPendingSchema.parse(input);}catch{setError("topic_rule_request_invalid");return;}
    if(operation.kind==="suggestion"&&operation.scope!==scope){setSuggestionError("topic_rule_suggestion_scope_mismatch");return;}
    // Store the exact request/key before transport; failure to retain it means zero POSTs.
    try{retainPending(url,operation);}catch{setError("topic_rule_operation_failed");return;}
    const startedEpoch=epoch.current;
    inFlight.current=true;pendingRef.current=operation;setPending(operation);setReadChecked(false);
    setBusy(true);onBusyChange(true);setError(null);setSuggestionError(null);setSuccess(null);
    try{const init={
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":operation.key},
      body:JSON.stringify(operation.body)};
      const value=operation.kind==="suggestion"?await requestTopicRuleSuggestionJson(
        `${suggestionUrl}/${encodeURIComponent(operation.body.receipt_id)}/draft`,init)
        :await requestTopicRuleJson(operation.kind==="trial"?`${url}/trial`:url,init);
      const bridge=operation.kind==="suggestion"?topicRuleSuggestionBridgeSchema.parse(value):null;
      const result=bridge?bridge.draft:operation.kind==="save"?topicRuleDraftSchema.parse(value):topicRuleTrialSchema.parse(value);
      if(bridge&&operation.kind==="suggestion"&&(bridge.receipt_id!==operation.body.receipt_id||bridge.action!==operation.body.action
        ||bridge.draft.source.run_key!==runKey||bridge.draft.source.candidate_key!==candidate.candidate_key
        ||bridge.draft.source.revision!==operation.body.expected_candidate_revision
        ||bridge.draft.revision!==operation.body.expected_draft_revision+1))throw new Error("scope_mismatch");
      if(operation.kind==="save"&&"source" in result&&(result.source.run_key!==runKey
        ||result.source.candidate_key!==candidate.candidate_key
        ||result.source.revision!==operation.body.expected_candidate_revision
        ||result.revision!==operation.body.expected_draft_revision+1))throw new Error("scope_mismatch");
      if(operation.kind==="trial"&&"draft_revision" in result&&(result.draft_id!==operation.body.draft_id
        ||result.draft_revision!==operation.body.expected_draft_revision||result.draft_digest!==operation.body.expected_draft_digest))
        throw new Error("scope_mismatch");
      if(!mounted.current||startedEpoch!==epoch.current)return;
      retainPending(url,null);pendingRef.current=null;
      if(!mounted.current)return;setPending(null);setSuccess(operation.kind!=="trial"?"saved":"tested");
      if(operation.kind!=="trial")onRuleSaved?.();
      await load(operation.kind!=="trial");
    }catch(cause){
      if(!mounted.current||startedEpoch!==epoch.current)return;
      // Known rejected requests did not commit. Unknown transport/parse/5xx outcomes retain the exact key.
      if((cause instanceof TopicRuleRequestError||cause instanceof TopicRuleSuggestionRequestError)&&!cause.ambiguous){
        try{retainPending(url,null);pendingRef.current=null;setPending(null);}catch{/* Retain pending if storage fails. */}
      }
      if(cause instanceof TopicRuleSuggestionRequestError){setSuggestionError(cause.code);
        if(cause.code==="topic_rule_suggestion_forbidden"||cause.code==="topic_rule_suggestion_not_found"){
          setSuggestionPage(null);setPage(null);setReadChecked(false);setFields(emptyTopicRuleFields());
          setBeforeCopy(null);setUsedReceipt(null);usedReceiptRef.current=null;}}
      else setError(cause instanceof TopicRuleRequestError?cause.code:"topic_rule_operation_failed");
    }finally{if(startedEpoch===epoch.current){inFlight.current=false;if(mounted.current){setBusy(false);onBusyChange(false);}}}
  }
  function save(){if(blocked||pendingRef.current||!valid||!formBase)return;
    if(usedReceipt){const spec=topicRuleSpecFromFields(candidate,fields);
      void submit({kind:"suggestion",scope,key:`topic-rule:suggestion:${crypto.randomUUID()}`,body:{action:"save",run_key:runKey,
        candidate_key:candidate.candidate_key,receipt_id:usedReceipt,expected_candidate_revision:formBase.candidate_revision,
        expected_candidate_state_token:formBase.candidate_state_token,expected_draft_revision:formBase.draft_revision,
        expected_draft_digest:formBase.draft_digest,lexical:spec.lexical,filters:spec.filters}});return;}
    const body={run_key:runKey,candidate_key:candidate.candidate_key,
      expected_candidate_revision:formBase.candidate_revision,expected_candidate_state_token:formBase.candidate_state_token,
      expected_draft_revision:formBase.draft_revision,expected_draft_digest:formBase.draft_digest,
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
  function useSuggestion(){const receipt=suggestionPage?.receipt;if(blocked||pending||!receipt||receipt.is_stale||!receipt.rule_spec)return;
    setBeforeCopy({fields,receipt:usedReceipt});setFields(topicRuleSuggestionFields(receipt));setUsedReceipt(receipt.receipt_id);
    usedReceiptRef.current=receipt.receipt_id;setSuccess(null);}
  function restore(){const receipt=suggestionPage?.receipt,prior=suggestionPage?.prior_drafts[0];
    if(blocked||pending||dirty||!receipt||receipt.is_stale||!prior||!formBase)return;
    void submit({kind:"suggestion",scope,key:`topic-rule:restore:${crypto.randomUUID()}`,body:{action:"restore",run_key:runKey,
      candidate_key:candidate.candidate_key,receipt_id:receipt.receipt_id,restore_draft_id:prior.draft_id,
      expected_candidate_revision:formBase.candidate_revision,expected_candidate_state_token:formBase.candidate_state_token,
      expected_draft_revision:formBase.draft_revision,expected_draft_digest:formBase.draft_digest}});}
  return<><TopicRuleSuggestionView page={suggestionPage} error={suggestionError} t={t} blocked={blocked||!!pending} reading={busy||loading}
    dirty={dirty} used={usedReceipt!==null} canUndoCopy={beforeCopy!==null} onUse={useSuggestion}
    onCitations={()=>{const id=suggestionPage?.receipt?.receipt_id;if(id)void load(false,true,id);}}
    onUndoCopy={()=>{if(beforeCopy){setFields(beforeCopy.fields);setBeforeCopy(null);setUsedReceipt(beforeCopy.receipt);usedReceiptRef.current=beforeCopy.receipt;}}}
    onRestore={restore} execution={page?<TopicRuleSuggestionExecution key={scope} endpoint={`${suggestionUrl}/execution`}
      workspaceId={decodeURIComponent(/\/signal\/([^/]+)/u.exec(endpoint)?.[1]??"")}
      request={{run_key:runKey,candidate_key:candidate.candidate_key,expected_candidate_revision:page.candidate.revision,
        expected_candidate_state_token:page.candidate.state_token,expected_draft_revision:page.draft?.revision??0,
        expected_draft_digest:page.draft?.draft_digest??null}}
      capability={suggestionPage?.generation??{enabled:false,reason:"execution_not_enabled"}}
      disabled={blocked||!!pending} onBusyChange={generationBusyChange} onReceipt={id=>void load(false,false,id)}/>:undefined}/>
  {formStale?<p role="status">{t("suggestion.formStale")}</p>:null}
  {(dirty||formStale||usedReceipt)?<button type="button" className="admin-button" disabled={busy||loading||!!pending||editorDirty}
    onClick={()=>void load(true)}>{t("suggestion.discard")}</button>:null}
  <TopicCandidateRuleDraftView candidate={candidate} page={page} fields={fields} t={t} locale={locale}
    loading={loading} busy={busy} blocked={blocked} dirty={dirty} valid={valid} editorDirty={editorDirty}
    sourceStale={sourceStale} error={storageBlocked?"topic_rule_operation_failed":error} pending={pending!==null} readChecked={readChecked} success={success}
    onFields={(next)=>{setFields(next);setSuccess(null);}} onSave={save} onTrial={trial} onRefresh={()=>void refresh()}
    onRecover={()=>{if(pendingRef.current&&readChecked&&!busy)void submit(pendingRef.current);}}/></>;
}

export function TopicRuleSuggestionView({page,error,t,blocked,reading,dirty,used,canUndoCopy,onUse,onCitations,onUndoCopy,onRestore,execution}:{
  page:TopicRuleSuggestionPage|null;error:TopicRuleSuggestionSafeError|null;t:Translate;blocked:boolean;dirty:boolean;used:boolean;
  reading:boolean;canUndoCopy:boolean;onUse:()=>void;onCitations:()=>void;onUndoCopy:()=>void;onRestore:()=>void;execution?:React.ReactNode}){
  const receipt=page?.receipt,prior=page?.prior_drafts[0];
  return<section className="topic-evaluation-manager__evidence admin-drawer-form" aria-label={t("suggestion.title")}>
    <h3>{t("suggestion.title")}</h3><p>{t("suggestion.body")}</p>
    {execution??<><button type="button" className="admin-button" disabled>{t("suggestion.generate")}</button>
    <p className="admin-drawer-form__hint">{t("suggestion.generationDisabled")}</p></>}
    {error?<p role="alert" className="workspace-form__error">{t(`suggestion.errors.${error}`)}</p>:null}
    {page&&!receipt?<p>{t("suggestion.empty")}</p>:null}
    {receipt?<><strong>{t(receipt.origin==="provider"?"suggestion.provider":"suggestion.localFixture")}</strong><p>{receipt.explanation}</p>
      {receipt.is_stale?<p role="status">{t("suggestion.stale")}</p>:null}
      {receipt.status==="insufficient_evidence"?<p>{t("suggestion.insufficient")}</p>:null}
      {receipt.rule_spec?<dl>{(["any","all","not"]as const).map(key=><div key={key}>
        <dt>{t(`fields.${key}`)}</dt><dd>{receipt.rule_spec!.lexical[key].join(" · ")||t("suggestion.none")}</dd></div>)}</dl>:null}
      <p className="admin-drawer-form__hint">{t("suggestion.citationCount",receipt.evidence)}</p>
      <div className="admin-drawer-form__actions">
        <button type="button" className="admin-button" disabled={blocked||receipt.is_stale||!receipt.rule_spec} onClick={onUse}>{t("suggestion.use")}</button>
        <button type="button" className="admin-button" disabled={reading} onClick={onCitations}>{t("suggestion.citations")}</button>
        {canUndoCopy?<button type="button" className="admin-button" disabled={blocked} onClick={onUndoCopy}>{t("suggestion.undoCopy")}</button>:null}
        {prior?<button type="button" className="admin-button" disabled={blocked||dirty||receipt.is_stale||!receipt.rule_spec} onClick={onRestore}>
          {t("suggestion.restore",{revision:prior.revision})}</button>:null}
      </div>
      {used?<p role="status">{t("suggestion.copied")}</p>:null}
      {page?.citations?.items.map((item,index)=><article className="topic-evaluation-manager__evidence" key={item.evidence_ref}>
        <strong>{t("suggestion.reference",{index:index+1})}</strong>{item.status==="available"?<>
          <blockquote>{item.excerpt}</blockquote><p>{[item.month,item.language,item.market,item.scope].filter(Boolean).join(" · ")}</p>
        </>:<p>{t("suggestion.citationUnavailable")}</p>}</article>)}
    </>:null}
  </section>;
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
      <fieldset disabled={disabled}><legend>{t("suggestion.scopes")}</legend>
        {(["primary_brand","same_entity","competitor","category","other"]as const).map(scope=><label key={scope}>
          <input type="checkbox" checked={fields.scopes.includes(scope)} onChange={event=>onFields({...fields,
            scopes:event.target.checked?[...fields.scopes,scope]:fields.scopes.filter(value=>value!==scope)})}/>
          {t(`suggestion.scopeLabels.${scope}`)}</label>)}
      </fieldset>
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
