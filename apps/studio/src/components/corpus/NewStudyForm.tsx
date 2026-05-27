"use client";

import { type ChangeEvent, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

export function NewStudyForm({ brands, methodologies, defaultBrandId }: NewStudyFormProps) {
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
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [engineUrl, setEngineUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const selectedBrand = brands.find((brand) => brand.id === draft.brandId) ?? null;
  const selectedMethodology = methodologies.find((methodology) => methodology.id === draft.methodologyId) ?? defaultMethodology;
  const brandLabel = brandMode === "new"
    ? inlineBrand.displayName || inlineBrand.name || "Marca nueva"
    : selectedBrand
      ? selectedBrand.displayName ?? selectedBrand.name
      : "Sin marca";

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
    setFiles(Array.from(event.target.files ?? []));
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
        if (!draft.brandId) addError(0, "brandId", "Selecciona una marca.");
        if (!draft.methodologyId) addError(0, "methodologyId", "Selecciona una metodología.");
      } else {
        if (inlineBrand.name.trim().length < 2) addError(0, "brand.name", "Pon el nombre de la marca.");
        if (inlineBrand.organizationName.trim().length < 2) addError(0, "brand.organizationName", "Pon la organización.");
      }
    }

    if (maxStep >= 1) {
      if (draft.studyName.trim().length < 3) addError(1, "studyName", "Pon un nombre de estudio.");
      if (draft.businessQuestion.trim().length < 10) {
        addError(1, "businessQuestion", "Agrega una pregunta de negocio concreta, mínimo 10 caracteres.");
      }
    }

    const ok = Object.keys(errors).length === 0;
    return {
      ok,
      errors,
      firstInvalidStep: ok ? maxStep : firstInvalidStep,
      message: ok ? "" : "Completa los campos marcados antes de seguir."
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

    try {
      let brandId = draft.brandId;
      if (brandMode === "new") {
        setProgressLabel("Creando Brand OS...");
        brandId = await createInlineBrand(inlineBrand);
      }

      setProgressLabel("Creando estudio...");
      const studyPayload = buildStudyPayload(draft, brandId);
      const res = await fetch("/api/corpora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studyPayload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json, "No se pudo crear el estudio."));

      if (files.length > 0) {
        setProgressLabel("Subiendo Knowledge Base...");
        const upload = new FormData();
        upload.set("source_kind", draft.sourceKind);
        for (const file of files) upload.append("files", file);
        const uploadRes = await fetch(`/api/corpora/${json.data.id}/knowledge`, {
          method: "POST",
          body: upload
        });
        const uploadJson = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) throw new Error(uploadJson?.message ?? "No se pudo procesar el Knowledge Base.");
        if (uploadJson.job_id) {
          await waitForJob(uploadJson.job_id, setProgressLabel);
        }
        const sources = await fetchKnowledgeSources(json.data.id);
        setKnowledgeSources(sources);
      }

      setEngineUrl(json.data.engine_url);
      setStep(4);
      setProgressLabel("Listo para lanzar Engine.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el estudio.");
      setProgressLabel(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="study-wizard-shell" onSubmit={onSubmit}>
      <aside className="study-wizard-rail" aria-label="Setup del estudio">
        <div>
          <p className="vitals-eyebrow">New study</p>
          <h2>{draft.studyName || "Nuevo estudio"}</h2>
          <p>{brandLabel} · {selectedMethodology?.name ?? "Metodología"}</p>
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
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="study-wizard-stage">
        {step === 0 && (
          <WizardPanel eyebrow="Brand OS" title="Marca y territorio competitivo">
            <div className="study-mode-switch">
              <button
                className={brandMode === "existing" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setBrandMode("existing")}
                disabled={brands.length === 0}
              >
                Marca existente
              </button>
              <button
                className={brandMode === "new" ? "study-mode study-mode--active" : "study-mode"}
                type="button"
                onClick={() => setBrandMode("new")}
              >
                Crear marca
              </button>
            </div>

            {brandMode === "existing" ? (
              <div className="new-study-grid">
                <Field label="Marca">
                  <select className="filter-input new-study-input" value={draft.brandId} onChange={(event) => updateDraft("brandId", event.target.value)} required>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.displayName ?? brand.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.brandId && <small className="new-study-field-error">{fieldErrors.brandId}</small>}
                </Field>
                <Field label="Metodología">
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
                  <TextField label="Marca" value={inlineBrand.name} onChange={(value) => updateInlineBrand("name", value)} error={fieldErrors["brand.name"]} required />
                  <TextField label="Organización" value={inlineBrand.organizationName} onChange={(value) => updateInlineBrand("organizationName", value)} error={fieldErrors["brand.organizationName"]} required />
                  <TextField label="Display name" value={inlineBrand.displayName} onChange={(value) => updateInlineBrand("displayName", value)} />
                  <TextField label="Slug" value={inlineBrand.slug} onChange={(value) => updateInlineBrand("slug", value)} />
                  <TextField
                    label="Industria"
                    value={inlineBrand.industry}
                    onChange={(value) => updateInlineBrand("industry", value)}
                    placeholder="Busca o escribe: Beauty & Personal Care, Retail..."
                    list="wizard-industry-options"
                  />
                  <TextField
                    label="Subindustria"
                    value={inlineBrand.industrySub}
                    onChange={(value) => updateInlineBrand("industrySub", value)}
                    placeholder="Busca o escribe: Makeup, Skincare..."
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
                  <TextAreaField label="Aliases / handles" value={inlineBrand.seedHandles} onChange={(value) => updateInlineBrand("seedHandles", value)} placeholder="@marca, marca sin acento..." compact />
                  <TextAreaField
                    label="Competidores"
                    value={inlineBrand.competitors}
                    onChange={(value) => updateInlineBrand("competitors", value)}
                    placeholder={"Ulta Beauty\nLiverpool\nPalacio de Hierro\nSally Beauty"}
                    hint="Sólo nombres de competidores, uno por línea. Rankings, links y research largo van en Notas de mercado."
                    compact
                  />
                </div>
                <TextAreaField label="Notas de mercado" value={inlineBrand.knowledgeNotes} onChange={(value) => updateInlineBrand("knowledgeNotes", value)} placeholder="Qué vende, promesas, restricciones, fricciones conocidas, campañas recientes..." />
              </>
            )}
          </WizardPanel>
        )}

        {step === 1 && (
          <WizardPanel eyebrow="Study Brief" title="Objetivo, hipótesis y límites">
            <TextField label="Nombre del estudio" value={draft.studyName} onChange={(value) => updateDraft("studyName", value)} error={fieldErrors.studyName} required />
            <TextAreaField label="Pregunta de negocio" value={draft.businessQuestion} onChange={(value) => updateDraft("businessQuestion", value)} error={fieldErrors.businessQuestion} required placeholder="¿Qué decisión debe habilitar este estudio?" />
            <div className="new-study-grid">
              <TextField label="Decisión interna" value={draft.decisionToInform} onChange={(value) => updateDraft("decisionToInform", value)} placeholder="Mensajes, producto, operación..." />
              <TextField label="Audiencia" value={draft.audienceSegment} onChange={(value) => updateDraft("audienceSegment", value)} placeholder="Consumidores en México" />
            </div>
            <TextAreaField label="Contexto de categoría" value={draft.categoryContext} onChange={(value) => updateDraft("categoryContext", value)} compact />
            <div className="new-study-grid">
              <TextAreaField label="Hipótesis iniciales" value={draft.hypotheses} onChange={(value) => updateDraft("hypotheses", value)} compact />
              <TextAreaField label="Restricciones estratégicas" value={draft.strategicConstraints} onChange={(value) => updateDraft("strategicConstraints", value)} compact />
              <TextAreaField label="Barriers conocidas" value={draft.knownBarriers} onChange={(value) => updateDraft("knownBarriers", value)} compact />
              <TextAreaField label="Triggers conocidos" value={draft.knownTriggers} onChange={(value) => updateDraft("knownTriggers", value)} compact />
            </div>
            <TextAreaField label="Criterio de éxito" value={draft.successCriteria} onChange={(value) => updateDraft("successCriteria", value)} compact />
            <div className="new-study-grid new-study-grid--compact">
              <TextField label="Países" value={draft.geoFocus} onChange={(value) => updateDraft("geoFocus", value)} />
              <Field label="Ventana">
                <select className="filter-input new-study-input" value={draft.targetWindowMonths} onChange={(event) => updateDraft("targetWindowMonths", event.target.value)}>
                  <option value="3">3 meses</option>
                  <option value="6">6 meses</option>
                  <option value="12">12 meses</option>
                  <option value="18">18 meses</option>
                  <option value="24">24 meses</option>
                </select>
              </Field>
            </div>
          </WizardPanel>
        )}

        {step === 2 && (
          <WizardPanel eyebrow="Knowledge Base" title="Fuentes complementarias">
            <div className="new-study-grid">
              <Field label="Tipo de fuente">
                <select className="filter-input new-study-input" value={draft.sourceKind} onChange={(event) => updateDraft("sourceKind", event.target.value)}>
                  <option value="spreadsheet_archive">Spreadsheet archive</option>
                  <option value="social_archive">Social archive</option>
                  <option value="brand_document">Documento de marca</option>
                  <option value="research_deck">Research / deck</option>
                  <option value="search_data">Search data</option>
                  <option value="scraper_export">Scraper export</option>
                </select>
              </Field>
              <Field label="Archivos">
                <input
                  className="filter-input new-study-input"
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.json,.md,text/plain,text/csv,application/json,text/markdown,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFiles}
                />
              </Field>
            </div>
            <div className="knowledge-file-list">
              {files.length === 0 ? (
                <p>No hay archivos seleccionados. Puedes lanzar Engine sólo con el brief si todavía no tienes fuentes.</p>
              ) : (
                files.map((file) => (
                  <div className="knowledge-file-row" key={`${file.name}-${file.size}`}>
                    <Icon name="upload" size={15} />
                    <span>{file.name}</span>
                    <code>{formatBytes(file.size)}</code>
                  </div>
                ))
              )}
            </div>
          </WizardPanel>
        )}

        {step === 3 && (
          <WizardPanel eyebrow="Compiled Brief" title="Lo que Noisia va a usar para arrancar">
            <BriefPreview draft={draft} brandLabel={brandLabel} methodology={selectedMethodology?.name ?? "Triggers & Barriers"} files={files} />
          </WizardPanel>
        )}

        {step === 4 && (
          <WizardPanel eyebrow="Launch" title={engineUrl ? "Estudio listo" : "Crear estudio y preparar Engine"}>
            {isSubmitting && (
              <div className="study-processing-card">
                <Icon name="spinner" size={18} />
                <div>
                  <strong>{progressLabel ?? "Preparando estudio..."}</strong>
                  <p>Estamos guardando el brief y conectando el Knowledge Base. Puedes quedarte aquí; el botón está trabajando.</p>
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
                    <p>{source.summary || source.file_understanding || "Fuente procesada sin resumen."}</p>
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
                  <strong>Listo para crear</strong>
                  <p>Se guardará el estudio, se procesará Knowledge Base y después podrás abrir Engine.</p>
                </div>
              </div>
            )}
            {engineUrl && (
              <button className="wizard-cta" type="button" onClick={() => router.push(engineUrl)}>
                <Icon name="play" size={14} /> Abrir Engine
              </button>
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
              <Icon name="arrow-right" size={13} className="icon--flip" /> Atrás
            </button>
          )}
          {step < 4 ? (
            <button className="wizard-cta" type="button" onClick={() => goToStep(Math.min(4, step + 1))} disabled={isSubmitting}>
              Siguiente <Icon name="arrow-right" size={13} />
            </button>
          ) : !engineUrl ? (
            <button className="wizard-cta" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Icon name="spinner" size={14} /> Procesando...
                </>
              ) : (
                <>
                  <Icon name="sparkle" size={14} /> Crear estudio
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
  const items = [
    ["Marca", brandLabel],
    ["Metodología", methodology],
    ["Pregunta", draft.businessQuestion],
    ["Decisión", draft.decisionToInform],
    ["Audiencia", draft.audienceSegment],
    ["Contexto", draft.categoryContext],
    ["Hipótesis", draft.hypotheses],
    ["Barriers conocidas", draft.knownBarriers],
    ["Triggers conocidos", draft.knownTriggers],
    ["Criterio de éxito", draft.successCriteria],
    ["Fuentes", files.length > 0 ? files.map((file) => file.name).join(", ") : "Sin archivos"]
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

async function createInlineBrand(brand: InlineBrand) {
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
  if (!res.ok) throw new Error(formatApiError(json, "No se pudo crear la marca."));
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
    known_barriers: draft.knownBarriers,
    known_triggers: draft.knownTriggers,
    strategic_constraints: draft.strategicConstraints,
    success_criteria: draft.successCriteria,
    geo_focus: splitList(draft.geoFocus).map((item) => item.toUpperCase()),
    target_window_months: Number(draft.targetWindowMonths)
  };
}

async function fetchKnowledgeSources(corpusId: string): Promise<KnowledgeSource[]> {
  const res = await fetch(`/api/corpora/${corpusId}/knowledge`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? "No se pudo leer el Knowledge Base procesado.");
  return Array.isArray(json.data) ? json.data : [];
}

async function waitForJob(jobId: string, onProgress: (label: string) => void) {
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message ?? "No se pudo consultar el job de Knowledge Base.");
    const progress = typeof json.progress === "number" ? json.progress : 0;
    if (json.status === "completed") {
      onProgress("Knowledge Base listo.");
      return;
    }
    if (json.status === "failed") {
      throw new Error(json.failed_reason ?? "Falló el análisis del Knowledge Base.");
    }
    onProgress(`Analizando Knowledge Base... ${Math.round(progress)}%`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("El análisis del Knowledge Base tardó demasiado.");
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

function formatApiError(json: { message?: string; details?: { fields?: Array<{ path?: string; message?: string }> } }, fallback: string) {
  const fields = json?.details?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return json?.message ?? fallback;
  return fields
    .map((field) => `${field.path || "campo"}: ${field.message || "inválido"}`)
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
