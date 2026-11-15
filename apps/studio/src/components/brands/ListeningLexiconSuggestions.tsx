'use client';
import {useEffect,useRef,useState} from 'react';
import {useTranslations} from 'next-intl';
type Evidence={contract_version:'signal-listening-lexicon-suggestions-v1';workspace_id:string;configuration_id:string;available:boolean;
  foreground_size:number;background_size:number;items:Array<{term:string;language:string|null;foreground_roots:number;background_roots:number;lift:number}>};
export function ListeningLexiconSuggestions({workspaceId,configurationId,disabled,onAccept}:{workspaceId:string;configurationId:string;
  disabled:boolean;onAccept:(term:string)=>void}){
  const t=useTranslations('Listening'),[evidence,setEvidence]=useState<Evidence|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(false);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>{generation.current++;request.current?.abort();setEvidence(null);setLoading(false);setError(false);
    return()=>{request.current?.abort();};},[workspaceId,configurationId]);
  async function load(){
    request.current?.abort();const controller=new AbortController();request.current=controller;const current=++generation.current;
    setLoading(true);setError(false);setEvidence(null);
    try{
      const url=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/listening/lexicon?configuration_id=${encodeURIComponent(configurationId)}`;
      const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();
      const result=await response.json()as Evidence;
      if(result.contract_version!=='signal-listening-lexicon-suggestions-v1'||result.workspace_id!==workspaceId||result.configuration_id!==configurationId)throw Error();
      if(!controller.signal.aborted&&generation.current===current)setEvidence(result);
    }catch{if(!controller.signal.aborted&&generation.current===current)setError(true);}
    finally{if(!controller.signal.aborted&&generation.current===current)setLoading(false);}
  }
  return <div className="admin-form">
    <p className="admin-drawer-form__hint">{t('lexiconEvidenceHelp')}</p>
    <button className="admin-button" type="button" disabled={disabled||loading} onClick={()=>void load()}>{t('lexiconEvidenceLoad')}</button>
    {loading?<p role="status">{t('loading')}</p>:null}
    {error?<p role="alert">{t('error')}</p>:null}
    {evidence&&!evidence.available?<p>{t('lexiconEvidenceUnavailable')}</p>:null}
    {evidence?.available?<>
      <p>{t('lexiconEvidencePopulation',{foreground:evidence.foreground_size,background:evidence.background_size})}</p>
      {!evidence.items.length?<p>{t('lexiconEvidenceEmpty')}</p>:null}
      {evidence.items.map(item=><div className="admin-form-actions" key={JSON.stringify([item.term,item.language])}>
        <span><strong>{item.term}</strong> · {t('lexiconEvidenceCounts',{roots:item.foreground_roots,lift:item.lift.toFixed(2)})}</span>
        <button className="admin-button" type="button" disabled={disabled} onClick={()=>onAccept(item.term)}>{t('lexiconEvidenceAdd')}</button>
      </div>)}
    </>:null}
  </div>;
}
