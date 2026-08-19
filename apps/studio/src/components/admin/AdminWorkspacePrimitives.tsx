import type { ReactNode } from "react";

import {
  WorkspaceHeader,
  WorkspaceStatus
} from "@/components/workspace/WorkspaceShell";
import type { AdminOperationalState } from "@/lib/data/admin-workspace";

type AdminSummaryItem = {
  hint: ReactNode;
  label: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  value: ReactNode;
};

export function AdminWorkspaceHeader({
  actions,
  eyebrow,
  icon,
  status,
  subtitle,
  title
}: {
  actions?: ReactNode;
  eyebrow: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  subtitle: ReactNode;
  title: ReactNode;
}) {
  return (
    <WorkspaceHeader
      aside={actions ? <div className="admin-workspace-actions">{actions}</div> : undefined}
      eyebrow={eyebrow}
      icon={icon}
      status={status}
      subtitle={subtitle}
      title={title}
    />
  );
}

export function AdminStatus({
  children,
  state = "not_available"
}: {
  children: ReactNode;
  state?: AdminOperationalState;
}) {
  const tone = state === "good"
    ? "success"
    : state === "warning"
      ? "warning"
      : state === "danger"
        ? "danger"
        : "neutral";
  return <WorkspaceStatus tone={tone}>{children}</WorkspaceStatus>;
}

export function AdminSummaryStrip({ items }: { items: AdminSummaryItem[] }) {
  return (
    <dl className="admin-summary-strip">
      {items.map((item, index) => (
        <div data-tone={item.tone && item.tone !== "neutral" ? item.tone : undefined} key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          <small>{item.hint}</small>
        </div>
      ))}
    </dl>
  );
}

export function formatAdminDate(
  value: string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatAdminNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

export function AdminResourceSection({
  actions,
  children,
  className,
  subtitle,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={["admin-section", "admin-resource-section", className].filter(Boolean).join(" ")}>
      <header className="admin-section__head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="admin-resource-section__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function AdminFeedbackState({
  actions,
  body,
  detail,
  icon,
  title,
  tone = "neutral"
}: {
  actions?: ReactNode;
  body: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <section
      className="admin-feedback-state"
      data-tone={tone === "danger" ? tone : undefined}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div aria-hidden className="admin-feedback-state__icon">{icon}</div>
      <div className="admin-feedback-state__copy">
        <h2>{title}</h2>
        <p>{body}</p>
        {detail ? <div className="admin-feedback-state__detail">{detail}</div> : null}
        {actions ? <div className="admin-feedback-state__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function AdminSettingsRow({
  action,
  className,
  description,
  icon,
  title,
  value
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
}) {
  return (
    <div className={["admin-settings-row", !icon && "admin-settings-row--plain", className].filter(Boolean).join(" ")}>
      {icon ?? null}
      <div>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      {value !== undefined && value !== null ? <div className="admin-settings-row__value">{value}</div> : null}
      {action}
    </div>
  );
}
