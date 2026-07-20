"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { TokenCatalogField, type ComboOption } from "@/components/brands/BrandOsForm";
import { Icon } from "@/components/ui/Icon";
import {
  collectIndustryTags,
  filterCompatibleBaselineCorpora,
  type BaselineCorpusOption
} from "@/lib/baseline-corpus";
import { COUNTRY_OPTIONS } from "@/lib/country-catalog";
import { INDUSTRY_OPTIONS, subindustriesForIndustry } from "@/lib/industry-catalog";
import {
  STUDY_LENS_OPTIONS,
  buildStudyAnalysisPlan,
  defaultStudyLensSlugs,
  labelForLens
} from "@/lib/multimethod/analysis-plan";
import { slugify } from "@/lib/slug";
import {
  looksLikeStudyContext,
  mergeContextBlock
} from "@/lib/study-intake-context";
import {
  buildStudyDataOsFieldSpecs,
  type StudyDataOsFieldSpecs
} from "@/lib/data-os/field-specs";
import type { StudySourcePreview } from "@/lib/study-source-preview";

type BrandOption = {
  id: string;
  name: string;
  displayName: string | null;
  industry: string | null;
  industrySub: string | null;
  countries: string[] | null;
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
  data_os_materialization: {
    table?: string;
    observation_count?: number;
    upserted_observation_count?: number;
    metric_keys?: string[];
    period_start?: string | null;
    period_end?: string | null;
  } | null;
  source_profile: {
    datasets?: Array<{
      key?: string;
      name?: string;
      row_count?: number;
      materialized_rows?: number;
      semantic_role?: string;
    }>;
    source_metrics?: string[];
    source_dimensions?: string[];
    source_time_axes?: string[];
  } | null;
};

