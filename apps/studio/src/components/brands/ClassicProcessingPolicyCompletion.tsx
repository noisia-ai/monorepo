'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
const statuses=['provisioned','existing_policy','configuration_required','active_work'] as const;
type Status=typeof statuses[number];
/** Explicit setup only. No run, provider call, feature opt-in, or grant changes. */
export function ClassicProcessingPolicyCompletion({workspaceId}:{workspaceId:string}){
 const t=useTranslations('ClassicProcessingPolicy');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState<Status|'unavailable'|null>(null);
 const complete=async()=>{
  if(busy)return;setBusy(true);setStatus(null);
  try{
   const response=await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/processing-policy/completion`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const body=await response.json();
   if(!response.ok||body.contract_version!=='classic-policy-completion-v1'||!statuses.includes(body.status))throw Error('unavailable');
   setStatus(body.status);
  }catch{setStatus('unavailable');}finally{setBusy(false);}
 };
 return <section className="admin-section"><div className="admin-section__head"><div><h3>{t('title')}</h3><p>{t('body')}</p></div></div>
  <div className="admin-section__body"><button className="admin-button" type="button" disabled={busy} onClick={()=>void complete()}>{t(busy?'working':'complete')}</button>
   {status?<p role={status==='unavailable'?'alert':'status'}>{t(status)}</p>:null}</div></section>;
}
