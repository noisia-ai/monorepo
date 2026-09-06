import React from "react";

import type { SignalTopicEvaluationV2CandidateDetail } from "@/lib/data-os/signal-topic-evaluation-v2-management";

type Translate=(key:string,values?:Record<string,string|number>)=>string;

/** A saved model suggestion, not an approval or a second editorial writer. */
export function TopicCandidateRefinementSuggestion({refinement,dismissed,copied,busy,editable,t,
  onUse,onDismiss,onShow}:{
  refinement:SignalTopicEvaluationV2CandidateDetail["refinement"];
  dismissed:boolean;copied:boolean;busy:boolean;editable:boolean;t:Translate;
  onUse:()=>void;onDismiss:()=>void;onShow:()=>void;
}){
  if(refinement.status!=="available")return <p className="admin-drawer-form__hint">
    {t(`refinement.${refinement.status}`)}</p>;
  const proposal=refinement.proposal;
  if(dismissed)return <div className="topic-evaluation-manager__refinement">
    <p>{t("refinement.dismissed")}</p>
    <button className="admin-button" type="button" onClick={onShow}>{t("refinement.show")}</button>
  </div>;
  return <section aria-label={t("refinement.title")} className="topic-evaluation-manager__refinement">
    <h3>{t("refinement.title")}</h3>
    <p className="admin-drawer-form__hint">{t("refinement.hint")}</p>
    <strong>{proposal.display_name}</strong>
    <p>{proposal.description}</p>
    <details><summary>{t("refinement.basis",{count:proposal.evidence_refs.length})}</summary>
      <p>{proposal.rationale}</p>
      <p className="admin-drawer-form__hint">{t("refinement.sourceRevision",{revision:proposal.source_revision})}</p>
    </details>
    {proposal.related_candidates.length?<p>{t("refinement.related",{
      names:proposal.related_candidates.map((item)=>item.title).join(" · ")})}</p>:null}
    {proposal.recommendation!=="none"?<p className="admin-drawer-form__hint">
      {t(`refinement.${proposal.recommendation}`)}</p>:null}
    {proposal.is_stale?<p className="workspace-form__error" role="status">{t("refinement.stale")}</p>:null}
    <div className="admin-drawer-form__actions">
      <button className="admin-button" type="button" disabled={busy||!editable||proposal.is_stale||copied}
        onClick={onUse}>{t("refinement.use")}</button>
      <button className="admin-button" type="button" disabled={busy} onClick={onDismiss}>{t("refinement.dismiss")}</button>
    </div>
    {copied?<p role="status">{t("refinement.copied")}</p>:null}
  </section>;
}
