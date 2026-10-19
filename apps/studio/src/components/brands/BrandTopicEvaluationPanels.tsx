"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FullEvidenceTopicCandidateManager } from "./FullEvidenceTopicCandidateManager";
import { FullEvidenceTopicEvaluationStatus } from "./FullEvidenceTopicEvaluationStatus";
import { TopicEvaluationManager } from "./TopicEvaluationManager";

/** Provenance comes from the scoped V2 reader; no guessed counts or new launch authority. */
export function BrandTopicEvaluationPanels({workspaceId}:{workspaceId:string}){
  const[imported,setImported]=useState<boolean|null>(null);
  const t=useTranslations("AdminWorkspace.brandOs.topicEvaluation.historical");
  return<>
    {imported?<details className="admin-section workspace-resource-section">
      <summary>{t("title")}</summary><p className="admin-drawer-form__hint">{t("body")}</p>
      <TopicEvaluationManager workspaceId={workspaceId} readOnly/>
    </details>:<TopicEvaluationManager workspaceId={workspaceId} readOnly={imported===null}/>}
    {imported===null?<p className="admin-drawer-form__hint" role="status">{t("checking")}</p>:null}
    <FullEvidenceTopicEvaluationStatus workspaceId={workspaceId}/>
    <FullEvidenceTopicCandidateManager workspaceId={workspaceId} onImportedResult={setImported}/>
  </>;
}
