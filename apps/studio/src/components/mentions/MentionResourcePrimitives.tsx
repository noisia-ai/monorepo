"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowsDownUp,
  CaretDown,
  Check,
  CheckSquare,
  Columns,
  DotsSixVertical,
  Eye,
  EyeSlash,
  LockSimple,
  MagnifyingGlass,
  X
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import { SignalMetricHelp } from "@/components/signal-v2/SignalMetricHelp";
import { SignalSourceIcon } from "@/components/signal-v2/SignalSourceIcon";
import type { SignalMentionRecordV1 } from "@/lib/data-os/signal-workspace-serving";

export type MentionColumn =
  | "mention"
  | "inclusion"
  | "operator"
  | "platform"
  | "scope"
  | "role"
  | "published"
  | "sentiment"
  | "engagement"
  | "context"
  | "topics"
  | "multiEntity";

export type MentionColumnState = {
  key: MentionColumn;
  visible: boolean;
  locked?: boolean;
};

type SortOption<Key extends string> = {
  groupStart?: boolean;
  key: Key;
  label: string;
};

export function MentionResourceSearch({
  ariaLabel,
  clearLabel,
  onChange,
  onClear,
  onSubmit,
  placeholder,
  value
}: {
  ariaLabel: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  placeholder: string;
  value: string;
}) {
  return (
    <form
      className="signal-v2-mentions-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <MagnifyingGlass aria-hidden size={15} />
      <input
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? (
        <button aria-label={clearLabel} onClick={onClear} type="button">
          <X aria-hidden size={13} />
        </button>
      ) : null}
    </form>
  );
}

