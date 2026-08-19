"use client";

import { ArrowRight, CheckCircle, Clock, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  formatAdminDate
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import type {
  SignalGovernancePreparationV1
} from "@/lib/data-os/signal-governance-control-plane";

type Drawer =
  | { kind: "quality" }
  | { kind: "retention" }
  | { kind: "licensing" }
  | { kind: "provenance"; sourceId: string }
  | { kind: "identity" }
  | { kind: "timezone" }
  | null;

const USAGES = [
  "client-derived-metrics",
  "client-mention-list",
  "client-text-or-excerpt",
  "internal-qa",
  "llm-processing",
  "strategic-analysis"
] as const;

export function GovernancePreparationManager({
  initial,
  workspaceId
}: {
  initial: SignalGovernancePreparationV1;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  const locale = useLocale();
  const router = useRouter();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryKeys = useRef(new Map<string,string>());
  const readyCount = initial.checklist.filter((item) => item.state === "ready").length;
  const source = drawer?.kind === "provenance"
    ? initial.sources.find((item) => item.source_id === drawer.sourceId) ?? null
    : null;
  const technical = useMemo(() => ({
    readyCompilations: initial.governed_views.ready_compilations,
    currentBindings: initial.governed_views.current_bindings,
    stale: initial.governed_views.stale_or_invalidated
  }), [initial]);

  const submit = async (command: Record<string, unknown>) => {
    const requestIdentity = JSON.stringify(command);
    const idempotencyKey = retryKeys.current.get(requestIdentity) ?? crypto.randomUUID();
    retryKeys.current.set(requestIdentity,idempotencyKey);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/governance`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(command)
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("errors.command"));
      retryKeys.current.delete(requestIdentity);
      setDrawer(null);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("errors.command"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AdminResourceSection
        subtitle={t("subtitle")}
        title={t("title")}
        actions={<AdminStatus state={readyCount === initial.checklist.length ? "good" : "warning"}>{t("progress", { ready: readyCount, total: initial.checklist.length })}</AdminStatus>}
      >
        <div className="admin-settings-list">
          {initial.checklist.map((item) => (
            <AdminSettingsRow
              key={item.key}
              icon={item.state === "ready" ? <CheckCircle aria-hidden size={17} weight="fill" /> : item.state === "not_available" ? <Clock aria-hidden size={17} /> : <WarningCircle aria-hidden size={17} weight="fill" />}
              title={t(`items.${item.key}.title`)}
              description={item.blocker ? t(`blockers.${item.blocker}`) : t(`items.${item.key}.ready`)}
              value={<AdminStatus state={tone(item.state)}>{t(`states.${item.state}`)}</AdminStatus>}
              action={actionForChecklist(item.key, item.action, setDrawer, submit, t)}
            />
          ))}
        </div>
      </AdminResourceSection>

      <AdminResourceSection subtitle={t("authorities.subtitle")} title={t("authorities.title")}>
        <div className="admin-settings-list">
          <PolicyRows
            kind="quality"
            rows={initial.policies.quality}
            onActivate={(version) => void submit({ action: "activate-policy", policy_kind: "quality-policy", policy_version: version })}
            onCreate={() => setDrawer({ kind: "quality" })}
            busy={busy}
          />
          <PolicyRows
            kind="retention"
            rows={initial.policies.retention}
            onActivate={(version) => void submit({ action: "activate-policy", policy_kind: "retention-policy", policy_version: version })}
            onCreate={() => setDrawer({ kind: "retention" })}
            busy={busy}
          />
          <PolicyRows
            kind="licensing"
            rows={initial.policies.licensing}
            onActivate={(version) => void submit({ action: "activate-policy", policy_kind: "licensing-policy", policy_version: version })}
            onCreate={() => setDrawer({ kind: "licensing" })}
            busy={busy}
          />
        </div>
      </AdminResourceSection>

      <AdminResourceSection subtitle={t("provenance.subtitle")} title={t("provenance.title")}>
        {initial.sources.length === 0 ? (
          <div className="admin-empty admin-empty--compact"><strong>{t("provenance.empty")}</strong></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{t("provenance.source")}</th><th>{t("provenance.imports")}</th><th>{t("provenance.authority")}</th><th aria-label={t("provenance.action")} /></tr></thead>
              <tbody>{initial.sources.map((item) => (
                <tr key={item.source_id}>
                  <td><div className="admin-table__primary"><strong>{item.name}</strong><small>{item.scope ?? t("states.not_available")}</small></div></td>
                  <td>{item.imports}</td>
                  <td><AdminStatus state={item.active_source_binding && item.unbound_imports === 0 ? "good" : "warning"}>{item.active_source_binding ? t("states.ready") : t("states.blocked")}</AdminStatus></td>
                  <td><div className="admin-workspace-actions">
                    {item.binding_drafts.map((draft) => (
                      <button
                        className="admin-button admin-button--compact"
                        disabled={busy}
                        key={`${draft.scope}:${draft.binding_version}`}
                        onClick={() => void submit({
                          action: "activate-provenance-binding",
                          source_id: item.source_id,
                          import_batch_id: draft.import_batch_id,
                          binding_version: draft.binding_version
                        })}
                        type="button"
                      >{t("actions.activate", { version: draft.binding_version })}</button>
                    ))}
                    <button className="admin-button admin-button--compact" onClick={() => setDrawer({ kind: "provenance", sourceId: item.source_id })} type="button">{t("actions.configure")}<ArrowRight aria-hidden size={14} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </AdminResourceSection>

      <details className="admin-section admin-section--details">
        <summary>{t("technical.title")}</summary>
        <dl className="admin-definition-list">
          <div><dt>{t("technical.brandOs")}</dt><dd>v{initial.identities.brand_os_profile_version ?? "—"}</dd></div>
          <div><dt>{t("technical.identities")}</dt><dd>{initial.identities.competitors + initial.identities.categories + initial.identities.references + 1}</dd></div>
          <div><dt>{t("technical.assertions")}</dt><dd>{initial.semantic_review.approved_eligible}</dd></div>
          <div><dt>{t("technical.compilations")}</dt><dd>{technical.readyCompilations}</dd></div>
          <div><dt>{t("technical.bindings")}</dt><dd>{technical.currentBindings}</dd></div>
          <div><dt>{t("technical.stale")}</dt><dd>{technical.stale}</dd></div>
        </dl>
      </details>

      {drawer ? (
        <WorkspaceDrawer ariaLabel={t(`drawers.${drawer.kind}.title`)} closeLabel={t("actions.close")} eyebrow={t("eyebrow")} onClose={() => !busy && setDrawer(null)} title={t(`drawers.${drawer.kind}.title`)}>
          {drawer.kind === "quality" ? <QualityForm busy={busy} error={error} submit={submit} /> : null}
          {drawer.kind === "retention" ? <RetentionForm busy={busy} error={error} submit={submit} /> : null}
          {drawer.kind === "licensing" ? <LicensingForm busy={busy} error={error} submit={submit} /> : null}
          {drawer.kind === "identity" ? <IdentityForm busy={busy} error={error} submit={submit} /> : null}
          {drawer.kind === "timezone" ? <TimezoneForm busy={busy} error={error} initial={initial.workspace.timezone} submit={submit} /> : null}
          {drawer.kind === "provenance" && source ? <ProvenanceForm busy={busy} error={error} source={source} submit={submit} locale={locale} /> : null}
        </WorkspaceDrawer>
      ) : null}
    </>
  );
}

function PolicyRows({
  busy,
  kind,
  onActivate,
  onCreate,
  rows
}: {
  busy: boolean;
  kind: "quality" | "retention" | "licensing";
  onActivate: (version: number) => void;
  onCreate: () => void;
  rows: Array<{ policy_version: number; status: string; effective_from: string; effective_to: string | null; approved_by: string | null; approved_at: string | null }>;
}) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  const locale = useLocale();
  const current = rows.find((row) => row.status === "active") ?? rows[0] ?? null;
  const draft = rows.find((row) => row.status === "draft") ?? null;
  return (
    <AdminSettingsRow
      icon={<ShieldCheck aria-hidden size={17} />}
      title={t(`authorities.${kind}`)}
      description={current ? t("authorities.approval", {
        actor: current.approved_by ?? t("authorities.serverActor"),
        date: formatAdminDate(current.approved_at ?? current.effective_from, locale)
      }) : t("authorities.missing")}
      value={current ? <span className="admin-status-stack">v{current.policy_version}<AdminStatus state={current.status === "active" ? "good" : "warning"}>{t(`states.${current.status}`)}</AdminStatus></span> : <AdminStatus state="warning">{t("states.not_available")}</AdminStatus>}
      action={<div className="admin-workspace-actions">
        {draft ? <button className="admin-button admin-button--compact" disabled={busy} onClick={() => onActivate(draft.policy_version)} type="button">{t("actions.activate", { version: draft.policy_version })}</button> : null}
        <button className="admin-button admin-button--compact" onClick={onCreate} type="button">{t("actions.newVersion")}</button>
      </div>}
    />
  );
}

function QualityForm({ busy, error, submit }: FormProps) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({
    action: "create-quality-draft",
    min_quality_score: numberOrNull(form.get("min_quality_score")),
    required_quality_flags: csv(form.get("required_quality_flags")),
    forbidden_quality_flags: csv(form.get("forbidden_quality_flags")),
    canonical_root_disposition: String(form.get("canonical_root_disposition")),
    effective_from: dateTime(form.get("effective_from")),
    effective_to: dateTime(form.get("effective_to"))
  })}>
    <label className="workspace-field"><span>{t("fields.minScore")}</span><input className="workspace-control" max={100} min={0} name="min_quality_score" type="number" /><small>{t("fields.minScoreHelp")}</small></label>
    <label className="workspace-field"><span>{t("fields.requiredFlags")}</span><input className="workspace-control" name="required_quality_flags" /><small>{t("fields.csvHelp")}</small></label>
    <label className="workspace-field"><span>{t("fields.forbiddenFlags")}</span><input className="workspace-control" name="forbidden_quality_flags" /></label>
    <label className="workspace-field"><span>{t("fields.rootDisposition")}</span><select className="workspace-control" defaultValue="evaluate" name="canonical_root_disposition"><option value="evaluate">{t("values.evaluate")}</option><option value="blocked">{t("values.blocked")}</option><option value="not_available">{t("values.notAvailable")}</option></select></label>
    <EffectiveWindowFields />
  </DecisionForm>;
}

function RetentionForm({ busy, error, submit }: FormProps) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({
    action: "create-retention-draft",
    retention_state: String(form.get("retention_state")),
    retention_mode: String(form.get("retention_mode")),
    retain_until: dateTime(form.get("retain_until")),
    expiry_action: String(form.get("expiry_action")),
    approval_evidence: String(form.get("approval_evidence") ?? "") || null,
    effective_from: dateTime(form.get("effective_from")),
    effective_to: dateTime(form.get("effective_to"))
  })}>
    <label className="workspace-field"><span>{t("fields.retentionState")}</span><select className="workspace-control" defaultValue="not_available" name="retention_state"><DecisionOptions /></select></label>
    <label className="workspace-field"><span>{t("fields.retentionMode")}</span><select className="workspace-control" defaultValue="not_available" name="retention_mode"><option value="indefinite">{t("values.indefinite")}</option><option value="until">{t("values.until")}</option><option value="not_available">{t("values.notAvailable")}</option></select></label>
    <label className="workspace-field"><span>{t("fields.retainUntil")}</span><input className="workspace-control" name="retain_until" type="datetime-local" /></label>
    <label className="workspace-field"><span>{t("fields.expiryAction")}</span><select className="workspace-control" defaultValue="not_available" name="expiry_action"><option value="block_use">{t("values.blockUse")}</option><option value="review_required">{t("values.reviewRequired")}</option><option value="not_available">{t("values.notAvailable")}</option></select></label>
    <ApprovalEvidenceField />
    <EffectiveWindowFields />
  </DecisionForm>;
}

function LicensingForm({ busy, error, submit }: FormProps) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({
    action: "create-licensing-draft",
    usages: USAGES.map((usage) => ({ usage_purpose: usage, decision: String(form.get(usage)) })),
    approval_evidence: String(form.get("approval_evidence") ?? "") || null,
    effective_from: dateTime(form.get("effective_from")),
    effective_to: dateTime(form.get("effective_to"))
  })}>
    <p className="admin-table__muted">{t("fields.licensingHelp")}</p>
    {USAGES.map((usage) => <label className="workspace-field" key={usage}><span>{t(`usages.${usage}`)}</span><select className="workspace-control" defaultValue="not_available" name={usage}><DecisionOptions /></select></label>)}
    <ApprovalEvidenceField />
    <EffectiveWindowFields />
  </DecisionForm>;
}

function ProvenanceForm({ busy, error, locale, source, submit }: FormProps & {
  locale: string;
  source: SignalGovernancePreparationV1["sources"][number];
}) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({
    action: "create-provenance-binding-draft",
    source_id: source.source_id,
    import_batch_id: String(form.get("import_batch_id") ?? "") || null,
    effective_from: dateTime(form.get("effective_from")),
    effective_to: dateTime(form.get("effective_to"))
  })}>
    <p className="admin-table__muted">{t("provenance.body", { source: source.name })}</p>
    <label className="workspace-field"><span>{t("provenance.scope")}</span><select className="workspace-control" defaultValue="" name="import_batch_id"><option value="">{t("provenance.sourceLevel")}</option>{source.completed_imports.map((item) => <option key={item.import_batch_id} value={item.import_batch_id}>{item.label} · {formatAdminDate(item.created_at, locale)}</option>)}</select><small>{t("provenance.scopeHelp")}</small></label>
    <EffectiveWindowFields />
  </DecisionForm>;
}

function IdentityForm({ busy, error, submit }: FormProps) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({
    action: "upsert-identity",
    entity_type: String(form.get("entity_type")),
    canonical_name: String(form.get("canonical_name")),
    external_id: String(form.get("external_id") ?? "") || null
  })}>
    <label className="workspace-field"><span>{t("fields.identityType")}</span><select className="workspace-control" name="entity_type"><option value="category">{t("values.category")}</option><option value="reference">{t("values.reference")}</option></select></label>
    <label className="workspace-field"><span>{t("fields.canonicalName")}</span><input className="workspace-control" maxLength={240} minLength={2} name="canonical_name" required /></label>
    <label className="workspace-field"><span>{t("fields.externalId")}</span><input className="workspace-control" maxLength={240} name="external_id" /></label>
  </DecisionForm>;
}

function TimezoneForm({ busy, error, initial, submit }: FormProps & { initial: string }) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <DecisionForm busy={busy} error={error} onSubmit={(form) => submit({ action: "update-timezone", timezone: String(form.get("timezone")) })}>
    <label className="workspace-field"><span>{t("fields.timezone")}</span><input className="workspace-control" defaultValue={initial} maxLength={120} name="timezone" required /><small>{t("fields.timezoneHelp")}</small></label>
  </DecisionForm>;
}

type FormProps = { busy: boolean; error: string | null; submit: (command: Record<string, unknown>) => Promise<void> };

function DecisionForm({ busy, children, error, onSubmit }: { busy: boolean; children: React.ReactNode; error: string | null; onSubmit: (form: FormData) => Promise<void> }) {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }}>
    {children}
    {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
    <button className="admin-button admin-button--primary" disabled={busy} type="submit">{busy ? t("actions.saving") : t("actions.createDraft")}</button>
  </form>;
}

function EffectiveWindowFields() {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <div className="workspace-field-grid workspace-field-grid--two">
    <label className="workspace-field"><span>{t("fields.effectiveFrom")}</span><input className="workspace-control" name="effective_from" type="datetime-local" /></label>
    <label className="workspace-field"><span>{t("fields.effectiveTo")}</span><input className="workspace-control" name="effective_to" type="datetime-local" /></label>
  </div>;
}

function ApprovalEvidenceField() {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <label className="workspace-field"><span>{t("fields.approvalEvidence")}</span><textarea className="workspace-control" maxLength={1000} minLength={8} name="approval_evidence" required /><small>{t("fields.approvalEvidenceHelp")}</small></label>;
}

function DecisionOptions() {
  const t = useTranslations("AdminWorkspace.data.preparation");
  return <><option value="allowed">{t("values.allowed")}</option><option value="prohibited">{t("values.prohibited")}</option><option value="not_available">{t("values.notAvailable")}</option></>;
}

function actionForChecklist(
  key: SignalGovernancePreparationV1["checklist"][number]["key"],
  action: string | null,
  open: (drawer: Drawer) => void,
  submit: (command: Record<string,unknown>) => Promise<void>,
  t: ReturnType<typeof useTranslations>
) {
  if (!action) return undefined;
  if (action === "reconcile-brand-os") {
    return <div className="admin-workspace-actions">
      <button className="admin-button admin-button--compact" onClick={() => open({ kind: "identity" })} type="button">{t("actions.manageIdentity")}</button>
      <button className="admin-button admin-button--compact" onClick={() => void submit({ action: "reconcile-brand-os" })} type="button">{t("actions.reconcileIdentity")}</button>
    </div>;
  }
  const kind = key === "quality" ? "quality" : key === "retention" ? "retention" : key === "licensing" ? "licensing" : key === "timezone" ? "timezone" : null;
  return kind ? <button className="admin-button admin-button--compact" onClick={() => open({ kind })} type="button">{t("actions.resolve")}</button> : undefined;
}

function tone(state: string): "good" | "warning" | "not_available" {
  if (state === "ready") return "good";
  if (state === "not_available") return "not_available";
  return "warning";
}

function csv(value: FormDataEntryValue | null) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function numberOrNull(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized ? Number(normalized) : null;
}

function dateTime(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized ? new Date(normalized).toISOString() : null;
}
