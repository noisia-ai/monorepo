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
  const [scope,setScope]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const intent=useRef<{key:string;body:unknown}|null>(null);
  const latest=resource.data?.revisions[0];
  const adopt=async(conceptKey?:string)=>{
    if(busy)return;
    if(conceptKey&&latest&&!intent.current)intent.current={key:crypto.randomUUID(),body:{action:"adopt",input:{run_key:`workspace-discovery:${latest.revision_id}`,
      candidate_key:conceptKey,expected_revision_digest:latest.revision_digest,scope:scope[conceptKey]}}};
    if(!intent.current)return;setBusy(true);setError(null);
    try{const response=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":intent.current.key},body:JSON.stringify(intent.current.body)});
      const body=await response.json();if([401,403,404].includes(response.status))onAccessDenied?.();
      if(!response.ok){if(response.status<500)intent.current=null;throw Error(body.error??"request");}
      intent.current=null;setPending(false);await onAdopted();await resource.read();
    }catch(cause){setError(cause instanceof Error?cause.message:"request");setPending(intent.current!==null);}finally{setBusy(false);}
  };
  return <section className="admin-section" id="mfp-discovery"><div className="admin-section__head"><div><h3>{t("discovery.title")}</h3><p>{t("discovery.body")}</p></div>
    <button className="admin-button" type="button" disabled={resource.loading||busy} onClick={()=>void resource.read()}>{t("refresh")}</button></div>
    <div className="admin-section__body topics-manager__candidate-grid">{latest?.catalog?.map(concept=>{
      const adopted=sources.some(source=>source?.run_key===`workspace-discovery:${latest.revision_id}`&&source.candidate_key===concept.concept_key);
      return <article key={concept.concept_key}><h4>{concept.label}</h4><p>{concept.definition}</p>
        <label>{t("scope")}<select value={scope[concept.concept_key]??""} disabled={adopted||busy||pending||!canAdopt}
          onChange={event=>setScope(old=>({...old,[concept.concept_key]:event.target.value}))}><option value="" disabled>{t("chooseScope")}</option>
          {["primary_brand","competitor","category","all_conversations"].map(value=><option key={value} value={value}>{t(`scopes.${value}`)}</option>)}</select></label>
        <button className="admin-button" type="button" disabled={adopted||busy||pending||!canAdopt||!scope[concept.concept_key]||latest.source_valid===false}
          onClick={()=>void adopt(concept.concept_key)}>{t(adopted?"discovery.adopted":"discovery.adopt")}</button></article>;
    })}
    {!latest?.catalog?.length?<p>{t("discovery.empty")}</p>:null}</div>
    {resource.error||error?<p role="alert">{t(`errors.${mfpErrorKey(error??resource.error??"")}`)}</p>:null}
    {pending?<button className="admin-button" disabled={busy} type="button" onClick={()=>void adopt()}>{t("retrySame")}</button>:null}
  </section>;
}
