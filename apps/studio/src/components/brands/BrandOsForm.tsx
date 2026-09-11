"use client";

import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useBrandContextPreparation } from "./BrandContextPreparationNotice";
import { WorkspaceTimezoneField } from "@/components/admin/WorkspaceTimezoneField";
import { browserWorkspaceTimezone, DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/timezone-catalog";
import { Icon } from "@/components/ui/Icon";
import { COUNTRY_OPTIONS } from "@/lib/country-catalog";
import { INDUSTRY_OPTIONS, INDUSTRY_SEARCH_ALIASES, subindustriesForIndustry } from "@/lib/industry-catalog";
import { slugify } from "@/lib/slug";
import { BRAND_KNOWLEDGE_NOTES_MAX_CHARS } from "@/lib/data-os/brand-automatic-knowledge";

export type ComboOption = {
  value: string;
  label: string;
  keywords?: readonly string[];
};

export type BrandFormSurface = "study" | "workspace";

const industryOptions = INDUSTRY_OPTIONS.map((industry) => ({
  value: industry,
  label: industry,
  keywords: INDUSTRY_SEARCH_ALIASES.get(industry) ?? []
}));

export function BrandOsForm({ clientContext }: {
  clientContext?: { organizationId: string; organizationName: string };
}) {
  const t = useTranslations("BrandOs.form");
  const router = useRouter();
  const preparation = useBrandContextPreparation(false);
  const [brandValue, setBrandValue] = useState("");
  const [displayNameValue, setDisplayNameValue] = useState("");
  const [organizationValue, setOrganizationValue] = useState("");
  const [countryValues, setCountryValues] = useState(["MX"]);
  const [industryValue, setIndustryValue] = useState("");
  const [subindustryValues, setSubindustryValues] = useState<string[]>([]);
  const [descriptionValue, setDescriptionValue] = useState("");
  const [aliasValues, setAliasValues] = useState<string[]>([]);
  const [competitorValues, setCompetitorValues] = useState<string[]>([]);
  const [knowledgeNotesValue, setKnowledgeNotesValue] = useState("");
  const [timezoneValue, setTimezoneValue] = useState(DEFAULT_WORKSPACE_TIMEZONE);
  useEffect(() => { setTimezoneValue(browserWorkspaceTimezone()); }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subindustryOptions = useMemo(
    () => subindustriesForIndustry(industryValue).map((subindustry) => ({ value: subindustry, label: subindustry })),
    [industryValue]
  );

  function updateIndustry(value: string) {
    setIndustryValue(value);
  }

  function preventImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement | null;
    if (event.key !== "Enter") return;
    if (target?.tagName === "TEXTAREA" || target?.tagName === "BUTTON") return;
    event.preventDefault();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const name = brandValue.trim();
    const slug = slugify(String(form.get("slug") ?? "").trim() || name);
    const rawCompetitors = competitorValues.join("\n");
    const rawAliases = aliasValues.join("\n");
    const rawKnowledgeNotes = knowledgeNotesValue.trim();
    const payload = {
      slug,
      name,
      display_name: displayNameValue.trim() || name,
      industry: industryValue.trim(),
      industry_sub: subindustryValues.join(", "),
      countries: countryValues,
      description: descriptionValue.trim(),
      brand_seed_handles: extractSeeds(rawAliases, 32),
      competitors: extractSeeds(rawCompetitors, 24),
      knowledge_notes: rawKnowledgeNotes,
      timezone: timezoneValue,
      status: "active"
    };
    const requestPayload = clientContext ? payload : {
      ...payload,
      organization_name: organizationValue.trim()
    };

    try {
      const intent = preparation.forUnfundedRequest("create-brand", requestPayload);
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
        body: JSON.stringify({ ...requestPayload, preparation: intent })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json, t("fallbackCreateError"), t("fieldFallback"), t("invalidFallback")));
      preparation.accepted("create-brand");
      router.push(clientContext
        ? `/signal/${encodeURIComponent(json.signal_workspace.slug)}/manage/brand-os`
        : `/studio/brands/${json.data.id}/brand-os`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fallbackCreateError"));
      setIsSubmitting(false);
    }
  }

  return (
    <form className="new-study-shell brand-os-shell admin-brand-intake" onKeyDown={preventImplicitSubmit} onSubmit={onSubmit}>
      <section className="admin-section admin-intake-section admin-intake-section--raised">
        <div className="new-study-section-head">
          <p className="vitals-eyebrow">{t("identityEyebrow")}</p>
          <h2>{t("identityTitle")}</h2>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>{t("brand")}</span>
            <input className="filter-input new-study-input" name="name" required minLength={2} maxLength={160} value={brandValue} onChange={(event) => setBrandValue(event.target.value)} />
          </label>
          <label className="new-study-field">
            <span>{t("displayName")}</span>
            <input className="filter-input new-study-input" name="display_name" maxLength={160} value={displayNameValue} onChange={(event) => setDisplayNameValue(event.target.value)} />
          </label>
        </div>

        <div className="new-study-grid">
          <label className="new-study-field">
            <span>{t("organization")}</span>
            {clientContext
              ? <span className="filter-input new-study-input" aria-readonly="true">{clientContext.organizationName}</span>
              : <input className="filter-input new-study-input" name="organization_name" required minLength={2} maxLength={180} value={organizationValue} onChange={(event) => setOrganizationValue(event.target.value)} />}
          </label>
          <label className="new-study-field">
            <span>{t("slug")}</span>
            <input className="filter-input new-study-input" name="slug" placeholder={t("slugPlaceholder")} />
          </label>
        </div>

        <div className="new-study-grid">
          <TokenCatalogField
            label={t("countries")}
            name="countries"
            options={COUNTRY_OPTIONS}
            placeholder={t("countryPlaceholder")}
            values={countryValues}
            onChange={setCountryValues}
          />
          <CatalogCombobox
            label={t("industry")}
            name="industry"
            options={industryOptions}
            placeholder={t("industryPlaceholder")}
            required
            value={industryValue}
            onChange={updateIndustry}
          />
        </div>

        <div className="new-study-grid">
          <WorkspaceTimezoneField value={timezoneValue} onChange={setTimezoneValue} surface="study" disabled={isSubmitting} />
          <div aria-hidden="true" />
        </div>

        <div className="new-study-grid">
          <TokenCatalogField
            allowCustom
            disabled={!industryValue.trim()}
            disabledHint={t("subindustryDisabled")}
            label={t("subindustry")}
            name="industry_sub"
            options={subindustryOptions}
            placeholder={t("subindustryPlaceholder")}
            values={subindustryValues}
            onChange={setSubindustryValues}
          />
          <div aria-hidden="true" />
        </div>
      </section>

      <section className="admin-section admin-intake-section">
        <div className="new-study-section-head">
          <p className="vitals-eyebrow">{t("seedsEyebrow")}</p>
          <h2>{t("seedsTitle")}</h2>
        </div>

        <div className="new-study-grid">
          <TokenInputField
            label={t("aliases")}
            name="brand_seed_handles"
            placeholder={t("aliasesPlaceholder")}
            values={aliasValues}
            onChange={setAliasValues}
          />
          <TokenInputField
            label={t("competitors")}
            name="competitors"
            placeholder="Ulta Beauty, Liverpool, Palacio de Hierro..."
            values={competitorValues}
            onChange={setCompetitorValues}
          />
        </div>

        <SmartTextareaField
          label={t("description")}
          maxLength={12000}
          name="description"
          value={descriptionValue}
          onChange={setDescriptionValue}
        />

        <small className="new-study-hint">
          {t("competitorsHint")}
        </small>

        <SmartTextareaField
          label={t("notes")}
          maxLength={BRAND_KNOWLEDGE_NOTES_MAX_CHARS}
          name="knowledge_notes"
          placeholder={t("notesPlaceholder")}
          value={knowledgeNotesValue}
          onChange={setKnowledgeNotesValue}
        />
      </section>

      <footer className="new-study-actions admin-intake-actions">
        {error && (
          <p className="new-study-error" role="alert">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
        <button className="admin-button admin-button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Icon name="spinner" size={14} /> {t("creating")}
            </>
          ) : (
            <>
              <Icon name="save" size={14} /> {t("create")}
            </>
          )}
        </button>
      </footer>
    </form>
  );
}

