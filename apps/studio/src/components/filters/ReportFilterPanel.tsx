"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/ui/Icon";
import { SourceIcon } from "@/components/ui/SourceIcon";

export type FilterOption = {
  label: string;
  value: string;
  count?: number;
  source?: string;
};

export type FilterControl =
  | {
      type: "search";
      name: string;
      label: string;
      placeholder: string;
      value?: string;
      icon?: IconName;
    }
  | {
      type: "single";
      name: string;
      label: string;
      allLabel: string;
      value?: string;
      options: FilterOption[];
      icon?: IconName;
    }
  | {
      type: "date-range";
      label: string;
      fromName: string;
      toName: string;
      fromValue?: string;
      toValue?: string;
      minDate?: string;
      maxDate?: string;
      icon?: IconName;
    };

type Values = Record<string, string>;

type Props = {
  title?: string;
  eyebrow?: string;
  resultLabel?: string;
  resultCount: number;
  controls: FilterControl[];
  open: boolean;
  onClose: () => void;
  onApplyStart?: () => void;
};

export function ReportFilterPanel({
  title = "Filter & Sort",
  eyebrow = "Explorar corpus",
  resultLabel = "resultados",
  resultCount,
  controls,
  open,
  onClose,
  onApplyStart,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [openControl, setOpenControl] = useState<string | null>(null);
  const [openDateControl, setOpenDateControl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [values, setValues] = useState<Values>(() => initialValues(controls));
  const activeCount = useMemo(
    () => Object.values(values).filter((value) => value.trim().length > 0).length,
    [values]
  );

  useEffect(() => {
    setValues(initialValues(controls));
    setOpenControl(null);
    setOpenDateControl(null);
    setIsApplying(false);
  }, [controls]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    if (open) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function applyFilters() {
    // TODO mejora-futura: conectar este panel a saved views y filtros semanticos con AI cuando los reportes lo necesiten.
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      const trimmed = value.trim();
      if (trimmed.length > 0) params.set(key, trimmed);
    }
    const query = params.toString();
    setIsApplying(true);
    onApplyStart?.();
    setOpenControl(null);
    setOpenDateControl(null);
    onClose();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  }

  function resetFilters() {
    const reset = Object.fromEntries(Object.keys(values).map((key) => [key, ""]));
    setValues(reset);
    setIsApplying(true);
    onApplyStart?.();
    setOpenControl(null);
    setOpenDateControl(null);
    onClose();
    router.push(pathname);
  }

  return (
    <div className={`report-filter-shell${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button className="report-filter-scrim" onClick={onClose} tabIndex={open ? 0 : -1} type="button" />
      <aside aria-label={title} className="report-filter-panel" role="dialog">
        <header className="report-filter-head">
          <div>
            <p className="report-filter-eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="report-filter-close" onClick={onClose} type="button">
            <Icon name="x" size={18} />
            <span>Cerrar</span>
          </button>
        </header>

        <button className="report-filter-reset" onClick={resetFilters} type="button">
          <Icon name="refresh" size={14} />
          Reset
          {activeCount > 0 ? <span>{activeCount}</span> : null}
        </button>

        <div className="report-filter-grid">
          {controls.map((control) => {
            if (control.type === "search") {
              return (
                <label className="report-filter-search" key={control.name}>
                  <span>{control.label}</span>
                  <div className="report-filter-input-wrap">
                    <Icon name={control.icon ?? "search"} size={16} />
                    <input
                      onChange={(event) => setValue(control.name, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") applyFilters();
                      }}
                      onFocus={() => {
                        setOpenControl(null);
                        setOpenDateControl(null);
                      }}
                      placeholder={control.placeholder}
                      type="text"
                      value={values[control.name] ?? ""}
                    />
                  </div>
                </label>
              );
            }

            if (control.type === "date-range") {
              return (
                <div className="report-filter-date" key={`${control.fromName}-${control.toName}`}>
                  <span className="report-filter-label">
                    <Icon name={control.icon ?? "calendar"} size={13} />
                    {control.label}
                  </span>
                  <div className="report-filter-date-row">
                    <DateBox
                      isOpen={openDateControl === control.fromName}
                      label="Desde"
                      maxDate={control.maxDate}
                      minDate={control.minDate}
                      name={control.fromName}
                      onClose={() => setOpenDateControl(null)}
                      onChange={setValue}
                      onToggle={() => {
                        setOpenControl(null);
                        setOpenDateControl((current) => (current === control.fromName ? null : control.fromName));
                      }}
                      value={values[control.fromName] ?? ""}
                    />
                    <DateBox
                      isOpen={openDateControl === control.toName}
                      label="Hasta"
                      maxDate={control.maxDate}
                      minDate={control.minDate}
                      name={control.toName}
                      onClose={() => setOpenDateControl(null)}
                      onChange={setValue}
                      onToggle={() => {
                        setOpenControl(null);
                        setOpenDateControl((current) => (current === control.toName ? null : control.toName));
                      }}
                      value={values[control.toName] ?? ""}
                    />
                  </div>
                  <DatePresets
                    fromName={control.fromName}
                    maxDate={control.maxDate}
                    minDate={control.minDate}
                    onChange={setValue}
                    toName={control.toName}
                  />
                </div>
              );
            }

            const selected = control.options.find((option) => option.value === values[control.name]);
            const isOpen = openControl === control.name;

            return (
              <div className="report-filter-control" key={control.name}>
                <span className="report-filter-label">
                  <Icon name={control.icon ?? "tag"} size={13} />
                  {control.label}
                </span>
                <button
                  aria-expanded={isOpen}
                  className={`report-filter-trigger${selected ? " report-filter-trigger--active" : ""}`}
                  onClick={() => {
                    setOpenDateControl(null);
                    setOpenControl(isOpen ? null : control.name);
                  }}
                  type="button"
                >
                  <span className="report-filter-trigger-label">
                    {selected?.source ? <SourceIcon value={selected.source} /> : null}
                    <span>{selected?.label ?? control.allLabel}</span>
                  </span>
                  {selected?.count !== undefined ? <strong>{formatCount(selected.count)}</strong> : null}
                  <Icon name="chevron-down" size={14} />
                </button>
                {isOpen ? (
                  <div className="report-filter-popover">
                    <button
                      className={!values[control.name] ? "is-selected" : ""}
                      onClick={() => {
                        setValue(control.name, "");
                        setOpenControl(null);
                      }}
                      type="button"
                    >
                      <span>{control.allLabel}</span>
                    </button>
                    {control.options.map((option) => (
                      <button
                        className={values[control.name] === option.value ? "is-selected" : ""}
                        key={option.value}
                        onClick={() => {
                          setValue(control.name, option.value);
                          setOpenControl(null);
                        }}
                        type="button"
                      >
                        <span className="report-filter-option-label">
                          {option.source ? <SourceIcon value={option.source} /> : null}
                          <span>{option.label}</span>
                        </span>
                        {option.count !== undefined ? <strong>{formatCount(option.count)}</strong> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <footer className="report-filter-footer">
          <div className="report-filter-summary">
            <strong>{formatCount(resultCount)}</strong>
            <span>{resultLabel}</span>
          </div>
          <div className="report-filter-actions">
            <button className="wizard-cta wizard-cta--ghost" onClick={resetFilters} type="button">
              <Icon name="sparkle" size={14} />
              Limpiar
            </button>
            <button className="wizard-cta wizard-cta--secondary" onClick={resetFilters} type="button">
              <Icon name="refresh" size={14} />
              Reset
            </button>
            <button
              className="wizard-cta report-filter-apply"
              disabled={isApplying}
              onClick={applyFilters}
              type="button"
            >
              <Icon name={isApplying ? "spinner" : "filter"} size={14} />
              {isApplying ? "Aplicando..." : "Aplicar filtros"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function DateBox({
  isOpen,
  label,
  maxDate,
  minDate,
  name,
  value,
  onClose,
  onChange,
  onToggle,
}: {
  isOpen: boolean;
  label: string;
  maxDate?: string;
  minDate?: string;
  name: string;
  value: string;
  onClose: () => void;
  onChange: (name: string, value: string) => void;
  onToggle: () => void;
}) {
  const selectedDate = parseYmd(value);
  const minBoundary = parseYmd(minDate ?? "");
  const maxBoundary = parseYmd(maxDate ?? "");
  const [viewDate, setViewDate] = useState(() => selectedDate ?? maxBoundary ?? new Date());
  const [mode, setMode] = useState<"day" | "month" | "year">("day");
  const days = useMemo(() => buildCalendarDays(viewDate), [viewDate]);
  const years = useMemo(() => buildSelectableYears(minBoundary, maxBoundary), [minBoundary, maxBoundary]);

  useEffect(() => {
    const nextDate = parseYmd(value);
    if (nextDate) setViewDate(nextDate);
  }, [value]);

  function selectDate(date: Date) {
    if (isOutsideRange(date, minBoundary, maxBoundary)) return;
    onChange(name, toYmd(date));
    onClose();
  }

  function selectMonth(month: number) {
    const nextDate = clampDate(new Date(viewDate.getFullYear(), month, 1), minBoundary, maxBoundary);
    setViewDate(nextDate);
    setMode("day");
  }

  function selectYear(year: number) {
    const nextDate = clampDate(new Date(year, viewDate.getMonth(), 1), minBoundary, maxBoundary);
    setViewDate(nextDate);
    setMode("month");
  }

  return (
    <div className="report-filter-date-box">
      <button
        aria-expanded={isOpen}
        className={value ? "report-filter-date-button is-selected" : "report-filter-date-button"}
        onClick={onToggle}
        type="button"
      >
        <span>{label}</span>
        <strong>{value || "AAAA-MM-DD"}</strong>
        <Icon name="calendar" size={14} />
      </button>
      {isOpen ? (
        <div className="report-date-picker">
          <div className="report-date-picker-head">
            <button
              disabled={isPrevMonthDisabled(viewDate, minBoundary)}
              onClick={() => setViewDate(shiftMonth(viewDate, -1))}
              type="button"
            >
              <Icon className="icon--flip" name="arrow-right" size={13} />
            </button>
            <button className="report-date-title" onClick={() => setMode(mode === "day" ? "year" : "day")} type="button">
              {mode === "year" ? "Seleccionar año" : mode === "month" ? String(viewDate.getFullYear()) : formatMonth(viewDate)}
            </button>
            <button
              disabled={isNextMonthDisabled(viewDate, maxBoundary)}
              onClick={() => setViewDate(shiftMonth(viewDate, 1))}
              type="button"
            >
              <Icon name="arrow-right" size={13} />
            </button>
          </div>
          {mode === "year" ? (
            <div className="report-date-year-grid">
              {years.map((year) => (
                <button
                  className={year === viewDate.getFullYear() ? "is-selected" : ""}
                  key={year}
                  onClick={() => selectYear(year)}
                  type="button"
                >
                  {year}
                </button>
              ))}
            </div>
          ) : mode === "month" ? (
            <div className="report-date-month-grid">
              {monthLabels.map((month, index) => {
                const candidate = new Date(viewDate.getFullYear(), index, 1);
                const disabled = isMonthOutsideRange(candidate, minBoundary, maxBoundary);
                return (
                  <button
                    className={index === viewDate.getMonth() ? "is-selected" : ""}
                    disabled={disabled}
                    key={month}
                    onClick={() => selectMonth(index)}
                    type="button"
                  >
                    {month}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="report-date-weekdays">
                {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="report-date-grid">
                {days.map((day) => {
                  const disabled = isOutsideRange(day.date, minBoundary, maxBoundary);
                  return (
                    <button
                      className={[
                        day.inMonth ? "" : "is-muted",
                        selectedDate && sameDay(day.date, selectedDate) ? "is-selected" : "",
                        sameDay(day.date, new Date()) ? "is-today" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={disabled}
                      key={toYmd(day.date)}
                      onClick={() => selectDate(day.date)}
                      type="button"
                    >
                      {day.date.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="report-date-picker-foot">
            <button onClick={() => setMode("year")} type="button">
              Año
            </button>
            <button onClick={() => setMode("month")} type="button">
              Mes
            </button>
            <button
              onClick={() => {
                onChange(name, "");
                onClose();
              }}
              type="button"
            >
              Limpiar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DatePresets({
  fromName,
  maxDate,
  minDate,
  onChange,
  toName,
}: {
  fromName: string;
  maxDate?: string;
  minDate?: string;
  onChange: (name: string, value: string) => void;
  toName: string;
}) {
  const minBoundary = parseYmd(minDate ?? "");
  const maxBoundary = parseYmd(maxDate ?? "");
  const anchor = maxBoundary ?? new Date();
  const presets = [
    { label: "7D", from: shiftDay(anchor, -6), to: anchor },
    { label: "30D", from: shiftDay(anchor, -29), to: anchor },
    { label: "90D", from: shiftDay(anchor, -89), to: anchor },
    { label: "Mes", from: new Date(anchor.getFullYear(), anchor.getMonth(), 1), to: anchor },
    { label: "Todo", from: minBoundary ?? shiftDay(anchor, -364), to: anchor },
  ];

  return (
    <div className="report-date-presets">
      {presets.map((preset) => {
        const from = clampDate(preset.from, minBoundary, maxBoundary);
        const to = clampDate(preset.to, minBoundary, maxBoundary);
        return (
          <button
            key={preset.label}
            onClick={() => {
              onChange(fromName, toYmd(from));
              onChange(toName, toYmd(to));
            }}
            type="button"
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

function initialValues(controls: FilterControl[]) {
  const values: Values = {};

  for (const control of controls) {
    if (control.type === "date-range") {
      values[control.fromName] = control.fromValue ?? "";
      values[control.toName] = control.toValue ?? "";
    } else {
      values[control.name] = control.value ?? "";
    }
  }

  return values;
}

function parseYmd(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toYmd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftMonth(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function shiftDay(date: Date, amount: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildCalendarDays(viewDate: Date) {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      inMonth: date.getMonth() === viewDate.getMonth(),
    };
  });
}

const monthLabels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function buildSelectableYears(minDate: Date | null, maxDate: Date | null) {
  const currentYear = new Date().getFullYear();
  const minYear = minDate?.getFullYear() ?? currentYear - 9;
  const maxYear = maxDate?.getFullYear() ?? currentYear;
  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index);
}

function isOutsideRange(date: Date, minDate: Date | null, maxDate: Date | null) {
  const day = startOfDay(date).getTime();
  if (minDate && day < startOfDay(minDate).getTime()) return true;
  if (maxDate && day > startOfDay(maxDate).getTime()) return true;
  return false;
}

function isMonthOutsideRange(date: Date, minDate: Date | null, maxDate: Date | null) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime();
  if (minDate && monthEnd < startOfDay(minDate).getTime()) return true;
  if (maxDate && monthStart > startOfDay(maxDate).getTime()) return true;
  return false;
}

function isPrevMonthDisabled(date: Date, minDate: Date | null) {
  return Boolean(minDate && new Date(date.getFullYear(), date.getMonth(), 0) < startOfDay(minDate));
}

function isNextMonthDisabled(date: Date, maxDate: Date | null) {
  return Boolean(maxDate && new Date(date.getFullYear(), date.getMonth() + 1, 1) > startOfDay(maxDate));
}

function clampDate(date: Date, minDate: Date | null, maxDate: Date | null) {
  if (minDate && date < startOfDay(minDate)) return startOfDay(minDate);
  if (maxDate && date > startOfDay(maxDate)) return startOfDay(maxDate);
  return date;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}
