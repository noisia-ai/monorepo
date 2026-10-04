"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {executeMfpIntent,mfpIntent,type MfpIntent} from "@/lib/data-os/mfp-ui-state";
export function useMfpResource<T>(endpoint:string,contract:string,onDenied?:()=>void,poll=false) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
  const live=useRef(true),controller=useRef<AbortController|null>(null),denied=useRef(onDenied);denied.current=onDenied;
  const read=useCallback(async()=>{
    controller.current?.abort();const next=new AbortController();controller.current=next;setLoading(true);
    try {const response=await fetch(endpoint,{cache:"no-store",signal:next.signal});
      if(next.signal.aborted||!live.current)return;
      if([401,403,404].includes(response.status)){setData(null);denied.current?.();throw Error("forbidden");}
      const body=await response.json(); if(next.signal.aborted||!live.current)return;
      if(!response.ok||body.contract_version!==contract)throw Error(body.error??"request");setData(body);setError(null);
    }catch(cause){if(!next.signal.aborted&&live.current)setError(cause instanceof Error?cause.message:"request");}
    finally{if(!next.signal.aborted&&live.current)setLoading(false);}
  },[endpoint,contract]);
  useEffect(()=>{live.current=true;setData(null);void read();return()=>{live.current=false;controller.current?.abort();};},[read]);
  useEffect(()=>{const value=data as {latest?:{status:string}|null;run?:{status:string}}|null; if(!poll||loading||!["queued","running"].includes(value?.latest?.status??value?.run?.status??""))return;const timer=setTimeout(()=>void read(),5000);return()=>clearTimeout(timer);},[read,poll,data,loading]);
  return {data,error,loading,read};
}
/** Keep an unresolved command's body/key intact so retry cannot duplicate a paid run. */
export function useMfpMutation(endpoint:string,onDenied?:()=>void) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const intent=useRef<MfpIntent|null>(null),live=useRef(true),denied=useRef(onDenied);denied.current=onDenied;
  useEffect(()=>{live.current=true;intent.current=null;return()=>{live.current=false;};},[endpoint]);
  const send=async(body?:Record<string,unknown>,method="POST",onSuccess?:(result:Record<string,unknown>,submitted:Record<string,unknown>)=>void)=>{
    if(busy)return null;
    if(body){if(intent.current)return null;intent.current=mfpIntent(body,method,crypto.randomUUID());}
    if(!intent.current)return null;
    setBusy(true);setError(null);
    try{const {response,result,submitted}=await executeMfpIntent(endpoint,intent.current);if(!live.current)return null;
      if([401,403,404].includes(response.status)){intent.current=null;denied.current?.();}
      if(!response.ok){if(response.status<500)intent.current=null;throw Error(result?.error??"request");}
      if(!result)throw Error("request");intent.current=null;setPending(false);onSuccess?.(result,submitted);return result;
    }catch(cause){if(live.current){setError(cause instanceof Error?cause.message:"request");setPending(intent.current!==null);}return null;}
    finally{if(live.current)setBusy(false);}
  };
  return {busy,error,pending,send};
}