function SmartTextareaField({
  label,
  maxLength,
  name,
  placeholder,
  value,
  onChange
}: {
  label: string;
  maxLength?: number;
  name: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <label className="new-study-field new-study-field--wide">
      <span>{label}</span>
      <div className={`smart-textarea-wrap${expanded ? " smart-textarea-wrap--expanded" : ""}`}>
        <button
          aria-label={expanded ? "Collapse field" : "Expand field"}
          className="textarea-expand-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? "minimize" : "maximize"} size={14} />
        </button>
        <textarea
          className="filter-input new-study-textarea new-study-textarea--expandable"
          maxLength={maxLength}
          name={name}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}

export function ExpandableTextareaField({
  defaultValue,
  label,
  maxLength,
  name,
  placeholder,
  surface = "study"
}: {
  defaultValue?: string;
  label: string;
  maxLength?: number;
  name: string;
  placeholder?: string;
  surface?: BrandFormSurface;
}) {
  const [expanded, setExpanded] = useState(false);

  if (surface === "workspace") {
    return (
      <label className="workspace-field workspace-field--wide">
        <span>{label}</span>
        <textarea
          className="workspace-control workspace-control--textarea"
          defaultValue={defaultValue}
          maxLength={maxLength}
          name={name}
          placeholder={placeholder}
        />
      </label>
    );
  }

  return (
    <label className="new-study-field new-study-field--wide">
      <span>{label}</span>
      <div className={`smart-textarea-wrap${expanded ? " smart-textarea-wrap--expanded" : ""}`}>
        <button
          aria-label={expanded ? "Collapse field" : "Expand field"}
          className="textarea-expand-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? "minimize" : "maximize"} size={14} />
        </button>
        <textarea
          className="filter-input new-study-textarea new-study-textarea--expandable"
          defaultValue={defaultValue}
          maxLength={maxLength}
          name={name}
          placeholder={placeholder}
        />
      </div>
    </label>
  );
}

export function CatalogCombobox({
  disabled = false,
  disabledHint,
  label,
  name,
  options,
  placeholder,
  required = false,
  surface = "study",
  value,
  onChange
}: {
  disabled?: boolean;
  disabledHint?: string;
  label: string;
  name: string;
  options: readonly ComboOption[];
  placeholder: string;
  required?: boolean;
  surface?: BrandFormSurface;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const normalizedValue = value.trim().toLowerCase();
  const exactMatch = options.some((option) => option.value.toLowerCase() === normalizedValue);
  const visibleOptions = (browseAll || exactMatch || !normalizedValue
    ? options
    : options.filter((option) => optionMatches(option, normalizedValue))
  ).slice(0, 10);
  const showCustom = value.trim() && !exactMatch && !disabled;

  function openCatalog() {
    if (disabled) return;
    setBrowseAll(true);
    setIsOpen(true);
    setActiveIndex(0);
  }

  function selectOption(option: ComboOption) {
    onChange(option.value);
    setIsOpen(false);
    setBrowseAll(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleOptions.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const exact = options.find((option) => {
        const normalizedOption = option.value.toLowerCase();
        return normalizedOption === normalizedValue || option.label.toLowerCase() === normalizedValue;
      });
      const filtered = normalizedValue ? options.filter((option) => optionMatches(option, normalizedValue)) : visibleOptions;
      if (exact) {
        selectOption(exact);
      } else if (filtered.length === 1 && filtered[0]) {
        selectOption(filtered[0]);
      } else if (!normalizedValue && isOpen && visibleOptions[activeIndex]) {
        selectOption(visibleOptions[activeIndex]);
      } else {
        setIsOpen(false);
      }
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <label className={`${surface === "workspace" ? "workspace-field" : "new-study-field"} catalog-combo${disabled ? " catalog-combo--disabled" : ""}`}>
      <span>{label}</span>
      <div className="catalog-combo-control">
        <input
          autoComplete="off"
          className={surface === "workspace" ? "workspace-control" : "filter-input new-study-input"}
          disabled={disabled}
          name={name}
          placeholder={disabled ? disabledHint ?? placeholder : placeholder}
          required={required}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={value}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onChange={(event) => {
            onChange(event.target.value);
            setBrowseAll(false);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={openCatalog}
          onKeyDown={onKeyDown}
        />
        <button
          aria-label={`Open ${label} catalog`}
          className="catalog-combo-trigger"
          disabled={disabled}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            if (isOpen) {
              setIsOpen(false);
            } else {
              openCatalog();
            }
          }}
        >
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {isOpen && (
        <div className="catalog-combo-menu" id={listboxId} role="listbox">
          {visibleOptions.map((option, index) => {
            const isSelected = option.value.toLowerCase() === normalizedValue;
            return (
              <button
                aria-selected={isSelected}
                className="catalog-combo-option"
                data-highlighted={index === activeIndex ? "true" : undefined}
                key={option.value}
                type="button"
                role="option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Icon aria-hidden name="check" size={14} /> : null}
              </button>
            );
          })}
          {showCustom && (
            <button
              className="catalog-combo-option catalog-combo-option--custom"
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(value.trim());
                setIsOpen(false);
              }}
            >
              Use custom: {value.trim()}
            </button>
          )}
          {visibleOptions.length === 0 && !showCustom && (
            <span className="catalog-combo-empty">No catalog matches.</span>
          )}
        </div>
      )}
    </label>
  );
}

export function TokenCatalogField({
  allowCustom = false,
  disabled = false,
  disabledHint,
  label,
  name,
  options,
  placeholder,
  surface = "study",
  values,
  onChange
}: {
  allowCustom?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  label: string;
  name: string;
  options: readonly ComboOption[];
  placeholder: string;
  surface?: BrandFormSurface;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const selected = new Set(values);
  const normalizedDraft = draft.trim().toLowerCase();
  const matches = options
    .filter((option) => !selected.has(option.value))
    .filter((option) => !normalizedDraft || optionMatches(option, normalizedDraft))
    .slice(0, 8);
  const canUseCustom = allowCustom && draft.trim().length >= 2 && !matches.some((option) => option.value.toLowerCase() === normalizedDraft);

  function add(value: string) {
    const cleaned = value.trim();
    if (!cleaned || selected.has(cleaned)) return;
    onChange([...values, cleaned]);
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  function openCatalog() {
    if (disabled) return;
    setIsOpen(true);
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if ((event.key === "Enter" || event.key === "Tab") && draft.trim()) {
      event.preventDefault();
      const exact = matches.find((option) => option.value.toLowerCase() === normalizedDraft || option.label.toLowerCase() === normalizedDraft);
      const selectedOption = exact ?? matches[activeIndex];
      if (selectedOption) {
        add(selectedOption.value);
      } else if (allowCustom) {
        add(draft);
      }
    }
    if (event.key === "Enter" && !draft.trim()) {
      event.preventDefault();
      openCatalog();
    }
    if (event.key === "Backspace" && !draft && values.length > 0) {
      event.preventDefault();
      remove(values[values.length - 1] ?? "");
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <label className={`${surface === "workspace" ? "workspace-field" : "new-study-field"} token-field${disabled ? " catalog-combo--disabled" : ""}`}>
      <span>{label}</span>
      <input name={name} type="hidden" value={values.join(", ")} />
      <div
        className={`token-input-shell token-input-shell--with-trigger${surface === "workspace" ? " workspace-token-input" : ""}`}
        onClick={() => {
          openCatalog();
        }}
      >
        {values.map((value) => (
          <Token key={value} label={options.find((option) => option.value === value)?.label ?? value} onRemove={() => remove(value)} surface={surface} />
        ))}
        <input
          autoComplete="off"
          className="token-input"
          disabled={disabled}
          placeholder={disabled ? disabledHint ?? placeholder : values.length === 0 ? placeholder : ""}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          value={draft}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            openCatalog();
          }}
          onKeyDown={onKeyDown}
        />
        <button
          aria-label={`Open ${label} catalog`}
          className="token-input-trigger"
          disabled={disabled}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            if (isOpen) {
              setIsOpen(false);
            } else {
              openCatalog();
            }
          }}
        >
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {isOpen && !disabled && (matches.length > 0 || canUseCustom) && (
        <div className="token-field-menu" id={listboxId} role="listbox">
          {matches.map((option, index) => (
            <button
              aria-selected="false"
              className="catalog-combo-option"
              data-highlighted={index === activeIndex ? "true" : undefined}
              key={option.value}
              onMouseDown={(event) => {
                event.preventDefault();
                add(option.value);
                setIsOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
            </button>
          ))}
          {canUseCustom && (
            <button
              type="button"
              className="catalog-combo-option catalog-combo-option--custom"
              role="option"
              aria-selected={false}
              onMouseDown={(event) => {
                event.preventDefault();
                add(draft);
                setIsOpen(false);
              }}
            >
              Use custom: {draft.trim()}
            </button>
          )}
        </div>
      )}
    </label>
  );
}

export function TokenInputField({
  label,
  name,
  placeholder,
  surface = "study",
  values,
  onChange
}: {
  label: string;
  name: string;
  placeholder: string;
  surface?: BrandFormSurface;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addMany(raw: string) {
    const next = extractSeeds(raw, 80);
    if (next.length === 0) return;
    onChange(Array.from(new Set([...values, ...next])).slice(0, 80));
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      if (draft.trim()) {
        event.preventDefault();
        addMany(draft);
      }
    }
    if (event.key === "Backspace" && !draft && values.length > 0) {
      event.preventDefault();
      remove(values[values.length - 1] ?? "");
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (text.includes("\n") || text.includes(",") || text.includes("\t")) {
      event.preventDefault();
      addMany(text);
    }
  }

  return (
    <label className={`${surface === "workspace" ? "workspace-field" : "new-study-field"} token-field`}>
      <span>{label}</span>
      <input name={name} type="hidden" value={values.join("\n")} />
      <div className={`token-input-shell token-input-shell--tall${surface === "workspace" ? " workspace-token-input" : ""}`}>
        {values.map((value) => (
          <Token key={value} label={value} onRemove={() => remove(value)} surface={surface} />
        ))}
        <input
          autoComplete="off"
          className="token-input"
          placeholder={values.length === 0 ? placeholder : ""}
          value={draft}
          onBlur={() => addMany(draft)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
    </label>
  );
}

function Token({
  label,
  onRemove,
  surface = "study"
}: {
  label: string;
  onRemove: () => void;
  surface?: BrandFormSurface;
}) {
  return (
    <span className={surface === "workspace" ? "workspace-chip" : "token-chip"}>
      {label}
      <button
        aria-label={`Remove ${label}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

function splitList(value: string) {
  return value
    .split(/\n|,|\t/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionMatches(option: ComboOption, normalizedQuery: string) {
  return [option.label, option.value, ...(option.keywords ?? [])].some((value) =>
    value.toLowerCase().includes(normalizedQuery)
  );
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

function formatApiError(
  json: { message?: string; details?: { fields?: Array<{ path?: string; message?: string }> } },
  fallback: string,
  fieldFallback: string,
  invalidFallback: string
) {
  const fields = json?.details?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return json?.message ?? fallback;
  return fields
    .map((field) => `${field.path || fieldFallback}: ${field.message || invalidFallback}`)
    .join(" · ");
}
