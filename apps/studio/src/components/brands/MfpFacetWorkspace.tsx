"use client";
import {useEffect,useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import type {MentionFacetsV1} from "@noisia/query-engine";
import {ClientCorpusPreparationStep} from "./ClientCorpusPreparationStep";
import {useMfpMutation,useMfpResource} from "./useMfpResource";
import {mfpMoney,mfpErrorKey,mfpSafeUrl,type MfpFacetPage,type MfpFacetStatus} from "@/lib/data-os/mfp-ui";
const dimensions=["relevance","entities","salience","voice","act","spam_or_bot","language","asunto","status"];
const voices=["individual","media","brand_official","retail_promo","creator","institution","unknown"];
const acts=["experience","question_help","complaint","praise","opinion","news","promotion","other"];
const correctable=["entities","voice","act","spam_or_bot","language","asunto"];

export function MfpFacetWorkspace({workspaceId,dataHref,signalHref,onAccessDenied}:{workspaceId:string;dataHref:string;signalHref:string;onAccessDenied?:()=>void}) {
  const t=useTranslations("Mfp"),locale=useLocale();
  const base=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/facets`;
  const [rootId,setRootId]=useState<string|null>(null);
  const [dimension,setDimension]=useState("relevance"),[value,setValue]=useState(""),[cursor,setCursor]=useState<string|null>(null);
  const [selection,setSelection]=useState<string[]>([]),[editDimension,setEditDimension]=useState("voice"),[editValue,setEditValue]=useState("individual");
  const [entities,setEntities]=useState<Array<{entity_id:string;kind:"primary_brand"|"competitor"|"category";salience:"main"|"secondary"}>>([]);
  const [reason,setReason]=useState("off_topic"),[saved,setSaved]=useState(false);
  const filter=new URLSearchParams({view:"mentions",limit:"30"});if(value){filter.set("dimension",dimension);filter.set("value",value);}if(cursor)filter.set("cursor",cursor);if(rootId)filter.set("root_id",rootId);
  const status=useMfpResource<MfpFacetStatus>(`${base}?view=labeling`,"mention-facets-status-v1",onAccessDenied,true);
  const browser=useMfpResource<MfpFacetPage>(`${base}?${filter}`,"mention-facets-browser-v1",onAccessDenied);
  const mutation=useMfpMutation(base,onAccessDenied);
  useEffect(()=>{const navigate=()=>{const id=window.location.hash.replace(/^#mention-/,"");
    if(/^[a-f0-9-]{36}$/i.test(id)){setRootId(id);setValue("");setCursor(null);}};navigate();window.addEventListener("hashchange",navigate);
    return()=>window.removeEventListener("hashchange",navigate);},[]);
  useEffect(()=>{if(rootId&&browser.data?.items.some(item=>item.root_id===rootId))document.getElementById(`mention-${rootId}`)?.scrollIntoView({block:"center"});},[rootId,browser.data]);
  useEffect(()=>{setSelection([]);setSaved(false);},[dimension,value,cursor]);
  const refresh=async()=>{await Promise.all([status.read(),browser.read()]);};
  const start=async(full=false)=>{if(await mutation.send({full_recalculation:full})){await refresh();}};
  const chooseDimension=(next:string)=>{setEditDimension(next);setEditValue(next==="voice"?"individual":next==="act"?"experience":next==="spam_or_bot"?"false":next==="language"?"es":"");};
  const beginEdit=(item:MfpFacetPage["items"][number])=>{setSelection([item.root_id]);setEntities(item.facets?.entities.value??[]);setReason(item.facets?.unrelated_reason??"off_topic");
    if(editDimension!=="entities") {
      const dimension=item.facets?.[editDimension as "voice"|"act"|"spam_or_bot"|"language"|"asunto"];
      if(dimension&&!dimension.abstained)setEditValue(String(dimension.value??""));
    }
  };
  const save=async()=>{
    const resolved=editDimension==="entities"?entities:editDimension==="spam_or_bot"?editValue==="true":editValue.trim();
    const overrides=selection.flatMap(root_id=>[
      {root_id,dimension:editDimension,value:{value:resolved,confidence:"high",abstained:false}},
      ...(editDimension==="entities"&&!entities.length?[{root_id,dimension:"unrelated_reason",value:reason}]:[])]);
    if(await mutation.send({overrides},"PATCH")){setSelection([]);setSaved(true);await refresh();}
  };
  const label=(dim:string,v:string)=>dim==="entities"?browser.data?.entities.find(e=>e.entity_id===v)?.name??(v==="abstained"?t("values.abstained"):v)
    :["language","asunto"].includes(dim)&&v!=="abstained"?v:t(`values.${v}`);
  const count=status.data?.counts.reduce((sum,row)=>sum+row.count,0)??0;
  const done=status.data?.counts.filter(row=>!["pending","error"].includes(row.status)).reduce((sum,row)=>sum+row.count,0)??0;
  const active=["queued","running"].includes(status.data?.latest?.status??"");
  const canStart=Boolean(status.data?.enabled&&status.data.provider_available&&browser.data?.can_request_processing&&!active&&!status.error&&!mutation.busy&&!mutation.pending);
  return <section className="admin-section mfp-workspace" id="mention-facets" aria-busy={status.loading||browser.loading}>
    <div className="admin-section__head"><div><h3>{t("journey.title")}</h3><p>{t("journey.body")}</p></div>
      <button className="admin-button" type="button" onClick={()=>void refresh()} disabled={status.loading||browser.loading}>{t("refresh")}</button></div>
    <div className="admin-section__body">
      <ol className="client-processing-journey__steps mfp-journey">
        <li><span className="client-processing-journey__number">1</span><a href={dataHref}>{t("journey.import")}</a></li>
        <ClientCorpusPreparationStep workspaceId={workspaceId} index={1} onAccessDenied={onAccessDenied}/>
        <li><span className="client-processing-journey__number">3</span><strong>{t("journey.facets")}</strong><span>{t("progress",{done,total:count})}</span></li>
        <li><span className="client-processing-journey__number">4</span><a href="#mfp-discovery">{t("journey.discover")}</a></li>
        <li><span className="client-processing-journey__number">5</span><a href="#defined-interests">{t("journey.membership")}</a></li>
        <li><span className="client-processing-journey__number">6</span><a href={signalHref}>{t("journey.signal")}</a></li>
      </ol>
      {status.error||browser.error?<p role="alert" className="team-msg team-msg--error">{t(`errors.${mfpErrorKey(status.error??browser.error??"")}`)}</p>:null}
      {browser.data?.labeler_status!=="approved"?<p className="mfp-notice" role="status">{t("experimental")}</p>:null}
      {status.data?<>
        <progress aria-label={t("journey.facets")} max={Math.max(1,count)} value={done}/>
        <dl className="admin-summary-strip admin-summary-strip--compact">
          <div><dt>{t("estimated")}</dt><dd>{mfpMoney(status.data.estimated_micro_usd,locale)}</dd></div>
          <div><dt>{t("fullEstimate")}</dt><dd>{mfpMoney(status.data.estimated_full_micro_usd,locale)}</dd></div>
          <div><dt>{t("actual")}</dt><dd>{mfpMoney(status.data.latest?.settled_micro_usd,locale)}</dd></div>
          <div><dt>{t("reserved")}</dt><dd>{mfpMoney(status.data.latest?.reserved_micro_usd,locale)}</dd></div>
          <div><dt>{t("strictMaximum")}</dt><dd>{status.data.latest?.cap_micro_usd==null?t("noMaximum"):mfpMoney(status.data.latest.cap_micro_usd,locale)}</dd></div>
        </dl>
        {status.data.stale_count>0?<p role="status">{t("staleCount",{count:status.data.stale_count})}</p>:null}
        {status.data.latest?<p role="status">{t(`runStates.${status.data.latest.status}`)}</p>:null}
        {status.data.latest?.error_code?<p role="alert">{t(`errors.${mfpErrorKey(status.data.latest.error_code)}`)}</p>:null}
        <div className="admin-form-actions">
          <button className="admin-button admin-button--primary" disabled={!canStart} onClick={()=>void start()} type="button">{t("facets.start")}</button>
          <button className="admin-button" disabled={!canStart} onClick={()=>void start(true)} type="button">{t("facets.recalculate")}</button>
          {status.data.latest?.waiting_full_confirmation?<button className="admin-button" disabled={mutation.busy||mutation.pending}
            onClick={async()=>{if(await mutation.send({confirm_run_id:status.data!.latest!.id,entity_context_digest:status.data!.entity_context_digest}))await refresh();}} type="button">{t("confirmFull")}</button>:null}
        </div><p className="admin-drawer-form__hint">{t("estimateNotice")}</p>
      </>:null}
      {!status.data?.provider_available?<p>{t("errors.provider")}</p>:null}
      <h3>{t("facets.title")}</h3>
      {rootId?<button className="admin-button" type="button" onClick={()=>{setRootId(null);window.history.replaceState(null,"",window.location.pathname+window.location.search);}}>{t("showAllMentions")}</button>:null}
      <div className="mfp-filters"><label>{t("dimension")}<select value={dimension} onChange={event=>{setDimension(event.target.value);setValue("");setCursor(null);}}>
        {dimensions.map(d=><option key={d} value={d}>{t(`dimensions.${d}`)}</option>)}</select></label>
        <label>{t("filter")}<select value={value} onChange={event=>{setValue(event.target.value);setCursor(null);}}><option value="">{t("all")}</option>
          {browser.data?.distributions.filter(d=>d.dimension===dimension).map(d=><option key={d.value} value={d.value}>{label(dimension,d.value)} ({d.count})</option>)}</select></label>
        <button className="admin-button" onClick={()=>{setDimension("status");setValue("abstained");setCursor(null);}} type="button">{t("facets.exceptions")}</button>
      </div>
      <div className="mfp-distribution">{browser.data?.distributions.filter(d=>d.dimension===dimension).map(d=><button type="button" key={d.value}
        aria-pressed={value===d.value} onClick={()=>{setValue(d.value);setCursor(null);}}>{label(dimension,d.value)} <strong>{d.count.toLocaleString(locale)}</strong></button>)}</div>
      {browser.data?.items.length?<label className="mfp-select-all"><input type="checkbox" checked={selection.length===browser.data.items.length}
        disabled={!browser.data.can_edit||mutation.busy} onChange={event=>setSelection(event.target.checked?browser.data!.items.map(i=>i.root_id):[])}/>{t("selectPage")}</label>:null}
      <div className="mfp-mentions">{browser.data?.items.map(item=><article key={item.root_id} id={`mention-${item.root_id}`} className="mfp-evidence">
        <label className="mfp-select-all"><input type="checkbox" checked={selection.includes(item.root_id)} disabled={!browser.data?.can_edit||mutation.busy}
          onChange={event=>setSelection(old=>event.target.checked?[...old,item.root_id]:old.filter(id=>id!==item.root_id))}/><strong>{item.title??item.platform??t("mention")}</strong></label>
        <div className="mfp-evidence__meta"><span>{t(`values.${item.status}`)}</span><span>{t(`values.${item.relevance}`)}</span>
          {item.human_dimensions.length?<span>{t("sources.human")}</span>:null}</div>
        <p className="mfp-evidence__text">{item.text}</p>
        <dl className="mfp-facet-values">{correctable.map(dim=><div key={dim}><dt>{t(`dimensions.${dim}`)}</dt>
          <dd>{facetLabel(item.facets,dim,label)}</dd></div>)}</dl>
        {item.requires_context_review?<p role="status">{t("contextReview")}</p>:null}
        <div className="admin-form-actions"><button type="button" className="admin-button" disabled={!browser.data?.can_edit||mutation.busy}
          onClick={()=>beginEdit(item)}>{t("correct")}</button>
          {mfpSafeUrl(item.url)?<a href={mfpSafeUrl(item.url)!} target="_blank" rel="noreferrer">{t("openOriginal")}</a>:null}</div>
      </article>)}</div>
      {browser.data&&!browser.data.items.length?<p>{t("empty")}</p>:null}
      {selection.length>0?<fieldset className="mfp-correction" disabled={mutation.busy||mutation.pending}>
        <legend>{t("correctSelected",{count:selection.length})}</legend>
        <label>{t("dimension")}<select value={editDimension} onChange={event=>chooseDimension(event.target.value)}>{correctable.map(d=><option key={d} value={d}>{t(`dimensions.${d}`)}</option>)}</select></label>
        {editDimension==="entities"?<>
          {browser.data?.entities.map(entity=><div className="mfp-entity" key={entity.entity_id}><label><input type="checkbox" checked={entities.some(e=>e.entity_id===entity.entity_id)}
            onChange={event=>setEntities(old=>event.target.checked?[...old,{entity_id:entity.entity_id,kind:entity.kind,salience:"main"}]:old.filter(e=>e.entity_id!==entity.entity_id))}/>{entity.name}</label>
            {entities.some(e=>e.entity_id===entity.entity_id)?<label>{t("dimensions.salience")}<select value={entities.find(e=>e.entity_id===entity.entity_id)!.salience}
              onChange={event=>setEntities(old=>old.map(e=>e.entity_id===entity.entity_id?{...e,salience:event.target.value as "main"|"secondary"}:e))}>
              <option value="main">{t("values.main")}</option><option value="secondary">{t("values.secondary")}</option></select></label>:null}</div>)}
          {!entities.length?<label>{t("unrelatedReason")}<select value={reason} onChange={event=>setReason(event.target.value)}><option value="off_topic">{t("values.off_topic")}</option><option value="homonym">{t("values.homonym")}</option></select></label>:null}
        </>:editDimension==="voice"||editDimension==="act"||editDimension==="spam_or_bot"?<label>{t("value")}<select value={editValue} onChange={event=>setEditValue(event.target.value)}>
          {(editDimension==="voice"?voices:editDimension==="act"?acts:["false","true"]).map(v=><option key={v} value={v}>{label(editDimension,v)}</option>)}</select></label>
          :<label>{t("value")}<input value={editValue} maxLength={editDimension==="language"?2:200} onChange={event=>setEditValue(event.target.value)}/></label>}
        <p>{t("humanNotice")}</p><button className="admin-button admin-button--primary" type="button" disabled={!editValue.trim()&&editDimension!=="entities"} onClick={()=>void save()}>{t("saveCorrections")}</button>
      </fieldset>:null}
      {saved?<p role="status">{t("saved")}</p>:null}
      {mutation.error?<p className="team-msg team-msg--error" role="alert">{t(`errors.${mfpErrorKey(mutation.error)}`)}</p>:null}
      {mutation.pending?<button className="admin-button" disabled={mutation.busy} type="button" onClick={async()=>{if(await mutation.send())await refresh();}}>{t("retrySame")}</button>:null}
      <div className="admin-form-actions">{cursor?<button className="admin-button" type="button" onClick={()=>setCursor(null)}>{t("firstPage")}</button>:null}
        {browser.data?.next_cursor?<button className="admin-button" type="button" disabled={browser.loading} onClick={()=>setCursor(browser.data!.next_cursor)}>{t("nextPage")}</button>:null}</div>
    </div>
  </section>;
}
function facetLabel(facets:MentionFacetsV1|null,dimension:string,label:(dimension:string,value:string)=>string) {
  if(!facets)return label(dimension,"abstained");
  if(dimension==="entities")return facets.entities.abstained?label(dimension,"abstained"):facets.entities.value.map(e=>`${label("entities",e.entity_id)} (${label("salience",e.salience)})`).join(", ")||"—";
  const item=facets[dimension as "voice"|"act"|"spam_or_bot"|"language"|"asunto"];
  return item.abstained?label(dimension,"abstained"):label(dimension,String(item.value??"—"));
}
