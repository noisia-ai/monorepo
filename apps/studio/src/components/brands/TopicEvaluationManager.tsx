"use client";

import { ArrowCounterClockwise,ChartLineUp,CircleNotch,PencilSimple,Play,Warning,XCircle } from "@phosphor-icons/react";
import { useLocale,useTranslations } from "next-intl";
import { useCallback,useEffect,useRef,useState,type MouseEvent } from "react";

import { AdminFeedbackState,AdminResourceSection,AdminStatus,AdminSummaryStrip,formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import { acquireSignalTopicEvaluationSubmissionLockV1,buildSignalTopicEvaluationLaunchRequestV1,
  buildSignalTopicEvaluationSuccessorRequestV1,canLaunchSignalTopicEvaluationV1,
  createSignalTopicEvaluationIdempotencyKeyV1,createSignalTopicEvaluationSuccessorIdempotencyKeyV1,
  createSignalTopicEvaluationReviewIdempotencyKeyV1,projectSignalTopicEvaluationManagementV1,
  readSignalTopicEvaluationRunStatusV1,selectSignalTopicEvaluationLaunchModeV1,type SignalTopicEvaluationCandidateV1,
  type SignalTopicEvaluationManagementV1 } from "@/lib/data-os/signal-topic-evaluation-launch";

async function requestJson(url:string,init?:RequestInit){const response=await fetch(url,{cache:"no-store",...init});
  const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:
    typeof payload?.error==="string"?payload.error:"request_failed");return payload;}
