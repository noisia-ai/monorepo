"use client";

import { CircleNotch, Database, Warning } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  AdminSummaryStrip,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import {
  projectSignalTopicEvaluationFullEvidenceStatusV2,
  shortSignalTopicEvaluationDigestV2,
  type SignalTopicEvaluationFullEvidenceStatusV2
} from "@/lib/data-os/signal-topic-evaluation-full-evidence-status";

async function requestStatus(url: string) {
  const response = await fetch(url, { cache: "no-store", method: "GET" });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      && typeof payload.message === "string" ? payload.message : "request_failed";
    throw new Error(message);
  }
  return projectSignalTopicEvaluationFullEvidenceStatusV2(payload);
}

export function FullEvidenceTopicEvaluationStatus({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.brandOs.fullEvidenceTopicEvaluation");
  const locale = useLocale();
  const endpoint = `/api/data-os/signal/${workspaceId}/topic-evaluation/full-evidence`;
  const [status, setStatus] = useState<SignalTopicEvaluationFullEvidenceStatusV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await requestStatus(endpoint));
    } catch (loadError) {
      setStatus(null);
      setError(loadError instanceof Error ? loadError.message : t("errors.body"));
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminResourceSection
      actions={(
        <button className="admin-button" disabled={loading} onClick={() => void load()} type="button">
          {loading ? <CircleNotch aria-hidden className="icon--spin" size={14} /> : null}
          {t("actions.refresh")}
        </button>
      )}
      className="full-evidence-topic-evaluation-status"
      subtitle={t("subtitle")}
      title={t("title")}
    >
      {loading && !status ? (
        <div aria-busy="true" aria-live="polite" className="semantic-context-pack__preflight-loading" role="status">
          <CircleNotch aria-hidden className="icon--spin" size={18} />
          <span>{t("loading")}</span>
        </div>
      ) : null}
      {error && !status ? (
        <AdminFeedbackState
          actions={<button className="admin-button" onClick={() => void load()} type="button">{t("actions.refresh")}</button>}
          body={t("errors.body")}
          detail={error}
          icon={<Warning size={20} />}
          title={t("errors.title")}
          tone="danger"
        />
      ) : null}
      {status ? (
        <>
          <AdminSummaryStrip
            density="compact"
            items={[
              { label: t("summary.historical"), value: "115", hint: t("summary.historicalHint") },
              { label: t("summary.clusters"), value: formatAdminNumber(status.clusterCount, locale), hint: t("summary.clustersHint") },
              { label: t("summary.memberships"), value: formatAdminNumber(status.membershipCount, locale), hint: t("summary.membershipsHint") },
              { label: t("summary.topView"), value: formatAdminNumber(status.topViewLimit, locale), hint: t("summary.topViewHint") }
            ]}
          />
          <div className="semantic-context-pack__notice">
            <Database aria-hidden size={18} />
            <div>
              <strong>{t("boundary.title")}</strong>
              <p>{t("boundary.body")}</p>
            </div>
            <AdminStatus state="not_available">{t("states.disabled")}</AdminStatus>
          </div>
          <div className="topic-evaluation-manager__evidence">
            <strong>{t("navigation.title")}</strong>
            <p>{t("navigation.body")}</p>
            <ul className="full-evidence-topic-evaluation-status__capabilities">
              <li>{t("navigation.catalog")}</li>
              <li>{t("navigation.mentions")}</li>
              <li>{t("navigation.context")}</li>
            </ul>
          </div>
          <p className="full-evidence-topic-evaluation-status__digest">
            {t("digests.snapshot", { digest: shortSignalTopicEvaluationDigestV2(status.snapshotDigest) })}
            {" · "}
            {t("digests.authority", { digest: shortSignalTopicEvaluationDigestV2(status.authorityDigest) })}
          </p>
        </>
      ) : null}
    </AdminResourceSection>
  );
}
