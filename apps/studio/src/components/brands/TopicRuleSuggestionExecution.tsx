"use client";
import React,{useEffect,useRef,useState} from "react";
import {useTranslations} from "next-intl";
import {requestTopicRuleSuggestionJson,TopicRuleSuggestionRequestError,type TopicRuleSuggestionPage} from "@/lib/data-os/signal-topic-rule-suggestion-management";
import {topicRuleExecutionRequestSchema,topicRuleExecutionSchema,topicRuleExecutionPendingSchema,topicRuleExecutionReadSchema,
  assertTopicRuleExecutionBinding,topicRuleExecutionIsActive,type TopicRuleExecution,type TopicRuleExecutionPending,
  type TopicRuleExecutionRequest} from "@/lib/data-os/signal-topic-rule-execution-management";

export function TopicRuleSuggestionExecution({endpoint,workspaceId,request,capability,disabled,onReceipt,onBusyChange}:{
  endpoint:string;workspaceId:string;request:TopicRuleExecutionRequest;capability:TopicRuleSuggestionPage["generation"];
  disabled:boolean;onReceipt:(id:string)=>void;onBusyChange:(busy:boolean)=>void}){
  const t=useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicCandidates.ruleDraft.suggestion.execution");
  const scope=`${endpoint}:${request.run_key}:${request.candidate_key}`,storage=`noisia:topic-rule-execution:${scope}`;
  const[row,setRow]=useState<TopicRuleExecution|null>(null),[pending,setPending]=useState<TopicRuleExecutionPending|null>(null);
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[checked,setChecked]=useState(false);
  const current=useRef(scope),pendingRef=useRef<TopicRuleExecutionPending|null>(null),inFlight=useRef(false);
  const receiptCallback=useRef(onReceipt),notified=useRef<string|null>(null);
  receiptCallback.current=onReceipt;
  function accept(value:unknown,retained:TopicRuleExecutionPending|null){
    const next=topicRuleExecutionSchema.parse(value);
    if(next.workspace_id!==workspaceId||next.run_key!==request.run_key||next.candidate_key!==request.candidate_key)throw new Error("scope");
    if(retained)assertTopicRuleExecutionBinding(next,retained,workspaceId);
    setRow(next);
    if(!topicRuleExecutionIsActive(next)){
      sessionStorage.removeItem(storage);pendingRef.current=null;setPending(null);
      if(next.receipt_id&&notified.current!==next.receipt_id){notified.current=next.receipt_id;receiptCallback.current(next.receipt_id);}
    }
  }
  async function readStatus(){
    const started=scope,retained=pendingRef.current;
    try{const query=new URLSearchParams({run_key:request.run_key});if(retained)query.set("idempotency_key",retained.key);
      const result=topicRuleExecutionReadSchema.parse(await requestTopicRuleSuggestionJson(`${endpoint}?${query}`,{method:"GET"})).execution;
      if(current.current!==started)return;
      if(result!==null)accept(result,retained);
      setChecked(true);setError(null);
    }catch{if(current.current===started){setChecked(false);setError("readFailed");}}
  }
  useEffect(()=>{
    current.current=scope;setRow(null);setPending(null);pendingRef.current=null;notified.current=null;
    setChecked(false);setError(null);inFlight.current=false;setBusy(false);
    try{const raw=sessionStorage.getItem(storage);if(raw){const retained=topicRuleExecutionPendingSchema.parse(JSON.parse(raw));
      if(retained.scope!==scope)throw new Error("scope");pendingRef.current=retained;setPending(retained);}
      if(pendingRef.current)void readStatus();
    }catch{setError("storageFailed");}
    return()=>{current.current="";onBusyChange(false);};
    // Scope changes remount this controller; current request values never rewrite a retained request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);
  useEffect(()=>{
    if(capability.enabled&&!checked&&!pendingRef.current)void readStatus();
    // Read readiness transitions without resetting authored text or a retained request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope,capability.enabled]);
  useEffect(()=>{
    if(!topicRuleExecutionIsActive(row))return;
    const timer=setTimeout(()=>void readStatus(),3000);return()=>clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[row]);
  async function launch(recover=false){
    if(inFlight.current||disabled||!capability.enabled||error==="storageFailed")return;
    if(recover&&(!pendingRef.current||!checked||row?.status==="claimed"))return;
    if(!recover&&(!checked||pendingRef.current||row))return;
    const operation=topicRuleExecutionPendingSchema.parse(recover?pendingRef.current:{scope,
      key:`topic-rule:generate:${crypto.randomUUID()}`,body:topicRuleExecutionRequestSchema.parse(request)});
    try{sessionStorage.setItem(storage,JSON.stringify(operation));}catch{setError("storageFailed");return;}
    const started=scope;pendingRef.current=operation;setPending(operation);setChecked(false);setBusy(true);inFlight.current=true;
    onBusyChange(true);setError(null);
    try{const result=await requestTopicRuleSuggestionJson(endpoint,{method:"POST",
      headers:{"Content-Type":"application/json","Idempotency-Key":operation.key},body:JSON.stringify(operation.body)});
      if(current.current!==started)return;accept(result,operation);
    }catch(cause){if(current.current!==started)return;
      if(cause instanceof TopicRuleSuggestionRequestError&&!cause.ambiguous){
        sessionStorage.removeItem(storage);pendingRef.current=null;setPending(null);setError("rejected");
      }else setError("uncertain");
    }finally{if(current.current===started){inFlight.current=false;setBusy(false);onBusyChange(false);}}
  }
  return<div>
    <button type="button" className="admin-button" disabled={disabled||busy||!capability.enabled||!checked||!!pending||!!row||!!error}
      onClick={()=>void launch()}>{t("generate")}</button>
    <p className="admin-drawer-form__hint">{capability.enabled?t("budget",{amount:(capability.budget_micro_usd/1000000).toFixed(2)}):t("disabled")}</p>
    {row?<p role="status">{t(`status.${row.status}`)}{row.cost_micro_usd!==null?` ${t("cost",{amount:(row.cost_micro_usd/1000000).toFixed(6)})}`:""}</p>:null}
    {error?<p role="alert">{t(error)}</p>:null}
    {(pending||row||error)?<button type="button" className="admin-button" disabled={busy} onClick={()=>void readStatus()}>{t("refresh")}</button>:null}
    {pending&&row?.status!=="claimed"?<button type="button" className="admin-button" disabled={busy||disabled||!checked||!capability.enabled}
      onClick={()=>void launch(true)}>{t("recover")}</button>:null}
  </div>;
}