export function MentionResourceSort<Key extends string>({
  ariaLabel,
  disabled,
  label,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  disabled?: boolean;
  label: string;
  onChange: (value: Key) => void;
  options: SortOption<Key>[];
  value: Key;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = options.find((option) => option.key === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!active) return null;

  return (
    <div className="signal-v2-mentions-sort" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ArrowsDownUp aria-hidden size={15} />
        <span>{label}</span>
        <strong>{active.label}</strong>
        <CaretDown aria-hidden size={12} />
      </button>
      {open ? (
        <div className="signal-v2-mentions-sort__menu" role="menu">
          {options.map((option) => (
            <button
              aria-checked={value === option.key}
              className={option.groupStart ? "is-group-start" : undefined}
              key={option.key}
              onClick={() => {
                setOpen(false);
                onChange(option.key);
              }}
              role="menuitemradio"
              type="button"
            >
              <span>{value === option.key ? <Check aria-hidden size={14} weight="bold" /> : null}</span>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MentionResourceColumns({
  columns,
  getLabel,
  labels,
  onChange
}: {
  columns: MentionColumnState[];
  getLabel: (key: MentionColumn) => string;
  labels: {
    action: string;
    drag: string;
    hide: (column: string) => string;
    manual: string;
    order: string;
    required: string;
    show: (column: string) => string;
    title: string;
  };
  onChange: (columns: MentionColumnState[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<MentionColumn | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const update = (next: MentionColumnState[]) => {
    const documentWithTransitions = document as Document & {
      startViewTransition?: (callback: () => void) => unknown;
    };
    if (documentWithTransitions.startViewTransition) {
      documentWithTransitions.startViewTransition(() => onChange(next));
      return;
    }
    onChange(next);
  };

  const moveColumn = (from: MentionColumn, to: MentionColumn) => {
    if (from === to) return;
    const next = [...columns];
    const fromIndex = next.findIndex((item) => item.key === from);
    const toIndex = next.findIndex((item) => item.key === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    update(next);
  };

  return (
    <div className="signal-v2-mentions-columns" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Columns aria-hidden size={15} />{labels.action}<CaretDown aria-hidden size={12} />
      </button>
      {open ? (
        <div className="signal-v2-mentions-columns__menu" role="menu">
          <div className="signal-v2-mentions-columns__sort">
            <ArrowsDownUp aria-hidden size={15} />
            <span>{labels.order}</span>
            <strong>{labels.manual}</strong>
          </div>
          <div className="signal-v2-mentions-columns__heading">
            <strong>{labels.title}</strong>
            <small>{labels.drag}</small>
          </div>
          <div className="signal-v2-mentions-columns__list">
            {columns.map((column) => {
              const columnLabel = getLabel(column.key);
              return (
                <div
                  className={draggedColumn === column.key ? "is-dragging" : undefined}
                  draggable={!column.locked}
                  key={column.key}
                  onDragEnd={() => setDraggedColumn(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedColumn(column.key)}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedColumn) moveColumn(draggedColumn, column.key);
                    setDraggedColumn(null);
                  }}
                  role="menuitem"
                >
                  <span aria-hidden className="signal-v2-mentions-columns__handle">
                    {column.locked
                      ? <LockSimple size={13} />
                      : <DotsSixVertical size={15} weight="bold" />}
                  </span>
                  <span>{columnLabel}</span>
                  <button
                    aria-label={column.locked
                      ? labels.required
                      : column.visible
                        ? labels.hide(columnLabel)
                        : labels.show(columnLabel)}
                    disabled={column.locked}
                    onClick={() => {
                      if (column.locked) return;
                      update(columns.map((item) => item.key === column.key
                        ? { ...item, visible: !item.visible }
                        : item));
                    }}
                    title={column.locked ? labels.required : undefined}
                    type="button"
                  >
                    {column.locked
                      ? <LockSimple aria-hidden size={14} />
                      : column.visible
                        ? <Eye aria-hidden size={15} />
                        : <EyeSlash aria-hidden size={15} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MentionSelectionBar({
  children,
  clearLabel,
  label,
  onClear
}: {
  children: ReactNode;
  clearLabel: string;
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="signal-v2-mentions-selection">
      <strong>{label}</strong>
      {children}
      <button aria-label={clearLabel} onClick={onClear} type="button">
        <X aria-hidden size={14} />
      </button>
    </div>
  );
}

export function MentionResourceTable({
  columnLabel,
  columns,
  onActivate,
  onTogglePage,
  onToggleSelected,
  records,
  renderCell,
  selectedIds,
  selectionLabels
}: {
  columnLabel: (key: MentionColumn) => string;
  columns: MentionColumn[];
  onActivate: (record: SignalMentionRecordV1) => void;
  onTogglePage: () => void;
  onToggleSelected: (record: SignalMentionRecordV1) => void;
  records: SignalMentionRecordV1[];
  renderCell?: (column: MentionColumn, record: SignalMentionRecordV1) => ReactNode | undefined;
  selectedIds: string[];
  selectionLabels: {
    add: string;
    clearPage: string;
    remove: string;
    selectPage: string;
  };
}) {
  const allSelected = records.length > 0 && records.every((record) => selectedIds.includes(record.subject_id));
  return (
    <table
      className={`signal-v2-mentions-table${columns.length <= 2 ? " is-compact" : ""}`}
      key={columns.join(":")}
    >
      <thead>
        <tr>
          <th className="signal-v2-mentions-table__check">
            <button
              aria-label={allSelected ? selectionLabels.clearPage : selectionLabels.selectPage}
              onClick={onTogglePage}
              type="button"
            >
              {allSelected ? <CheckSquare aria-hidden size={16} weight="fill" /> : <span />}
            </button>
          </th>
          {columns.map((column) => (
            <th className={`signal-v2-mentions-table__${column}`} key={column}>
              <MentionColumnHeader column={column} label={columnLabel(column)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const selected = selectedIds.includes(record.subject_id);
          return (
            <tr
              aria-selected={selected}
              key={record.subject_id}
              onClick={() => onActivate(record)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onActivate(record);
              }}
              tabIndex={0}
            >
              <td className="signal-v2-mentions-table__check">
                <button
                  aria-label={selected ? selectionLabels.remove : selectionLabels.add}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelected(record);
                  }}
                  type="button"
                >
                  {selected ? <Check aria-hidden size={12} weight="bold" /> : <span />}
                </button>
              </td>
              {columns.map((column) => {
                const customCell = renderCell?.(column, record);
                return customCell === undefined
                  ? <MentionRecordCell column={column} key={column} record={record} />
                  : <Fragment key={column}>{customCell}</Fragment>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MentionColumnHeader({ column, label }: { column: MentionColumn; label: string }) {
  const t = useTranslations("SignalV2");
  if (column === "scope") {
    return (
      <SignalMetricHelp
        content={{
          body: t("mentions.helpers.scope.body"),
          formula: t("mentions.helpers.scope.process"),
          title: t("mentions.helpers.scope.title")
        }}
        label={label}
      />
    );
  }
  if (column === "context") {
    return (
      <SignalMetricHelp
        content={{
          body: t("mentions.helpers.tb.body"),
          formula: t("mentions.helpers.tb.process"),
          title: t("mentions.helpers.tb.title")
        }}
        label={label}
      />
    );
  }
  return <span>{label}</span>;
}

export function MentionRecordCell({
  column,
  record
}: {
  column: MentionColumn;
  record: SignalMentionRecordV1;
}) {
  const t = useTranslations("SignalV2");
  switch (column) {
    case "inclusion":
    case "operator":
      return null;
    case "mention":
      return (
        <td className="signal-v2-mentions-table__mention">
          <div>
            <SignalSourceIcon platform={record.platform} size={14} />
            <span>
              <strong>{record.title || truncate(record.text_snippet, 92)}</strong>
              {record.title ? <small>{truncate(record.text_snippet, 116)}</small> : null}
            </span>
          </div>
        </td>
      );
    case "platform":
      return (
        <td className="signal-v2-mentions-table__platform">
          <span className="signal-v2-source-label">
            <SignalSourceIcon platform={record.platform} size={13} />
            {pretty(record.platform)}
          </span>
        </td>
      );
    case "scope":
      return <td className="signal-v2-mentions-table__scope"><AttributionBadge record={record} /></td>;
    case "role":
      return (
        <td className="signal-v2-mentions-table__role">
          <span className="signal-v2-neutral-chip">
            {t(`mentions.roles.${record.conversation_role}`)}
          </span>
        </td>
      );
    case "published":
      return <td className="signal-v2-mentions-table__published">{formatDate(record.occurred_at)}</td>;
    case "sentiment":
      return <td className="signal-v2-mentions-table__sentiment"><MentionSentiment value={record.sentiment} /></td>;
    case "engagement":
      return <td className="signal-v2-mentions-table__engagement">{formatCount(record.interaction_count)}</td>;
    case "context":
      return <td className="signal-v2-mentions-table__context"><MentionContext record={record} /></td>;
    case "topics": {
      const labels = record.tags.map((tag) => tag.label)
        .filter((label, index, values) => values.indexOf(label) === index);
      return (
        <td className="signal-v2-mentions-table__topics">
          {labels.length > 0 ? (
            <span className="signal-v2-mention-topics" title={labels.join(", ")}>
              <strong>{labels[0]}</strong>
              {labels.length > 1 ? <small>+{labels.length - 1}</small> : null}
            </span>
          ) : "—"}
        </td>
      );
    }
    case "multiEntity": {
      const identityCount = new Set(record.attribution.map((item) => `${item.scope}:${item.label}`)).size;
      const isMultiEntity = identityCount > 1 || record.entities.length > 1;
      return (
        <td className="signal-v2-mentions-table__multiEntity">
          <span className="signal-v2-neutral-chip">
            {t(isMultiEntity ? "mentions.multiEntity.yes" : "mentions.multiEntity.no")}
          </span>
        </td>
      );
    }
  }
}

export function MentionResourcePagination({
  disabled,
  labels,
  nextDisabled,
  onNext,
  onPageSize,
  onPrevious,
  pageSize,
  pageSizes = [25, 50, 100],
  previousDisabled,
  rangeLabel
}: {
  disabled?: boolean;
  labels: { next: string; perPage: string; previous: string };
  nextDisabled: boolean;
  onNext: () => void;
  onPageSize: (size: number) => void;
  onPrevious: () => void;
  pageSize: number;
  pageSizes?: number[];
  previousDisabled: boolean;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <footer className="signal-v2-mentions-pagination">
      <span>{rangeLabel}</span>
      <div className="signal-v2-mentions-page-size" ref={rootRef}>
        <span>{labels.perPage}</span>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <strong>{pageSize}</strong>
          <CaretDown aria-hidden size={12} />
        </button>
        {open ? (
          <div className="signal-v2-mentions-page-size__menu" role="menu">
            {pageSizes.map((size) => (
              <button
                aria-checked={pageSize === size}
                key={size}
                onClick={() => {
                  setOpen(false);
                  onPageSize(size);
                }}
                role="menuitemradio"
                type="button"
              >
                <span>{pageSize === size ? <Check aria-hidden size={14} weight="bold" /> : null}</span>
                {size}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div>
        <button disabled={disabled || previousDisabled} onClick={onPrevious} type="button">
          <ArrowLeft aria-hidden size={14} />{labels.previous}
        </button>
        <button disabled={disabled || nextDisabled} onClick={onNext} type="button">
          {labels.next}<ArrowRight aria-hidden size={14} />
        </button>
      </div>
    </footer>
  );
}

export function MentionsTableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="signal-v2-mentions-table-skeleton" role="status">
      {Array.from({ length: 8 }, (_, row) => (
        <div key={row} style={{ gridTemplateColumns: `34px minmax(280px, 2fr) repeat(${Math.max(1, columns - 2)}, minmax(86px, 1fr))` }}>
          <span />
          <div>
            <strong />
            <small />
          </div>
          {Array.from({ length: Math.max(1, columns - 2) }, (__, cell) => <i key={cell} />)}
        </div>
      ))}
    </div>
  );
}

export function AttributionBadge({ record }: { record: SignalMentionRecordV1 }) {
  const t = useTranslations("SignalV2");
  const primary = primaryAttribution(record);
  return (
    <span className={`signal-v2-mention-scope signal-v2-mention-scope--${primary.scope}`}>
      <i aria-hidden />
      {t(`mentions.scope.${primary.scope}`)}
    </span>
  );
}

export function MentionSentiment({ value }: { value: SignalMentionRecordV1["sentiment"] }) {
  const t = useTranslations("SignalV2");
  const key = value ?? "unclassified";
  return (
    <span className={`signal-v2-mention-sentiment signal-v2-mention-sentiment--${key}`}>
      <i aria-hidden />
      {t(`mentions.sentiment.${key}`)}
    </span>
  );
}

export function MentionContext({ record }: { record: SignalMentionRecordV1 }) {
  const t = useTranslations("SignalV2");
  const coding = primaryTbCoding(record);
  const reservedTbTags = new Set(["trigger", "barrier", "mixed", "irrelevant"]);
  const classification = [
    ...(coding?.polarity ? [t(`mentions.tb.polarity.${coding.polarity}`)] : []),
    ...(coding?.layer ? [t(`mentions.tb.layer.${coding.layer}`)] : [])
  ].join(" · ");
  const observedSignal = coding?.emergent_tags.find((tag) => (
    !reservedTbTags.has(tag.toLocaleLowerCase())
  )) ?? null;
  const contextTitle = [
    classification ? `${t("mentions.tb.compactClassification")}: ${classification}.` : null,
    observedSignal ? `${t("mentions.tb.compactSignal")}: ${observedSignal}.` : null
  ].filter(Boolean).join(" ");

  return (
    <div className="signal-v2-mention-context" title={contextTitle || undefined}>
      {classification ? (
        <span
          className={`signal-v2-mention-context__classification signal-v2-mention-context__classification--${coding?.polarity ?? "mixed"}${observedSignal ? "" : " signal-v2-mention-context__classification--only"}`}
        >
          <small>{t("mentions.tb.compactClassification")}</small>
          <strong>{classification}</strong>
        </span>
      ) : null}
      {observedSignal ? (
        <span className="signal-v2-mention-context__signal">
          <small>{t("mentions.tb.compactSignal")}</small>
          <strong>{observedSignal}</strong>
        </span>
      ) : null}
      {!classification && !observedSignal ? <small>—</small> : null}
    </div>
  );
}

export function primaryAttribution(record: SignalMentionRecordV1) {
  return record.attribution.find((item) => item.scope === "brand")
    ?? record.attribution.find((item) => item.scope === "competitor")
    ?? record.attribution.find((item) => item.scope === "category")
    ?? record.attribution[0]
    ?? { scope: "unknown" as const, label: "Unattributed" };
}

export function primaryTbCoding(record: SignalMentionRecordV1) {
  return record.tb_classification?.codings.find((coding) => coding.polarity !== "irrelevant")
    ?? record.tb_classification?.codings[0]
    ?? null;
}

export function pretty(value: string | null) {
  if (!value) return "Web";
  return value.replaceAll("_", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}