function microUsd(value:string|null,locale:string){if(!value||!/^\d+$/u.test(value))return"USD —";
  return new Intl.NumberFormat(locale,{style:"currency",currency:"USD",currencyDisplay:"code",
    minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(BigInt(value))/1_000_000);}
type LaunchMode="root"|"successor";
type StoredAttempt={idempotencyKey:string;status:"queued"|null};
function readStoredAttempt(value:string|null,mode:LaunchMode):StoredAttempt|null{if(!value)return null;try{const parsed=JSON.parse(value) as Partial<StoredAttempt>;
  const prefix=mode==="successor"?"topic-evaluation:successor:":"topic-evaluation:start:";
  if(typeof parsed.idempotencyKey!=="string"||!parsed.idempotencyKey.startsWith(prefix)
    ||(parsed.status!==null&&parsed.status!=="queued"))return null;
  return{idempotencyKey:parsed.idempotencyKey,status:parsed.status};}catch{return null;}}

export function TopicEvaluationManager({workspaceId}:{workspaceId:string}){
  const t=useTranslations("AdminWorkspace.brandOs.topicEvaluation"),locale=useLocale();
  const endpoint=`/api/data-os/signal/${workspaceId}/topic-evaluation`,storagePrefix=`noisia:topic-evaluation-launch:${workspaceId}`;
  const[management,setManagement]=useState<SignalTopicEvaluationManagementV1|null>(null);
  const[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false);
  const[drawer,setDrawer]=useState<"launch"|"candidate"|null>(null);
  const[selected,setSelected]=useState<SignalTopicEvaluationCandidateV1|null>(null);
  const[acknowledged,setAcknowledged]=useState(false),[submitting,setSubmitting]=useState(false);
  const[attemptRecorded,setAttemptRecorded]=useState(false),[sessionChecked,setSessionChecked]=useState(false);
  const[runStatus,setRunStatus]=useState<"queued"|null>(null),[error,setError]=useState<string|null>(null);
  const[title,setTitle]=useState(""),[description,setDescription]=useState("");
  const[inclusion,setInclusion]=useState(""),[exclusion,setExclusion]=useState("");
  const submitLockRef=useRef(false),openerRef=useRef<HTMLButtonElement|null>(null);

  const load=useCallback(async(cursor?:string|null)=>{if(cursor)setLoadingMore(true);else setLoading(true);setError(null);
    try{const payload=await requestJson(`${endpoint}?limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
      const next=projectSignalTopicEvaluationManagementV1(payload);
      setManagement((current)=>cursor&&current?{...next,results:{...next.results,
        items:[...current.results.items,...next.results.items]}}:next);
    }catch(loadError){setError(loadError instanceof Error?loadError.message:t("errors.load"));}
    finally{setLoading(false);setLoadingMore(false);}},[endpoint,t]);
  useEffect(()=>{void load();},[load]);
  const durableStatus=management?.run?.status??null;
  useEffect(()=>{if(!durableStatus||!["queued","in_flight","response_persisted"].includes(durableStatus))return;
    const timer=window.setTimeout(()=>void load(),5000);return()=>window.clearTimeout(timer);},[durableStatus,load]);

  const card=management?.card??null,ready=card?canLaunchSignalTopicEvaluationV1(card):false;
  const launchMode:LaunchMode|null=selectSignalTopicEvaluationLaunchModeV1(management);
  const storageKey=launchMode?`${storagePrefix}:${launchMode}`:null;
  useEffect(()=>{submitLockRef.current=false;
    if(!storageKey||!launchMode){setAttemptRecorded(false);setRunStatus(null);setSessionChecked(true);return;}
    const stored=readStoredAttempt(window.sessionStorage.getItem(storageKey),launchMode);
    setAttemptRecorded(stored!==null);setRunStatus(stored?.status??null);submitLockRef.current=stored!==null;
    setSessionChecked(true);},[launchMode,storageKey]);
  const commandDisabled=!sessionChecked||launchMode===null||!ready||!acknowledged||attemptRecorded||submitting;
  function openCandidate(candidate:SignalTopicEvaluationCandidateV1,event:MouseEvent<HTMLButtonElement>){
    openerRef.current=event.currentTarget;setSelected(candidate);setTitle(candidate.title);setDescription(candidate.description);
    setInclusion(candidate.inclusion.join("\n"));setExclusion(candidate.exclusion.join("\n"));setDrawer("candidate");setError(null);}
  async function submitLaunch(){if(!card||!launchMode||!storageKey||commandDisabled||!acquireSignalTopicEvaluationSubmissionLockV1(submitLockRef))return;
    const idempotencyKey=launchMode==="successor"?createSignalTopicEvaluationSuccessorIdempotencyKeyV1():createSignalTopicEvaluationIdempotencyKeyV1();
    const command=launchMode==="successor"?buildSignalTopicEvaluationSuccessorRequestV1({acknowledged,card,
      successor:management!.successor,idempotencyKey}):buildSignalTopicEvaluationLaunchRequestV1({acknowledged,card,idempotencyKey});
    const launchEndpoint=launchMode==="successor"?`${endpoint}/successor`:endpoint;
    setSubmitting(true);setAttemptRecorded(true);setError(null);window.sessionStorage.setItem(storageKey,JSON.stringify({idempotencyKey,status:null}));
    try{const payload=await requestJson(launchEndpoint,{method:"POST",headers:command.headers,body:JSON.stringify(command.body)});
      const status=readSignalTopicEvaluationRunStatusV1(payload);setRunStatus(status);
      window.sessionStorage.setItem(storageKey,JSON.stringify({idempotencyKey,status}));setDrawer(null);setAcknowledged(false);await load();
    }catch(submitError){setError(submitError instanceof Error?submitError.message:t("errors.start"));}
    finally{setSubmitting(false);}}
  async function review(action:"save"|"reject"|"restore"|"undo"){
    if(!selected||submitting)return;setSubmitting(true);setError(null);
    const common={action,candidate_key:selected.candidateKey,expected_revision:selected.revision,state_token:selected.stateToken};
    const body=action==="save"?{...common,values:{title:title.trim(),description:description.trim(),
      inclusion:lines(inclusion),exclusion:lines(exclusion)}}:action==="undo"?{...common,target_revision:selected.undoTargetRevision}:common;
    try{await requestJson(`${endpoint}/candidates/${encodeURIComponent(selected.candidateKey)}/commands`,{
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":createSignalTopicEvaluationReviewIdempotencyKeyV1()},body:JSON.stringify(body)});
      setDrawer(null);setSelected(null);await load();
    }catch(reviewError){setError(reviewError instanceof Error?reviewError.message:t("errors.review"));}
    finally{setSubmitting(false);}}
  const actions=<><button className="admin-button" disabled={loading||submitting} onClick={()=>void load()} type="button">
    {loading?<CircleNotch aria-hidden className="icon--spin" size={14}/>:null}{t("actions.refresh")}</button>
    <button className="admin-button admin-button--primary" disabled={launchMode===null||attemptRecorded||loading}
      onClick={(event)=>{openerRef.current=event.currentTarget;setAcknowledged(false);setDrawer("launch");}} type="button">
      <Play aria-hidden size={15}/>{launchMode==="successor"?t("actions.openSuccessor"):t("actions.open")}</button></>;
  return<><AdminResourceSection actions={actions} className="topic-evaluation-manager" subtitle={t("subtitle")} title={t("title")}>
    {loading&&!management?<div aria-busy="true" aria-live="polite" className="semantic-context-pack__preflight-loading" role="status">
      <CircleNotch aria-hidden className="icon--spin" size={18}/><span>{t("loading")}</span></div>:null}
    {error&&!management?<AdminFeedbackState actions={<button className="admin-button" onClick={()=>void load()} type="button">{t("actions.refresh")}</button>}
      body={error} icon={<Warning size={20}/>} title={t("errors.title")} tone="danger"/>:null}
    {management?<><AdminSummaryStrip density="compact" items={[
      {label:t("summary.proposals"),value:card!.proposalCount===null?"—":formatAdminNumber(card!.proposalCount,locale),hint:t("summary.proposalsHint")},
      {label:t("summary.model"),value:card!.model??"—",hint:card!.pricingVersion??t("summary.unconfigured")},
      {label:t("summary.candidates"),value:formatAdminNumber(management.results.total,locale),hint:t("summary.candidateHint")},
      {label:t("summary.pending"),value:formatAdminNumber(management.results.pending,locale),hint:t("summary.noAdoption")} ]}/>
      <div className="semantic-context-pack__notice" data-tone={ready?undefined:"warning"}><ChartLineUp aria-hidden size={18}/><div>
        <strong>{ready?t("boundary.title"):t("boundary.blockedTitle")}</strong><p>{ready?t("boundary.body",{minimum:card!.successMinimumCandidates}):
          card!.preflightErrorCode==="topic_evaluation_launch_authority_unavailable"?t("boundary.authorityUnavailableBody"):t("boundary.blockedBody")}</p></div>
        <AdminStatus state={ready?"good":"warning"}>{ready?t("states.ready"):t("states.blocked")}</AdminStatus></div>
      {management.run?<RunNotice management={management} t={t} locale={locale}/>:<Empty title={t("results.noRunTitle")} body={t("results.noRunBody")}/>}
      {management.results.runKey?<div className="topic-evaluation-manager__results" aria-label={t("results.title")}>
        <div className="topic-evaluation-manager__results-heading"><div><h3>{t("results.title")}</h3><p>{t("results.body")}</p></div>
          <AdminStatus state={management.results.total>=card!.successMinimumCandidates?"good":"warning"}>{management.results.total>=card!.successMinimumCandidates?t("results.rubricMet"):t("results.rubricMissed")}</AdminStatus></div>
        {management.results.items.length?<div className="topic-evaluation-manager__list">{management.results.items.map((candidate)=><button
          className="topic-evaluation-manager__candidate" key={candidate.candidateKey} onClick={(event)=>openCandidate(candidate,event)} type="button">
          <span><strong>{candidate.title}</strong><small>{candidate.description}</small></span>
          <span className="topic-evaluation-manager__candidate-meta"><AdminStatus state={candidate.reviewState==="pending"?"warning":"not_available"}>{t(`candidate.states.${candidate.reviewState}`)}</AdminStatus>
            <small>{t("candidate.evidence",{count:candidate.evidence.count})}</small></span></button>)}</div>
          :<Empty title={t("results.emptyTitle")} body={t("results.emptyBody")}/>}
        {management.results.nextCursor?<button className="admin-button" disabled={loadingMore} onClick={()=>void load(management.results.nextCursor)} type="button">
          {loadingMore?<CircleNotch aria-hidden className="icon--spin" size={14}/>:null}{t("actions.more")}</button>:null}
      </div>:null}
      {runStatus&&!management.run?<p role="status">{t(`run.states.${runStatus}`)}</p>:null}
      {attemptRecorded&&!runStatus?<div className="semantic-context-pack__notice" data-tone="warning" role="alert"><Warning aria-hidden size={18}/><div>
        <strong>{t("attempt.title")}</strong><p>{t("attempt.body")}</p></div></div>:null}
      {error?<p className="workspace-form__error" role="alert">{error}</p>:null}</>:null}
  </AdminResourceSection>
  {drawer==="launch"&&card&&launchMode?<WorkspaceDrawer ariaLabel={launchMode==="successor"?t("drawer.successorTitle"):t("drawer.title")} closeLabel={t("actions.close")} eyebrow={t("eyebrow")}
    onClose={()=>{if(!submitting){setDrawer(null);setAcknowledged(false);}}} returnFocusRef={openerRef} title={launchMode==="successor"?t("drawer.successorTitle"):t("drawer.title")}>
    <div className="admin-drawer-form"><p className="admin-drawer-form__intro">{launchMode==="successor"?t("drawer.successorBody"):t("drawer.body")}</p><div className="semantic-context-pack__preflight">
      <FlightRow label={t("summary.proposals")} value={card.proposalCount===null?"—":formatAdminNumber(card.proposalCount,locale)}/><FlightRow label={t("summary.model")} value={card.model??"—"}/>
      <FlightRow label={t("summary.estimate")} value={microUsd(card.estimatedMaxCostMicroUsd,locale)}/><FlightRow label={t("summary.hardCap")} value={microUsd(card.hardCapMicroUsd,locale)}/>
      <FlightRow label={t("drawer.calls")} value={String(card.oneCallMax)}/><FlightRow label={t("drawer.output")} value={t("drawer.pendingCandidates")}/></div>
      <p className="admin-drawer-form__hint">{launchMode==="successor"?t("drawer.successorBoundary"):t("drawer.boundary")}</p><label className="semantic-context-pack__confirmation"><input checked={acknowledged}
        disabled={attemptRecorded||submitting} onChange={(event)=>setAcknowledged(event.target.checked)} type="checkbox"/><span>{launchMode==="successor"?t("drawer.successorAcknowledgement",{
          estimate:microUsd(card.estimatedMaxCostMicroUsd,locale),hardCap:microUsd(card.hardCapMicroUsd,locale)}):t("drawer.acknowledgement",{
          estimate:microUsd(card.estimatedMaxCostMicroUsd,locale),hardCap:microUsd(card.hardCapMicroUsd,locale)})}</span></label>
      <button className="admin-button admin-button--primary" disabled={commandDisabled} onClick={()=>void submitLaunch()} type="button">
        {submitting?<CircleNotch aria-hidden className="icon--spin" size={15}/>:<Play aria-hidden size={15}/>} {submitting?t("actions.starting"):launchMode==="successor"?t("actions.startSuccessor"):t("actions.start")}</button></div>
  </WorkspaceDrawer>:null}
  {drawer==="candidate"&&selected?<WorkspaceDrawer ariaLabel={t("candidate.drawerTitle")} closeLabel={t("actions.close")} eyebrow={t("candidate.eyebrow")}
    onClose={()=>{if(!submitting){setDrawer(null);setSelected(null);}}} returnFocusRef={openerRef} title={selected.title}>
    <div className="admin-drawer-form"><p className="admin-drawer-form__intro">{t("candidate.boundary")}</p>
      <label className="workspace-field"><span>{t("candidate.title")}</span><input className="workspace-control" disabled={selected.reviewState==="rejected"||submitting} maxLength={160} onChange={(event)=>setTitle(event.target.value)} value={title}/></label>
      <label className="workspace-field"><span>{t("candidate.description")}</span><textarea className="workspace-control" disabled={selected.reviewState==="rejected"||submitting} maxLength={2000} onChange={(event)=>setDescription(event.target.value)} rows={5} value={description}/></label>
      <label className="workspace-field"><span>{t("candidate.inclusion")}</span><textarea className="workspace-control" disabled={selected.reviewState==="rejected"||submitting} onChange={(event)=>setInclusion(event.target.value)} rows={4} value={inclusion}/></label>
      <label className="workspace-field"><span>{t("candidate.exclusion")}</span><textarea className="workspace-control" disabled={selected.reviewState==="rejected"||submitting} onChange={(event)=>setExclusion(event.target.value)} rows={3} value={exclusion}/></label>
      <div className="topic-evaluation-manager__evidence"><strong>{t("candidate.evidenceTitle")}</strong><p>{t("candidate.evidenceProjection",{count:selected.evidence.count,
        supports:selected.evidence.supports,limits:selected.evidence.limits,contradicts:selected.evidence.contradicts})}</p><p>{t("candidate.sources",{count:selected.sourceProposalCount})}</p></div>
      {error?<p className="workspace-form__error" role="alert">{error}</p>:null}<div className="admin-drawer-form__actions">
        {selected.reviewState==="pending"?<><button className="admin-button admin-button--primary" disabled={submitting||!title.trim()||!description.trim()||!lines(inclusion).length}
          onClick={()=>void review("save")} type="button"><PencilSimple aria-hidden size={15}/>{t("actions.save")}</button>
          <button className="admin-button" disabled={submitting} onClick={()=>void review("reject")} type="button"><XCircle aria-hidden size={15}/>{t("actions.reject")}</button></>:<button
          className="admin-button admin-button--primary" disabled={submitting} onClick={()=>void review("restore")} type="button"><ArrowCounterClockwise aria-hidden size={15}/>{t("actions.restore")}</button>}
        {selected.undoTargetRevision?<button className="admin-button" disabled={submitting} onClick={()=>void review("undo")} type="button"><ArrowCounterClockwise aria-hidden size={15}/>{t("actions.undo")}</button>:null}
      </div></div>
  </WorkspaceDrawer>:null}</>;
}

function RunNotice({management,t,locale}:{management:SignalTopicEvaluationManagementV1;t:(key:string,values?:Record<string,string|number|Date>)=>string;locale:string}){
  const run=management.run!;const ambiguous=run.status==="outcome_unknown";
  const terminal=run.status==="completed"||run.status==="failed"||ambiguous;
  const terminalBody=run.providerOutcomeClass==="definitely_not_sent"?t("run.definitelyNotSentBody"):
    run.providerOutcomeClass==="known_response_invalid"?t("run.knownResponseInvalidBody"):
    run.providerOutcomeClass==="ambiguous_after_send"?t("run.outcomeUnknownBody"):
    run.status==="failed"?t("run.failedBody"):t("run.progressBody");
  return<div className="semantic-context-pack__run" role={ambiguous?"alert":"status"}><div className="semantic-context-pack__run-copy"><span className="semantic-context-pack__run-icon">
    {!terminal?<CircleNotch aria-hidden className="icon--spin" size={16}/>:run.status==="failed"||ambiguous?<Warning aria-hidden size={16}/>:<ChartLineUp aria-hidden size={16}/>}</span>
    <div><strong>{t(`run.states.${run.status}`)}</strong><p>{run.status==="completed"?t("run.completedBody",{count:run.candidateCount??0,cost:microUsd(run.settledMicroUsd,locale)}):
      terminalBody}</p></div></div><AdminStatus state={run.status==="completed"?"good":run.status==="failed"?"danger":"warning"}>{t(`run.states.${run.status}`)}</AdminStatus></div>;
}
function Empty({title,body}:{title:string;body:string}){return<div className="topic-evaluation-manager__empty"><strong>{title}</strong><p>{body}</p></div>;}
function FlightRow({label,value}:{label:string;value:string}){return<div><span>{label}</span><strong>{value}</strong></div>;}
function lines(value:string){return value.split("\n").map((item)=>item.trim()).filter(Boolean).slice(0,12);}
