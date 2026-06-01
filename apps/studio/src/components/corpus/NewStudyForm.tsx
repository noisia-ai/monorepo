"use client";

import { type ChangeEvent, type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { INDUSTRY_OPTIONS, subindustriesForIndustry } from "@/lib/industry-catalog";

type BrandOption = {
  id: string;
  name: string;
  displayName: string | null;
  industry: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
};

type MethodologyOption = {
  id: string;
  slug: string;
  name: string;
  version: string;
};

type KnowledgeSource = {
  id: string;
  title: string;
  file_name: string | null;
  file_size_bytes: number | null;
  status: string;
  error_message: string | null;
  summary: string;
  file_understanding: string;
  dataset_inventory: string[];
  query_language: string[];
};

type Draft = {
  studyName: string;
  brandId: string;
  methodologyId: string;
  businessQuestion: string;
  decisionToInform: string;
  audienceSegment: string;
  categoryContext: string;
  hypotheses: string;
  competitiveContext: string;
  knownBarriers: string;
  knownTriggers: string;
  strategicConstraints: string;
  successCriteria: string;
  geoFocus: string;
  targetWindowMonths: string;
  sourceKind: string;
};

type InlineBrand = {
  organizationName: string;
  name: string;
  displayName: string;
  slug: string;
  industry: string;
  industrySub: string;
  countries: string;
  seedHandles: string;
  competitors: string;
  knowledgeNotes: string;
};

type FieldErrors = Partial<Record<string, string>>;

type NewStudyFormProps = {
  brands: BrandOption[];
  methodologies: MethodologyOption[];
  defaultBrandId?: string;
};

const steps = [
  { key: "brand", label: "Marca" },
  { key: "objective", label: "Objetivo" },
  { key: "sources", label: "Fuentes" },
  { key: "brief", label: "Brief" },
  { key: "launch", label: "Launch" }
];
const MAX_KNOWLEDGE_FILES = 20;
const KNOWLEDGE_ACCEPT = ".xlsx,.xls,.csv,.tsv,.txt,.json,.md,text/plain,text/csv,application/json,text/markdown,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function NewStudyForm({ brands, methodologies, defaultBrandId }: NewStudyFormProps) {
  const t = useTranslations("NewStudy");
  const router = useRouter();
  const defaultMethodology = methodologies.find((item) => item.slug === "triggers-barriers") ?? methodologies[0];
  const defaultBrand = useMemo(
    () => brands.find((brand) => brand.id === defaultBrandId) ?? brands[0],
    [brands, defaultBrandId]
  );
  const [step, setStep] = useState(0);
  const [brandMode, setBrandMode] = useState<"existing" | "new">(brands.length > 0 ? "existing" : "new");
  const [draft, setDraft] = useState<Draft>({
    studyName: defaultBrand ? `${defaultBrand.displayName ?? defaultBrand.name} · Triggers & Barriers` : "",
    brandId: defaultBrand?.id ?? "",
    methodologyId: defaultMethodology?.id ?? "",
    businessQuestion: "",
    decisionToInform: "",
    audienceSegment: "",
    categoryContext: "",
    hypotheses: "",
    competitiveContext: "",
    knownBarriers: "",
    knownTriggers: "",
    strategicConstraints: "",
    successCriteria: "",
    geoFocus: "MX",
    targetWindowMonths: "12",
    sourceKind: "spreadsheet_archive"
  });
  const [inlineBrand, setInlineBrand] = useState<InlineBrand>({
    organizationName: "",
    name: "",
    displayName: "",
    slug: "",
    industry: "",
    industrySub: "",
    countries: "MX",
    seedHandles: "",
    competitors: "",
    knowledgeNotes: ""
  });
  const [files, setFiles] = useState<File[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [createdCorpusId, setCreatedCorpusId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBrand = brands.find((brand) => brand.id === draft.brandId) ?? null;
  const selectedMethodology = methodologies.find((methodology) => methodology.id === draft.methodologyId) ?? defaultMethodology;
  const failedSourceCount = knowledgeSources.filter((source) => source.status === "failed").length;
  const brandLabel = brandMode === "new"
    ? inlineBrand.displayName || inlineBrand.name || t("rail.newBrand")
    : selectedBrand
      ? selectedBrand.displayName ?? selectedBrand.name
      : t("rail.noBrand");

  function updateDraft(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function updateInlineBrand(key: keyof InlineBrand, value: string) {
    setFieldErrors((current) => ({ ...current, [`brand.${key}`]: undefined }));
    setInlineBrand((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !current.slug) {
        next.slug = slugify(value);
      }
      return next;
    });
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    if (incoming.length === 0) return;

    let duplicateCount = 0;
    let overflowCount = 0;
    const nextFiles = [...files];
    const known = new Set(files.map(fileKey));
    for (const file of incoming) {
      const key = fileKey(file);
      if (known.has(key)) {
        duplicateCount += 1;
        continue;
      }
      if (nextFiles.length >= MAX_KNOWLEDGE_FILES) {
        overflowCount += 1;
        continue;
      }
      known.add(key);
      nextFiles.push(file);
    }
    setFiles(nextFiles);

    event.target.value = "";
    if (overflowCount > 0) {
      setFileNotice(t("sources.maxReached", { max: MAX_KNOWLEDGE_FILES, count: overflowCount }));
    } else if (duplicateCount > 0) {
      setFileNotice(t("sources.duplicatesSkipped", { count: duplicateCount }));
    } else {
      setFileNotice(null);
    }
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)));
    setFileNotice(null);
  }

  function validateThroughStep(maxStep: number) {
    const errors: FieldErrors = {};
    let firstInvalidStep = maxStep;

    const addError = (stepIndex: number, key: string, message: string) => {
      if (!errors[key]) errors[key] = message;
      firstInvalidStep = Math.min(firstInvalidStep, stepIndex);
    };

    if (maxStep >= 0) {
      if (brandMode === "existing") {
        if (!draft.brandId) addError(0, "brandId", t("validation.brand"));
        if (!draft.methodologyId) addError(0, "methodologyId", t("validation.methodology"));
      } else {
        if (inlineBrand.name.trim().length < 2) addError(0, "brand.name", t("validation.brandName"));
        if (inlineBrand.organizationName.trim().length < 2) addError(0, "brand.organizationName", t("validation.organization"));
      }
    }

    if (maxStep >= 1) {
      if (draft.studyName.trim().length < 3) addError(1, "studyName", t("validation.studyName"));
      if (draft.businessQuestion.trim().length < 10) {
        addError(1, "businessQuestion", t("validation.businessQuestion"));
      }
    }

    const ok = Object.keys(errors).length === 0;
    return {
      ok,
      errors,
      firstInvalidStep: ok ? maxStep : firstInvalidStep,
      message: ok ? "" : t("validation.completeMarked")
    };
  }

  function goToStep(nextStep: number) {
    setError(null);
    if (nextStep <= step) {
      setStep(nextStep);
      return;
    }

    const validation = validateThroughStep(nextStep - 1);
    setFieldErrors(validation.errors);
    if (!validation.ok) {
      setStep(validation.firstInvalidStep);
      setError(validation.message);
      return;
    }
    setStep(nextStep);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const validation = validateThroughStep(3);
    setFieldErrors(validation.errors);
    if (!validation.ok) {
      setStep(validation.firstInvalidStep);
      setError(validation.message);
      return;
    }
    setIsSubmitting(true);
    setKnowledgeSources([]);
    setEngineUrl(null);
    setCreatedCorpusId(null);

    try {
      let brandId = draft.brandId;
      if (brandMode === "new") {
        setProgressLabel(t("progress.creatingBrand"));
        brandId = await createInlineBrand(inlineBrand, {
          fallback: t("progress.fallbackBrandError"),
          fieldFallback: t("progress.fieldFallback"),
          invalidFallback: t("progress.invalidFallback")
        });
      }

      setProgressLabel(t("progress.creatingStudy"));
      const studyPayload = buildStudyPayload(draft, brandId);
      const res = await fetch("/api/corpora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studyPayload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json, t("progress.fallbackStudyError")));
      const corpusId = String(json.data?.id ?? "");
      if (!corpusId) throw new Error(t("progress.fallbackStudyError"));
      setCreatedCorpusId(corpusId);
      setEngineUrl(json.data.engine_url);

      if (files.length > 0) {
        await uploadKnowledgeFiles(corpusId);
      }

      setStep(4);
      setProgressLabel(t("progress.readyEngine"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("progress.fallbackStudyError"));
      setProgressLabel(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function uploadKnowledgeFiles(corpusId: string) {
    setProgressLabel(t("progress.uploadingKnowledge"));
    const upload = new FormData();
    upload.set("source_kind", draft.sourceKind);
    for (const file of files) upload.append("files", file);
    const uploadRes = await fetch(`/api/corpora/${corpusId}/knowledge`, {
      method: "POST",
      body: upload
    });
    const uploadJson = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) throw new Error(uploadJson?.message ?? t("progress.fallbackKnowledgeProcessError"));
    if (uploadJson.job_id) {
      const waitResult = await waitForJob(uploadJson.job_id, setProgressLabel, {
        fallbackJobReadError: t("progress.fallbackJobReadError"),
        knowledgeReady: t("progress.knowledgeReady"),
        knowledgeFailed: t("progress.knowledgeFailed"),
        knowledgeTimeout: t("progress.knowledgeTimeout"),
        analyzingKnowledge: (progress) => t("progress.analyzingKnowledge", { progress })
      });
      if (waitResult === "timeout") {
        setError(t("progress.knowledgeTimeout"));
      }
    }
    const sources = await fetchKnowledgeSources(corpusId, t("progress.fallbackKnowledgeReadError"));
    setKnowledgeSources(sources);
  }

  async function retryKnowledgeUpload() {
    if (!createdCorpusId || files.length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await uploadKnowledgeFiles(createdCorpusId);
      setProgressLabel(t("progress.readyEngine"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("progress.fallbackKnowledgeProcessError"));
      setProgressLabel(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="study-wizard-shell" onSubmit={onSubmit}>
      <aside className="study-wizard-rail" aria-label={t("rail.aria")}>
        <div>
          <p className="vitals-eyebrow">{t("rail.eyebrow")}</p>
          <h2>{draft.studyName || t("rail.fallbackTitle")}</h2>
          <p>{brandLabel} · {selectedMethodology?.name ?? t("rail.methodology")}</p>
        </div>
        <ol className="study-step-list">
          {steps.map((item, index) => (
            <li key={item.key}>
              <button
                className={`study-step${index === step ? " study-step--active" : ""}${index < step ? " study-step--done" : ""}`}
                type="button"
                onClick={() => goToStep(index)}
                disabled={isSubmitting}
              >
                <span>{index + 1}</span>
                {t(`steps.${item.key}`)}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="study-wizard-stage">
        {step === 0 && (
          <WizardPanel eyebrow={t("brand.eyebrow")} title={t("brand.title")}>
            <div className="study-mode-switch">
              <button
                className={brandMode === "existing" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setBrandMode("existing")}
                disabled={brands.length === 0}
              >
                {t("brand.existing")}
              </button>
              <button
                className={brandMode === "new" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setBrandMode("new")}
              >
                {t("brand.create")}
              </button>
            </div>

            {brandMode === "existing" ? (
              <div className="new-study-grid">
                <Field label={t("brief.brand")}>
                  <select className="filter-input new-study-input" value={draft.brandId} onChange={(event) => updateDraft("brandId", event.target.value)} required>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.displayName ?? brand.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.brandId && <small className="new-study-field-error">{fieldErrors.brandId}</small>}
                </Field>
                <Field label={t("brand.methodology")}>
                  <select className="filter-input new-study-input" value={draft.methodologyId} onChange={(event) => updateDraft("methodologyId", event.target.value)} required>
                    {methodologies.map((methodology) => (
                      <option key={methodology.id} value={methodology.id}>
                        {methodology.name} · {methodology.version}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.methodologyId && <small className="new-study-field-error">{fieldErrors.methodologyId}</small>}
                </Field>
              </div>
            ) : (
              <>
                <div className="new-study-grid">
                  <TextField label={t("brief.brand")} value={inlineBrand.name} onChange={(value) => updateInlineBrand("name", value)} error={fieldErrors["brand.name"]} required />
                  <TextField label={t("brand.organization")} value={inlineBrand.organizationName} onChange={(value) => updateInlineBrand("organizationName", value)} error={fieldErrors["brand.organizationName"]} required />
                  <TextField label={t("brand.displayName")} value={inlineBrand.displayName} onChange={(value) => updateInlineBrand("displayName", value)} />
                  <TextField label={t("brand.slug")} value={inlineBrand.slug} onChange={(value) => updateInlineBrand("slug", value)} />
                  <TextField
                    label={t("brand.industry")}
                    value={inlineBrand.industry}
                    onChange={(value) => updateInlineBrand("industry", value)}
                    placeholder={t("brand.industryPlaceholder")}
                    list="wizard-industry-options"
                  />
                  <TextField
                    label={t("brand.subindustry")}
                    value={inlineBrand.industrySub}
                    onChange={(value) => updateInlineBrand("industrySub", value)}
                    placeholder={t("brand.subindustryPlaceholder")}
                    list="wizard-subindustry-options"
                  />
                </div>
                <datalist id="wizard-industry-options">
                  {INDUSTRY_OPTIONS.map((industry) => <option key={industry} value={industry} />)}
                </datalist>
                <datalist id="wizard-subindustry-options">
                  {subindustriesForIndustry(inlineBrand.industry).map((subindustry) => (
                    <option key={subindustry} value={subindustry} />
                  ))}
                </datalist>
                <div className="new-study-grid">
                  <TextAreaField label={t("brand.aliases")} value={inlineBrand.seedHandles} onChange={(value) => updateInlineBrand("seedHandles", value)} placeholder={t("brand.aliasesPlaceholder")} compact />
                  <TextAreaField
                    label={t("brand.competitors")}
                    value={inlineBrand.competitors}
                    onChange={(value) => updateInlineBrand("competitors", value)}
                    placeholder={"Ulta Beauty\nLiverpool\nPalacio de Hierro\nSally Beauty"}
                    hint={t("brand.competitorsHint")}
                    compact
                  />
                </div>
                <TextAreaField label={t("brand.marketNotes")} value={inlineBrand.knowledgeNotes} onChange={(value) => updateInlineBrand("knowledgeNotes", value)} placeholder={t("brand.marketNotesPlaceholder")} />
              </>
            )}
          </WizardPanel>
        )}

        {step === 1 && (
          <WizardPanel eyebrow={t("objective.eyebrow")} title={t("objective.title")}>
            <TextField label={t("objective.studyName")} value={draft.studyName} onChange={(value) => updateDraft("studyName", value)} error={fieldErrors.studyName} required />
            <TextAreaField label={t("objective.businessQuestion")} value={draft.businessQuestion} onChange={(value) => updateDraft("businessQuestion", value)} error={fieldErrors.businessQuestion} required placeholder={t("objective.businessQuestionPlaceholder")} />
            <div className="new-study-grid">
              <TextField label={t("objective.decision")} value={draft.decisionToInform} onChange={(value) => updateDraft("decisionToInform", value)} placeholder={t("objective.decisionPlaceholder")} />
              <TextField label={t("objective.audience")} value={draft.audienceSegment} onChange={(value) => updateDraft("audienceSegment", value)} placeholder={t("objective.audiencePlaceholder")} />
            </div>
            <TextAreaField label={t("objective.categoryContext")} value={draft.categoryContext} onChange={(value) => updateDraft("categoryContext", value)} compact />
            <TextAreaField label={t("objective.competitiveContext")} value={draft.competitiveContext} onChange={(value) => updateDraft("competitiveContext", value)} placeholder={t("objective.competitiveContextPlaceholder")} />
            <div className="new-study-grid">
              <TextAreaField label={t("objective.hypotheses")} value={draft.hypotheses} onChange={(value) => updateDraft("hypotheses", value)} compact />
              <TextAreaField label={t("objective.constraints")} value={draft.strategicConstraints} onChange={(value) => updateDraft("strategicConstraints", value)} compact />
              <TextAreaField label={t("objective.knownBarriers")} value={draft.knownBarriers} onChange={(value) => updateDraft("knownBarriers", value)} compact />
              <TextAreaField label={t("objective.knownTriggers")} value={draft.knownTriggers} onChange={(value) => updateDraft("knownTriggers", value)} compact />
            </div>
            <TextAreaField label={t("objective.success")} value={draft.successCriteria} onChange={(value) => updateDraft("successCriteria", value)} compact />
            <div className="new-study-grid new-study-grid--compact">
              <TextField label={t("objective.countries")} value={draft.geoFocus} onChange={(value) => updateDraft("geoFocus", value)} />
              <Field label={t("objective.window")}>
                <select className="filter-input new-study-input" value={draft.targetWindowMonths} onChange={(event) => updateDraft("targetWindowMonths", event.target.value)}>
                  <option value="3">{t("objective.months", { count: 3 })}</option>
                  <option value="6">{t("objective.months", { count: 6 })}</option>
                  <option value="12">{t("objective.months", { count: 12 })}</option>
                  <option value="18">{t("objective.months", { count: 18 })}</option>
                  <option value="24">{t("objective.months", { count: 24 })}</option>
                </select>
              </Field>
            </div>
          </WizardPanel>
        )}

        {step === 2 && (
          <WizardPanel eyebrow={t("sources.eyebrow")} title={t("sources.title")}>
            <div className="new-study-grid">
              <Field label={t("sources.type")}>
                <select className="filter-input new-study-input" value={draft.sourceKind} onChange={(event) => updateDraft("sourceKind", event.target.value)}>
                  <option value="spreadsheet_archive">{t("sources.types.spreadsheetArchive")}</option>
                  <option value="social_archive">{t("sources.types.socialArchive")}</option>
                  <option value="brand_document">{t("sources.types.brandDocument")}</option>
                  <option value="research_deck">{t("sources.types.researchDeck")}</option>
                  <option value="search_data">{t("sources.types.searchData")}</option>
                  <option value="scraper_export">{t("sources.types.scraperExport")}</option>
                </select>
              </Field>
              <div className="new-study-field new-study-file-field">
                <span>{t("sources.files")}</span>
                <div className="new-study-file-uploader">
                  <div>
                    <strong>{t("sources.dropTitle")}</strong>
                    <p>{t("sources.dropHint", { max: MAX_KNOWLEDGE_FILES })}</p>
                  </div>
                  <button className="new-study-file-button" type="button" onClick={() => fileInputRef.current?.click()}>
                    <Icon name="upload" size={15} /> {t("sources.addFiles")}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  className="new-study-file-input"
                  type="file"
                  multiple
                  accept={KNOWLEDGE_ACCEPT}
                  onChange={onFiles}
                />
                <small className="new-study-file-count">
                  {t("sources.selectedCount", { count: files.length, max: MAX_KNOWLEDGE_FILES })}
                </small>
                {fileNotice && <small className="new-study-field-error">{fileNotice}</small>}
              </div>
            </div>
            <div className="knowledge-file-list">
              {files.length === 0 ? (
                <p>{t("sources.empty")}</p>
              ) : (
                files.map((file) => (
                  <div className="knowledge-file-row" key={`${file.name}-${file.size}`}>
                    <Icon name="upload" size={15} />
                    <span>{file.name}</span>
                    <code>{formatBytes(file.size)}</code>
                    <button type="button" className="knowledge-file-remove" onClick={() => removeFile(file)} aria-label={t("sources.removeFile", { name: file.name })}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </WizardPanel>
        )}

        {step === 3 && (
          <WizardPanel eyebrow={t("brief.eyebrow")} title={t("brief.title")}>
            <BriefPreview draft={draft} brandLabel={brandLabel} methodology={selectedMethodology?.name ?? "Triggers & Barriers"} files={files} />
          </WizardPanel>
        )}

        {step === 4 && (
          <WizardPanel eyebrow={t("launch.eyebrow")} title={engineUrl ? t("launch.readyTitle") : t("launch.createTitle")}>
            {isSubmitting && (
              <div className="study-processing-card">
                <Icon name="spinner" size={18} />
                <div>
                  <strong>{progressLabel ?? t("launch.preparing")}</strong>
                  <p>{t("launch.processingCopy")}</p>
                </div>
              </div>
            )}
            {knowledgeSources.length > 0 && (
              <div className="knowledge-result-list">
                {knowledgeSources.map((source) => (
                  <article className="knowledge-result" key={source.id}>
                    <header>
                      <strong>{source.file_name ?? source.title}</strong>
                      <span>{source.status}</span>
                    </header>
                    <p>{source.status === "failed" ? source.error_message || t("launch.sourceFailedFallback") : source.summary || source.file_understanding || t("launch.sourceProcessedFallback")}</p>
                    {source.query_language.length > 0 && (
                      <div className="knowledge-tags">
                        {source.query_language.map((term) => <span key={term}>{term}</span>)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {!engineUrl && !isSubmitting && (
              <div className="launch-card">
                  <Icon name="play" size={18} />
                  <div>
                  <strong>{t("launch.ready")}</strong>
                  <p>{t("launch.readyCopy")}</p>
                </div>
              </div>
            )}
            {engineUrl && (
              <div className="launch-actions">
                {failedSourceCount > 0 && files.length > 0 && (
                  <button className="wizard-cta wizard-cta--ghost" type="button" onClick={retryKnowledgeUpload} disabled={isSubmitting}>
                    <Icon name={isSubmitting ? "spinner" : "refresh"} size={14} /> {t("launch.retrySources", { count: failedSourceCount })}
                  </button>
                )}
                <button className="wizard-cta" type="button" onClick={() => router.push(engineUrl)} disabled={isSubmitting}>
                  <Icon name="play" size={14} /> {t("launch.openEngine")}
                </button>
              </div>
            )}
          </WizardPanel>
        )}

        <footer className="new-study-actions">
          {error && (
            <p className="new-study-error">
              <Icon name="alert" size={14} /> {error}
            </p>
          )}
          {progressLabel && !error && (
            <p className="new-study-progress">
              {isSubmitting && <Icon name="spinner" size={14} />} {progressLabel}
            </p>
          )}
          {step > 0 && (
            <button className="wizard-cta wizard-cta--ghost" type="button" onClick={() => goToStep(Math.max(0, step - 1))} disabled={isSubmitting}>
              <Icon name="arrow-right" size={13} className="icon--flip" /> {t("actions.back")}
            </button>
          )}
          {step < 4 ? (
            <button className="wizard-cta" type="button" onClick={() => goToStep(Math.min(4, step + 1))} disabled={isSubmitting}>
              {t("actions.next")} <Icon name="arrow-right" size={13} />
            </button>
          ) : !engineUrl ? (
            <button className="wizard-cta" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Icon name="spinner" size={14} /> {t("actions.processing")}
                </>
              ) : (
                <>
                  <Icon name="sparkle" size={14} /> {t("actions.create")}
                </>
              )}
            </button>
          ) : null}
        </footer>
      </section>
    </form>
  );
}

function WizardPanel({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="new-study-panel study-wizard-panel">
      <div className="new-study-section-head">
        <p className="vitals-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="new-study-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  list,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  list?: string;
  error?: string;
}) {
  return (
    <Field label={label}>
      <input
        className={`filter-input new-study-input${error ? " new-study-control--error" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        list={list}
      />
      {error && <small className="new-study-field-error">{error}</small>}
    </Field>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  required,
  compact,
  hint,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  compact?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label}>
      <textarea
        className={`filter-input new-study-textarea${compact ? " new-study-textarea--short" : ""}${error ? " new-study-control--error" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
      {error && <small className="new-study-field-error">{error}</small>}
      {hint && <small className="new-study-hint">{hint}</small>}
    </Field>
  );
}

function BriefPreview({
  draft,
  brandLabel,
  methodology,
  files
}: {
  draft: Draft;
  brandLabel: string;
  methodology: string;
  files: File[];
}) {
  const t = useTranslations("NewStudy.brief");
  const items = [
    [t("brand"), brandLabel],
    [t("methodology"), methodology],
    [t("question"), draft.businessQuestion],
    [t("decision"), draft.decisionToInform],
    [t("audience"), draft.audienceSegment],
    [t("context"), draft.categoryContext],
    [t("competitive"), draft.competitiveContext],
    [t("hypotheses"), draft.hypotheses],
    [t("knownBarriers"), draft.knownBarriers],
    [t("knownTriggers"), draft.knownTriggers],
    [t("success"), draft.successCriteria],
    [t("sources"), files.length > 0 ? files.map((file) => file.name).join(", ") : t("noFiles")]
  ].filter(([, value]) => value);

  return (
    <div className="brief-preview">
      {items.map(([label, value]) => (
        <div className="brief-preview-row" key={label}>
          <span>{label}</span>
          <p>{value}</p>
        </div>
      ))}
    </div>
  );
}

async function createInlineBrand(
  brand: InlineBrand,
  labels: { fallback: string; fieldFallback: string; invalidFallback: string }
) {
  const payload = {
    organization_name: brand.organizationName,
    slug: brand.slug || slugify(brand.name),
    name: brand.name,
    display_name: brand.displayName || brand.name,
    industry: brand.industry,
    industry_sub: brand.industrySub,
    countries: splitList(brand.countries || "MX").map((item) => item.toUpperCase()),
    brand_seed_handles: extractSeeds(brand.seedHandles, 32),
    competitors: extractSeeds(brand.competitors, 24),
    knowledge_notes: withRawContext(brand.knowledgeNotes, "Competidores / research pegado", brand.competitors),
    status: "active"
  };
  const res = await fetch("/api/brands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(json, labels.fallback, labels.fieldFallback, labels.invalidFallback));
  return String(json.data.id);
}

function buildStudyPayload(draft: Draft, brandId: string) {
  return {
    name: draft.studyName,
    brand_id: brandId,
    methodology_id: draft.methodologyId,
    business_question: draft.businessQuestion,
    decision_to_inform: draft.decisionToInform,
    audience_segment: draft.audienceSegment,
    category_context: draft.categoryContext,
    hypotheses: draft.hypotheses,
    competitive_context: draft.competitiveContext,
    known_barriers: draft.knownBarriers,
    known_triggers: draft.knownTriggers,
    strategic_constraints: draft.strategicConstraints,
    success_criteria: draft.successCriteria,
    geo_focus: splitList(draft.geoFocus).map((item) => item.toUpperCase()),
    target_window_months: Number(draft.targetWindowMonths)
  };
}

async function fetchKnowledgeSources(corpusId: string, fallback: string): Promise<KnowledgeSource[]> {
  const res = await fetch(`/api/corpora/${corpusId}/knowledge`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? fallback);
  return Array.isArray(json.data) ? json.data : [];
}

async function waitForJob(
  jobId: string,
  onProgress: (label: string) => void,
  labels: {
    fallbackJobReadError: string;
    knowledgeReady: string;
    knowledgeFailed: string;
    knowledgeTimeout: string;
    analyzingKnowledge: (progress: number) => string;
  }
) {
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message ?? labels.fallbackJobReadError);
    const progress = typeof json.progress === "number" ? json.progress : 0;
    if (json.status === "completed") {
      onProgress(labels.knowledgeReady);
      return "completed";
    }
    if (json.status === "failed") {
      throw new Error(json.failed_reason ?? labels.knowledgeFailed);
    }
    onProgress(labels.analyzingKnowledge(Math.round(progress)));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  onProgress(labels.knowledgeTimeout);
  return "timeout";
}

function splitList(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSeeds(value: string, limit: number) {
  const seeds = splitList(value)
    .map(cleanSeedCandidate)
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(seeds)).slice(0, limit);
}

function cleanSeedCandidate(raw: string) {
  const tableCells = raw
    .split("|")
    .map((cell) => cell.replace(/\*\*/g, "").trim())
    .filter(Boolean);

  let item = raw;
  if (tableCells.length >= 2) {
    const firstCell = tableCells[0] ?? "";
    item = /^\d+$/.test(firstCell) ? tableCells[1] ?? firstCell : firstCell;
  }

  item = item
    .replace(/\*\*/g, "")
    .replace(/^\[\d+\]:\s*/, "")
    .replace(/^[#*\-\d.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = item.toLowerCase();
  const looksLikeContext =
    item.length > 80 ||
    /https?:\/\//i.test(item) ||
    /[\[\]{}]/.test(item) ||
    /\b(top|ranking|competidor|amenaza|por que|por qué|vistos desde|no solo|experiencia|promociones|meses sin|comunidad|destino|lujo|piel|perfumes|cabello)\b/i.test(lower);

  if (looksLikeContext || item.length < 2) return null;
  return item.slice(0, 240);
}

function withRawContext(notes: string, label: string, raw: string) {
  if (!raw) return notes;
  const section = `${label}:\n${raw}`;
  return [notes, section].filter(Boolean).join("\n\n").slice(0, 50000);
}

function formatApiError(
  json: { message?: string; details?: { fields?: Array<{ path?: string; message?: string }> } },
  fallback: string,
  fieldFallback = "field",
  invalidFallback = "invalid"
) {
  const fields = json?.details?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return json?.message ?? fallback;
  return fields
    .map((field) => `${field.path || fieldFallback}: ${field.message || invalidFallback}`)
    .join(" · ");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
