'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {mfpMoney} from '@/lib/data-os/mfp-ui';
import {parseMembershipConfiguration,membershipRouteNeedsConfirmation,type MembershipRoute,type MembershipConfiguration} from '@/lib/data-os/mfp-membership-configuration-ui';
export function MfpMembershipConfigurationView({value,route,busy,confirmed,error,onRoute,onConfirm,onSave,onRefresh}:{value:MembershipConfiguration|null;route:MembershipRoute;busy:boolean;confirmed:boolean;error:string|null;
 onRoute:(route:MembershipRoute)=>void;onConfirm:(confirmed:boolean)=>void;onSave:()=>void;onRefresh:()=>void}){
 const t=useTranslations('Mfp.configuration'),locale=useLocale();
 const confirmation=value&&membershipRouteNeedsConfirmation(value,route);
 return <section className="admin-section"><div className="admin-section__head"><div><h3>{t('title')}</h3><p>{t('body')}</p></div>
  <button className="admin-button" type="button" disabled={busy} onClick={onRefresh}>{t('refresh')}</button></div>
  <div className="admin-section__body admin-drawer-form">{value?<>
   <label>{t('route')}<select value={route} disabled={busy||!value.can_configure} onChange={e=>onRoute(e.target.value as MembershipRoute)}>
    <option value="standard">{t('standard')}</option><option value="hybrid_h1">{t('hybrid_h1')}</option></select></label>
   <p>{t('exposure',{count:value.unknown_calls,cost:mfpMoney(value.reserved_exposure_micro_usd,locale)})}</p>
   {confirmation?<label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>onConfirm(e.target.checked)}/>{t('confirm')}</label>:null}
   {!value.can_configure?<p role="status">{t('readOnly')}</p>:null}
   <button className="admin-button" type="button" disabled={busy||!value.can_configure||route===value.route||Boolean(confirmation&&!confirmed)} onClick={onSave}>{t('save')}</button>
  </>:<p role="status">{t(busy?'loading':'unavailable')}</p>}
  {error?<p role="alert">{t(error==='hybrid_route_changed'?'changed':error==='hybrid_unknown_confirmation_required'?'confirmationRequired':'unavailable')}</p>:null}</div>
 </section>;
}
export function MfpMembershipConfiguration({workspaceId}:{workspaceId:string}){
 const endpoint=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/memberships/configuration`;
 const [value,setValue]=useState<MembershipConfiguration|null>(null),[route,setRoute]=useState<MembershipRoute>('standard');
 const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState<string|null>(null);
 const controller=useRef<AbortController|null>(null);
 const read=useCallback(async()=>{
  controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);
  try{const response=await fetch(endpoint,{cache:'no-store',signal:request.signal});const next=parseMembershipConfiguration(await response.json());
   if(!response.ok||!next)throw Error('unavailable');if(request.signal.aborted)return;
   setValue(next);setRoute(next.route);setConfirmed(false);setError(null);
  }catch{if(!request.signal.aborted){setValue(null);setError('unavailable');}}
  finally{if(!request.signal.aborted)setBusy(false);}
 },[endpoint]);
 useEffect(()=>{setValue(null);void read();return()=>controller.current?.abort();},[read]);
 const save=async()=>{
  if(!value||busy||!value.can_configure||membershipRouteNeedsConfirmation(value,route)&&!confirmed)return;
  const request=new AbortController();controller.current=request;setBusy(true);setError(null);
  try{const response=await fetch(endpoint,{method:'PATCH',signal:request.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({route,expected_route_digest:value.route_digest,
   ...(membershipRouteNeedsConfirmation(value,route)?{confirm_unresolved_jev:confirmed}:{})})});
   const body=await response.json();if(request.signal.aborted)return;
   if(!response.ok){if([401,403,404].includes(response.status))setValue(null);throw Error(body?.error??'unavailable');}
   await read();
  }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'unavailable');}
  finally{if(!request.signal.aborted)setBusy(false);}
 };
 return <MfpMembershipConfigurationView value={value} route={route} busy={busy} confirmed={confirmed} error={error}
  onRoute={next=>{setRoute(next);setConfirmed(false);}} onConfirm={setConfirmed} onSave={()=>void save()} onRefresh={()=>void read()}/>;
}
