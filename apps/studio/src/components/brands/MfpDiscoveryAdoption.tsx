"use client";
import {useRef,useState} from "react";
import {useTranslations} from "next-intl";
import type {WorkspaceTopicConsolidationActivationStatusV1} from "@/lib/data-os/workspace-topic-consolidation-activation";
import {useMfpResource} from "./useMfpResource";
import {mfpErrorKey} from "@/lib/data-os/mfp-ui";
export function MfpDiscoveryAdoption({workspaceId,canAdopt,sources,onAdopted,onAccessDenied}:{workspaceId:string;canAdopt:boolean;
  sources:Array<{run_key:string;candidate_key:string}|null>;onAdopted:()=>Promise<unknown>;onAccessDenied?:()=>void}) {
  const t=useTranslations("Mfp"),base=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics`;
  const resource=useMfpResource<WorkspaceTopicConsolidationActivationStatusV1>(`${base}/consolidation/activation`,"signal-topic-consolidation-activation-status-v1",onAccessDenied);
  const incremental=useMfpResource<import("@noisia/db").SignalIncrementalDiscoveryCandidatesV1>(`${base}/incremental-candidates`,"signal-incremental-discovery-candidates-v1",onAccessDenied);
  const [scope,setScope]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const intent=useRef<{key:string;body:unknown}|null>(null);
  const latest=resource.data?.revisions[0];
  const candidates=[...(latest?.catalog??[]).map(c=>({...c,run_key:`workspace-discovery:${latest!.revision_id}`,candidate_digest:latest!.revision_digest,source_valid:latest!.source_valid!==false})),...(incremental.data?.candidates??[]).map(c=>({...c,concept_key:c.candidate_key,source_valid:true}))];
  const adopt=async(conceptKey?:string)=>{
    if(busy)return;
    const candidate=candidates.find(c=>`${c.run_key}:${c.concept_key}`===conceptKey);
    if(candidate&&!intent.current)intent.current={key:crypto.randomUUID(),body:{action:"adopt",input:{run_key:candidate.run_key,
      candidate_key:candidate.concept_key,expected_revision_digest:candidate.candidate_digest,scope:scope[conceptKey!]}}};
    if(!intent.current)return;setBusy(true);setError(null);
    try{const response=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":intent.current.key},body:JSON.stringify(intent.current.body)});
      if([401,403,404].includes(response.status))onAccessDenied?.();const body=await response.json().catch(()=>null);
      if(!response.ok){if(response.status<500)intent.current=null;throw Error(body?.error??"request");}
      intent.current=null;setPending(false);await onAdopted();await Promise.all([resource.read(),incremental.read()]);
    }catch(cause){setError(cause instanceof Error?cause.message:"request");setPending(intent.current!==null);}finally{setBusy(false);}
  };
  return <section className="admin-section" id="mfp-discovery"><div className="admin-section__head"><div><h3>{t("discovery.title")}</h3><p>{t("discovery.body")}</p></div>
    <button className="admin-button" type="button" disabled={resource.loading||busy} onClick={()=>void Promise.all([resource.read(),incremental.read()])}>{t("refresh")}</button></div>
    <div className="admin-section__body topics-manager__candidate-grid">{candidates.map(concept=>{
      const candidateId=`${concept.run_key}:${concept.concept_key}`;
      const adopted=sources.some(source=>source?.run_key===concept.run_key&&source.candidate_key===concept.concept_key);
      return <article key={candidateId}><h4>{concept.label}</h4><p>{concept.definition}</p>
        <label>{t("scope")}<select value={scope[candidateId]??""} disabled={adopted||busy||pending||!canAdopt}
          onChange={event=>setScope(old=>({...old,[candidateId]:event.target.value}))}><option value="" disabled>{t("chooseScope")}</option>
          {["primary_brand","competitor","category","all_conversations"].map(value=><option key={value} value={value}>{t(`scopes.${value}`)}</option>)}</select></label>
        <button className="admin-button" type="button" disabled={adopted||busy||pending||!canAdopt||!scope[candidateId]||!concept.source_valid}
          onClick={()=>void adopt(candidateId)}>{t(adopted?"discovery.adopted":"discovery.adopt")}</button></article>;
    })}
    {!candidates.length?<p>{t("discovery.empty")}</p>:null}</div>
    {resource.error||incremental.error||error?<p role="alert">{t(`errors.${mfpErrorKey(error??resource.error??incremental.error??"")}`)}</p>:null}
    {pending?<button className="admin-button" disabled={busy} type="button" onClick={()=>void adopt()}>{t("retrySame")}</button>:null}
  </section>;
}
