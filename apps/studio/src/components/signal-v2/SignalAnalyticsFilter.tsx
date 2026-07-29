"use client";

import {
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  ClockCounterClockwise
} from "@phosphor-icons/react";
import {
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarHeading,
  RangeCalendar,
  Button as AriaButton,
  type DateValue,
  type RangeValue
} from "react-aria-components";
import {
  CalendarDate,
  parseDate,
  startOfMonth,
  startOfWeek,
  startOfYear,
  today
} from "@internationalized/date";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  SignalComparisonModeV1,
  SignalComparisonV1,
  SignalDateRangeV1,
  SignalDimensionValuesV1,
  SignalFilterV1
} from "@noisia/query-engine";

export type SignalAnalyticsFilterSelection = {
  start: string;
  end: string;
  comparisonMode: SignalComparisonModeV1;
  comparisonStart?: string;
  comparisonEnd?: string;
  dimensions?: SignalDimensionValuesV1;
  searchQuery?: string;
};

export function SignalAnalyticsFilter({
  comparison,
  coverage,
  filter,
  loading,
  onApply
}: {
  comparison: SignalComparisonV1;
  coverage: { date_from: string | null; date_through: string | null };
  filter: SignalFilterV1;
  loading: boolean;
  onApply: (selection: SignalAnalyticsFilterSelection) => Promise<boolean>;
}) {
  const t = useTranslations("SignalV2");
  const locale = useLocale();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [customComparisonOpen, setCustomComparisonOpen] = useState(false);
  const [presetGroup, setPresetGroup] = useState<"last" | "toDate" | "quarters" | null>(null);
  const periodAnchorRef = useRef<HTMLDivElement>(null);
  const comparisonAnchorRef = useRef<HTMLDivElement>(null);
  const [draftRange, setDraftRange] = useState<SignalDateRangeV1>(filter.date_range);
  const [draftComparisonRange, setDraftComparisonRange] = useState<SignalDateRangeV1>(
    comparison.date_range ?? previousPeriod(filter.date_range)
  );
  const filterStart = filter.date_range.start;
  const filterEnd = filter.date_range.end;
  const comparisonStart = comparison.date_range?.start;
  const comparisonEnd = comparison.date_range?.end;

  useEffect(() => {
    const currentRange = { start: filterStart, end: filterEnd };
    setDraftRange(currentRange);
    setDraftComparisonRange(
      comparisonStart && comparisonEnd
        ? { start: comparisonStart, end: comparisonEnd }
        : previousPeriod(currentRange)
    );
  }, [comparisonEnd, comparisonStart, filterEnd, filterStart]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPeriodOpen(false);
      setCompareOpen(false);
      setCustomComparisonOpen(false);
      setPresetGroup(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (periodOpen && !periodAnchorRef.current?.contains(target)) {
        setPeriodOpen(false);
        setPresetGroup(null);
      }

      if (
        (compareOpen || customComparisonOpen)
        && !comparisonAnchorRef.current?.contains(target)
      ) {
        setCompareOpen(false);
        setCustomComparisonOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [compareOpen, customComparisonOpen, periodOpen]);

  const todayInWorkspace = useMemo(() => today(filter.timezone), [filter.timezone]);
  const minimumDate = coverage.date_from ? parseDate(coverage.date_from) : undefined;
  const maximumDate = todayInWorkspace;
  const periodLabel = formatRange(filter.date_range, locale);
  const comparisonLabel = comparison.date_range
    ? formatRange(comparison.date_range, locale)
    : t("filters.comparison.none");

  const applyPeriod = async () => {
    const applied = await onApply({
      start: draftRange.start,
      end: draftRange.end,
      comparisonMode: comparison.mode,
      ...(comparison.mode === "custom" && comparison.date_range
        ? {
            comparisonStart: comparison.date_range.start,
            comparisonEnd: comparison.date_range.end
          }
        : {})
    });
    if (applied) setPeriodOpen(false);
  };

  const applyComparison = async (
    mode: SignalComparisonModeV1,
    customRange?: SignalDateRangeV1
  ) => {
    const applied = await onApply({
      start: filter.date_range.start,
      end: filter.date_range.end,
      comparisonMode: mode,
      ...(mode === "custom" && customRange
        ? { comparisonStart: customRange.start, comparisonEnd: customRange.end }
        : {})
    });
    if (applied) {
      setCompareOpen(false);
      setCustomComparisonOpen(false);
    }
  };

  const setPreset = (range: SignalDateRangeV1) => {
    setDraftRange(range);
    setPresetGroup(null);
  };

  const primaryDuration = inclusiveDays(filter.date_range);
  const customDurationMatches = inclusiveDays(draftComparisonRange) === primaryDuration;
  const customOverlaps = rangesOverlap(filter.date_range, draftComparisonRange);

  return (
    <>
      <div className="signal-v2-filter-anchor" ref={periodAnchorRef}>
        <button
          aria-controls="signal-v2-period-dialog"
          aria-expanded={periodOpen}
          className={`signal-v2-filter${periodOpen ? " signal-v2-filter--active" : ""}`}
          onClick={() => {
            setDraftRange(filter.date_range);
            setPeriodOpen((open) => !open);
            setCompareOpen(false);
            setCustomComparisonOpen(false);
          }}
          type="button"
        >
          <CalendarBlank size={15} />
          {periodLabel}
          <CaretDown size={13} />
        </button>

        {periodOpen ? (
          <div
            aria-label={t("filters.dateDialog")}
            className="signal-v2-period-popover signal-v2-period-popover--shopify"
            id="signal-v2-period-dialog"
            role="dialog"
          >
            <div className="signal-v2-period-popover__presets">
              <PresetButton
                active={isSameRange(draftRange, singleDay(todayInWorkspace))}
                label={t("filters.today")}
                onClick={() => setPreset(singleDay(todayInWorkspace))}
              />
              <PresetButton
                active={isSameRange(draftRange, singleDay(todayInWorkspace.subtract({ days: 1 })))}
                label={t("filters.yesterday")}
                onClick={() => setPreset(singleDay(todayInWorkspace.subtract({ days: 1 })))}
              />
              <span className="signal-v2-preset-divider" />
              <PresetButton
                active={presetGroup === "last"}
                expanded={presetGroup === "last"}
                label={t("filters.last")}
                onClick={() => setPresetGroup((group) => group === "last" ? null : "last")}
              />
              {presetGroup === "last" ? (
                <div className="signal-v2-preset-submenu">
                  {[7, 30, 90].map((days) => (
                    <button
                      key={days}
                      onClick={() => setPreset({
                        start: todayInWorkspace.subtract({ days: days - 1 }).toString(),
                        end: todayInWorkspace.toString()
                      })}
                      type="button"
                    >
                      {t("filters.lastDays", { count: days })}
                    </button>
                  ))}
                </div>
              ) : null}
              <PresetButton
                active={presetGroup === "toDate"}
                expanded={presetGroup === "toDate"}
                label={t("filters.toDate")}
                onClick={() => setPresetGroup((group) => group === "toDate" ? null : "toDate")}
              />
              {presetGroup === "toDate" ? (
                <div className="signal-v2-preset-submenu">
                  <button
                    onClick={() => setPreset({
                      start: startOfWeek(todayInWorkspace, locale).toString(),
                      end: todayInWorkspace.toString()
                    })}
                    type="button"
                  >
                    {t("filters.weekToDate")}
                  </button>
                  <button
                    onClick={() => setPreset({
                      start: startOfMonth(todayInWorkspace).toString(),
                      end: todayInWorkspace.toString()
                    })}
                    type="button"
                  >
                    {t("filters.monthToDate")}
                  </button>
                  <button
                    onClick={() => setPreset({
                      start: quarterStart(todayInWorkspace).toString(),
                      end: todayInWorkspace.toString()
                    })}
                    type="button"
                  >
                    {t("filters.quarterToDate")}
                  </button>
                  <button
                    onClick={() => setPreset({
                      start: startOfYear(todayInWorkspace).toString(),
                      end: todayInWorkspace.toString()
                    })}
                    type="button"
                  >
                    {t("filters.yearToDate")}
                  </button>
                </div>
              ) : null}
              <span className="signal-v2-preset-divider" />
              <PresetButton
                active={Boolean(
                  coverage.date_from
                  && coverage.date_through
                  && isSameRange(draftRange, {
                    start: coverage.date_from,
                    end: coverage.date_through
                  })
                )}
                label={t("filters.allCoverage")}
                onClick={() => {
                  if (coverage.date_from && coverage.date_through) {
                    setPreset({ start: coverage.date_from, end: coverage.date_through });
                  }
                }}
              />
              <PresetButton
                active={isSameRange(draftRange, holidayRange(todayInWorkspace, "black_friday"))}
                label="Black Friday"
                onClick={() => setPreset(holidayRange(todayInWorkspace, "black_friday"))}
              />
              <PresetButton
                active={isSameRange(draftRange, holidayRange(todayInWorkspace, "cyber_monday"))}
                label="Cyber Monday"
                onClick={() => setPreset(holidayRange(todayInWorkspace, "cyber_monday"))}
              />
              <PresetButton
                active={presetGroup === "quarters"}
                expanded={presetGroup === "quarters"}
                label={t("filters.quarters")}
                onClick={() => setPresetGroup((group) => group === "quarters" ? null : "quarters")}
              />
              {presetGroup === "quarters" ? (
                <div className="signal-v2-preset-submenu">
                  {[0, 1, 2, 3].map((offset) => {
                    const start = quarterStart(todayInWorkspace).subtract({ months: offset * 3 });
                    const end = offset === 0 ? todayInWorkspace : quarterEnd(start);
                    return (
                      <button
                        key={offset}
                        onClick={() => setPreset({ start: start.toString(), end: end.toString() })}
                        type="button"
                      >
                        {`Q${Math.floor((start.month - 1) / 3) + 1} ${start.year}`}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <span className="signal-v2-preset-divider" />
              <PresetButton
                active={false}
                label={t("filters.customRange")}
                onClick={() => setPresetGroup(null)}
              />
            </div>

            <div className="signal-v2-period-popover__body">
              <AnalyticsRangeCalendar
                label={t("filters.dateRange")}
                maxValue={maximumDate}
                minValue={minimumDate}
                onChange={setDraftRange}
                value={draftRange}
              />
              <div className="signal-v2-popover-actions">
                <button onClick={() => setPeriodOpen(false)} type="button">
                  {t("actions.cancel")}
                </button>
                <button
                  disabled={loading || draftRange.start > draftRange.end}
                  onClick={applyPeriod}
                  type="button"
                >
                  {loading ? t("actions.loading") : t("actions.apply")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="signal-v2-filter-anchor" ref={comparisonAnchorRef}>
        <button
          aria-controls="signal-v2-comparison-menu"
          aria-expanded={compareOpen || customComparisonOpen}
          className={`signal-v2-filter${compareOpen || customComparisonOpen ? " signal-v2-filter--active" : ""}`}
          onClick={() => {
            setCompareOpen((open) => !open);
            setCustomComparisonOpen(false);
            setPeriodOpen(false);
          }}
          type="button"
        >
          <ClockCounterClockwise size={15} />
          {comparisonLabel}
          <CaretDown size={13} />
        </button>

        {compareOpen ? (
          <div
            aria-label={t("filters.comparison.label")}
            className="signal-v2-compare-popover signal-v2-compare-popover--shopify"
            id="signal-v2-comparison-menu"
            role="menu"
          >
            <ComparisonRow
              active={comparison.mode === "none"}
              label={t("filters.comparison.none")}
              onClick={() => void applyComparison("none")}
            />
            <ComparisonRow
              active={comparison.mode === "previous_period"}
              label={primaryDuration === 1
                ? t("filters.comparison.yesterday")
                : t("filters.comparison.previousPeriod")}
              onClick={() => void applyComparison("previous_period")}
            />
            <ComparisonRow
              active={comparison.mode === "previous_year"}
              label={t("filters.comparison.previousYear")}
              onClick={() => void applyComparison("previous_year")}
            />
            <ComparisonRow
              active={comparison.mode === "previous_year_same_weekday"}
              label={t("filters.comparison.previousYearWeekday")}
              onClick={() => void applyComparison("previous_year_same_weekday")}
            />
            <ComparisonRow
              active={comparison.mode === "custom"}
              label={t("filters.comparison.custom")}
              onClick={() => {
                setDraftComparisonRange(comparison.date_range ?? previousPeriod(filter.date_range));
                setCompareOpen(false);
                setCustomComparisonOpen(true);
              }}
            />
          </div>
        ) : null}

        {customComparisonOpen ? (
          <div
            aria-label={t("filters.comparison.customDialog")}
            className="signal-v2-period-popover signal-v2-period-popover--comparison"
            role="dialog"
          >
            <div className="signal-v2-period-popover__body">
              <AnalyticsRangeCalendar
                label={t("filters.comparison.customDateRange")}
                maxValue={parseDate(filter.date_range.start).subtract({ days: 1 })}
                onChange={setDraftComparisonRange}
                value={draftComparisonRange}
              />
              {!customDurationMatches || customOverlaps ? (
                <p className="signal-v2-calendar-error" role="alert">
                  {customOverlaps
                    ? t("filters.comparison.noOverlap")
                    : t("filters.comparison.equalDays", { count: primaryDuration })}
                </p>
              ) : null}
              <div className="signal-v2-popover-actions">
                <button onClick={() => setCustomComparisonOpen(false)} type="button">
                  {t("actions.cancel")}
                </button>
                <button
                  disabled={loading || !customDurationMatches || customOverlaps}
                  onClick={() => void applyComparison("custom", draftComparisonRange)}
                  type="button"
                >
                  {loading ? t("actions.loading") : t("actions.apply")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function AnalyticsRangeCalendar({
  label,
  maxValue,
  minValue,
  onChange,
  value
}: {
  label: string;
  maxValue?: DateValue;
  minValue?: DateValue;
  onChange: (range: SignalDateRangeV1) => void;
  value: SignalDateRangeV1;
}) {
  const t = useTranslations("SignalV2");
  const locale = useLocale();
  const range = useMemo<RangeValue<DateValue>>(() => ({
    start: parseDate(value.start),
    end: parseDate(value.end)
  }), [value.end, value.start]);
  const updateRange = (next: RangeValue<DateValue> | null) => {
    if (!next) return;
    onChange({ start: next.start.toString(), end: next.end.toString() });
  };
  const updateStart = (next: DateValue | null) => {
    if (!next) return;
    const start = next.toString();
    onChange({ start, end: start > value.end ? start : value.end });
  };
  const updateEnd = (next: DateValue | null) => {
    if (!next) return;
    const end = next.toString();
    onChange({ start: end < value.start ? end : value.start, end });
  };

  return (
    <RangeCalendar
      aria-label={label}
      defaultFocusedValue={parseDate(value.end).subtract({ months: 1 })}
      firstDayOfWeek="sun"
      maxValue={maxValue}
      minValue={minValue}
      onChange={updateRange}
      pageBehavior="single"
      value={range}
      visibleDuration={{ months: 2 }}
    >
      <div className="signal-v2-date-fields signal-v2-date-fields--aria">
        <HumanDateInput
          label={t("filters.from")}
          locale={locale}
          maxValue={maxValue}
          minValue={minValue}
          onChange={updateStart}
          value={value.start}
        />
        <span aria-hidden className="signal-v2-range-arrow">→</span>
        <HumanDateInput
          label={t("filters.to")}
          locale={locale}
          maxValue={maxValue}
          minValue={minValue}
          onChange={updateEnd}
          value={value.end}
        />
      </div>

      <div className="signal-v2-calendar-months">
        <div className="signal-v2-calendar-month">
          <div className="signal-v2-calendar-heading">
            <AriaButton aria-label={t("filters.previousMonth")} slot="previous">
              <CaretLeft size={18} />
            </AriaButton>
            <CalendarHeading format={{ month: "long", year: "numeric" }} offset={{ months: 0 }} />
            <span aria-hidden className="signal-v2-calendar-heading__spacer" />
          </div>
          <CalendarGrid offset={{ months: 0 }}>
            <CalendarGridHeader>
              {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
            </CalendarGridHeader>
            <CalendarGridBody>
              {(date) => <VisualRangeCalendarCell date={date} range={range} />}
            </CalendarGridBody>
          </CalendarGrid>
        </div>
        <div className="signal-v2-calendar-month">
          <div className="signal-v2-calendar-heading">
            <span aria-hidden className="signal-v2-calendar-heading__spacer" />
            <CalendarHeading format={{ month: "long", year: "numeric" }} offset={{ months: 1 }} />
            <AriaButton aria-label={t("filters.nextMonth")} slot="next">
              <CaretRight size={18} />
            </AriaButton>
          </div>
          <CalendarGrid offset={{ months: 1 }}>
            <CalendarGridHeader>
              {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
            </CalendarGridHeader>
            <CalendarGridBody>
              {(date) => <VisualRangeCalendarCell date={date} range={range} />}
            </CalendarGridBody>
          </CalendarGrid>
        </div>
      </div>
    </RangeCalendar>
  );
}

function VisualRangeCalendarCell({
  date,
  range
}: {
  date: CalendarDate;
  range: RangeValue<DateValue>;
}) {
  const bridgesSelectedRange = date.compare(range.start) >= 0 && date.compare(range.end) <= 0;

  return (
    <CalendarCell
      className={`react-aria-CalendarCell${
        bridgesSelectedRange ? " signal-v2-calendar-cell--range-bridge" : ""
      }`}
      date={date}
    />
  );
}

function HumanDateInput({
  label,
  locale,
  maxValue,
  minValue,
  onChange,
  value
}: {
  label: string;
  locale: string;
  maxValue?: DateValue;
  minValue?: DateValue;
  onChange: (value: DateValue | null) => void;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const commit = () => {
    try {
      const next = parseEditableDate(draft, locale);
      const beforeMinimum = minValue && next.compare(minValue) < 0;
      const afterMaximum = maxValue && next.compare(maxValue) > 0;
      if (!beforeMinimum && !afterMaximum) onChange(next);
    } catch {
      // Invalid partial input is discarded when focus leaves the field.
    }
    setEditing(false);
  };

  return (
    <label className="signal-v2-human-date-field">
      <span>{label}</span>
      <div className="signal-v2-date-input">
        <input
          aria-label={label}
          autoComplete="off"
          className="signal-v2-date-input__field"
          inputMode="numeric"
          onBlur={commit}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => {
            const input = event.currentTarget;
            setDraft(formatEditableDate(value, locale));
            setEditing(true);
            window.requestAnimationFrame(() => input.select());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(formatEditableDate(value, locale));
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          value={editing ? draft : formatHumanDate(value, locale)}
        />
        <CalendarBlank aria-hidden size={18} />
      </div>
    </label>
  );
}

function PresetButton({
  active,
  expanded,
  label,
  onClick
}: {
  active: boolean;
  expanded?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      className={active ? "signal-v2-preset--active" : undefined}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ComparisonRow({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className={active ? "signal-v2-comparison-row--active" : undefined}
      onClick={onClick}
      role="menuitemradio"
      type="button"
    >
      <span>{label}</span>
      {active ? <Check aria-hidden size={16} weight="bold" /> : null}
    </button>
  );
}

function singleDay(date: CalendarDate): SignalDateRangeV1 {
  return { start: date.toString(), end: date.toString() };
}

function quarterStart(date: CalendarDate) {
  const month = Math.floor((date.month - 1) / 3) * 3 + 1;
  return new CalendarDate(date.calendar, date.era, date.year, month, 1);
}

function quarterEnd(date: CalendarDate) {
  return quarterStart(date).add({ months: 3 }).subtract({ days: 1 });
}

function holidayRange(
  reference: CalendarDate,
  holiday: "black_friday" | "cyber_monday"
): SignalDateRangeV1 {
  let holidayDate = blackFriday(reference.year);
  if (holiday === "cyber_monday") holidayDate = holidayDate.add({ days: 3 });
  if (holidayDate.compare(reference) > 0) {
    holidayDate = blackFriday(reference.year - 1);
    if (holiday === "cyber_monday") holidayDate = holidayDate.add({ days: 3 });
  }
  return singleDay(holidayDate);
}

function blackFriday(year: number) {
  const novemberFirstDay = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - novemberFirstDay + 7) % 7);
  return new CalendarDate(year, 11, firstThursday + 21).add({ days: 1 });
}

function previousPeriod(range: SignalDateRangeV1): SignalDateRangeV1 {
  const duration = inclusiveDays(range);
  const end = parseDate(range.start).subtract({ days: 1 });
  return {
    start: end.subtract({ days: duration - 1 }).toString(),
    end: end.toString()
  };
}

function inclusiveDays(range: SignalDateRangeV1) {
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const end = Date.parse(`${range.end}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function rangesOverlap(left: SignalDateRangeV1, right: SignalDateRangeV1) {
  return left.start <= right.end && right.start <= left.end;
}

function isSameRange(left: SignalDateRangeV1, right: SignalDateRangeV1) {
  return left.start === right.start && left.end === right.end;
}

function formatRange(range: SignalDateRangeV1, locale: string) {
  const start = new Date(`${range.start}T12:00:00.000Z`);
  const end = new Date(`${range.end}T12:00:00.000Z`);
  const sameDay = range.start === range.end;
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
  return sameDay ? formatter.format(start) : `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatHumanDate(value: string, locale: string) {
  const date = parseDate(value);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

function formatEditableDate(value: string, locale: string) {
  const date = parseDate(value);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

function parseEditableDate(value: string, locale: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parseDate(trimmed);

  const parts = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!parts) throw new Error("Invalid date");

  const monthFirst = locale.toLowerCase().startsWith("en-us");
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const month = monthFirst ? first : second;
  const day = monthFirst ? second : first;
  const rawYear = Number(parts[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error("Invalid date");
  return parseDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
}
