"use client";

import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { INDUSTRY_OPTIONS, subindustriesForIndustry } from "@/lib/industry-catalog";
import {
  STUDY_LENS_OPTIONS,
  buildStudyAnalysisPlan,
  defaultStudyLensSlugs,
  labelForLens
} from "@/lib/multimethod/analysis-plan";
import { slugify } from "@/lib/slug";

type BrandOption = {
  id: string;
  name: string;
  displayName: string | null;
  industry: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
};

type ThemeOption = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  industryFocus: string[] | null;
  geoFocus: string[] | null;
  organizationName: string | null;
  organizationSlug: string | null;
};

type BaselineCorpusOption = {
  id: string;
  name: string | null;
  status: string;
  themeName: string | null;
  themeSlug: string | null;
  includedCount: number;
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
  themeId: string;
  baseCorpusId: string;
  methodologyId: string;
  selectedLensSlugs: string[];
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
  activeCampaigns: string;
  allowedClaims: string;
  prohibitedClaims: string;
  runBudgetUsd: string;
};

type InlineTheme = {
  name: string;
  slug: string;
  description: string;
  industryFocus: string;
  geoFocus: string;
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
type DraftStringKey = {
  [K in keyof Draft]: Draft[K] extends string ? K : never
}[keyof Draft];

type NewStudyFormProps = {
  brands: BrandOption[];
  themes: ThemeOption[];
  baselineCorpora: BaselineCorpusOption[];
  methodologies: MethodologyOption[];
  defaultBrandId?: string;
};

const steps = [
  { key: "brand", label: "Marca" },
  { key: "objective", label: "Objetivo" },
  { key: "lenses", label: "Lentes" },
  { key: "sources", label: "Fuentes" },
  { key: "brief", label: "Brief" },
  { key: "launch", label: "Launch" }
];
const LAST_STEP_INDEX = steps.length - 1;
const MAX_KNOWLEDGE_FILES = 20;
const KNOWLEDGE_ACCEPT = ".xlsx,.xls,.csv,.tsv,.txt,.json,.md,text/plain,text/csv,application/json,text/markdown,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PERFORMANCE_ACCEPT = ".csv,text/csv,application/vnd.ms-excel";
const PERFORMANCE_RECOMMENDED_METRICS = ["spend", "impressions", "reach", "clicks", "engagement", "video_views", "conversions"];
const PERFORMANCE_MAPPING_FIELDS = [
  ["record_date", "Fecha"],
  ["external_id", "ID"],
  ["entity_name", "Nombre"],
  ["entity_kind", "Nivel"],
  ["platform", "Plataforma"],
  ["channel", "Paid / organic"],
  ["spend", "Spend"],
  ["impressions", "Impresiones"],
  ["reach", "Reach"],
  ["clicks", "Clicks"],
  ["engagement", "Engagement"],
  ["conversions", "Conversiones"],
  ["ctr", "CTR"],
  ["cpm", "CPM"],
  ["cpc", "CPC"],
  ["creative_text", "Copy"],
  ["creative_asset_ref", "Asset / URL"]
] as const;

type PerformanceMappingField = (typeof PERFORMANCE_MAPPING_FIELDS)[number][0];
type PerformanceMapping = Partial<Record<PerformanceMappingField, string>>;
type PerformancePreview = {
  mapping?: PerformanceMapping;
  stats?: {
    records_total?: number;
    records_valid?: number;
    records_failed?: number;
    duplicate_keys?: number;
    coverage_start?: string | null;
    coverage_end?: string | null;
    records_inserted?: number;
  };
  diagnostics?: {
    format?: "tabular" | "single_metric_timeseries";
    source_title?: string | null;
    detected_metrics?: string[];
    present_metrics?: string[];
    missing_recommended_metrics?: string[];
    coverage_days?: number;
    coverage_months?: number;
    messages?: string[];
  };
  warnings?: string[];
  data_source_id?: string;
  source_sync_run_id?: string;
};

export function NewStudyForm({ brands, themes, baselineCorpora, methodologies, defaultBrandId }: NewStudyFormProps) {
  const t = useTranslations("NewStudy");
  const router = useRouter();
  const defaultMethodology = methodologies.find((item) => item.slug === "triggers-barriers") ?? methodologies[0];
  const defaultBrand = useMemo(
    () => brands.find((brand) => brand.id === defaultBrandId) ?? brands[0],
    [brands, defaultBrandId]
  );
  const [step, setStep] = useState(0);
  const [subjectType, setSubjectType] = useState<"brand" | "theme">(defaultBrandId || brands.length > 0 ? "brand" : "theme");
  const [brandMode, setBrandMode] = useState<"existing" | "new">(brands.length > 0 ? "existing" : "new");
  const [themeMode, setThemeMode] = useState<"existing" | "new">(themes.length > 0 ? "existing" : "new");
  const defaultTheme = themes[0];
  const [draft, setDraft] = useState<Draft>({
    studyName: defaultBrand ? `${defaultBrand.displayName ?? defaultBrand.name} · Triggers & Barriers` : "",
    brandId: defaultBrand?.id ?? "",
    themeId: defaultTheme?.id ?? "",
    baseCorpusId: "",
    methodologyId: defaultMethodology?.id ?? "",
    selectedLensSlugs: defaultStudyLensSlugs(defaultMethodology?.slug),
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
    sourceKind: "spreadsheet_archive",
    activeCampaigns: "",
    allowedClaims: "",
    prohibitedClaims: "",
    runBudgetUsd: "5"
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
  const [inlineTheme, setInlineTheme] = useState<InlineTheme>({
    name: "",
    slug: "",
    description: "",
    industryFocus: "",
    geoFocus: "MX"
  });
  const [files, setFiles] = useState<File[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [performanceFiles, setPerformanceFiles] = useState<File[]>([]);
  const [performanceHeaders, setPerformanceHeaders] = useState<string[]>([]);
  const [performanceMapping, setPerformanceMapping] = useState<PerformanceMapping>({});
  const [performancePreview, setPerformancePreview] = useState<PerformancePreview | null>(null);
  const [performanceStatus, setPerformanceStatus] = useState<"idle" | "previewing" | "ready" | "imported" | "error">("idle");
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [createdCorpusId, setCreatedCorpusId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Tracks whether the user manually edited the study name. While untouched,
  // the name auto-derives from the current subject (brand or theme) so switching
  // subject type doesn't leave a stale default-brand name behind.
  const [studyNameTouched, setStudyNameTouched] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBrand = brands.find((brand) => brand.id === draft.brandId) ?? null;
  const selectedTheme = themes.find((theme) => theme.id === draft.themeId) ?? null;
  const selectedBaselineCorpus = baselineCorpora.find((corpus) => corpus.id === draft.baseCorpusId) ?? null;
  const selectedMethodology = methodologies.find((methodology) => methodology.id === draft.methodologyId) ?? defaultMethodology;
  const selectedLensLabels = draft.selectedLensSlugs.map(labelForLens);
  const failedSourceCount = knowledgeSources.filter((source) => source.status === "failed").length;
  const subjectLabel = subjectType === "brand"
    ? brandMode === "new"
      ? inlineBrand.displayName || inlineBrand.name || t("rail.newBrand")
      : selectedBrand
        ? selectedBrand.displayName ?? selectedBrand.name
        : t("rail.noBrand")
    : themeMode === "new"
      ? inlineTheme.name || t("rail.newTheme")
      : selectedTheme?.name ?? t("rail.noTheme");

  // Real subject name (no placeholder fallbacks) used to auto-derive the study name.
  const resolvedSubjectName = subjectType === "brand"
    ? brandMode === "new"
      ? inlineBrand.displayName || inlineBrand.name
      : selectedBrand?.displayName ?? selectedBrand?.name ?? ""
    : themeMode === "new"
      ? inlineTheme.name
      : selectedTheme?.name ?? "";
  const methodologyName = selectedMethodology?.name ?? "Triggers & Barriers";
  const isSignalPulseStudy = selectedMethodology?.slug === "signal-pulse";

  useEffect(() => {
    if (studyNameTouched) return;
    if (!resolvedSubjectName) return;
    const next = `${resolvedSubjectName} · ${methodologyName}`;
    setDraft((current) => (current.studyName === next ? current : { ...current, studyName: next }));
  }, [studyNameTouched, resolvedSubjectName, methodologyName]);

  function updateDraft(key: DraftStringKey, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function updateMethodology(methodologyId: string) {
    const methodology = methodologies.find((item) => item.id === methodologyId);
    setDraft((current) => ({
      ...current,
      methodologyId,
      selectedLensSlugs: defaultStudyLensSlugs(methodology?.slug)
    }));
    setFieldErrors((current) => ({ ...current, methodologyId: undefined }));
  }

  function toggleLens(slug: string) {
    const option = STUDY_LENS_OPTIONS.find((item) => item.slug === slug);
    if (option?.locked) return;
    setDraft((current) => {
      const selected = new Set(current.selectedLensSlugs);
      if (selected.has(slug)) {
        selected.delete(slug);
      } else {
        selected.add(slug);
      }
      selected.add("triggers-barriers");
      return { ...current, selectedLensSlugs: Array.from(selected) };
    });
    setFieldErrors((current) => ({ ...current, selectedLensSlugs: undefined }));
  }

  function updateInlineBrand(key: keyof InlineBrand, value: string) {
    setFieldErrors((current) => ({ ...current, [`brand.${key}`]: undefined }));
    setInlineBrand((current) => {
      const next = { ...current, [key]: key === "slug" ? slugify(value) : value };
      if (key === "name" && !current.slug) {
        next.slug = slugify(value);
      }
      return next;
    });
  }

  function updateInlineTheme(key: keyof InlineTheme, value: string) {
    setFieldErrors((current) => ({ ...current, [`theme.${key}`]: undefined }));
    setInlineTheme((current) => {
      const next = { ...current, [key]: key === "slug" ? slugify(value, 100) : value };
      if (key === "name" && !current.slug) {
        next.slug = slugify(value, 100);
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

  async function onPerformanceFile(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (incoming.length === 0) return;
    setPerformanceFiles(incoming);
    setPerformancePreview(null);
    setPerformanceMapping({});
    setPerformanceError(null);
    setPerformanceStatus("previewing");
    try {
      const firstText = await readPerformanceFileText(incoming[0] as File);
      setPerformanceHeaders(incoming.length === 1 ? parseCsvHeader(firstText) : []);
      const previews = await Promise.all(incoming.map((file) => previewPerformanceFile(file, {})));
      const preview = aggregatePerformancePreviews(previews);
      setPerformancePreview(preview);
      setPerformanceMapping(incoming.length === 1 ? preview.mapping ?? {} : {});
      setPerformanceStatus("ready");
    } catch (err) {
      setPerformanceStatus("error");
      setPerformanceError(err instanceof Error ? err.message : "No se pudo previsualizar el CSV de performance.");
    }
  }

  function removePerformanceFile() {
    setPerformanceFiles([]);
    setPerformanceHeaders([]);
    setPerformanceMapping({});
    setPerformancePreview(null);
    setPerformanceStatus("idle");
    setPerformanceError(null);
  }

  function updatePerformanceMapping(field: PerformanceMappingField, value: string) {
    setPerformanceMapping((current) => ({ ...current, [field]: value }));
    setPerformanceStatus((current) => current === "imported" ? "ready" : current);
  }

  async function refreshPerformancePreview() {
    if (performanceFiles.length === 0) return;
    setPerformanceError(null);
    setPerformanceStatus("previewing");
    try {
      const previews = await Promise.all(performanceFiles.map((file) => previewPerformanceFile(
        file,
        performanceFiles.length === 1 ? performanceMapping : {}
      )));
      const preview = aggregatePerformancePreviews(previews);
      setPerformancePreview(preview);
      setPerformanceMapping(performanceFiles.length === 1 ? preview.mapping ?? performanceMapping : {});
      setPerformanceStatus("ready");
    } catch (err) {
      setPerformanceStatus("error");
      setPerformanceError(err instanceof Error ? err.message : "No se pudo previsualizar el CSV de performance.");
    }
  }

  function validateThroughStep(maxStep: number) {
    const errors: FieldErrors = {};
    let firstInvalidStep = maxStep;

    const addError = (stepIndex: number, key: string, message: string) => {
      if (!errors[key]) errors[key] = message;
      firstInvalidStep = Math.min(firstInvalidStep, stepIndex);
    };

    if (maxStep >= 0) {
      if (subjectType === "brand") {
        if (brandMode === "existing") {
          if (!draft.brandId) addError(0, "brandId", t("validation.brand"));
          if (!draft.methodologyId) addError(0, "methodologyId", t("validation.methodology"));
        } else {
          if (inlineBrand.name.trim().length < 2) addError(0, "brand.name", t("validation.brandName"));
          if (inlineBrand.organizationName.trim().length < 2) addError(0, "brand.organizationName", t("validation.organization"));
        }
      } else {
        if (themeMode === "existing") {
          if (!draft.themeId) addError(0, "themeId", t("validation.theme"));
          if (!draft.methodologyId) addError(0, "methodologyId", t("validation.methodology"));
        } else {
          if (inlineTheme.name.trim().length < 2) addError(0, "theme.name", t("validation.themeName"));
          if (inlineTheme.industryFocus.trim().length < 2) addError(0, "theme.industryFocus", t("validation.industryFocus"));
        }
      }
    }

    if (maxStep >= 1) {
      if (draft.studyName.trim().length < 3) addError(1, "studyName", t("validation.studyName"));
      if (draft.businessQuestion.trim().length < 10) {
        addError(1, "businessQuestion", t("validation.businessQuestion"));
      }
    }

    if (maxStep >= 2) {
      if (isSignalPulseStudy) {
        const budget = Number(draft.runBudgetUsd);
        if (!Number.isFinite(budget) || budget <= 0) {
          addError(2, "runBudgetUsd", "Define un budget cap mayor a 0.");
        }
      } else if (!draft.selectedLensSlugs.includes("triggers-barriers")) {
        addError(2, "selectedLensSlugs", t("validation.methodology"));
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
    const validation = validateThroughStep(4);
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
      let themeId = draft.themeId;
      if (subjectType === "brand" && brandMode === "new") {
        setProgressLabel(t("progress.creatingBrand"));
        brandId = await createInlineBrand(inlineBrand, {
          fallback: t("progress.fallbackBrandError"),
          fieldFallback: t("progress.fieldFallback"),
          invalidFallback: t("progress.invalidFallback")
        });
      }
      if (subjectType === "theme" && themeMode === "new") {
        setProgressLabel(t("progress.creatingTheme"));
        themeId = await createInlineTheme(inlineTheme, {
          fallback: t("progress.fallbackThemeError"),
          fieldFallback: t("progress.fieldFallback"),
          invalidFallback: t("progress.invalidFallback")
        });
      }

      setProgressLabel(t("progress.creatingStudy"));
      const studyPayload = buildStudyPayload(
        draft,
        subjectType === "brand" ? { brandId, baseCorpusId: draft.baseCorpusId || undefined } : { themeId },
        selectedMethodology?.slug
      );
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
      if (isSignalPulseStudy && performanceFiles.length > 0) {
        await uploadPerformanceFile(corpusId);
      }

      setStep(LAST_STEP_INDEX);
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
        noWorker: t("progress.noWorker"),
        analyzingKnowledge: (progress) => t("progress.analyzingKnowledge", { progress })
      });
      if (waitResult === "timeout") {
        setError(t("progress.knowledgeTimeout"));
      }
    }
    const sources = await fetchKnowledgeSources(corpusId, t("progress.fallbackKnowledgeReadError"));
    setKnowledgeSources(sources);
  }

  async function uploadPerformanceFile(corpusId: string) {
    if (performanceFiles.length === 0) return;
    setProgressLabel(t("progress.uploadingPerformance"));
    const imported = await Promise.all(performanceFiles.map((file) => importPerformanceFile(
      corpusId,
      file,
      performanceFiles.length === 1 ? performanceMapping : {}
    )));
    setPerformancePreview(aggregatePerformancePreviews(imported));
    setPerformanceStatus("imported");
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
          <p>{subjectLabel} · {selectedMethodology?.name ?? t("rail.methodology")} · {draft.selectedLensSlugs.length} lentes en plan</p>
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
          <WizardPanel eyebrow={t("subject.eyebrow")} title={t("subject.title")}>
            <div className="study-mode-switch">
              <button
                className={subjectType === "brand" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setSubjectType("brand")}
              >
                {t("subject.brand")}
              </button>
              <button
                className={subjectType === "theme" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setSubjectType("theme")}
              >
                {t("subject.theme")}
              </button>
            </div>

            {subjectType === "brand" ? (
              <>
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
              <>
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
                    <select className="filter-input new-study-input" value={draft.methodologyId} onChange={(event) => updateMethodology(event.target.value)} required>
                      {methodologies.map((methodology) => (
                        <option key={methodology.id} value={methodology.id}>
                          {methodology.name} · {methodology.version}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.methodologyId && <small className="new-study-field-error">{fieldErrors.methodologyId}</small>}
                  </Field>
                </div>
                <BaselineCorpusField
                  baselineCorpora={baselineCorpora}
                  selectedBaselineCorpus={selectedBaselineCorpus}
                  value={draft.baseCorpusId}
                  onChange={(value) => updateDraft("baseCorpusId", value)}
                />
              </>
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
                <BaselineCorpusField
                  baselineCorpora={baselineCorpora}
                  selectedBaselineCorpus={selectedBaselineCorpus}
                  value={draft.baseCorpusId}
                  onChange={(value) => updateDraft("baseCorpusId", value)}
                />
              </>
            )}
              </>
            ) : (
              <>
                <div className="study-mode-switch">
                  <button
                    className={themeMode === "existing" ? "study-mode study-mode--active" : "study-mode"}
                    type="button"
                    onClick={() => setThemeMode("existing")}
                    disabled={themes.length === 0}
                  >
                    {t("theme.existing")}
                  </button>
                  <button
                    className={themeMode === "new" ? "study-mode study-mode--active" : "study-mode"}
                    type="button"
                    onClick={() => setThemeMode("new")}
                  >
                    {t("theme.create")}
                  </button>
                </div>

                {themeMode === "existing" ? (
                  <div className="new-study-grid">
                    <Field label={t("theme.theme")}>
                      <select className="filter-input new-study-input" value={draft.themeId} onChange={(event) => updateDraft("themeId", event.target.value)} required>
                        {themes.map((theme) => (
                          <option key={theme.id} value={theme.id}>
                            {theme.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.themeId && <small className="new-study-field-error">{fieldErrors.themeId}</small>}
                    </Field>
                    <Field label={t("brand.methodology")}>
                      <select className="filter-input new-study-input" value={draft.methodologyId} onChange={(event) => updateMethodology(event.target.value)} required>
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
                      <TextField label={t("theme.name")} value={inlineTheme.name} onChange={(value) => updateInlineTheme("name", value)} error={fieldErrors["theme.name"]} required />
                      <TextField label={t("theme.slug")} value={inlineTheme.slug} onChange={(value) => updateInlineTheme("slug", value)} />
                      <TextField
                        label={t("theme.industryFocus")}
                        value={inlineTheme.industryFocus}
                        onChange={(value) => updateInlineTheme("industryFocus", value)}
                        error={fieldErrors["theme.industryFocus"]}
                        placeholder={t("theme.industryFocusPlaceholder")}
                        list="wizard-theme-industry-options"
                        required
                      />
                      <TextField label={t("theme.geoFocus")} value={inlineTheme.geoFocus} onChange={(value) => updateInlineTheme("geoFocus", value)} />
                    </div>
                    <datalist id="wizard-theme-industry-options">
                      {INDUSTRY_OPTIONS.map((industry) => <option key={industry} value={industry} />)}
                    </datalist>
                    <TextAreaField label={t("theme.description")} value={inlineTheme.description} onChange={(value) => updateInlineTheme("description", value)} placeholder={t("theme.descriptionPlaceholder")} />
                    <div className="new-study-grid">
                      <Field label={t("brand.methodology")}>
                        <select className="filter-input new-study-input" value={draft.methodologyId} onChange={(event) => updateMethodology(event.target.value)} required>
                          {methodologies.map((methodology) => (
                            <option key={methodology.id} value={methodology.id}>
                              {methodology.name} · {methodology.version}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.methodologyId && <small className="new-study-field-error">{fieldErrors.methodologyId}</small>}
                      </Field>
                    </div>
                  </>
                )}
              </>
            )}
          </WizardPanel>
        )}

        {step === 1 && (
          <WizardPanel eyebrow={t("objective.eyebrow")} title={t("objective.title")}>
            <TextField label={t("objective.studyName")} value={draft.studyName} onChange={(value) => { setStudyNameTouched(true); updateDraft("studyName", value); }} error={fieldErrors.studyName} required />
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
          <WizardPanel eyebrow="Analysis plan" title={isSignalPulseStudy ? "Brief Signal Pulse" : "Lentes del reporte"}>
            {isSignalPulseStudy ? (
              <SignalPulseBriefPanel
                draft={draft}
                fieldErrors={fieldErrors}
                onChange={updateDraft}
              />
            ) : (
              <LensPlanPanel
                selectedLensSlugs={draft.selectedLensSlugs}
                selectedMethodology={selectedMethodology}
                onToggle={toggleLens}
              />
            )}
            {fieldErrors.selectedLensSlugs && <small className="new-study-field-error">{fieldErrors.selectedLensSlugs}</small>}
          </WizardPanel>
        )}

        {step === 3 && (
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
            {isSignalPulseStudy && (
              <PerformanceSourcePanel
                files={performanceFiles}
                headers={performanceHeaders}
                mapping={performanceMapping}
                preview={performancePreview}
                status={performanceStatus}
                error={performanceError}
                onFile={onPerformanceFile}
                onRemove={removePerformanceFile}
                onMappingChange={updatePerformanceMapping}
                onPreview={refreshPerformancePreview}
              />
            )}
          </WizardPanel>
        )}

        {step === 4 && (
          <WizardPanel eyebrow={t("brief.eyebrow")} title={t("brief.title")}>
            <BriefPreview
              draft={draft}
              subjectLabel={subjectLabel}
              methodology={selectedMethodology?.name ?? "Triggers & Barriers"}
              files={files}
              subjectType={subjectType}
              lensLabels={selectedLensLabels}
              isSignalPulseStudy={isSignalPulseStudy}
              performanceFiles={performanceFiles}
            />
          </WizardPanel>
        )}

        {step === 5 && (
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
          {step < LAST_STEP_INDEX ? (
            <button className="wizard-cta" type="button" onClick={() => goToStep(Math.min(LAST_STEP_INDEX, step + 1))} disabled={isSubmitting}>
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

function BaselineCorpusField({
  baselineCorpora,
  selectedBaselineCorpus,
  value,
  onChange
}: {
  baselineCorpora: BaselineCorpusOption[];
  selectedBaselineCorpus: BaselineCorpusOption | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("NewStudy.baseline");

  return (
    <section className="baseline-corpus-field">
      <div>
        <p className="vitals-eyebrow">{t("eyebrow")}</p>
        <h3>{t("title")}</h3>
        <p>{t("copy")}</p>
      </div>
      <Field label={t("label")}>
        <select className="filter-input new-study-input" value={value} onChange={(event) => onChange(event.target.value)} disabled={baselineCorpora.length === 0}>
          <option value="">{baselineCorpora.length === 0 ? t("empty") : t("none")}</option>
          {baselineCorpora.map((corpus) => (
            <option key={corpus.id} value={corpus.id}>
              {(corpus.name || corpus.themeName || t("fallbackCorpus"))} · {formatNumber(corpus.includedCount)} mentions
            </option>
          ))}
        </select>
        {selectedBaselineCorpus && (
          <small className="new-study-hint">
            {t("selected", {
              name: selectedBaselineCorpus.name || selectedBaselineCorpus.themeName || t("fallbackCorpus"),
              count: selectedBaselineCorpus.includedCount
            })}
          </small>
        )}
      </Field>
    </section>
  );
}

function LensPlanPanel({
  selectedLensSlugs,
  selectedMethodology,
  onToggle
}: {
  selectedLensSlugs: string[];
  selectedMethodology: MethodologyOption | undefined;
  onToggle: (slug: string) => void;
}) {
  const selectedSet = new Set(selectedLensSlugs);
  const analysisPlan = buildStudyAnalysisPlan(selectedLensSlugs, selectedMethodology?.slug);
  const composerModules = analysisPlan.composer_modules;

  return (
    <section className="study-lens-plan">
      <div className="study-lens-plan-intro">
        <div>
          <p className="vitals-eyebrow">Multi-lens corpus</p>
          <h3>Un corpus, varias lecturas</h3>
          <p>
            Cada lente seleccionado crea sus propios módulos de query y carga de CSV. T&B corre primero como lectura base;
            después los lentes elegidos analizan el corpus con su provenance, sin mezclar sus objetivos.
          </p>
        </div>
        <div className="study-lens-summary">
          <span>{selectedLensSlugs.length}</span>
          <small>lentes en plan</small>
        </div>
      </div>

      <div className="study-lens-grid">
        {STUDY_LENS_OPTIONS.map((lens) => {
          const isSelected = selectedSet.has(lens.slug);
          const pack = (analysisPlan.lens_configs[lens.slug]?.query_pack ?? {}) as Record<string, unknown>;
          const minMentions = Number(pack.min_mentions_per_entity ?? 0);
          const requiresCompetitors = pack.requires_competitors === true;
          return (
            <button
              aria-pressed={isSelected}
              className={`study-lens-card${isSelected ? " study-lens-card--selected" : ""}`}
              disabled={lens.locked}
              key={lens.slug}
              onClick={() => onToggle(lens.slug)}
              type="button"
            >
              <span className="study-lens-card-status">{lens.status}</span>
              <strong>{lens.label}</strong>
              <p>{lens.description}</p>
              <small>{lens.locked ? "Corre con T&B" : isSelected ? "Se ejecuta después" : "Agregar al plan"}</small>
              <em>
                {requiresCompetitors ? "Requiere peer set" : "Puede correr sin peer set"}
                {minMentions > 0 ? ` · ${minMentions}+ menciones/entidad` : ""}
              </em>
              <Icon name={isSelected ? "check" : "sparkle"} size={15} />
            </button>
          );
        })}
      </div>

      <div className="study-lens-modules">
        <span>Composer esperado</span>
        <div>
          {composerModules.map((module) => <small key={module}>{labelForLens(module)}</small>)}
        </div>
      </div>
    </section>
  );
}

function SignalPulseBriefPanel({
  draft,
  fieldErrors,
  onChange
}: {
  draft: Draft;
  fieldErrors: FieldErrors;
  onChange: (key: DraftStringKey, value: string) => void;
}) {
  return (
    <section className="study-lens-plan">
      <div className="study-lens-plan-intro">
        <div>
          <p className="vitals-eyebrow">Signal Pulse</p>
          <h3>Reporte táctico mensual</h3>
          <p>
            Signal Pulse lee la conversación viva por clusters, la compara por mes y la convierte en decisiones concretas para marketing.
            El costo queda visible antes de correr; Claude sólo ayuda a nombrar e interpretar los clusters.
          </p>
        </div>
        <div className="study-lens-summary">
          <span>${Number(draft.runBudgetUsd || 0).toFixed(0)}</span>
          <small>tope de corrida</small>
        </div>
      </div>
      <div className="new-study-grid">
        <TextAreaField
          compact
          label="Campañas o territorios activos"
          value={draft.activeCampaigns}
          onChange={(value) => onChange("activeCampaigns", value)}
          placeholder="Ej. Back to school, creators de snack, territorios de picante extremo"
        />
        <TextAreaField
          compact
          label="Claims que sí se pueden usar"
          value={draft.allowedClaims}
          onChange={(value) => onChange("allowedClaims", value)}
          placeholder="Claims o temas que Marketing sí puede activar"
        />
        <TextAreaField
          compact
          label="Claims prohibidos o legales"
          value={draft.prohibitedClaims}
          onChange={(value) => onChange("prohibitedClaims", value)}
          placeholder="No-go claims, riesgos regulatorios o territorios sensibles"
        />
        <TextField
          label="Budget cap de corrida (USD)"
          value={draft.runBudgetUsd}
          onChange={(value) => onChange("runBudgetUsd", value)}
          error={fieldErrors.runBudgetUsd}
          required
        />
      </div>
    </section>
  );
}

function PerformanceSourcePanel({
  files,
  headers,
  mapping,
  preview,
  status,
  error,
  onFile,
  onRemove,
  onMappingChange,
  onPreview
}: {
  files: File[];
  headers: string[];
  mapping: PerformanceMapping;
  preview: PerformancePreview | null;
  status: "idle" | "previewing" | "ready" | "imported" | "error";
  error: string | null;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onMappingChange: (field: PerformanceMappingField, value: string) => void;
  onPreview: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const stats = preview?.stats;
  const hasFiles = files.length > 0;
  const allowManualMapping = files.length === 1;
  return (
    <section className="performance-source-panel" aria-label="Performance 12 meses">
      <header className="performance-source-head">
        <div>
          <p className="vitals-eyebrow">Signal Pulse evidence</p>
          <h3>Performance 12 meses</h3>
          <p>Meta, TikTok u orgánico entran estructurados a performance_records; nunca como menciones.</p>
        </div>
        <button className="new-study-file-button" type="button" onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={15} /> {hasFiles ? "Cambiar CSVs" : "Cargar CSVs"}
        </button>
        <input
          ref={inputRef}
          className="new-study-file-input"
          type="file"
          multiple
          accept={PERFORMANCE_ACCEPT}
          onChange={onFile}
        />
      </header>

      {hasFiles ? (
        <div className="performance-source-file-list">
          {files.map((file) => (
            <div className="performance-source-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <Icon name={status === "previewing" ? "spinner" : status === "imported" ? "check" : "upload"} size={15} />
              <span>{file.name}</span>
              <code>{formatBytes(file.size)}</code>
              <button type="button" className="knowledge-file-remove" onClick={onRemove} aria-label="Quitar CSVs de performance">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="performance-source-empty">Opcional para crear el estudio, obligatorio para charts paid/organic de producción.</p>
      )}

      {hasFiles && (
        <>
          {allowManualMapping && (
            <div className="performance-mapping-grid">
              {PERFORMANCE_MAPPING_FIELDS.map(([field, label]) => (
                <label className="performance-mapping-field" key={field}>
                  <span>{label}</span>
                  <select
                    className="filter-input new-study-input"
                    value={mapping[field] ?? ""}
                    onChange={(event) => onMappingChange(field, event.target.value)}
                  >
                    <option value="">No mapear</option>
                    {headers.map((header) => (
                      <option key={`${field}-${header}`} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="performance-source-actions">
            <button className="wizard-cta wizard-cta--secondary" type="button" onClick={onPreview} disabled={status === "previewing"}>
              <Icon name={status === "previewing" ? "spinner" : "refresh"} size={14} /> Revisar datos
            </button>
            {stats && (
              <div className="performance-source-stats">
                <span>{stats.records_valid ?? 0} validas</span>
                <span>{stats.records_failed ?? 0} fallidas</span>
                <span>{stats.duplicate_keys ?? 0} duplicadas</span>
                {stats.coverage_start && stats.coverage_end && <span>{stats.coverage_start} / {stats.coverage_end}</span>}
              </div>
            )}
          </div>
          {preview?.diagnostics && (
            <div className="performance-diagnostics">
              <div>
                <span>Tienes</span>
                <p>{formatMetricList(preview.diagnostics.present_metrics)} · {preview.diagnostics.coverage_days ?? 0} dias / {preview.diagnostics.coverage_months ?? 0} meses</p>
              </div>
              <div>
                <span>Te falta</span>
                <p>{formatMetricList(preview.diagnostics.missing_recommended_metrics)}</p>
              </div>
            </div>
          )}
          {preview?.diagnostics?.messages && preview.diagnostics.messages.length > 0 && (
            <ul className="performance-source-warnings performance-source-warnings--neutral">
              {preview.diagnostics.messages.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}
          {preview?.warnings && preview.warnings.length > 0 && (
            <ul className="performance-source-warnings">
              {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          {error && <p className="new-study-field-error">{error}</p>}
        </>
      )}
    </section>
  );
}

function BriefPreview({
  draft,
  subjectLabel,
  methodology,
  files,
  performanceFiles,
  subjectType,
  lensLabels,
  isSignalPulseStudy
}: {
  draft: Draft;
  subjectLabel: string;
  methodology: string;
  files: File[];
  performanceFiles: File[];
  subjectType: "brand" | "theme";
  lensLabels: string[];
  isSignalPulseStudy: boolean;
}) {
  const t = useTranslations("NewStudy.brief");
  const items = [
    [t("subject"), subjectLabel],
    [t("subjectType"), subjectType === "theme" ? t("themeSubject") : t("brandSubject")],
    [t("baseline"), draft.baseCorpusId ? t("baselineLinked") : ""],
    [t("methodology"), methodology],
    [t("lenses"), lensLabels.join(", ")],
    ...(isSignalPulseStudy ? [
      ["Budget cap", draft.runBudgetUsd ? `$${draft.runBudgetUsd}` : ""],
      ["Campanas activas", draft.activeCampaigns],
      ["Claims permitidos", draft.allowedClaims],
      ["Claims prohibidos", draft.prohibitedClaims],
      ["Performance estructurado", performanceFiles.length > 0 ? performanceFiles.map((file) => file.name).join(", ") : ""]
    ] : []),
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
    slug: slugify(brand.slug || brand.name),
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

async function createInlineTheme(
  theme: InlineTheme,
  labels: { fallback: string; fieldFallback: string; invalidFallback: string }
) {
  const payload = {
    slug: slugify(theme.slug || theme.name, 100),
    name: theme.name,
    description: theme.description,
    industry_focus: splitList(theme.industryFocus),
    geo_focus: splitList(theme.geoFocus || "MX").map((item) => item.toUpperCase()),
    status: "active",
    is_public: false
  };
  const res = await fetch("/api/themes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(json, labels.fallback, labels.fieldFallback, labels.invalidFallback));
  return String(json.data.id);
}

function buildStudyPayload(
  draft: Draft,
  subject: { brandId?: string; themeId?: string; baseCorpusId?: string },
  primaryMethodologySlug?: string
) {
  const analysisPlan = buildStudyAnalysisPlan(draft.selectedLensSlugs, primaryMethodologySlug);
  const isSignalPulse = primaryMethodologySlug === "signal-pulse";
  const budgetCapUsd = Number(draft.runBudgetUsd || 5);
  if (isSignalPulse) {
    analysisPlan.marketing_brief = {
      objectives: draft.decisionToInform,
      audience_priorities: draft.audienceSegment,
      active_campaigns: splitList(draft.activeCampaigns),
      active_territories: splitList(draft.categoryContext),
      allowed_claims: splitList(draft.allowedClaims),
      prohibited_claims: splitList(draft.prohibitedClaims),
      legal_constraints: splitList(draft.strategicConstraints),
      success_criteria: splitList(draft.successCriteria)
    };
    analysisPlan.budget_cap_usd = Number.isFinite(budgetCapUsd) && budgetCapUsd > 0 ? budgetCapUsd : 5;
  }
  return {
    name: draft.studyName,
    ...(subject.brandId ? { brand_id: subject.brandId } : {}),
    ...(subject.themeId ? { theme_id: subject.themeId } : {}),
    ...(subject.baseCorpusId ? { base_corpus_id: subject.baseCorpusId } : {}),
    methodology_id: draft.methodologyId,
    analysis_plan: analysisPlan,
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

async function previewPerformanceFile(file: File, mapping: PerformanceMapping): Promise<PerformancePreview> {
  return sendPerformanceFile("", file, mapping, "preview");
}

async function importPerformanceFile(corpusId: string, file: File, mapping: PerformanceMapping): Promise<PerformancePreview> {
  return sendPerformanceFile(corpusId, file, mapping, "import");
}

async function sendPerformanceFile(
  corpusId: string,
  file: File,
  mapping: PerformanceMapping,
  mode: "preview" | "import"
): Promise<PerformancePreview> {
  const params = new URLSearchParams({
    mode,
    provider: inferPerformanceProvider(file.name),
    source_label: file.name.replace(/\.[^.]+$/, "") || "Performance export",
    file_name: file.name,
    mapping: JSON.stringify(mapping)
  });
  const path = mode === "preview"
    ? `/api/corpora/preview/sources/performance-upload?${params.toString()}`
    : `/api/corpora/${corpusId}/sources/performance-upload?${params.toString()}`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": file.type || "text/csv" },
    body: file
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message ?? "No se pudo procesar el CSV de performance.");
  }
  return json;
}

async function readPerformanceFileText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 400));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount > sample.length * 0.2) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function aggregatePerformancePreviews(previews: PerformancePreview[]): PerformancePreview {
  if (previews.length === 1) return previews[0] as PerformancePreview;
  const presentMetrics = unique(previews.flatMap((preview) => preview.diagnostics?.present_metrics ?? []));
  const detectedMetrics = unique(previews.flatMap((preview) => preview.diagnostics?.detected_metrics ?? []));
  const coverageStarts = previews.map((preview) => preview.stats?.coverage_start).filter(Boolean).sort() as string[];
  const coverageEnds = previews.map((preview) => preview.stats?.coverage_end).filter(Boolean).sort() as string[];
  const coverageDays = Math.max(...previews.map((preview) => preview.diagnostics?.coverage_days ?? 0), 0);
  const coverageMonths = Math.max(...previews.map((preview) => preview.diagnostics?.coverage_months ?? 0), 0);
  const missingRecommended = PERFORMANCE_RECOMMENDED_METRICS.filter((metric) => !presentMetrics.includes(metric));
  return {
    mapping: previews[0]?.mapping,
    stats: {
      records_total: sumPreviewStat(previews, "records_total"),
      records_valid: sumPreviewStat(previews, "records_valid"),
      records_failed: sumPreviewStat(previews, "records_failed"),
      duplicate_keys: sumPreviewStat(previews, "duplicate_keys"),
      records_inserted: sumPreviewStat(previews, "records_inserted"),
      coverage_start: coverageStarts[0] ?? null,
      coverage_end: coverageEnds.at(-1) ?? null
    },
    diagnostics: {
      format: previews.every((preview) => preview.diagnostics?.format === "single_metric_timeseries") ? "single_metric_timeseries" : "tabular",
      detected_metrics: detectedMetrics,
      present_metrics: presentMetrics,
      missing_recommended_metrics: missingRecommended,
      coverage_days: coverageDays,
      coverage_months: coverageMonths,
      messages: [
        `Tengo ${previews.length} archivos de performance.`,
        `Tengo metricas: ${formatMetricList(presentMetrics)}.`,
        missingRecommended.length > 0 ? `Faltan metricas recomendadas: ${missingRecommended.join(", ")}.` : "No faltan metricas recomendadas base."
      ]
    },
    warnings: unique(previews.flatMap((preview) => preview.warnings ?? [])),
    data_source_id: previews.map((preview) => preview.data_source_id).filter(Boolean).join(",") || undefined,
    source_sync_run_id: previews.map((preview) => preview.source_sync_run_id).filter(Boolean).join(",") || undefined
  };
}

function sumPreviewStat(previews: PerformancePreview[], key: keyof NonNullable<PerformancePreview["stats"]>) {
  return previews.reduce((total, preview) => total + Number(preview.stats?.[key] ?? 0), 0);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function formatMetricList(values: string[] | undefined) {
  return values && values.length > 0 ? values.join(", ") : "ninguna";
}

function parseCsvHeader(input: string) {
  let text = input.replace(/^\uFEFF/, "").replace(/\0/g, "");
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (/^sep=./i.test(firstLine)) {
    text = text.slice((text.match(/^.*(?:\r?\n|$)/)?.[0] ?? "").length);
  }
  const delimiter = detectCsvDelimiter(text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerLine = lines.find((line) => {
    const normalized = line.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return /\b(fecha|date|day)\b/.test(normalized) && (normalized.includes(delimiter) || normalized.includes("primary"));
  }) ?? lines[0] ?? "";
  const headers: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < headerLine.length; index += 1) {
    const char = headerLine[index];
    const next = headerLine[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      headers.push(normalizePerformanceHeader(cell));
      cell = "";
      continue;
    }
    cell += char ?? "";
  }
  headers.push(normalizePerformanceHeader(cell));
  return headers.filter(Boolean);
}

function detectCsvDelimiter(input: string) {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
}

function normalizePerformanceHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function inferPerformanceProvider(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("meta") || normalized.includes("facebook") || normalized.includes("instagram")) return "meta";
  if (normalized.includes("google")) return "google";
  return "file";
}

async function waitForJob(
  jobId: string,
  onProgress: (label: string) => void,
  labels: {
    fallbackJobReadError: string;
    knowledgeReady: string;
    knowledgeFailed: string;
    knowledgeTimeout: string;
    noWorker: string;
    analyzingKnowledge: (progress: number) => string;
  }
) {
  // If the job stays queued (never picked up) and no worker is connected,
  // fail fast instead of polling for ~4 minutes and dying with "Load failed".
  let stalledWaitingChecks = 0;
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
    const isWaiting = json.status === "waiting" || json.status === "delayed";
    const noWorker = json.worker_alive === false;
    if (isWaiting && noWorker) {
      stalledWaitingChecks += 1;
      // Allow a few cycles in case a worker is booting; then bail out clearly.
      if (stalledWaitingChecks >= 4) {
        throw new Error(labels.noWorker);
      }
    } else {
      stalledWaitingChecks = 0;
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
