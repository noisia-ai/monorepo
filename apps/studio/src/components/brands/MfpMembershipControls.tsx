"use client";
import {useState} from "react";
import {useLocale,useTranslations} from "next-intl";
import {useMfpResource,useMfpMutation} from "./useMfpResource";
import {MfpEvidence} from "./MfpEvidence";
import {mfpErrorKey,mfpMoney,type MfpMembershipStatus,type MfpPreview,type MfpRun} from "@/lib/data-os/mfp-ui";
type Concept={concept_key:string;label:string;scope:string;definition:string;inclusion:string[];exclusion:string[];positive_examples:string[];negative_examples:string[];definition_digest:string};
export function MfpMembershipControls({workspaceId,concept,dirty,canEdit,mentionHref,signalHref,onAccessDenied}:{workspaceId:string;concept:Concept;dirty:boolean;canEdit:boolean;
  mentionHref:string;signalHref:string;onAccessDenied?:()=>void}) {
  const t=useTranslations("Mfp"),locale=useLocale();
  const base=`/api/data-os/signal/${encodeURIComponent(workspaceId)}/memberships`;
  const [verdict,setVerdict]=useState("belongs"),[cursor,setCursor]=useState<string|null>(null),[selection,setSelection]=useState<string[]>([]);
  const [previewRun,setPreviewRun]=useState<string|null>(null),[previewDefinition,setPreviewDefinition]=useState<string|null>(null);
  const query=new URLSearchParams({concept_key:concept.concept_key,verdict,limit:"30"});if(cursor)query.set("cursor",cursor);
  const resource=useMfpResource<MfpMembershipStatus>(`${base}?${query}`,"concept-membership-status-v1",onAccessDenied,true);
  const mutation=useMfpMutation(base,onAccessDenied),preview=useMfpMutation(`${base}/preview`,onAccessDenied);
  const current=resource.data?.concepts.find(item=>item.concept_key===concept.concept_key);
  const disabled=!resource.data?.enabled||!resource.data.provider_available||!resource.data.can_request_processing||mutation.busy||mutation.pending||Boolean(resource.error);
  const active=["queued","running"].includes(resource.data?.latest?.status??"");
  const submit=async(body:Record<string,unknown>,method="POST")=>{const result=await mutation.send(body,method);if(result){setSelection([]);await resource.read();}return result;};
  const startPreview=async()=>{const result=await preview.send({concept:{concept_key:concept.concept_key,label:concept.label,scope:concept.scope,definition:concept.definition,
    inclusion:concept.inclusion,exclusion:concept.exclusion,positive_examples:concept.positive_examples,negative_examples:concept.negative_examples,definition_digest:concept.definition_digest}});if(result){setPreviewRun(result.run_id);setPreviewDefinition(JSON.stringify(concept));}};
  const filter=(next:string)=>{setVerdict(next);setCursor(null);setSelection([]);};
  return <section className="mfp-membership" aria-busy={resource.loading||mutation.busy}>
    <header className="admin-section__head"><div><h3>{t("membership.title")}</h3><p>{t("membership.body")}</p></div>
      <button type="button" className="admin-button" disabled={resource.loading} onClick={()=>void resource.read()}>{t("refresh")}</button></header>
    <p className="mfp-notice">{t("experimental")}</p>
    {resource.error?<p className="team-msg team-msg--error" role="alert">{t(`errors.${mfpErrorKey(resource.error)}`)}</p>:null}
    {resource.data?<>
      <dl className="admin-summary-strip admin-summary-strip--compact"><div><dt>{t("membership.relevant")}</dt><dd>{resource.data.population.relevant}</dd></div>
        <div><dt>{t("membership.withoutConcept")}</dt><dd>{resource.data.population.without_concept}</dd></div>
        <div><dt>{t("estimated")}</dt><dd>{mfpMoney(resource.data.estimated_micro_usd,locale)}</dd></div>
        <div><dt>{t("previewEstimate")}</dt><dd>{mfpMoney(resource.data.preview_estimated_micro_usd,locale)}</dd></div></dl>
      <MfpRunReceipt run={resource.data.latest}/>
      <div className="admin-form-actions">
        <button className="admin-button" type="button" disabled={disabled||preview.busy||preview.pending||!concept.label.trim()||!concept.definition.trim()}
          onClick={()=>void startPreview()}>{t("preview")}</button>
        <button className="admin-button admin-button--primary" type="button" disabled={disabled||dirty||!current||active}
          onClick={()=>void submit({})}>{t("membership.start")}</button>
        {resource.data.latest?.waiting_full_confirmation?<button className="admin-button" disabled={mutation.busy||mutation.pending||!resource.data.can_request_processing} type="button"
          onClick={()=>void submit({confirm_run_id:resource.data!.latest!.id,entity_context_digest:resource.data!.entity_context_digest})}>{t("confirmFull")}</button>:null}
      </div>
      <p className="admin-drawer-form__hint">{t("estimateNotice")}</p>
      {dirty?<p role="status">{t("saveBeforeFull")}</p>:null}
      {current?<div className="mfp-signal-selection"><label><input type="checkbox" checked={current.selected}
        disabled={!resource.data.can_edit_topics||!canEdit||dirty||mutation.busy||mutation.pending}
        onChange={event=>void submit({selection:{concept_key:concept.concept_key,selected:event.target.checked,expected_selection_revision:current.selection_revision},idempotency_key:crypto.randomUUID()},"PATCH")}/>{t("selectSignal")}</label>
        <a href={signalHref}>{t("openSignal")}</a></div>:null}
      <h4>{t("exceptions.title")}</h4><p>{t("exceptions.body")}</p>
      <div className="mfp-filters"><label>{t("filter")}<select value={verdict} onChange={event=>filter(event.target.value)}>
        {["belongs","not_belongs","insufficient","refused","error","pending"].map(v=><option key={v} value={v}>{t(`verdicts.${v}`)}</option>)}</select></label>
        <button type="button" className="admin-button" onClick={()=>filter("insufficient")}>{t("exceptions.review")}</button>
        <span>{t("count",{count:resource.data.counts.find(c=>c.verdict===verdict)?.count??0})}</span></div>
      {resource.data.items.length?<label className="mfp-select-all"><input type="checkbox" checked={selection.length===resource.data.items.length}
        disabled={!resource.data.can_edit_topics||mutation.busy} onChange={event=>setSelection(event.target.checked?resource.data!.items.map(i=>i.root_id):[])}/>{t("selectPage")}</label>:null}
      {selection.length?<div className="admin-form-actions"><span>{t("correctSelected",{count:selection.length})}</span>
        {(["belongs","not_belongs"] as const).map(decision=><button className="admin-button" type="button" key={decision}
          disabled={mutation.busy||mutation.pending||!resource.data?.can_edit_topics} onClick={()=>void submit({overrides:selection.map(root_id=>({root_id,concept_key:concept.concept_key,verdict:decision}))},"PATCH")}>{t(decision==="belongs"?"exceptions.accept":"exceptions.reject")}</button>)}</div>:null}
      <div>{resource.data.items.map(item=><div key={`${item.root_id}:${item.concept_key}`}>
        <label className="mfp-select-all"><input type="checkbox" checked={selection.includes(item.root_id)} disabled={!resource.data?.can_edit_topics||mutation.busy}
          onChange={event=>setSelection(old=>event.target.checked?[...old,item.root_id]:old.filter(id=>id!==item.root_id))}/>{t("selectMention")}</label>
        <MfpEvidence item={item} mentionHref={`${mentionHref}#mention-${item.root_id}`}/></div>)}</div>
      {!resource.data.items.length?<p>{t("empty")}</p>:null}
      <div className="admin-form-actions">{cursor?<button className="admin-button" type="button" onClick={()=>{setCursor(null);setSelection([]);}}>{t("firstPage")}</button>:null}
        {resource.data.next_cursor?<button className="admin-button" type="button" disabled={resource.loading} onClick={()=>{setCursor(resource.data!.next_cursor);setSelection([]);}}>{t("nextPage")}</button>:null}</div>
    </>:null}
    {mutation.error||preview.error?<p className="team-msg team-msg--error" role="alert">{t(`errors.${mfpErrorKey(mutation.error??preview.error??"")}`)}</p>:null}
    {mutation.pending?<button className="admin-button" type="button" disabled={mutation.busy} onClick={async()=>{if(await mutation.send())await resource.read();}}>{t("retrySame")}</button>:null}
    {preview.pending?<button className="admin-button" type="button" disabled={preview.busy} onClick={async()=>{const result=await preview.send();if(result){setPreviewRun(result.run_id);setPreviewDefinition(JSON.stringify(concept));}}}>{t("retrySame")}</button>:null}
    {previewRun?<><p>{t("previewNotice")}</p>{previewDefinition!==JSON.stringify(concept)?<p role="status">{t("previewChanged")}</p>:null}
      <MfpPreviewResults key={previewRun} endpoint={`${base}/preview?run_id=${encodeURIComponent(previewRun)}`} mentionHref={mentionHref} onAccessDenied={onAccessDenied}/></>:null}
  </section>;
}
export function MfpRunReceipt({run}:{run:MfpRun|null}) {
  const t=useTranslations("Mfp"),locale=useLocale();if(!run)return null;
  return <><p role="status">{t(`runStates.${run.status}`)}</p><dl className="admin-summary-strip admin-summary-strip--compact">
    <div><dt>{t("actual")}</dt><dd>{mfpMoney(run.settled_micro_usd,locale)}</dd></div><div><dt>{t("reserved")}</dt><dd>{mfpMoney(run.reserved_micro_usd,locale)}</dd></div>
    <div><dt>{t("strictMaximum")}</dt><dd>{run.cap_micro_usd==null?t("noMaximum"):mfpMoney(run.cap_micro_usd,locale)}</dd></div></dl>
    {run.error_code?<p role="alert">{t(`errors.${mfpErrorKey(run.error_code)}`)}</p>:null}</>;
}
function MfpPreviewResults({endpoint,mentionHref,onAccessDenied}:{endpoint:string;mentionHref:string;onAccessDenied?:()=>void}) {
  const t=useTranslations("Mfp");const preview=useMfpResource<MfpPreview>(endpoint,"concept-membership-preview-v1",onAccessDenied,true);
  return <section className="mfp-preview"><h4>{t("previewResults",{count:preview.data?.sample_size??30})}</h4><MfpRunReceipt run={preview.data?.run??null}/>
    {preview.error?<p role="alert">{t(`errors.${mfpErrorKey(preview.error)}`)}</p>:null}
    {preview.data?.items.map(item=><MfpEvidence key={`${item.root_id}:${item.concept_key}`} item={item} mentionHref={`${mentionHref}#mention-${item.root_id}`}/>)}
    <button className="admin-button" type="button" disabled={preview.loading} onClick={()=>void preview.read()}>{t("refresh")}</button></section>;
}
