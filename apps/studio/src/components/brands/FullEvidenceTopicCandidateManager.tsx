"use client";

import { ArrowCounterClockwise,CircleNotch,PencilSimple,Warning,XCircle } from "@phosphor-icons/react";
import { useLocale,useTranslations } from "next-intl";
import { useCallback,useEffect,useRef,useState,type MouseEvent } from "react";

import { AdminFeedbackState,AdminResourceSection,AdminStatus,AdminSummaryStrip,
  formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import { TopicCandidateRefinementSuggestion } from "./TopicCandidateRefinementSuggestion";
import { TopicCandidateEvidence } from "./TopicCandidateEvidence";
import { copySignalTopicEvaluationV2RefinementWording,createSignalTopicEvaluationV2ReviewIdempotencyKey,
  parseSignalTopicEvaluationV2CandidateDetail,parseSignalTopicEvaluationV2CandidatePage,
  type SignalTopicEvaluationV2Candidate,type SignalTopicEvaluationV2CandidateDetail,
  type SignalTopicEvaluationV2CandidatePage } from "@/lib/data-os/signal-topic-evaluation-v2-management";

async function requestJson(url:string,init?:RequestInit){
  const response=await fetch(url,{cache:"no-store",...init});
  const payload=await response.json().catch(()=>null) as unknown;
  if(!response.ok){const safe=payload&&typeof payload==="object"&&"message" in payload
    &&typeof payload.message==="string"?payload.message:"request_failed";throw new Error(safe);}
  return payload;
}
function lines(value:string){return value.split("\n").map((item)=>item.trim()).filter(Boolean).slice(0,16);}

export function FullEvidenceTopicCandidateManager({workspaceId,onImportedResult}:{workspaceId:string;
  onImportedResult?:(imported:boolean)=>void}){
  const t=useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates"),locale=useLocale();
  const endpoint=`/api/data-os/signal/${workspaceId}/topic-evaluation/full-evidence/candidates`;
  const[page,setPage]=useState<SignalTopicEvaluationV2CandidatePage|null>(null);
  const[detail,setDetail]=useState<SignalTopicEvaluationV2CandidateDetail|null>(null);
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const[title,setTitle]=useState(""),[description,setDescription]=useState("");
  const[inclusion,setInclusion]=useState(""),[exclusion,setExclusion]=useState("");
  const[proposalDismissed,setProposalDismissed]=useState(false),[proposalCopied,setProposalCopied]=useState(false);
  const openerRef=useRef<HTMLButtonElement|null>(null);

  const load=useCallback(async(cursor?:string|null)=>{setLoading(true);setError(null);
    try{const next=parseSignalTopicEvaluationV2CandidatePage(await requestJson(
      `${endpoint}?limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`));
      setPage((current)=>cursor&&current?{...next,items:[...current.items,...next.items]}:next);
    }catch(loadError){setError(loadError instanceof Error?loadError.message:t("errors.load"));}
    finally{setLoading(false);}},[endpoint,t]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(page)onImportedResult?.(page.result_origin?.kind==="imported_result");},[page,onImportedResult]);

  async function open(candidate:SignalTopicEvaluationV2Candidate,event:MouseEvent<HTMLButtonElement>){
    if(!page?.run_key)return;openerRef.current=event.currentTarget;setBusy(true);setError(null);
    try{const loaded=parseSignalTopicEvaluationV2CandidateDetail(await requestJson(
      `${endpoint}/${encodeURIComponent(candidate.candidate_key)}?run_key=${encodeURIComponent(page.run_key)}`));
      setDetail(loaded);setTitle(loaded.candidate.title);setDescription(loaded.candidate.description);
      setInclusion(loaded.candidate.inclusion.join("\n"));setExclusion(loaded.candidate.exclusion.join("\n"));
      setProposalDismissed(false);setProposalCopied(false);
    }catch(loadError){setError(loadError instanceof Error?loadError.message:t("errors.load"));}
    finally{setBusy(false);}
  }
  function useProposal(){
    if(!detail||busy||detail.refinement.status!=="available")return;
    const next=copySignalTopicEvaluationV2RefinementWording({candidate:detail.candidate,
      proposal:detail.refinement.proposal,fields:{title,description,inclusion,exclusion}});
    if(!next)return;setTitle(next.title);setDescription(next.description);setProposalCopied(true);
  }
  async function command(action:"save"|"reject"|"restore"|"undo"){
    if(!detail||busy)return;setBusy(true);setError(null);const candidate=detail.candidate;
    const common={action,run_key:detail.run_key,candidate_key:candidate.candidate_key,
      expected_revision:candidate.revision,state_token:candidate.state_token};
    const body=action==="save"?{...common,values:{title:title.trim(),description:description.trim(),
      inclusion:lines(inclusion),exclusion:lines(exclusion)}}:action==="undo"
      ?{...common,target_revision:candidate.undo_target_revision}:common;
    try{await requestJson(`${endpoint}/${encodeURIComponent(candidate.candidate_key)}/commands`,{
      method:"POST",headers:{"Content-Type":"application/json",
        "Idempotency-Key":createSignalTopicEvaluationV2ReviewIdempotencyKey()},body:JSON.stringify(body)});
      setDetail(null);await load();
    }catch(commandError){setError(commandError instanceof Error?commandError.message:t("errors.command"));}
    finally{setBusy(false);}
  }
  const candidate=detail?.candidate;
  return<><AdminResourceSection actions={<button className="admin-button" disabled={loading||busy}
      onClick={()=>void load()} type="button">{loading?<CircleNotch aria-hidden className="icon--spin" size={14}/>:null}
      {t("actions.refresh")}</button>} className="topic-evaluation-manager" subtitle={t("subtitle")} title={t("title")}>
    {loading&&!page?<div aria-busy="true" aria-live="polite" className="semantic-context-pack__preflight-loading" role="status">
      <CircleNotch aria-hidden className="icon--spin" size={18}/><span>{t("loading")}</span></div>:null}
    {error&&!page?<AdminFeedbackState body={error} icon={<Warning size={20}/>} title={t("errors.title")} tone="danger"/>:null}
    {page?<><AdminSummaryStrip density="compact" items={[
      {label:t("summary.total"),value:formatAdminNumber(page.total,locale),hint:t("summary.totalHint")},
      {label:t("summary.pending"),value:formatAdminNumber(page.pending,locale),hint:t("summary.pendingHint")},
      {label:t("summary.rejected"),value:formatAdminNumber(page.rejected,locale),hint:t("summary.rejectedHint")} ]}/>
      <p className="admin-drawer-form__hint">{t("boundary")}</p>
      {page.result_origin?<p className="admin-drawer-form__hint">{t("importedResult")}</p>:null}
      {page.items.length?<div className="topic-evaluation-manager__list">{page.items.map((item)=><button
        className="topic-evaluation-manager__candidate" key={`${page.run_key}:${item.candidate_key}`}
        onClick={(event)=>void open(item,event)} type="button"><span><strong>{item.title}</strong>
        <small>{item.description}</small></span><span className="topic-evaluation-manager__candidate-meta">
        <AdminStatus state={item.review_state==="pending"?"warning":"not_available"}>{t(`states.${item.review_state}`)}</AdminStatus>
        <small>{t("evidence",{count:item.evidence_count})}</small></span></button>)}</div>
        :<div className="topic-evaluation-manager__empty"><strong>{t("empty.title")}</strong><p>{t("empty.body")}</p></div>}
      {page.next_cursor?<button className="admin-button" disabled={loading} onClick={()=>void load(page.next_cursor)} type="button">
        {t("actions.more")}</button>:null}{error?<p className="workspace-form__error" role="alert">{error}</p>:null}</>:null}
  </AdminResourceSection>
  {candidate&&detail?<WorkspaceDrawer ariaLabel={t("drawer.title")} closeLabel={t("actions.close")}
    eyebrow={t("drawer.eyebrow")} onClose={()=>{if(!busy)setDetail(null);}} returnFocusRef={openerRef} title={candidate.title}>
    <div className="admin-drawer-form topic-evaluation-manager__editor"><p className="admin-drawer-form__intro">{t("drawer.boundary")}</p>
      {detail.result_origin?<p className="admin-drawer-form__hint">{t("importedResult")}</p>:null}
      <TopicCandidateRefinementSuggestion refinement={detail.refinement} dismissed={proposalDismissed}
        copied={proposalCopied} busy={busy} editable={candidate.review_state==="pending"} t={t}
        onUse={useProposal} onDismiss={()=>setProposalDismissed(true)} onShow={()=>setProposalDismissed(false)}/>
      <label className="workspace-field"><span>{t("fields.title")}</span><input className="workspace-control"
        disabled={candidate.review_state==="rejected"||busy} maxLength={160}
        onChange={(event)=>setTitle(event.target.value)} value={title}/></label>
      <label className="workspace-field"><span>{t("fields.description")}</span><textarea className="workspace-control"
        disabled={candidate.review_state==="rejected"||busy} maxLength={1500}
        onChange={(event)=>setDescription(event.target.value)} rows={5} value={description}/></label>
      <label className="workspace-field"><span>{t("fields.inclusion")}</span><textarea className="workspace-control"
        disabled={candidate.review_state==="rejected"||busy} onChange={(event)=>setInclusion(event.target.value)}
        rows={4} value={inclusion}/></label>
      <label className="workspace-field"><span>{t("fields.exclusion")}</span><textarea className="workspace-control"
        disabled={candidate.review_state==="rejected"||busy} onChange={(event)=>setExclusion(event.target.value)}
        rows={3} value={exclusion}/></label>
      <div className="topic-evaluation-manager__evidence"><strong>{t("drawer.evidenceTitle")}</strong>
        <p>{t("drawer.evidenceBody",{count:candidate.evidence.length,clusters:candidate.source_cluster_keys.length})}</p>
        <p>{t("drawer.originalDigest",{digest:candidate.base_model_payload_digest})}</p></div>
      <section className="topic-evaluation-manager__evidence"><h3>{t("citations.explanation")}</h3>
        <p>{candidate.base_model_payload.explanation}</p></section>
      <TopicCandidateEvidence key={`${workspaceId}:${detail.run_key}:${candidate.candidate_key}:candidate`}
        endpoint={endpoint} runKey={detail.run_key} candidateKey={candidate.candidate_key} collection="candidate" t={t}/>
      {detail.refinement.status==="available"?<TopicCandidateEvidence
        key={`${workspaceId}:${detail.run_key}:${candidate.candidate_key}:refinement:${detail.refinement.proposal.proposal_digest}`}
        endpoint={endpoint} runKey={detail.run_key} candidateKey={candidate.candidate_key} collection="refinement" t={t}/>:null}
      {error?<p className="workspace-form__error" role="alert">{error}</p>:null}
      <div className="admin-drawer-form__actions">{candidate.review_state==="pending"?<>
        <button className="admin-button admin-button--primary" disabled={busy||!title.trim()||!description.trim()
          ||!lines(inclusion).length} onClick={()=>void command("save")} type="button"><PencilSimple aria-hidden size={15}/>{t("actions.save")}</button>
        <button className="admin-button" disabled={busy} onClick={()=>void command("reject")} type="button"><XCircle aria-hidden size={15}/>{t("actions.reject")}</button></>
        :<button className="admin-button admin-button--primary" disabled={busy} onClick={()=>void command("restore")} type="button">
          <ArrowCounterClockwise aria-hidden size={15}/>{t("actions.restore")}</button>}
        {candidate.undo_target_revision?<button className="admin-button" disabled={busy} onClick={()=>void command("undo")} type="button">
          <ArrowCounterClockwise aria-hidden size={15}/>{t("actions.undo")}</button>:null}</div>
    </div>
  </WorkspaceDrawer>:null}</>;
}