type Draft = {
  studyName: string;
  brandId: string;
  themeId: string;
  baseCorpusId: string;
  methodologyId: string;
  selectedLensSlugs: string[];
  businessQuestion: string;
  studyContext: string;
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
type StudyObjectiveAiDraft = {
  canonical_business_question: string;
  internal_decisions: string[];
  audiences: string[];
  category_context: string;
  competitive_context: string;
  hypotheses: string[];
  known_barriers: string[];
  known_triggers: string[];
  strategic_constraints: string[];
  success_criteria: string[];
  research_assumptions: string[];
  study_context_summary: string;
  source_requirements: string[];
  data_os_field_specs?: StudyDataOsFieldSpecs;
};

type NewStudyFormProps = {
  brands: BrandOption[];
  themes: ThemeOption[];
  baselineCorpora: BaselineCorpusOption[];
  methodologies: MethodologyOption[];
  defaultBrandId?: string;
};

const steps = [
  { key: "brand", label: "Marca" },
  { key: "sources", label: "Fuentes" },
  { key: "objective", label: "Objetivo" },
  { key: "lenses", label: "Lentes" },
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

const DECISION_OPTIONS: ComboOption[] = [
  { value: "Messaging strategy", label: "Messaging strategy", keywords: ["mensajes", "copy", "claims"] },
  { value: "Positioning", label: "Positioning", keywords: ["posicionamiento", "brand territory"] },
  { value: "Campaign planning", label: "Campaign planning", keywords: ["campana", "calendar"] },
  { value: "Creative strategy", label: "Creative strategy", keywords: ["creative", "concept"] },
  { value: "Media planning", label: "Media planning", keywords: ["media", "paid", "channels"] },
  { value: "Product experience", label: "Product experience", keywords: ["producto", "app", "ux"] },
  { value: "Pricing / promotions", label: "Pricing / promotions", keywords: ["precio", "promo", "discount"] },
  { value: "Retention / CRM", label: "Retention / CRM", keywords: ["retencion", "loyalty", "subscription"] },
  { value: "Operations / service", label: "Operations / service", keywords: ["operacion", "delivery", "support"] },
  { value: "Retail / marketplace", label: "Retail / marketplace", keywords: ["retail", "ecommerce", "marketplace"] },
  { value: "Category expansion", label: "Category expansion", keywords: ["categoria", "expansion"] },
  { value: "Brand health", label: "Brand health", keywords: ["salud de marca", "reputation"] },
  { value: "Reputation / risk", label: "Reputation / risk", keywords: ["riesgo", "crisis"] },
  { value: "Innovation / NPD", label: "Innovation / NPD", keywords: ["innovation", "new product"] },
  { value: "Partnerships", label: "Partnerships", keywords: ["alianzas", "partners"] }
];

const AUDIENCE_OPTIONS: ComboOption[] = [
  { value: "Current customers", label: "Current customers", keywords: ["clientes actuales"] },
  { value: "Prospective buyers", label: "Prospective buyers", keywords: ["prospectos"] },
  { value: "Category buyers", label: "Category buyers", keywords: ["compradores categoria"] },
  { value: "App users", label: "App users", keywords: ["usuarios app"] },
  { value: "Lapsed customers", label: "Lapsed customers", keywords: ["perdidos", "churn"] },
  { value: "Premium buyers", label: "Premium buyers", keywords: ["premium"] },
  { value: "Price-sensitive buyers", label: "Price-sensitive buyers", keywords: ["precio", "ahorro"] },
  { value: "Subscription members", label: "Subscription members", keywords: ["miembros", "membership"] },
  { value: "First-time buyers", label: "First-time buyers", keywords: ["primerizos"] },
  { value: "Heavy users", label: "Heavy users", keywords: ["heavy", "power users"] },
  { value: "Urban households", label: "Urban households", keywords: ["ciudades", "hogares urbanos"] },
  { value: "Families", label: "Families", keywords: ["familias", "parents"] },
  { value: "Gen Z", label: "Gen Z", keywords: ["centennials"] },
  { value: "Millennials", label: "Millennials", keywords: ["millennial"] },
  { value: "Experts / professionals", label: "Experts / professionals", keywords: ["expertos", "veterinarios"] },
  { value: "Retail shoppers", label: "Retail shoppers", keywords: ["tienda", "retail"] }
];

const BARRIER_OPTIONS: ComboOption[] = [
  { value: "Price sensitivity", label: "Price sensitivity", keywords: ["precio", "caro"] },
  { value: "Trust / credibility", label: "Trust / credibility", keywords: ["confianza", "credibilidad"] },
  { value: "Delivery reliability", label: "Delivery reliability", keywords: ["entrega", "logistica"] },
  { value: "App friction", label: "App friction", keywords: ["app", "UX"] },
  { value: "Payment friction", label: "Payment friction", keywords: ["pago", "checkout"] },
  { value: "Customer support", label: "Customer support", keywords: ["soporte", "atencion"] },
  { value: "Product availability", label: "Product availability", keywords: ["stock", "inventario"] },
  { value: "Assortment gaps", label: "Assortment gaps", keywords: ["surtido"] },
  { value: "Quality concerns", label: "Quality concerns", keywords: ["calidad"] },
  { value: "Subscription skepticism", label: "Subscription skepticism", keywords: ["membresia", "suscripcion"] },
  { value: "Expert confidence", label: "Expert confidence", keywords: ["experto", "veterinario"] },
  { value: "Brand awareness", label: "Brand awareness", keywords: ["awareness", "conocimiento"] },
  { value: "Marketplace comparison", label: "Marketplace comparison", keywords: ["marketplace", "comparacion"] },
  { value: "Promo dependency", label: "Promo dependency", keywords: ["promociones"] },
  { value: "Returns / refunds", label: "Returns / refunds", keywords: ["devoluciones", "reembolsos"] },
  { value: "Safety concerns", label: "Safety concerns", keywords: ["seguridad", "riesgo"] }
];

const TRIGGER_OPTIONS: ComboOption[] = [
  { value: "Convenience", label: "Convenience", keywords: ["conveniencia"] },
  { value: "Same-day delivery", label: "Same-day delivery", keywords: ["entrega mismo dia"] },
  { value: "Savings / promotions", label: "Savings / promotions", keywords: ["ahorro", "promo"] },
  { value: "Assortment breadth", label: "Assortment breadth", keywords: ["surtido"] },
  { value: "Expert advice", label: "Expert advice", keywords: ["experto", "advice"] },
  { value: "Membership benefits", label: "Membership benefits", keywords: ["membership", "membresia"] },
  { value: "App ease", label: "App ease", keywords: ["app", "facilidad"] },
  { value: "Wellbeing", label: "Wellbeing", keywords: ["bienestar"] },
  { value: "Product quality", label: "Product quality", keywords: ["calidad"] },
  { value: "Subscription refill", label: "Subscription refill", keywords: ["recompra", "refill"] },
  { value: "Social proof", label: "Social proof", keywords: ["reviews", "resenas"] },
  { value: "Emergency need", label: "Emergency need", keywords: ["urgencia"] },
  { value: "Premium care", label: "Premium care", keywords: ["premium"] },
  { value: "Marketplace confidence", label: "Marketplace confidence", keywords: ["confianza marketplace"] },
  { value: "Store pickup", label: "Store pickup", keywords: ["pickup", "tienda"] },
  { value: "Professional access", label: "Professional access", keywords: ["veterinario", "profesional"] }
];

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
    studyContext: "",
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
  const [sourcePreviews, setSourcePreviews] = useState<StudySourcePreview[]>([]);
  const [sourcePreviewStatus, setSourcePreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [knowledgeNotice, setKnowledgeNotice] = useState<string | null>(null);
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
  const [objectiveAiDraft, setObjectiveAiDraft] = useState<StudyObjectiveAiDraft | null>(null);
  const [objectiveAiStatus, setObjectiveAiStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [objectiveAiError, setObjectiveAiError] = useState<string | null>(null);
  const [objectiveAiRefineInstruction, setObjectiveAiRefineInstruction] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBrand = brands.find((brand) => brand.id === draft.brandId) ?? null;
  const selectedTheme = themes.find((theme) => theme.id === draft.themeId) ?? null;
  const selectedMethodology = methodologies.find((methodology) => methodology.id === draft.methodologyId) ?? defaultMethodology;
  const baselineCompatibilityContext = useMemo(
    () => ({
      brandId: subjectType === "brand" && brandMode === "existing" ? selectedBrand?.id ?? null : null,
      methodologySlug: selectedMethodology?.slug ?? null,
      industryTags:
        subjectType === "brand" && brandMode === "existing"
          ? collectIndustryTags(selectedBrand?.industry, selectedBrand?.industrySub)
          : subjectType === "brand"
            ? collectIndustryTags(inlineBrand.industry, inlineBrand.industrySub)
            : [],
      geoFocus:
        subjectType === "brand" && brandMode === "existing"
          ? splitCountryList(draft.geoFocus || selectedBrand?.countries?.join(",") || "MX").map((item) => item.toUpperCase())
          : splitCountryList(draft.geoFocus || inlineBrand.countries || "MX").map((item) => item.toUpperCase())
    }),
    [
      brandMode,
      draft.geoFocus,
      inlineBrand.countries,
      inlineBrand.industry,
      inlineBrand.industrySub,
      selectedBrand?.countries,
      selectedBrand?.id,
      selectedBrand?.industry,
      selectedBrand?.industrySub,
      selectedMethodology?.slug,
      subjectType
    ]
  );
  const compatibleBaselineCorpora = useMemo(
    () => filterCompatibleBaselineCorpora(baselineCorpora, baselineCompatibilityContext),
    [baselineCompatibilityContext, baselineCorpora]
  );
  const selectedBaselineCorpus = compatibleBaselineCorpora.find((corpus) => corpus.id === draft.baseCorpusId) ?? null;
  const selectedLensLabels = draft.selectedLensSlugs.map(labelForLens);
  const failedSourceCount = knowledgeSources.filter((source) => source.status === "failed").length;
  const readySourcePreviewCount = sourcePreviews.filter((preview) => preview.status === "ready" && preview.text.trim().length >= 80).length;
  const objectiveAiContextReady = (
    draft.businessQuestion.trim().length >= 10 ||
    draft.studyContext.trim().length >= 80 ||
    readySourcePreviewCount > 0
  )
    && ((subjectType === "brand" && brandMode === "existing" && Boolean(draft.brandId))
      || (subjectType === "theme" && themeMode === "existing" && Boolean(draft.themeId)));
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
  const brandOptions = useMemo<ComboOption[]>(
    () => brands.map((brand) => ({ value: brand.id, label: brand.displayName ?? brand.name })),
    [brands]
  );
  const themeOptions = useMemo<ComboOption[]>(
    () => themes.map((theme) => ({ value: theme.id, label: theme.name })),
    [themes]
  );
  const methodologyOptions = useMemo<ComboOption[]>(
    () => methodologies.map((methodology) => ({ value: methodology.id, label: `${methodology.name} · ${methodology.version}` })),
    [methodologies]
  );
  const sourceTypeOptions = useMemo<ComboOption[]>(
    () => [
      { value: "spreadsheet_archive", label: t("sources.types.spreadsheetArchive") },
      { value: "social_archive", label: t("sources.types.socialArchive") },
      { value: "brand_document", label: t("sources.types.brandDocument") },
      { value: "research_deck", label: t("sources.types.researchDeck") },
      { value: "search_data", label: t("sources.types.searchData") },
      { value: "scraper_export", label: t("sources.types.scraperExport") }
    ],
    [t]
  );
  const windowOptions = useMemo<ComboOption[]>(
    () => [3, 6, 12, 18, 24].map((count) => ({ value: String(count), label: t("objective.months", { count }) })),
    [t]
  );

  useEffect(() => {
    if (studyNameTouched) return;
    if (!resolvedSubjectName) return;
    const next = `${resolvedSubjectName} · ${methodologyName}`;
    setDraft((current) => (current.studyName === next ? current : { ...current, studyName: next }));
  }, [studyNameTouched, resolvedSubjectName, methodologyName]);

  useEffect(() => {
    if (!draft.baseCorpusId) return;
    if (compatibleBaselineCorpora.some((corpus) => corpus.id === draft.baseCorpusId)) return;
    setDraft((current) => ({ ...current, baseCorpusId: "" }));
  }, [compatibleBaselineCorpora, draft.baseCorpusId]);

  function updateDraft(key: DraftStringKey, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function updateObjectiveAiDraft(patch: Partial<StudyObjectiveAiDraft>) {
    setObjectiveAiDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function acceptObjectiveList(key: DraftStringKey, suggestions: string[] | undefined) {
    const next = uniqueInOrder([...tokenValues(draft[key]), ...(suggestions ?? [])]).slice(0, 60);
    updateDraft(key, writeList(next));
  }

  function acceptCanonicalBusinessQuestion() {
    const nextQuestion = objectiveAiDraft?.canonical_business_question?.trim();
    if (!nextQuestion) return;
    if (looksLikeStudyContext(draft.businessQuestion)) {
      updateDraft(
        "studyContext",
        mergeContextBlock(draft.studyContext, t("objective.promotedQuestionContextLabel"), draft.businessQuestion)
      );
    }
    updateDraft("businessQuestion", nextQuestion);
    updateObjectiveAiDraft({ canonical_business_question: "" });
  }

  async function generateObjectiveDraft(refineInstruction = "") {
    if (!objectiveAiContextReady) return;
    setObjectiveAiStatus("loading");
    setObjectiveAiError(null);
    try {
      const previews = sourcePreviews.length > 0 || files.length === 0
        ? sourcePreviews
        : await refreshSourcePreviews(files, draft.sourceKind);
      const uploadedSources = previews
        .filter((source) => source.status === "ready")
        .slice(0, 12)
        .map((source) => ({
          name: source.name,
          kind: source.kind,
          text: source.text,
          sizeBytes: source.size_bytes
        }));
      const res = await fetch("/api/corpora/intake-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: subjectType === "brand" && brandMode === "existing" ? draft.brandId : undefined,
          theme_id: subjectType === "theme" && themeMode === "existing" ? draft.themeId : undefined,
          study_name: draft.studyName,
          methodology_slug: selectedMethodology?.slug,
          business_question: draft.businessQuestion,
          study_context: draft.studyContext,
          uploaded_sources: uploadedSources.map((source) => ({
            name: source.name,
            kind: source.kind,
            text: source.text,
            size_bytes: source.sizeBytes
          })),
          decision_to_inform: tokenValues(draft.decisionToInform),
          audience_segment: tokenValues(draft.audienceSegment),
          category_context: draft.categoryContext,
          competitive_context: draft.competitiveContext,
          hypotheses: tokenValues(draft.hypotheses),
          known_barriers: tokenValues(draft.knownBarriers),
          known_triggers: tokenValues(draft.knownTriggers),
          strategic_constraints: tokenValues(draft.strategicConstraints),
          success_criteria: tokenValues(draft.successCriteria),
          geo_focus: splitList(draft.geoFocus).map((item) => item.toUpperCase()),
          target_window_months: Number(draft.targetWindowMonths),
          refine_instruction: refineInstruction.trim() || undefined
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || t("objective.aiError"));
      setObjectiveAiDraft(json.suggestions as StudyObjectiveAiDraft);
      setObjectiveAiStatus("ready");
    } catch (err) {
      setObjectiveAiStatus("error");
      setObjectiveAiError(err instanceof Error ? err.message : t("objective.aiError"));
    }
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

  async function refreshSourcePreviews(nextFiles = files, nextSourceKind = draft.sourceKind) {
    if (nextFiles.length === 0) {
      setSourcePreviews([]);
      setSourcePreviewStatus("idle");
      setSourcePreviewError(null);
      return [];
    }

    setSourcePreviewStatus("loading");
    setSourcePreviewError(null);
    const upload = new FormData();
    upload.set("source_kind", nextSourceKind);
    for (const file of nextFiles) upload.append("files", file);

    try {
      const res = await fetch("/api/corpora/source-preview", {
        method: "POST",
        body: upload
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || t("sources.previewError"));
      const previews = Array.isArray(json.data) ? json.data as StudySourcePreview[] : [];
      setSourcePreviews(previews);
      setSourcePreviewStatus("ready");
      return previews;
    } catch (err) {
      setSourcePreviewStatus("error");
      setSourcePreviewError(err instanceof Error ? err.message : t("sources.previewError"));
      return [];
    }
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
    void refreshSourcePreviews(nextFiles);

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
    const nextFiles = files.filter((file) => fileKey(file) !== fileKey(target));
    setFiles(nextFiles);
    setSourcePreviews((current) => current.filter((preview) => sourcePreviewKey(preview) !== filePreviewKey(target)));
    if (nextFiles.length === 0) {
      setSourcePreviewStatus("idle");
      setSourcePreviewError(null);
    }
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

    if (maxStep >= 2) {
      if (draft.studyName.trim().length < 3) addError(2, "studyName", t("validation.studyName"));
      if (draft.businessQuestion.trim().length < 10) {
        addError(2, "businessQuestion", t("validation.businessQuestion"));
      }
    }

    if (maxStep >= 3) {
      if (isSignalPulseStudy) {
        const budget = Number(draft.runBudgetUsd);
        if (!Number.isFinite(budget) || budget <= 0) {
          addError(3, "runBudgetUsd", "Define un budget cap mayor a 0.");
        }
      } else if (!draft.selectedLensSlugs.includes("triggers-barriers")) {
        addError(3, "selectedLensSlugs", t("validation.methodology"));
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
    setKnowledgeNotice(null);
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
        selectedMethodology?.slug,
        files,
        sourcePreviews,
        objectiveAiDraft?.data_os_field_specs
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
    setKnowledgeNotice(null);
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
        setKnowledgeNotice(t("progress.knowledgeStillProcessing"));
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
    setKnowledgeNotice(null);
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
                  <SelectField
                    label={t("brief.brand")}
                    options={brandOptions}
                    value={draft.brandId}
                    onChange={(value) => updateDraft("brandId", value)}
                    error={fieldErrors.brandId}
                  />
                  <SelectField
                    label={t("brand.methodology")}
                    options={methodologyOptions}
                    value={draft.methodologyId}
                    onChange={updateMethodology}
                    error={fieldErrors.methodologyId}
                  />
                </div>
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
                    <SelectField
                      label={t("theme.theme")}
                      options={themeOptions}
                      value={draft.themeId}
                      onChange={(value) => updateDraft("themeId", value)}
                      error={fieldErrors.themeId}
                    />
                    <SelectField
                      label={t("brand.methodology")}
                      options={methodologyOptions}
                      value={draft.methodologyId}
                      onChange={updateMethodology}
                      error={fieldErrors.methodologyId}
                    />
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
                      <SelectField
                        label={t("brand.methodology")}
                        options={methodologyOptions}
                        value={draft.methodologyId}
                        onChange={updateMethodology}
                        error={fieldErrors.methodologyId}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </WizardPanel>
        )}

        {step === 2 && (
          <WizardPanel eyebrow={t("objective.eyebrow")} title={t("objective.title")}>
            <TextField label={t("objective.studyName")} value={draft.studyName} onChange={(value) => { setStudyNameTouched(true); updateDraft("studyName", value); }} error={fieldErrors.studyName} required />
            <TextAreaField
              label={t("objective.businessQuestion")}
              value={draft.businessQuestion}
              onChange={(value) => updateDraft("businessQuestion", value)}
              error={fieldErrors.businessQuestion}
              required
              placeholder={t("objective.businessQuestionPlaceholder")}
              suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
              suggestionText={objectiveAiDraft?.canonical_business_question}
              suggestionTitle={t("objective.aiQuestionTitle")}
              onAcceptSuggestion={acceptCanonicalBusinessQuestion}
              onDiscardSuggestion={() => updateObjectiveAiDraft({ canonical_business_question: "" })}
              compact
            />
            <div className="brand-ai-start study-ai-start">
              <div>
                <p className="vitals-eyebrow">{t("objective.aiEyebrow")}</p>
                <strong>{t("objective.aiStartTitle")}</strong>
                {objectiveAiStatus === "error" && (
                  <span className="brand-ai-inline-error">
                    <Icon name="alert" size={13} /> {objectiveAiError ?? t("objective.aiError")}
                  </span>
                )}
              </div>
              <button
                className="wizard-cta wizard-cta--secondary"
                type="button"
                disabled={!objectiveAiContextReady || objectiveAiStatus === "loading"}
                onClick={() => {
                  void generateObjectiveDraft();
                }}
              >
                <Icon name={objectiveAiStatus === "loading" ? "spinner" : "sparkle"} size={14} /> {t("objective.aiStart")}
              </button>
            </div>
            <div className="new-study-grid">
              <CatalogSuggestionField
                label={t("objective.decision")}
                loading={objectiveAiStatus === "loading" && !draft.decisionToInform.trim()}
                name="decision_to_inform"
                options={DECISION_OPTIONS}
                placeholder={t("objective.decisionPlaceholder")}
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiDecisionTitle")}
                suggestionValues={objectiveAiDraft?.internal_decisions}
                values={tokenValues(draft.decisionToInform)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("decisionToInform", objectiveAiDraft?.internal_decisions);
                  updateObjectiveAiDraft({ internal_decisions: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ internal_decisions: [] })}
                onChange={(values) => updateDraft("decisionToInform", writeList(values))}
              />
              <CatalogSuggestionField
                label={t("objective.audience")}
                loading={objectiveAiStatus === "loading" && !draft.audienceSegment.trim()}
                name="audience_segment"
                options={AUDIENCE_OPTIONS}
                placeholder={t("objective.audiencePlaceholder")}
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiAudienceTitle")}
                suggestionValues={objectiveAiDraft?.audiences}
                values={tokenValues(draft.audienceSegment)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("audienceSegment", objectiveAiDraft?.audiences);
                  updateObjectiveAiDraft({ audiences: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ audiences: [] })}
                onChange={(values) => updateDraft("audienceSegment", writeList(values))}
              />
            </div>
            <TextAreaField
              label={t("objective.categoryContext")}
              loading={objectiveAiStatus === "loading" && !draft.categoryContext.trim()}
              value={draft.categoryContext}
              onChange={(value) => updateDraft("categoryContext", value)}
              placeholder={t("objective.categoryContextPlaceholder")}
              suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
              suggestionText={objectiveAiDraft?.category_context}
              suggestionTitle={t("objective.aiCategoryTitle")}
              onAcceptSuggestion={() => {
                updateDraft("categoryContext", objectiveAiDraft?.category_context ?? "");
                updateObjectiveAiDraft({ category_context: "" });
              }}
              onDiscardSuggestion={() => updateObjectiveAiDraft({ category_context: "" })}
              compact
            />
            <TextAreaField
              label={t("objective.competitiveContext")}
              loading={objectiveAiStatus === "loading" && !draft.competitiveContext.trim()}
              value={draft.competitiveContext}
              onChange={(value) => updateDraft("competitiveContext", value)}
              placeholder={t("objective.competitiveContextPlaceholder")}
              suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
              suggestionText={objectiveAiDraft?.competitive_context}
              suggestionTitle={t("objective.aiCompetitiveTitle")}
              onAcceptSuggestion={() => {
                updateDraft("competitiveContext", objectiveAiDraft?.competitive_context ?? "");
                updateObjectiveAiDraft({ competitive_context: "" });
              }}
              onDiscardSuggestion={() => updateObjectiveAiDraft({ competitive_context: "" })}
            />
            <div className="new-study-grid">
              <StudyTokenField
                label={t("objective.hypotheses")}
                loading={objectiveAiStatus === "loading" && !draft.hypotheses.trim()}
                name="hypotheses"
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiHypothesesTitle")}
                suggestionValues={objectiveAiDraft?.hypotheses}
                values={tokenValues(draft.hypotheses)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("hypotheses", objectiveAiDraft?.hypotheses);
                  updateObjectiveAiDraft({ hypotheses: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ hypotheses: [] })}
                onChange={(values) => updateDraft("hypotheses", writeList(values))}
                placeholder={t("objective.hypothesesPlaceholder")}
              />
              <StudyTokenField
                label={t("objective.constraints")}
                loading={objectiveAiStatus === "loading" && !draft.strategicConstraints.trim()}
                name="strategic_constraints"
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiConstraintsTitle")}
                suggestionValues={objectiveAiDraft?.strategic_constraints}
                values={tokenValues(draft.strategicConstraints)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("strategicConstraints", objectiveAiDraft?.strategic_constraints);
                  updateObjectiveAiDraft({ strategic_constraints: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ strategic_constraints: [] })}
                onChange={(values) => updateDraft("strategicConstraints", writeList(values))}
                placeholder={t("objective.constraintsPlaceholder")}
              />
              <CatalogSuggestionField
                label={t("objective.knownBarriers")}
                loading={objectiveAiStatus === "loading" && !draft.knownBarriers.trim()}
                name="known_barriers"
                options={BARRIER_OPTIONS}
                placeholder={t("objective.knownBarriersPlaceholder")}
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiBarriersTitle")}
                suggestionValues={objectiveAiDraft?.known_barriers}
                values={tokenValues(draft.knownBarriers)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("knownBarriers", objectiveAiDraft?.known_barriers);
                  updateObjectiveAiDraft({ known_barriers: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ known_barriers: [] })}
                onChange={(values) => updateDraft("knownBarriers", writeList(values))}
              />
              <CatalogSuggestionField
                label={t("objective.knownTriggers")}
                loading={objectiveAiStatus === "loading" && !draft.knownTriggers.trim()}
                name="known_triggers"
                options={TRIGGER_OPTIONS}
                placeholder={t("objective.knownTriggersPlaceholder")}
                suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
                suggestionTitle={t("objective.aiTriggersTitle")}
                suggestionValues={objectiveAiDraft?.known_triggers}
                values={tokenValues(draft.knownTriggers)}
                onAcceptSuggestion={() => {
                  acceptObjectiveList("knownTriggers", objectiveAiDraft?.known_triggers);
                  updateObjectiveAiDraft({ known_triggers: [] });
                }}
                onDiscardSuggestion={() => updateObjectiveAiDraft({ known_triggers: [] })}
                onChange={(values) => updateDraft("knownTriggers", writeList(values))}
              />
            </div>
            <StudyTokenField
              label={t("objective.success")}
              loading={objectiveAiStatus === "loading" && !draft.successCriteria.trim()}
              name="success_criteria"
              suggestionLabels={{ accept: t("objective.aiAccept"), discard: t("objective.aiDiscard") }}
              suggestionTitle={t("objective.aiSuccessTitle")}
              suggestionValues={objectiveAiDraft?.success_criteria}
              values={tokenValues(draft.successCriteria)}
              onAcceptSuggestion={() => {
                acceptObjectiveList("successCriteria", objectiveAiDraft?.success_criteria);
                updateObjectiveAiDraft({ success_criteria: [] });
              }}
              onDiscardSuggestion={() => updateObjectiveAiDraft({ success_criteria: [] })}
              onChange={(values) => updateDraft("successCriteria", writeList(values))}
              placeholder={t("objective.successPlaceholder")}
            />
            <div className="brand-ai-refine study-ai-refine">
              <div>
                <p className="vitals-eyebrow">{t("objective.aiEyebrow")}</p>
                <strong>{objectiveAiStatus === "loading" ? t("objective.aiGenerating") : t("objective.aiRefineTitle")}</strong>
              </div>
              <input
                className="filter-input new-study-input"
                placeholder={t("objective.aiRefinePlaceholder")}
                value={objectiveAiRefineInstruction}
                onChange={(event) => setObjectiveAiRefineInstruction(event.target.value)}
              />
              <button
                className="wizard-cta wizard-cta--secondary brand-ai-refine-button"
                type="button"
                disabled={!objectiveAiContextReady || objectiveAiStatus === "loading"}
                onClick={() => {
                  void generateObjectiveDraft(objectiveAiRefineInstruction);
                }}
              >
                <Icon name={objectiveAiStatus === "loading" ? "spinner" : "sparkle"} size={14} /> {t("objective.aiRegenerate")}
              </button>
            </div>
            <div className="new-study-grid new-study-grid--compact">
              <TokenCatalogField
                allowCustom
                label={t("objective.countries")}
                name="geo_focus"
                options={COUNTRY_OPTIONS}
                placeholder="Mexico (MX)"
                values={countryTokenValues(draft.geoFocus)}
                onChange={(values) => updateDraft("geoFocus", values.join(", "))}
              />
              <SelectField
                label={t("objective.window")}
                options={windowOptions}
                value={draft.targetWindowMonths}
                onChange={(value) => updateDraft("targetWindowMonths", value)}
              />
            </div>
            <DataOsTraceCard draft={draft} methodologySlug={selectedMethodology?.slug ?? "triggers-barriers"} />
          </WizardPanel>
        )}

        {step === 3 && (
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

        {step === 1 && (
          <WizardPanel eyebrow={t("sources.eyebrow")} title={t("sources.title")}>
            <div className="source-engine-brief">
              <div>
                <p className="vitals-eyebrow">{t("sources.engineEyebrow")}</p>
                <strong>{t("sources.engineTitle")}</strong>
                <p>{t("sources.engineCopy")}</p>
              </div>
              <code>{t("sources.engineCode")}</code>
            </div>
            <div className="source-console">
              <div className="source-console-main">
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
              </div>
              <div className="source-console-side">
                <SelectField
                  label={t("sources.type")}
                  options={sourceTypeOptions}
                  value={draft.sourceKind}
                  onChange={(value) => {
                    updateDraft("sourceKind", value);
                    void refreshSourcePreviews(files, value);
                  }}
                />
                <TextAreaField
                  compact
                  label={t("sources.context")}
                  value={draft.studyContext}
                  onChange={(value) => updateDraft("studyContext", value)}
                  placeholder={t("sources.contextPlaceholder")}
                />
              </div>
            </div>
            <SourcePreviewPanel
              error={sourcePreviewError}
              previews={sourcePreviews}
              status={sourcePreviewStatus}
              onRefresh={() => {
                void refreshSourcePreviews(files);
              }}
            />
            <div className="source-secondary-grid">
              {subjectType === "brand" && (
                <BaselineCorpusField
                  baselineCorpora={compatibleBaselineCorpora}
                  totalCandidateCount={baselineCorpora.length}
                  selectedBaselineCorpus={selectedBaselineCorpus}
                  value={draft.baseCorpusId}
                  onChange={(value) => updateDraft("baseCorpusId", value)}
                />
              )}
              <DataOsTraceCard
                draft={draft}
                methodologySlug={selectedMethodology?.slug ?? "triggers-barriers"}
                sourcePreviews={sourcePreviews}
              />
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
              methodologySlug={selectedMethodology?.slug ?? "triggers-barriers"}
              files={files}
              sourcePreviews={sourcePreviews}
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
                      <span className={`knowledge-source-status knowledge-source-status--${normalizeKnowledgeStatus(source.status)}`}>
                        {sourceStatusLabel(source)}
                      </span>
                    </header>
                    <p>{source.status === "failed" ? source.error_message || t("launch.sourceFailedFallback") : sourceDisplaySummary(source, t("launch.sourceProcessedFallback"))}</p>
                    {source.data_os_materialization && (
                      <div className="knowledge-data-os-row">
                        <span>{formatObservationCount(source.data_os_materialization.observation_count)} observations</span>
                        <span>{source.source_profile?.datasets?.length ?? 0} datasets</span>
                        {source.data_os_materialization.period_start || source.data_os_materialization.period_end ? (
                          <span>{source.data_os_materialization.period_start ?? "open"} to {source.data_os_materialization.period_end ?? "open"}</span>
                        ) : null}
                      </div>
                    )}
                    {source.query_language.length > 0 && (
                      <div className="knowledge-tags">
                        {source.query_language.map((term) => <span key={term}>{term}</span>)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {knowledgeNotice && (
              <p className="new-study-notice">
                <Icon name="layers" size={14} /> {knowledgeNotice}
              </p>
            )}
            {!engineUrl && !isSubmitting && (
              <div className="launch-card">
                <Icon name="save" size={18} />
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
                  <Icon name="save" size={14} /> {t("actions.create")}
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

function SourcePreviewPanel({
  error,
  previews,
  status,
  onRefresh
}: {
  error: string | null;
  previews: StudySourcePreview[];
  status: "idle" | "loading" | "ready" | "error";
  onRefresh: () => void;
}) {
  const t = useTranslations("NewStudy.sources");

  if (status === "idle" && previews.length === 0) {
    return (
      <section className="source-preview-panel source-preview-panel--empty">
        <Icon name="layers" size={16} />
        <p>{t("previewEmpty")}</p>
      </section>
    );
  }

  return (
    <section className="source-preview-panel">
      <header>
        <div>
          <p className="vitals-eyebrow">{t("previewEyebrow")}</p>
          <h3>{t("previewTitle")}</h3>
        </div>
        <button className="wizard-cta wizard-cta--secondary wizard-cta--small" type="button" onClick={onRefresh} disabled={status === "loading"}>
          <Icon name={status === "loading" ? "spinner" : "refresh"} size={13} /> {t("previewRefresh")}
        </button>
      </header>
      {status === "loading" && (
        <div className="source-preview-skeleton" aria-label={t("previewLoading")}>
          <span />
          <span />
          <span />
        </div>
      )}
      {status === "error" && error && (
        <p className="new-study-field-error">
          <Icon name="alert" size={13} /> {error}
        </p>
      )}
      {previews.length > 0 && (
        <div className="source-preview-grid">
          {previews.map((preview) => (
            <article className={`source-preview-card${preview.status === "error" ? " source-preview-card--error" : ""}`} key={`${preview.name}-${preview.size_bytes}`}>
              <header>
                <div>
                  <strong>{preview.name}</strong>
                  <span>{formatBytes(preview.size_bytes)} · {preview.kind}</span>
                </div>
                <code>{preview.status === "ready" ? t("previewReady") : t("previewFailed")}</code>
              </header>
              {preview.status === "ready" ? (
                <>
                  <p>{preview.summary}</p>
                  <div className="source-preview-metrics">
                    <span>
                      {preview.sheet_count > 0
                        ? t("previewSheets", { count: preview.sheet_count })
                        : t("previewDatasets", { count: preview.source_profile?.datasets.length || (preview.field_names.length > 0 ? 1 : 0) })}
                    </span>
                    <span>{t("previewRows", { count: preview.row_count })}</span>
                    <span>{t("previewFields", { count: preview.field_names.length })}</span>
                  </div>
                  {preview.dataset_inventory.length > 0 && (
                    <ul>
                      {preview.dataset_inventory.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                </>
              ) : (
                <p>{preview.error ?? t("previewFailedCopy")}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="new-study-field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SelectField({
  disabled = false,
  error,
  label,
  onChange,
  options,
  placeholder,
  value
}: {
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly ComboOption[];
  placeholder?: string;
  value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonId = useId();
  const labelId = useId();
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  function openMenu() {
    if (disabled) return;
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }

  function choose(option: ComboOption) {
    onChange(option.value);
    setIsOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const option = options[activeIndex];
      if (option) choose(option);
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className={`study-select${disabled ? " study-select--disabled" : ""}`}>
      <span id={labelId}>{label}</span>
      <button
        id={buttonId}
        className={`study-select-button${error ? " new-study-control--error" : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-labelledby={`${labelId} ${buttonId}`}
        disabled={disabled}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? placeholder ?? ""}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {isOpen && !disabled && (
        <div className="study-select-menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className="study-select-option"
              role="option"
              aria-selected={option.value === value || index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && <small className="new-study-field-error">{error}</small>}
    </div>
  );
}

function CatalogSuggestionField({
  label,
  loading = false,
  name,
  options,
  onChange,
  onAcceptSuggestion,
  onDiscardSuggestion,
  placeholder,
  suggestionLabels,
  suggestionTitle,
  suggestionValues,
  values
}: {
  label: string;
  loading?: boolean;
  name: string;
  options: readonly ComboOption[];
  onChange: (values: string[]) => void;
  onAcceptSuggestion?: () => void;
  onDiscardSuggestion?: () => void;
  placeholder: string;
  suggestionLabels?: { accept: string; discard: string };
  suggestionTitle?: string;
  suggestionValues?: string[];
  values: string[];
}) {
  const suggestionReady = Boolean(suggestionValues?.length && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion);

  return (
    <div className="study-suggestable-field">
      <TokenCatalogField
        allowCustom
        label={label}
        name={name}
        options={options}
        placeholder={placeholder}
        values={values}
        onChange={onChange}
      />
      {loading && values.length === 0 && (
        <div className="token-input-skeleton token-input-skeleton--detached" aria-hidden="true">
          <span className="smart-skeleton-line smart-skeleton-line--chip" />
          <span className="smart-skeleton-line smart-skeleton-line--short" />
        </div>
      )}
      {suggestionReady && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion && (
        <InlineStudySuggestion
          labels={suggestionLabels}
          title={suggestionTitle}
          onAccept={onAcceptSuggestion}
          onDiscard={onDiscardSuggestion}
        >
          <div className="field-ai-chip-preview">
            {suggestionValues?.map((value) => <span key={value}>{value}</span>)}
          </div>
        </InlineStudySuggestion>
      )}
    </div>
  );
}

function StudyTokenField({
  label,
  loading = false,
  name,
  onChange,
  onAcceptSuggestion,
  onDiscardSuggestion,
  placeholder,
  suggestionLabels,
  suggestionTitle,
  suggestionValues,
  values
}: {
  label: string;
  loading?: boolean;
  name: string;
  onChange: (values: string[]) => void;
  onAcceptSuggestion?: () => void;
  onDiscardSuggestion?: () => void;
  placeholder: string;
  suggestionLabels?: { accept: string; discard: string };
  suggestionTitle?: string;
  suggestionValues?: string[];
  values: string[];
}) {
  const [draft, setDraft] = useState("");
  const suggestionReady = Boolean(suggestionValues?.length && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion);

  function addMany(raw: string) {
    const next = tokenValues(raw);
    if (next.length === 0) return;
    onChange(uniqueInOrder([...values, ...next]).slice(0, 60));
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === "Tab") && draft.trim()) {
      event.preventDefault();
      addMany(draft);
    }
    if (event.key === "Backspace" && !draft && values.length > 0) {
      event.preventDefault();
      remove(values[values.length - 1] ?? "");
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (text.includes("\n") || text.includes("\t") || text.includes(";")) {
      event.preventDefault();
      addMany(text);
    }
  }

  return (
    <label className="new-study-field token-field study-token-field">
      <span>{label}</span>
      <input name={name} type="hidden" value={values.join("\n")} />
      <div className="token-input-shell token-input-shell--tall">
        {values.map((item) => (
          <span className="token-chip" key={item}>
            {item}
            <button
              aria-label={`Remove ${item}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                remove(item);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {loading && (
          <div className="token-input-skeleton" aria-hidden="true">
            <span className="smart-skeleton-line smart-skeleton-line--chip" />
            <span className="smart-skeleton-line smart-skeleton-line--short" />
          </div>
        )}
        <input
          autoComplete="off"
          className="token-input"
          placeholder={loading ? "" : values.length === 0 ? placeholder : ""}
          value={draft}
          onBlur={() => addMany(draft)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
      {suggestionReady && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion && (
        <InlineStudySuggestion
          labels={suggestionLabels}
          title={suggestionTitle}
          onAccept={onAcceptSuggestion}
          onDiscard={onDiscardSuggestion}
        >
          <div className="field-ai-chip-preview">
            {suggestionValues?.map((value) => <span key={value}>{value}</span>)}
          </div>
        </InlineStudySuggestion>
      )}
    </label>
  );
}

function InlineStudySuggestion({
  children,
  title,
  labels,
  onAccept,
  onDiscard
}: {
  children: ReactNode;
  title: string;
  labels: { accept: string; discard: string };
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="field-ai-suggestion">
      <div className="field-ai-suggestion-head">
        <span><Icon name="sparkle" size={13} /> {title}</span>
        <div>
          <button type="button" onClick={onAccept}>{labels.accept}</button>
          <button type="button" onClick={onDiscard}>{labels.discard}</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function DataOsTraceCard({
  draft,
  methodologySlug,
  sourcePreviews = []
}: {
  draft: Draft;
  methodologySlug: string;
  sourcePreviews?: StudySourcePreview[];
}) {
  const t = useTranslations("NewStudy.trace");
  const readySourceCount = sourcePreviews.filter((source) => source.status === "ready").length;
  const traceRows = [
    {
      label: t("objective"),
      value: draft.businessQuestion.trim() ? "brand_os_objectives" : t("pending"),
      count: draft.businessQuestion.trim() ? 1 : 0
    },
    {
      label: t("brief"),
      value: "brand_os_briefs + brand_knowledge_sources",
      count: draft.studyName.trim() ? 1 : 0
    },
    {
      label: t("context"),
      value: draft.studyContext.trim() || draft.businessQuestion.length > 900 ? "brand_knowledge_sources + knowledge_chunks" : t("pending"),
      count: draft.studyContext.trim() || draft.businessQuestion.length > 900 ? 1 : 0
    },
    {
      label: t("sources"),
      value: readySourceCount > 0 ? "data_sources + data_assets + lineage_edges" : t("pending"),
      count: readySourceCount
    },
    {
      label: t("seeds"),
      value: "brand_os_seed_sets + brand_os_seed_terms",
      count: tokenValues(
        [
          draft.audienceSegment,
          draft.hypotheses,
          draft.knownTriggers,
          draft.knownBarriers,
          draft.competitiveContext,
          draft.categoryContext
        ].join("\n")
      ).length
    },
    {
      label: t("assertions"),
      value: "knowledge_assertions + usage_events",
      count: tokenValues(
        [
          draft.businessQuestion,
          draft.decisionToInform,
          draft.audienceSegment,
          draft.hypotheses,
          draft.knownTriggers,
          draft.knownBarriers,
          draft.strategicConstraints,
          draft.successCriteria
        ].join("\n")
      ).length
    },
    {
      label: t("baseline"),
      value: draft.baseCorpusId ? "brand_os_links + lineage_edges" : t("pending"),
      count: draft.baseCorpusId ? 1 : 0
    }
  ];

  return (
    <section className="study-trace-card">
      <header>
        <div>
          <p className="vitals-eyebrow">{t("eyebrow")}</p>
          <h3>{t("title")}</h3>
        </div>
        <code>{methodologySlug}</code>
      </header>
      <p>{t("copy")}</p>
      <div className="study-trace-grid">
        {traceRows.map((row) => (
          <div className="study-trace-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <small>{t("items", { count: row.count })}</small>
          </div>
        ))}
      </div>
    </section>
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
  const inputId = useId();
  return (
    <Field label={label} htmlFor={inputId}>
      <input
        id={inputId}
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
  error,
  loading = false,
  suggestionLabels,
  suggestionText,
  suggestionTitle,
  onAcceptSuggestion,
  onDiscardSuggestion
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  compact?: boolean;
  hint?: string;
  error?: string;
  loading?: boolean;
  suggestionLabels?: { accept: string; discard: string };
  suggestionText?: string;
  suggestionTitle?: string;
  onAcceptSuggestion?: () => void;
  onDiscardSuggestion?: () => void;
}) {
  const textareaId = useId();
  const suggestionReady = Boolean(suggestionText?.trim() && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion);
  return (
    <Field label={label} htmlFor={textareaId}>
      <div className="study-textarea-frame">
        <textarea
          id={textareaId}
          className={`filter-input new-study-textarea${compact ? " new-study-textarea--short" : ""}${error ? " new-study-control--error" : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={loading ? "" : placeholder}
          required={required}
        />
        {loading && (
          <div className={`smart-field-skeleton${compact ? " smart-field-skeleton--compact" : ""}`} aria-hidden="true">
            <span className="smart-skeleton-line smart-skeleton-line--wide" />
            <span className="smart-skeleton-line" />
            <span className="smart-skeleton-line smart-skeleton-line--short" />
          </div>
        )}
      </div>
      {error && <small className="new-study-field-error">{error}</small>}
      {hint && <small className="new-study-hint">{hint}</small>}
      {suggestionReady && suggestionLabels && suggestionTitle && onAcceptSuggestion && onDiscardSuggestion && (
        <InlineStudySuggestion
          labels={suggestionLabels}
          title={suggestionTitle}
          onAccept={onAcceptSuggestion}
          onDiscard={onDiscardSuggestion}
        >
          <pre>{suggestionText}</pre>
        </InlineStudySuggestion>
      )}
    </Field>
  );
}

function BaselineCorpusField({
  baselineCorpora,
  totalCandidateCount,
  selectedBaselineCorpus,
  value,
  onChange
}: {
  baselineCorpora: BaselineCorpusOption[];
  totalCandidateCount: number;
  selectedBaselineCorpus: BaselineCorpusOption | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("NewStudy.baseline");
  const emptyLabel = totalCandidateCount > 0 ? t("emptyFiltered") : t("empty");
  const options = useMemo<ComboOption[]>(
    () => [
      { value: "", label: baselineCorpora.length === 0 ? emptyLabel : t("none") },
      ...baselineCorpora.map((corpus) => ({
        value: corpus.id,
        label: [
          t(corpus.candidateType === "brand_reuse" ? "brandReuse" : "industryReuse"),
          corpus.name || corpus.subjectLabel || corpus.themeName || t("fallbackCorpus"),
          `${formatNumber(corpus.includedCount)} mentions`,
          `${corpus.methodologyName} · ${corpus.methodologyVersion}`
        ].join(" · ")
      }))
    ],
    [baselineCorpora, emptyLabel, t]
  );

  return (
    <section className="baseline-corpus-field">
      <div>
        <p className="vitals-eyebrow">{t("eyebrow")}</p>
        <h3>{t("title")}</h3>
        <p>{t("copy")}</p>
      </div>
      <div>
        <SelectField
          disabled={baselineCorpora.length === 0}
          label={t("label")}
          options={options}
          value={value}
          onChange={onChange}
        />
        {selectedBaselineCorpus && (
          <div className="baseline-corpus-selection">
            <span>{t(selectedBaselineCorpus.candidateType === "brand_reuse" ? "brandReuse" : "industryReuse")}</span>
            <strong>{selectedBaselineCorpus.name || selectedBaselineCorpus.subjectLabel || t("fallbackCorpus")}</strong>
            <small>
              {t("selected", {
                count: selectedBaselineCorpus.includedCount,
                methodology: `${selectedBaselineCorpus.methodologyName} · ${selectedBaselineCorpus.methodologyVersion}`,
                markets: selectedBaselineCorpus.geoFocus.join(", ") || "MX"
              })}
            </small>
          </div>
        )}
      </div>
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
  const productionLenses = STUDY_LENS_OPTIONS.filter((lens) => lens.status === "required");

  return (
    <section className="study-lens-plan">
      <div className="study-lens-plan-intro">
        <div>
          <p className="vitals-eyebrow">Production contract</p>
          <h3>One governed analysis path</h3>
          <p>
            Triggers &amp; Barriers is the production methodology. Brand OS, study sources, normalized observations,
            and listening evidence travel together with lineage into the Engine and Signal.
          </p>
        </div>
        <div className="study-lens-summary">
          <span>1</span>
          <small>production methodology</small>
        </div>
      </div>

      <div className="study-lens-grid">
        {productionLenses.map((lens) => {
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
              <small>{lens.locked ? "Production path" : isSelected ? "Selected" : "Add to plan"}</small>
              <em>
                {requiresCompetitors ? "Requiere peer set" : "Puede correr sin peer set"}
                {minMentions > 0 ? ` · ${minMentions}+ menciones/entidad` : ""}
              </em>
              <Icon name={isSelected ? "check" : "sparkle"} size={15} />
            </button>
          );
        })}
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
  const headerOptions = useMemo<ComboOption[]>(
    () => [
      { value: "", label: "No mapear" },
      ...headers.map((header) => ({ value: header, label: header }))
    ],
    [headers]
  );
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
                <SelectField
                  key={field}
                  label={label}
                  options={headerOptions}
                  value={mapping[field] ?? ""}
                  onChange={(value) => onMappingChange(field, value)}
                />
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
  methodologySlug,
  files,
  sourcePreviews,
  performanceFiles,
  subjectType,
  lensLabels,
  isSignalPulseStudy
}: {
  draft: Draft;
  subjectLabel: string;
  methodology: string;
  methodologySlug: string;
  files: File[];
  sourcePreviews: StudySourcePreview[];
  performanceFiles: File[];
  subjectType: "brand" | "theme";
  lensLabels: string[];
  isSignalPulseStudy: boolean;
}) {
  const t = useTranslations("NewStudy.brief");
  const readySources = sourcePreviews.filter((preview) => preview.status === "ready");
  const sourceNames = files.length > 0 ? files.map((file) => file.name) : [t("noFiles")];
  const decisionTokens = tokenValues(draft.decisionToInform);
  const audienceTokens = tokenValues(draft.audienceSegment);
  const hypothesisTokens = tokenValues(draft.hypotheses);
  const barrierTokens = tokenValues(draft.knownBarriers);
  const triggerTokens = tokenValues(draft.knownTriggers);
  const successTokens = tokenValues(draft.successCriteria);
  const constraintTokens = tokenValues(draft.strategicConstraints);
  const sourceRows = readySources.length > 0
    ? readySources.map((source) => ({
      name: source.name,
      meta: [
        source.kind,
        source.row_count ? `${formatNumber(source.row_count)} rows` : null,
        source.field_names?.length ? `${formatNumber(source.field_names.length)} fields` : null
      ].filter(Boolean).join(" · "),
      summary: source.summary || source.dataset_inventory?.slice(0, 2).join(" · ") || source.text
    }))
    : sourceNames.map((name) => ({ name, meta: "", summary: "" }));

  return (
    <div className="brief-preview">
      <section className="brief-hero">
        <div>
          <p className="vitals-eyebrow">{subjectType === "theme" ? t("themeSubject") : t("brandSubject")}</p>
          <h3>{subjectLabel}</h3>
          <p>{methodology}{lensLabels.length > 0 ? ` · ${lensLabels.join(", ")}` : ""}</p>
        </div>
        <div className="brief-hero-metrics">
          <span><strong>{readySources.length}</strong> sources</span>
          <span><strong>{decisionTokens.length}</strong> decisions</span>
          <span><strong>{audienceTokens.length}</strong> audiences</span>
        </div>
      </section>

      <BriefTextCard label={t("question")} value={draft.businessQuestion} priority />
      {draft.studyContext.trim() && <BriefTextCard label={t("studyContext")} value={draft.studyContext} collapsed />}

      <section className="brief-data-grid">
        <BriefChipCard label={t("decision")} values={decisionTokens} empty="Pending" />
        <BriefChipCard label={t("audience")} values={audienceTokens} empty="Pending" />
        <BriefChipCard label={t("hypotheses")} values={hypothesisTokens} empty="Pending" />
        <BriefChipCard label={t("knownBarriers")} values={barrierTokens} empty="Pending" />
        <BriefChipCard label={t("knownTriggers")} values={triggerTokens} empty="Pending" />
        <BriefChipCard label={t("success")} values={successTokens} empty="Pending" />
        {constraintTokens.length > 0 && <BriefChipCard label="Constraints" values={constraintTokens} />}
      </section>

      {(draft.categoryContext.trim() || draft.competitiveContext.trim()) && (
        <section className="brief-context-grid">
          {draft.categoryContext.trim() && <BriefTextCard label={t("context")} value={draft.categoryContext} />}
          {draft.competitiveContext.trim() && <BriefTextCard label={t("competitive")} value={draft.competitiveContext} />}
        </section>
      )}

      {isSignalPulseStudy && (
        <section className="brief-data-grid brief-data-grid--pulse">
          <BriefChipCard label="Budget cap" values={draft.runBudgetUsd ? [`$${draft.runBudgetUsd}`] : []} empty="Pending" />
          <BriefChipCard label="Campanas activas" values={tokenValues(draft.activeCampaigns)} empty="Pending" />
          <BriefChipCard label="Claims permitidos" values={tokenValues(draft.allowedClaims)} empty="Pending" />
          <BriefChipCard label="Claims prohibidos" values={tokenValues(draft.prohibitedClaims)} empty="Pending" />
          <BriefChipCard label="Performance estructurado" values={performanceFiles.map((file) => file.name)} empty="No files" />
        </section>
      )}

      <section className="brief-source-inventory">
        <div>
          <p className="vitals-eyebrow">{t("sources")}</p>
          <h3>Source inventory</h3>
        </div>
        <div className="brief-source-grid">
          {sourceRows.map((source) => (
            <article key={source.name}>
              <strong title={source.name}>{source.name}</strong>
              {source.meta && <small>{source.meta}</small>}
              {source.summary && <p>{source.summary}</p>}
            </article>
          ))}
        </div>
      </section>
      <DataOsTraceCard draft={draft} methodologySlug={methodologySlug} sourcePreviews={sourcePreviews} />
    </div>
  );
}

function BriefTextCard({
  collapsed = false,
  label,
  priority = false,
  value
}: {
  collapsed?: boolean;
  label: string;
  priority?: boolean;
  value: string;
}) {
  return (
    <section className={`brief-text-card${priority ? " brief-text-card--priority" : ""}${collapsed ? " brief-text-card--collapsed" : ""}`}>
      <span>{label}</span>
      <p>{value}</p>
    </section>
  );
}

function BriefChipCard({
  empty,
  label,
  values
}: {
  empty?: string;
  label: string;
  values: string[];
}) {
  const renderAsSignals = values.some((value) => value.length > 72) || values.length > 8;
  const visibleValues = renderAsSignals ? values.slice(0, 8) : values;
  const hiddenCount = Math.max(0, values.length - visibleValues.length);

  return (
    <section className={`brief-chip-card${renderAsSignals ? " brief-chip-card--signals" : ""}`}>
      <header>
        <span>{label}</span>
        <strong>{values.length}</strong>
      </header>
      <div className={renderAsSignals ? "brief-signal-list" : undefined}>
        {visibleValues.length > 0
          ? visibleValues.map((value, index) => renderAsSignals
            ? (
              <article className="brief-signal-row" key={value} title={value}>
                <span>{index + 1}</span>
                <p>{value}</p>
              </article>
            )
            : <small key={value} title={value}>{value}</small>)
          : <em>{empty ?? "Pending"}</em>}
        {hiddenCount > 0 && <em>+{hiddenCount} more tracked in Data OS</em>}
      </div>
    </section>
  );
}

function normalizeKnowledgeStatus(status: string) {
  if (status === "processed" || status === "profiled") return status;
  if (status === "failed") return "failed";
  if (status === "processing") return "processing";
  return "pending";
}

function sourceStatusLabel(source: KnowledgeSource) {
  if (source.status === "profiled") return "Data OS ready";
  if (source.status === "processed") return "processed";
  if (source.status === "processing") return "processing";
  if (source.status === "failed") return "failed";
  if (source.data_os_materialization) return "Data OS ready";
  return "pending";
}

function sourceDisplaySummary(source: KnowledgeSource, fallback: string) {
  if (source.summary) return source.summary;
  if (source.file_understanding) return source.file_understanding;
  if (source.data_os_materialization) {
    const metrics = source.source_profile?.source_metrics?.slice(0, 5).join(", ") || "metrics pending";
    const dimensions = source.source_profile?.source_dimensions?.slice(0, 5).join(", ") || "dimensions pending";
    return `Materialized in Data OS with ${formatObservationCount(source.data_os_materialization.observation_count)} observations. Metrics: ${metrics}. Dimensions: ${dimensions}.`;
  }
  return fallback;
}

function formatObservationCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
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
    countries: splitCountryList(brand.countries || "MX").map((item) => item.toUpperCase()),
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
  primaryMethodologySlug?: string,
  files: File[] = [],
  sourcePreviews: StudySourcePreview[] = [],
  submittedFieldSpecs?: StudyDataOsFieldSpecs
) {
  const analysisPlan = buildStudyAnalysisPlan(draft.selectedLensSlugs, primaryMethodologySlug);
  const isSignalPulse = primaryMethodologySlug === "signal-pulse";
  const budgetCapUsd = Number(draft.runBudgetUsd || 5);
  const sourceManifest = buildSourceManifest(files, draft.sourceKind, sourcePreviews);
  const geoFocus = splitList(draft.geoFocus).map((item) => item.toUpperCase());
  const targetWindowMonths = Number(draft.targetWindowMonths);
  const dataOsFieldSpecs = buildStudyDataOsFieldSpecs({
    submittedSpecs: submittedFieldSpecs,
    businessQuestion: draft.businessQuestion,
    decisionToInform: draft.decisionToInform,
    audienceSegment: draft.audienceSegment,
    categoryContext: draft.categoryContext,
    competitiveContext: draft.competitiveContext,
    studyContext: draft.studyContext,
    hypotheses: draft.hypotheses,
    knownBarriers: draft.knownBarriers,
    knownTriggers: draft.knownTriggers,
    strategicConstraints: draft.strategicConstraints,
    successCriteria: draft.successCriteria,
    geoFocus,
    targetWindowMonths,
    sourceManifest
  });
  if (isSignalPulse) {
    analysisPlan.marketing_brief = {
      objectives: compactLegacyText(draft.decisionToInform, 800),
      audience_priorities: compactLegacyText(draft.audienceSegment, 400),
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
    study_context: draft.studyContext,
    source_manifest: sourceManifest,
    data_os_field_specs: dataOsFieldSpecs,
    decision_to_inform: compactLegacyList(draft.decisionToInform, 800),
    audience_segment: compactLegacyList(draft.audienceSegment, 400),
    category_context: compactLegacyText(draft.categoryContext, 1200),
    hypotheses: compactLegacyList(draft.hypotheses, 1200),
    competitive_context: compactLegacyText(draft.competitiveContext, 2400),
    known_barriers: compactLegacyList(draft.knownBarriers, 1200),
    known_triggers: compactLegacyList(draft.knownTriggers, 1200),
    strategic_constraints: compactLegacyList(draft.strategicConstraints, 1200),
    success_criteria: compactLegacyList(draft.successCriteria, 1200),
    geo_focus: geoFocus,
    target_window_months: targetWindowMonths
  };
}

function compactLegacyList(value: string, maxLength: number) {
  const items = tokenValues(value);
  if (items.length === 0) return undefined;
  const output: string[] = [];
  for (const item of items) {
    const next = [...output, item].join("\n");
    if (next.length > maxLength) break;
    output.push(item);
  }
  const omitted = items.length - output.length;
  const text = output.join("\n");
  if (omitted <= 0 || text.length > maxLength - 24) return text;
  return compactLegacyText(`${text}\n+${omitted} stored in Data OS specs`, maxLength);
}

function compactLegacyText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 26)).trim()}... [Data OS full text]`;
}

function buildSourceManifest(files: File[], sourceKind: string, sourcePreviews: StudySourcePreview[]) {
  const previewsByKey = new Map(sourcePreviews.map((preview) => [sourcePreviewKey(preview), preview]));
  return files.map((file) => ({
    name: file.name,
    kind: sourceKind,
    size_bytes: file.size,
    mime_type: file.type || undefined,
    ...previewForManifest(previewsByKey.get(filePreviewKey(file)))
  }));
}

function previewForManifest(preview: StudySourcePreview | undefined) {
  if (!preview) return {};
  return {
    summary: preview.summary || undefined,
    preview_text: preview.text || undefined,
    dataset_inventory: preview.dataset_inventory,
    sheet_count: preview.sheet_count,
    row_count: preview.row_count,
    field_names: preview.field_names,
    source_profile: preview.source_profile,
    preview_status: preview.status,
    preview_error: preview.error
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
    .split(/\n|\t|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenValues(value: string) {
  return uniqueInOrder(
    splitList(value)
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  ).slice(0, 80);
}

function countryTokenValues(value: string) {
  const countryByValue = new Map(COUNTRY_OPTIONS.map((option) => [option.value.toUpperCase(), option.value]));
  return uniqueInOrder(
    splitCountryList(value || "MX").map((item) => {
      const normalized = item.toUpperCase();
      return countryByValue.get(normalized) ?? normalized;
    })
  ).slice(0, 12);
}

function splitCountryList(value: string) {
  return value
    .split(/\n|,|\t|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function writeList(values: string[]) {
  return uniqueInOrder(values).join("\n");
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
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

function filePreviewKey(file: File) {
  return `${file.name}:${file.size}`;
}

function sourcePreviewKey(preview: Pick<StudySourcePreview, "name" | "size_bytes">) {
  return `${preview.name}:${preview.size_bytes}`;
}
