"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/Icon";

export type WorkspaceSelectOption = {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
};

type WorkspaceSelectProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  name: string;
  onChange: (value: string) => void;
  options: readonly WorkspaceSelectOption[];
  value: string;
  search?: { placeholder: string; empty: string };
};

export function WorkspaceSelect({
  ariaLabel,
  className,
  disabled = false,
  name,
  onChange,
  options,
  value,
  search
}: WorkspaceSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === value)),
    [options, value]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const visibleOptions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
    return !search || !query ? options : options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ""}`.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "").includes(query));
  }, [options, search, searchQuery]);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options.find((option) => option.value === value) ?? options[0];

  function findEnabledIndex(start: number, direction: 1 | -1) {
    for (let offset = 1; offset <= visibleOptions.length; offset += 1) {
      const index = (start + direction * offset + visibleOptions.length) % visibleOptions.length;
      if (!visibleOptions[index]?.disabled) return index;
    }
    return start;
  }

  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(Math.max(0, visibleOptions.findIndex((option) => option.value === value)));

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    function updatePopoverPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const width = Math.max(rect.width, 180);
      const estimatedHeight = Math.min(276, visibleOptions.length * 36 + 12) + (search ? 48 : 0);
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const openAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
      );
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - estimatedHeight - 4)
        : Math.min(rect.bottom + 4, window.innerHeight - viewportPadding);

      setPopoverStyle({ left, top, width });
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    updatePopoverPosition();
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, visibleOptions, value, search]);

  useEffect(() => {
    if (isOpen && search) document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, listboxId, search]);

  function openMenu() {
    setSearchQuery("");
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      setPopoverStyle({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(rect.width, 180)
      });
    }
    setIsOpen(true);
  }

  function choose(index: number) {
    const option = visibleOptions[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setActiveIndex(index);
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    if (event.key === "Tab" && search) { setIsOpen(false); return; }
    if (event.key === "Escape") { event.preventDefault(); setIsOpen(false); triggerRef.current?.focus(); return; }
    if (!visibleOptions.length) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) openMenu();
      setActiveIndex((current) => {
        const start = isOpen ? current : selectedIndex;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return findEnabledIndex(start, direction);
      });
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!isOpen) openMenu();
      const boundary = event.key === "Home" ? -1 : 0;
      setActiveIndex(findEnabledIndex(boundary, event.key === "Home" ? 1 : -1));
      return;
    }

    if (event.key === "Enter" || event.key === " " && event.currentTarget.tagName === "BUTTON") {
      event.preventDefault();
      if (isOpen) choose(activeIndex);
      else openMenu();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div className={["workspace-select", className].filter(Boolean).join(" ")} ref={rootRef}>
      <input name={name} type="hidden" value={value} />
      <button
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="workspace-select__trigger"
        disabled={disabled}
        onClick={() => {
          if (isOpen) setIsOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span>{selected?.label ?? value}</span>
        <Icon aria-hidden name="chevron-down" size={14} />
      </button>

      {isOpen && popoverStyle ? createPortal((
        <div className={`workspace-select__popover${search ? " workspace-select__popover--searchable" : ""}`} ref={popoverRef} style={popoverStyle}>
          {search ? <input aria-label={search.placeholder} aria-controls={listboxId}
            aria-activedescendant={visibleOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
            autoComplete="off" autoFocus className="workspace-control workspace-select__search" placeholder={search.placeholder}
            onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onKeyDown}
            role="combobox" aria-expanded="true" aria-autocomplete="list" value={searchQuery} /> : null}
          <div aria-label={ariaLabel} className="workspace-select__listbox" id={listboxId} role="listbox">
            {visibleOptions.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <button
                  aria-disabled={option.disabled || undefined}
                  aria-selected={isSelected}
                  className="workspace-select__option"
                  disabled={option.disabled}
                  data-highlighted={index === activeIndex ? "true" : undefined}
                  id={`${listboxId}-${index}`}
                  key={option.value}
                  onClick={() => choose(index)}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="workspace-select__option-copy">
                    <span className="workspace-select__option-label">
                      {option.label}
                      {option.badge ? <span className="workspace-select__badge">{option.badge}</span> : null}
                    </span>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                  {isSelected ? <Icon aria-hidden name="check" size={14} /> : null}
                </button>
              );
            })}
            {search && !visibleOptions.length ? <p className="workspace-select__empty" role="status">{search.empty}</p> : null}
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

export function WorkspaceSelectField({
  className,
  error,
  hint,
  label,
  ...selectProps
}: WorkspaceSelectProps & {
  className?: string;
  error?: ReactNode;
  hint?: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className={["workspace-field", error ? "workspace-field--invalid" : "", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <WorkspaceSelect {...selectProps} ariaLabel={selectProps.ariaLabel} />
      {hint ? <small>{hint}</small> : null}
      {error ? <small className="workspace-field__error">{error}</small> : null}
    </div>
  );
}
