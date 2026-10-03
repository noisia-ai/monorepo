"use client";

import React,{ useEffect,useRef,useState } from "react";
import { appendSignalTopicEvaluationV2CandidateEvidencePage,requestSignalTopicEvaluationV2CandidateEvidence,
  type SignalTopicEvaluationV2CandidateEvidencePage } from "@/lib/data-os/signal-topic-evaluation-v2-management";

type Translate=(key:string,values?:Record<string,string|number>)=>string;

export function TopicCandidateEvidenceView({collection,page,loading,error,t,onLoad}:{
  collection:"candidate"|"refinement";page:SignalTopicEvaluationV2CandidateEvidencePage|null;
  loading:boolean;error:boolean;t:Translate;onLoad:(cursor?:string|null)=>void}){
  return<section className="topic-evaluation-manager__evidence" aria-label={t(`citations.${collection}.title`)}>
    <h3>{t(`citations.${collection}.title`)}</h3><p>{t(`citations.${collection}.body`)}</p>
    {!page?<button className="admin-button" disabled={loading} onClick={()=>onLoad()} type="button">
      {t("citations.load")}</button>:null}
    {loading?<p aria-live="polite" aria-busy="true" role="status">{t("citations.loading")}</p>:null}
    {error?<p className="workspace-form__error" role="alert">{t("citations.error")}</p>:null}
    {page?.status==="none"?<p>{t("citations.none")}</p>:null}
    {page?.status==="unavailable"?<p>{t("citations.unavailable")}</p>:null}
    {page?.status==="available"?<>
      <p>{t("citations.count",{shown:page.items.length,total:page.total})}</p>
      {page.items.length?<ol>{page.items.map((item,index)=><li key={item.evidence_ref}>
        <strong>{t("citations.reference",{index:index+1})}</strong>
        {item.status==="available"?<><blockquote>{item.excerpt}</blockquote>
          <p className="admin-drawer-form__hint">{t("citations.metadata",{month:item.month,
            language:item.language??t("citations.unspecified"),market:item.market??t("citations.unspecified"),
            scope:item.scope??t("citations.unspecified"),stratum:t(`citations.strata.${item.stratum}`)})}</p></>
          :<p>{t(`citations.reasons.${item.reason}`)}</p>}
      </li>)}</ol>:<p>{t("citations.empty")}</p>}
      {page.next_cursor?<button className="admin-button" disabled={loading}
        onClick={()=>onLoad(page.next_cursor)} type="button">{t("citations.more")}</button>:null}
    </>:null}
    {page?<button className="admin-button" disabled={loading} onClick={()=>onLoad()} type="button">
      {t("citations.refresh")}</button>:null}
  </section>;
}

/** Mounted with a workspace/run/candidate/collection key; never fetches before operator expansion. */
export function TopicCandidateEvidence({endpoint,runKey,candidateKey,collection,t}:{endpoint:string;runKey:string;
  candidateKey:string;collection:"candidate"|"refinement";t:Translate}){
  const[page,setPage]=useState<SignalTopicEvaluationV2CandidateEvidencePage|null>(null);
  const[loading,setLoading]=useState(false),[error,setError]=useState(false);
  const requestRef=useRef<AbortController|null>(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  async function load(cursor?:string|null){
    if(requestRef.current)return;
    const controller=new AbortController();requestRef.current=controller;setLoading(true);setError(false);
    if(!cursor)setPage(null);
    try{const next=await requestSignalTopicEvaluationV2CandidateEvidence({endpoint,runKey,candidateKey,collection,
      cursor,signal:controller.signal});
      if(controller.signal.aborted)return;
      setPage((current)=>{
        if(!cursor||!current||next.status!=="available")return next;
        return appendSignalTopicEvaluationV2CandidateEvidencePage(current,next);
      });
    }catch{if(!controller.signal.aborted){setPage(null);setError(true);}}
    finally{if(!controller.signal.aborted){requestRef.current=null;setLoading(false);}}
  }
  return<TopicCandidateEvidenceView collection={collection} page={page} loading={loading} error={error}
    t={t} onLoad={(cursor)=>void load(cursor)}/>;
}
