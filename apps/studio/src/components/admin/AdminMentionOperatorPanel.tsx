"use client";

import { CaretDown, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { WorkspaceStatus } from "@/components/workspace/WorkspaceShell";

type OperatorAlias = {
  mention_id: string;
  is_canonical: boolean;
  source_system: string | null;
  platform: string | null;
  data_source_id: string | null;
  source_file_id: string | null;
  created_at: string;
};

type OperatorAssertion = {
  id: string;
  scope: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  confidence: string | number | null;
  review_status: string;
  eligibility_status: string;
  attribution_source: string | null;
  evidence_kind: string | null;
  semantic_policy_key: string | null;
  policy_version: string | null;
  model_version: string | null;
  assertion_version: number | string;
  is_current: boolean;
  approval_source: string | null;
  approved_at: string | null;
  approved_by_display_name: string | null;
  resolution_state: string;
  created_at: string;
};

type OperatorImport = {
  membership_id: string;
  import_batch_id: string;
  data_source_id: string;
  source_name: string;
  source_type: string;
  provider: string | null;
  import_status: string;
  imported_at: string;
};

type OperatorStudy = {
  membership_id: string;
  study_corpus_id: string;
  study_name: string;
  import_batch_id: string | null;
  membership_role: string | null;
  created_at: string;
};

type OperatorPopulation = {
  population_id: string;
  population_key: string;
  version: number | string;
  purpose: string;
  population_status: string;
  contract_version: string | null;
  membership_status: string;
  membership_reason: string | null;
  effective_at: string;
  removed_at: string | null;
  is_current_pointer: boolean;
};

type OperatorTag = {
  id: string;
  taxonomy_key: string;
  term_key: string;
  label: string;
  value: string | null;
  score: string | number | null;
  confidence: string | number | null;
  source: string | null;
  review_status: string;
  approval_source: string | null;
};

type OperatorEntity = {
  id: string;
  relation_type: string;
  confidence: string | number | null;
  entity_id: string;
  entity_type: string;
  canonical_name: string;
  status: string;
};

type OperatorFeature = {
  id: string;
  feature_key: string;
  feature_value: unknown;
  value_type: string | null;
  confidence: string | number | null;
  source: string | null;
};

type OperatorCoding = {
  id: string;
  finding_id: string | null;
  polarity: string | null;
  layer: string | null;
  intensity_score: string | number | null;
  emergent_tags: string[] | null;
  ambiguous: boolean;
  report_key: string | null;
  analysis_status: string | null;
};

type OperatorEvidence = {
  citation_id: string;
  finding_id: string;
  polarity: string | null;
  layer: string | null;
  report_key: string | null;
  report_revision: number | string | null;
  release_status: string | null;
  is_current_release: boolean;
  is_protagonist: boolean;
};

type OperatorGovernanceEvent = {
  id: string;
  action: string;
  previous_inclusion_status: string | null;
  next_inclusion_status: string | null;
  actor_display_name: string | null;
  reason: string;
  reverts_event_id: string | null;
  created_at: string;
};

export type SignalAdminMentionOperatorV1 = {
  contract_version: "signal-admin-mention-operator-v1";
  canonical: {
    requested_mention_id: string;
    mention_id: string;
    requested_via_alias: boolean;
    aliases: OperatorAlias[];
  };
  author: {
    id: string;
    platform: string | null;
    handle: string | null;
    display_name: string | null;
    follower_count: number | null;
    country: string | null;
    is_verified: boolean | null;
    is_business: boolean | null;
  } | null;
  inclusion: {
    status: string;
    exclusion_reason: string | null;
    quality_score: number | null;
    quality_flags: unknown;
  };
  provenance: { imports: OperatorImport[]; studies: OperatorStudy[] };
  semantic: {
    current: OperatorAssertion[];
    history: OperatorAssertion[];
    review_events: Array<{
      id: string;
      action: string;
      reviewer_display_name: string | null;
      previous_review_status: string | null;
      next_review_status: string | null;
      previous_eligibility_status: string | null;
      next_eligibility_status: string | null;
      review_policy_key: string | null;
      review_policy_version: string | null;
      created_at: string;
    }>;
  };
  operational: { populations: OperatorPopulation[] };
  enrichment: {
    tags: OperatorTag[];
    entities: OperatorEntity[];
    features: OperatorFeature[];
  };
  triggers_barriers: {
    codings: OperatorCoding[];
    evidence_and_releases: OperatorEvidence[];
  };
  governance: {
    history: OperatorGovernanceEvent[];
    latest_review_request: OperatorGovernanceEvent | null;
  };
};

export type AdminMentionOperatorSummaryV1 = {
  inclusion_status: "excluded" | "included" | "pending";
  exclusion_reason: string | null;
  quality_score: number | null;
  quality_flags: unknown;
  resolution_state: string;
  review_status: string;
  eligibility_status: string;
  current_assertion_count: number;
  latest_governance: { action: string; reason: string | null; occurred_at: string } | null;
  provenance: {
    source_count: number;
    import_count: number;
    study_count: number;
    source_names: string[];
  };
};

export function AdminMentionInclusionCell({
  summary
}: {
  summary: AdminMentionOperatorSummaryV1;
}) {
  const t = useTranslations("AdminWorkspace.data.mentions.operator");
  return (
    <td className="signal-v2-mentions-table__inclusion">
      <WorkspaceStatus tone={inclusionTone(summary.inclusion_status)}>
        {t(`inclusion.${summary.inclusion_status}`)}
      </WorkspaceStatus>
    </td>
  );
}

export function AdminMentionSemanticStateCell({
  summary
}: {
  summary: AdminMentionOperatorSummaryV1;
}) {
  const t = useTranslations("AdminWorkspace.data.mentions.operator");
  return (
    <td className="signal-v2-mentions-table__operator">
      <WorkspaceStatus tone={resolutionTone(summary.resolution_state)}>
        {t(`resolution.${summary.resolution_state}`)}
      </WorkspaceStatus>
    </td>
  );
}

export function AdminMentionOperatorPrimaryPanel({
  error,
  loading,
  operator
}: {
  error: string | null;
  loading: boolean;
  operator: SignalAdminMentionOperatorV1 | null;
}) {
  const t = useTranslations("AdminWorkspace.data.mentions.operator");

  if (loading && !operator) {
    return (
      <section aria-live="polite" className="admin-mention-operator admin-mention-operator--loading">
        <SpinnerGap aria-hidden size={16} />
        <span>{t("loading")}</span>
      </section>
    );
  }

  if (error && !operator) {
    return (
      <section className="admin-mention-operator admin-mention-operator--error" role="alert">
        <WarningCircle aria-hidden size={17} />
        <span>{error}</span>
      </section>
    );
  }

  if (!operator) return null;

  const currentAssertion = operator.semantic.current[0] ?? null;
  const qualityFlags = operatorValueList(operator.inclusion.quality_flags)
    .filter((flag) => flag !== operator.inclusion.exclusion_reason);

  return (
    <div className="admin-mention-operator">
      {error ? (
        <div className="admin-mention-operator__notice" role="alert">
          <WarningCircle aria-hidden size={15} />{error}
        </div>
      ) : null}

      <OperatorSection title={t("primary.title")}>
        <div className="admin-mention-operator__primary-grid">
          <div>
            <small>{t("primary.inclusion")}</small>
            <WorkspaceStatus tone={inclusionTone(operator.inclusion.status)}>
              {t(`inclusion.${operator.inclusion.status}`)}
            </WorkspaceStatus>
          </div>
          <div>
            <small>{t("primary.resolution")}</small>
            <WorkspaceStatus tone={resolutionTone(currentAssertion?.resolution_state ?? "unresolved")}>
              {t(`resolution.${currentAssertion?.resolution_state ?? "unresolved"}`)}
            </WorkspaceStatus>
          </div>
          {operator.inclusion.quality_score != null ? (
            <div>
              <small>{t("primary.quality")}</small>
              <strong>{operator.inclusion.quality_score}</strong>
            </div>
          ) : null}
        </div>
        {operator.inclusion.exclusion_reason ? <p>{friendlyQualityReason(operator.inclusion.exclusion_reason, t)}</p> : null}
        {currentAssertion ? (
          <dl className="admin-mention-operator__primary-meta">
            <OperatorDatum label={t("semantic.review")} value={t(`review.${currentAssertion.review_status}`)} />
            <OperatorDatum label={t("semantic.eligibility")} value={t(`eligibility.${currentAssertion.eligibility_status}`)} />
            <OperatorDatum label={t("semantic.confidence")} value={percent(currentAssertion.confidence)} />
            <OperatorDatum label={t("semantic.approval")} value={approvalLabel(currentAssertion, t)} />
          </dl>
        ) : null}
        {qualityFlags.length > 0 ? (
          <div className="admin-mention-operator__chips">
            {qualityFlags.map((flag) => <span key={flag}>{friendlyQualityReason(flag, t)}</span>)}
          </div>
        ) : null}
      </OperatorSection>
    </div>
  );
}

export function AdminMentionOperatorTechnicalPanel({
  operator
}: {
  operator: SignalAdminMentionOperatorV1 | null;
}) {
  const t = useTranslations("AdminWorkspace.data.mentions.operator");
  const locale = useLocale();
  if (!operator) return null;

  const superseded = operator.semantic.history.filter((assertion) => !assertion.is_current);
  const taxonomyGroups = groupOperatorTags(operator.enrichment.tags);
  const traceCount = operator.provenance.imports.length
    + operator.provenance.studies.length
    + operator.operational.populations.length
    + operator.enrichment.tags.length
    + operator.enrichment.entities.length
    + operator.enrichment.features.length
    + operator.triggers_barriers.codings.length
    + operator.triggers_barriers.evidence_and_releases.length
    + operator.governance.history.length;

  return (
    <details className="signal-v2-mention-drawer__section admin-mention-technical">
      <summary>
        <span>
          <strong>{t("technical.title")}</strong>
          <small>{t("technical.summary")}</small>
        </span>
        <span>{traceCount}</span>
        <CaretDown aria-hidden size={14} />
      </summary>
      <div className="admin-mention-technical__body">
        {(operator.provenance.imports.length > 0 || operator.provenance.studies.length > 0) ? (
          <TechnicalGroup title={t("provenance.title")}>
            {operator.provenance.imports.map((item) => (
              <OperatorTimelineItem
                key={item.membership_id}
                meta={`${friendlySourceType(item.source_type, t)} · ${friendlyImportStatus(item.import_status, t)} · ${formatDate(item.imported_at, locale)}`}
                title={friendlySourceName(item.source_name, item.provider, t)}
              />
            ))}
            {operator.provenance.studies.map((item) => (
              <OperatorTimelineItem
                key={item.membership_id}
                meta={`${friendlyMembershipRole(item.membership_role, t)} · ${formatDate(item.created_at, locale)}`}
                title={t("provenance.study", { name: item.study_name })}
              />
            ))}
          </TechnicalGroup>
        ) : null}

        {operator.operational.populations.length > 0 ? (
          <TechnicalGroup title={t("populations.title")}>
            {operator.operational.populations.map((population) => (
              <article className="admin-mention-operator__record" key={population.population_id}>
                <header>
                  <strong>{friendlyPopulationName(population.population_key, t)}</strong>
                  <WorkspaceStatus tone={populationTone(population.membership_status)}>
                    {friendlyMembershipStatus(population.membership_status, t)}
                  </WorkspaceStatus>
                </header>
                <p>{t("populations.version", { version: population.version })} · {friendlyPopulationPurpose(population.purpose, t)}</p>
                <small>{population.is_current_pointer ? t("populations.visible") : friendlyPopulationStatus(population.population_status, t)}</small>
                <details className="admin-mention-operator__details">
                  <summary>{t("technical.identifiers")}</summary>
                  <div><code>{population.population_key}</code></div>
                </details>
              </article>
            ))}
          </TechnicalGroup>
        ) : null}

        {(taxonomyGroups.length > 0 || operator.enrichment.entities.length > 0) ? (
          <TechnicalGroup title={t("enrichment.title")}>
            {taxonomyGroups.map(([taxonomy, tags]) => (
              <OperatorGroup key={taxonomy} label={`${friendlyTaxonomy(taxonomy, t)} · ${tags.length}`}>
                {tags.map((tag) => <span key={tag.id}>{tag.label}</span>)}
              </OperatorGroup>
            ))}
            {operator.enrichment.entities.length > 0 ? (
              <OperatorGroup label={t("enrichment.entities")}>
                {operator.enrichment.entities.map((entity) => (
                  <span key={entity.id}>{entity.canonical_name} · {pretty(entity.entity_type)}</span>
                ))}
              </OperatorGroup>
            ) : null}
          </TechnicalGroup>
        ) : null}

        {operator.enrichment.features.length > 0 ? (
          <TechnicalGroup title={t("technical.features")}>
            <div className="admin-mention-technical__features">
              {operator.enrichment.features.map((feature) => (
                <details key={feature.id}>
                  <summary>
                    <span><strong>{friendlyFeatureName(feature.feature_key, t)}</strong><small>{feature.source ? friendlyTechnicalSource(feature.source, t) : t("technical.persisted")}</small></span>
                    <CaretDown aria-hidden size={13} />
                  </summary>
                  <TechnicalValue value={feature.feature_value} t={t} />
                </details>
              ))}
            </div>
          </TechnicalGroup>
        ) : null}

        {(operator.triggers_barriers.codings.length > 0 || operator.triggers_barriers.evidence_and_releases.length > 0) ? (
          <TechnicalGroup title={t("technical.tbTrace")}>
            {operator.triggers_barriers.codings.map((coding) => (
              <OperatorTimelineItem
                key={coding.id}
                meta={`${pretty(coding.layer)} · ${pretty(coding.analysis_status)}${coding.emergent_tags?.length ? ` · ${coding.emergent_tags.join(", ")}` : ""}`}
                title={pretty(coding.polarity)}
              />
            ))}
            {operator.triggers_barriers.evidence_and_releases.map((evidence) => (
              <OperatorTimelineItem
                key={evidence.citation_id}
                meta={`${pretty(evidence.release_status)} · ${evidence.is_current_release ? t("tb.currentRelease") : t("tb.historicalRelease")}`}
                title={evidence.report_key ?? t("tb.finding")}
              />
            ))}
          </TechnicalGroup>
        ) : null}

        {(superseded.length > 0 || operator.semantic.review_events.length > 0) ? (
          <TechnicalGroup title={t("semantic.historyTitle")}>
            {superseded.map((assertion) => (
              <OperatorTimelineItem
                key={assertion.id}
                meta={t("semantic.version", { version: assertion.assertion_version })}
                title={`${pretty(assertion.scope)} · ${t(`resolution.${assertion.resolution_state}`)}`}
              />
            ))}
            {operator.semantic.review_events.map((event) => (
              <OperatorTimelineItem
                key={event.id}
                meta={`${event.reviewer_display_name ?? t("systemActor")} · ${formatDate(event.created_at, locale)}`}
                title={pretty(event.action)}
              />
            ))}
          </TechnicalGroup>
        ) : null}

        {operator.governance.history.length > 0 ? (
          <TechnicalGroup title={t("governance.history")}>
            {operator.governance.history.map((event) => (
              <OperatorTimelineItem
                key={event.id}
                meta={`${event.actor_display_name ?? t("systemActor")} · ${formatDate(event.created_at, locale)}`}
                title={`${pretty(event.action)} · ${event.reason}`}
              />
            ))}
          </TechnicalGroup>
        ) : null}

        {operator.author ? (
          <TechnicalGroup title={t("author.title")}>
            <dl className="admin-mention-operator__grid">
              <OperatorDatum label={t("author.name")} value={operator.author.display_name || operator.author.handle || "—"} />
              <OperatorDatum label={t("author.platform")} value={pretty(operator.author.platform)} />
              <OperatorDatum label={t("author.followers")} value={operator.author.follower_count == null ? "—" : new Intl.NumberFormat(locale).format(operator.author.follower_count)} />
              <OperatorDatum label={t("author.country")} value={operator.author.country || "—"} />
              <OperatorDatum label={t("author.verified")} value={yesNo(operator.author.is_verified, t)} />
              <OperatorDatum label={t("author.business")} value={yesNo(operator.author.is_business, t)} />
            </dl>
          </TechnicalGroup>
        ) : null}

        <TechnicalGroup title={t("canonical.title")}>
          <details className="admin-mention-operator__details">
            <summary>{t("canonical.aliases", { count: operator.canonical.aliases.length })}</summary>
            <div>
              {operator.canonical.aliases.map((alias) => (
                <OperatorTimelineItem
                  key={alias.mention_id}
                  meta={`${pretty(alias.source_system)} · ${pretty(alias.platform)} · ${formatDate(alias.created_at, locale)}`}
                  title={alias.is_canonical ? t("canonical.root") : t("canonical.alias")}
                />
              ))}
            </div>
          </details>
        </TechnicalGroup>
      </div>
    </details>
  );
}

function OperatorSection({ children, count, title }: { children: ReactNode; count?: number; title: string }) {
  return (
    <section className="signal-v2-mention-drawer__section admin-mention-operator__section">
      <div className="signal-v2-mention-drawer__section-title">
        <h3>{title}</h3>
        {count != null ? <span>{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

function OperatorDatum({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function OperatorTimelineItem({ meta, title }: { meta: string; title: string }) {
  return <div className="admin-mention-operator__timeline"><strong>{title}</strong><small>{meta}</small></div>;
}

function OperatorGroup({ children, label }: { children: ReactNode; label: string }) {
  return <div className="admin-mention-operator__group"><strong>{label}</strong><div>{children}</div></div>;
}

function TechnicalGroup({ children, title }: { children: ReactNode; title: string }) {
  return <section className="admin-mention-technical__group"><h4>{title}</h4><div>{children}</div></section>;
}

function TechnicalValue({
  t,
  value
}: {
  t: ReturnType<typeof useTranslations>;
  value: unknown;
}) {
  const rows = technicalRows(value, t);
  if (rows.length === 0) return <p className="admin-mention-operator__empty">—</p>;
  return (
    <dl className="admin-mention-technical__values">
      {rows.map((row, index) => <div key={`${row.label}:${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl>
  );
}

function technicalRows(
  value: unknown,
  t: ReturnType<typeof useTranslations>,
  prefix = "",
  depth = 0
): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ label: t("technical.value"), value: technicalScalar(value, t) }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const label = `${prefix}${pretty(key)}`;
    if (item && typeof item === "object" && !Array.isArray(item) && depth < 1) {
      return technicalRows(item, t, `${label} · `, depth + 1);
    }
    return [{ label, value: technicalScalar(item, t) }];
  });
}

function technicalScalar(value: unknown, t: ReturnType<typeof useTranslations>): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") {
    if (value === "data_os_backfill_deterministic" || value === "sentione_csv") {
      return friendlyTechnicalSource(value, t);
    }
    return pretty(value);
  }
  if (Array.isArray(value)) {
    const primitives = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
    if (primitives.length === value.length && value.length <= 8) {
      return primitives.map((item) => technicalScalar(item, t)).join(", ");
    }
    return t("technical.values", { count: value.length });
  }
  if (typeof value === "object") {
    return t("technical.fields", { count: Object.keys(value as Record<string, unknown>).length });
  }
  return "—";
}

function groupOperatorTags(tags: OperatorTag[]) {
  const groups = new Map<string, OperatorTag[]>();
  for (const tag of tags) {
    const current = groups.get(tag.taxonomy_key) ?? [];
    if (!current.some((item) => item.label === tag.label)) current.push(tag);
    groups.set(tag.taxonomy_key, current);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function friendlyTaxonomy(value: string, t: ReturnType<typeof useTranslations>) {
  const key = ({
    audience: "audience",
    barrier: "barrier",
    content_format: "contentFormat",
    demographic: "demographic",
    emotion: "emotion",
    journey_stage: "journeyStage",
    sentiment_polarity: "sentiment",
    source_type: "sourceType",
    trigger: "trigger",
    value_perception: "valuePerception"
  } as Record<string, string>)[value];
  return key ? t(`taxonomies.${key}`) : pretty(value);
}

function friendlySourceName(
  name: string,
  provider: string | null,
  t: ReturnType<typeof useTranslations>
) {
  if (provider === "legacy-import" || name.toLowerCase().includes("legacy corpus")) {
    return t("provenance.legacy");
  }
  return name;
}

function friendlySourceType(value: string, t: ReturnType<typeof useTranslations>) {
  return value.toLowerCase().replaceAll("_", "-") === "social-listening"
    ? t("provenance.socialListening")
    : pretty(value);
}

function friendlyImportStatus(value: string, t: ReturnType<typeof useTranslations>) {
  const normalized = value.toLowerCase();
  if (normalized === "completed") return t("provenance.completed");
  if (normalized === "pending") return t("provenance.pending");
  if (normalized === "failed") return t("provenance.failed");
  return pretty(value);
}

function friendlyMembershipRole(value: string | null, t: ReturnType<typeof useTranslations>) {
  if (value?.toLowerCase() === "contributed") return t("provenance.contributed");
  return pretty(value);
}

function friendlyPopulationName(value: string, t: ReturnType<typeof useTranslations>) {
  return value === "primary-brand-operational" ? t("populations.primaryBrand") : pretty(value);
}

function friendlyPopulationPurpose(value: string, t: ReturnType<typeof useTranslations>) {
  return value.toLowerCase() === "operational" ? t("populations.operational") : pretty(value);
}

function friendlyPopulationStatus(value: string, t: ReturnType<typeof useTranslations>) {
  const normalized = value.toLowerCase();
  if (normalized === "draft") return t("populations.draft");
  if (normalized === "active" || normalized === "published") return t("populations.published");
  return pretty(value);
}

function friendlyMembershipStatus(value: string, t: ReturnType<typeof useTranslations>) {
  const normalized = value.toLowerCase();
  if (normalized === "active" || normalized === "included") return t("populations.included");
  if (normalized === "excluded" || normalized === "removed") return t("populations.excluded");
  return pretty(value);
}

function populationTone(value: string): "neutral" | "success" | "warning" {
  const normalized = value.toLowerCase();
  if (normalized === "active" || normalized === "included") return "success";
  if (normalized === "pending") return "warning";
  return "neutral";
}

function friendlyFeatureName(value: string, t: ReturnType<typeof useTranslations>) {
  const normalized = value.toLowerCase();
  if (normalized === "mention_operational_context") return t("technical.operationalContext");
  if (normalized.startsWith("signal_taxonomy_classification")) return t("technical.taxonomyClassification");
  if (normalized === "tb_coding") return t("technical.tbCoding");
  return pretty(value);
}

function friendlyTechnicalSource(value: string, t: ReturnType<typeof useTranslations>) {
  if (value === "data_os_backfill_deterministic") return t("technical.dataOsBackfill");
  if (value === "sentione_csv") return t("technical.sentioneImport");
  return pretty(value);
}

function friendlyQualityReason(value: string, t: ReturnType<typeof useTranslations>) {
  if (value === "text_under_30_chars") return t("quality.textTooShort");
  if (value === "missing_date") return t("quality.missingDate");
  return pretty(value);
}

function inclusionTone(value: string): "danger" | "neutral" | "success" | "warning" {
  if (value === "included") return "success";
  if (value === "excluded") return "danger";
  return "warning";
}

function resolutionTone(value: string): "danger" | "neutral" | "success" | "warning" {
  if (value === "approved_by_human" || value === "approved_by_model" || value === "approved_by_policy") return "success";
  if (value === "rejected") return "danger";
  if (value === "pending") return "warning";
  return "neutral";
}

function percent(value: string | number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : "—";
}

function approvalLabel(assertion: OperatorAssertion, t: ReturnType<typeof useTranslations>) {
  const source = assertion.approved_by_display_name || assertion.approval_source;
  return source ? `${pretty(source)} · ${t(`resolution.${assertion.resolution_state}`)}` : t(`resolution.${assertion.resolution_state}`);
}

function yesNo(value: boolean | null, t: ReturnType<typeof useTranslations>) {
  if (value == null) return "—";
  return value ? t("yes") : t("no");
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function pretty(value: string | null | undefined) {
  if (!value) return "—";
  return value.replaceAll("_", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function operatorValueList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" ? [item] : []);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => Boolean(item))
    .map(([key]) => key);
}
