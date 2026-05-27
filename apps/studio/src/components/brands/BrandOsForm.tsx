"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { INDUSTRY_OPTIONS, subindustriesForIndustry } from "@/lib/industry-catalog";

export function BrandOsForm() {
  const router = useRouter();
  const [industryValue, setIndustryValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim() || slugify(name);
    const rawCompetitors = String(form.get("competitors") ?? "").trim();
    const rawKnowledgeNotes = String(form.get("knowledge_notes") ?? "").trim();
    const payload = {
      organization_name: String(form.get("organization_name") ?? "").trim(),
      slug,
      name,
      display_name: String(form.get("display_name") ?? "").trim() || name,
      industry: String(form.get("industry") ?? "").trim(),
      industry_sub: String(form.get("industry_sub") ?? "").trim(),
      countries: splitList(String(form.get("countries") ?? "MX")).map((item) => item.toUpperCase()),
      description: String(form.get("description") ?? "").trim(),
      brand_seed_handles: extractSeeds(String(form.get("brand_seed_handles") ?? ""), 32),
      competitors: extractSeeds(rawCompetitors, 24),
      knowledge_notes: withRawContext(rawKnowledgeNotes, "Competidores / research pegado", rawCompetitors),
      status: "active"
    };

    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json, "No se pudo crear la marca."));
      router.push(`/studio/brands/${json.data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la marca.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="new-study-shell brand-os-shell" onSubmit={onSubmit}>
      <section className="new-study-panel">
        <div className="new-study-section-head">
          <p className="vitals-eyebrow">Brand OS</p>
          <h2>Identidad y categoría</h2>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>Marca</span>
            <input className="filter-input new-study-input" name="name" required minLength={2} maxLength={160} />
          </label>
          <label className="new-study-field">
            <span>Display name</span>
            <input className="filter-input new-study-input" name="display_name" maxLength={160} />
          </label>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>Organización</span>
            <input className="filter-input new-study-input" name="organization_name" required minLength={2} maxLength={180} />
          </label>
          <label className="new-study-field">
            <span>Slug</span>
            <input className="filter-input new-study-input" name="slug" placeholder="se-autogenera si lo dejas vacío" />
          </label>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>Industria</span>
            <input
              className="filter-input new-study-input"
              name="industry"
              list="industry-options"
              placeholder="Busca o escribe: Beauty & Personal Care, Retail..."
              value={industryValue}
              onChange={(event) => setIndustryValue(event.target.value)}
            />
            <datalist id="industry-options">
              {INDUSTRY_OPTIONS.map((industry) => <option key={industry} value={industry} />)}
            </datalist>
          </label>
          <label className="new-study-field">
            <span>Subindustria</span>
            <input
              className="filter-input new-study-input"
              name="industry_sub"
              list="subindustry-options"
              placeholder="Busca o escribe: Makeup, Skincare, Department Stores..."
            />
            <datalist id="subindustry-options">
              {subindustriesForIndustry(industryValue).map((subindustry) => (
                <option key={subindustry} value={subindustry} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="new-study-field new-study-field--wide">
          <span>Descripción estratégica</span>
          <textarea className="filter-input new-study-textarea" name="description" maxLength={12000} />
        </label>
      </section>

      <section className="new-study-panel">
        <div className="new-study-section-head">
          <p className="vitals-eyebrow">Knowledge seeds</p>
          <h2>Aliases, competidores y contexto base</h2>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>Países</span>
            <input className="filter-input new-study-input" name="countries" defaultValue="MX" />
          </label>
          <label className="new-study-field">
            <span>Aliases / handles</span>
            <textarea
              className="filter-input new-study-textarea new-study-textarea--short"
              name="brand_seed_handles"
              placeholder="@marca, marca sin acento, app..."
            />
          </label>
        </div>

        <label className="new-study-field new-study-field--wide">
          <span>Competidores</span>
          <textarea
            className="filter-input new-study-textarea new-study-textarea--short"
            name="competitors"
            placeholder={"Ulta Beauty\nLiverpool\nPalacio de Hierro\nSally Beauty"}
          />
          <small className="new-study-hint">
            Sólo nombres de competidores, uno por línea. No pegues rankings, links, tablas o bullets de ChatGPT aquí; eso va en Notas de Knowledge Base.
          </small>
        </label>

        <label className="new-study-field new-study-field--wide">
          <span>Notas de Knowledge Base</span>
          <textarea
            className="filter-input new-study-textarea"
            name="knowledge_notes"
            placeholder="Qué vende, qué promete, fricciones conocidas, canales importantes, campañas recientes, restricciones legales u operativas..."
          />
        </label>
      </section>

      <footer className="new-study-actions">
        {error && (
          <p className="new-study-error">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
        <button className="wizard-cta" type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Icon name="spinner" size={14} /> Creando...
            </>
          ) : (
            <>
              <Icon name="sparkle" size={14} /> Crear Brand OS
            </>
          )}
        </button>
      </footer>
    </form>
  );
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
