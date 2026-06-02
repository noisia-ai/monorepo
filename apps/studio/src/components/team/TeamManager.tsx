"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";

const ROLES = ["noisia_admin", "analyst", "client_admin", "client_viewer"] as const;
type Role = (typeof ROLES)[number];

const isInternal = (role: string) => role === "noisia_admin" || role === "analyst";

type Member = {
  id: string;
  email: string;
  fullName: string | null;
  primaryRole: string;
  userType: string;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type Invitation = {
  id: string;
  email: string;
  primaryRole: string;
  organizationId: string | null;
  organizationName: string | null;
  invitedByName: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type Organization = {
  id: string;
  name: string;
  slug?: string;
  legalName?: string;
  hqCountry?: string | null;
  industryPrimary?: string | null;
  status?: string;
  usersCount?: number;
  pendingInvitationsCount?: number;
  brandsCount?: number;
  activeBrandsCount?: number;
  activeCorporaCount?: number;
  themesCount?: number;
};

type Props = {
  currentUserId: string;
  members: Member[];
  invitations: Invitation[];
  organizations: Organization[];
};

export function TeamManager({ currentUserId, members, invitations, organizations }: Props) {
  const t = useTranslations("Team");
  const router = useRouter();

  return (
    <div className="team-manager">
      <OrganizationManager t={t} organizations={organizations} onDone={() => router.refresh()} />
      <InviteForm t={t} organizations={organizations} onDone={() => router.refresh()} />

      <section className="new-study-panel">
        <div className="new-study-section-head">
          <h2>{t("members.title")}</h2>
        </div>
        {members.length === 0 ? (
          <p className="page-head-sub">{t("members.empty")}</p>
        ) : (
          <ul className="team-list">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                t={t}
                member={m}
                organizations={organizations}
                isSelf={m.id === currentUserId}
                onDone={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="new-study-panel">
        <div className="new-study-section-head">
          <h2>{t("pending.title")}</h2>
        </div>
        {invitations.length === 0 ? (
          <p className="page-head-sub">{t("pending.empty")}</p>
        ) : (
          <ul className="team-list">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} t={t} invitation={inv} onDone={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function OrganizationManager({
  t,
  organizations,
  onDone
}: {
  t: T;
  organizations: Organization[];
  onDone: () => void;
}) {
  return (
    <section className="new-study-panel">
      <div className="new-study-section-head">
        <h2>{t("organizations.title")}</h2>
        <p>{t("organizations.subtitle")}</p>
      </div>
      <CreateOrganizationForm t={t} onDone={onDone} />
      {organizations.length === 0 ? (
        <p className="page-head-sub">{t("organizations.empty")}</p>
      ) : (
        <ul className="team-list">
          {organizations.map((organization) => (
            <OrganizationRow key={organization.id} t={t} organization={organization} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateOrganizationForm({ t, onDone }: { t: T; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      slug: String(form.get("slug") ?? "").trim(),
      legal_name: String(form.get("legal_name") ?? "").trim(),
      display_name: String(form.get("display_name") ?? "").trim(),
      hq_country: String(form.get("hq_country") ?? "MX").trim().toUpperCase(),
      industry_primary: String(form.get("industry_primary") ?? "").trim(),
      status: String(form.get("status") ?? "active")
    };

    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("organizations.createError"));
      setMessage({ tone: "ok", text: t("organizations.createSuccess") });
      (event.target as HTMLFormElement).reset();
      setOpen(false);
      onDone();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("organizations.createError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="org-create">
      <button className="wizard-cta wizard-cta--secondary" type="button" onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? "x" : "sparkle"} size={14} /> {open ? t("organizations.cancelCreate") : t("organizations.new")}
      </button>
      {open ? (
        <form className="org-form" onSubmit={onSubmit}>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.legalName")}</span>
              <input className="filter-input new-study-input" name="legal_name" required minLength={2} maxLength={180} />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.displayName")}</span>
              <input className="filter-input new-study-input" name="display_name" maxLength={180} />
            </label>
          </div>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.slug")}</span>
              <input className="filter-input new-study-input" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.industry")}</span>
              <input className="filter-input new-study-input" name="industry_primary" maxLength={80} />
            </label>
          </div>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.country")}</span>
              <input className="filter-input new-study-input" name="hq_country" defaultValue="MX" maxLength={2} minLength={2} />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.status")}</span>
              <select className="filter-input new-study-input" name="status" defaultValue="active">
                <option value="active">{t("organizations.statusActive")}</option>
                <option value="paused">{t("organizations.statusPaused")}</option>
                <option value="archived">{t("organizations.statusArchived")}</option>
              </select>
            </label>
          </div>
          <div className="team-form-actions">
            <button className="wizard-cta" type="submit" disabled={busy}>
              <Icon name={busy ? "spinner" : "check"} size={14} /> {busy ? t("organizations.creating") : t("organizations.create")}
            </button>
            {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
          </div>
        </form>
      ) : message ? (
        <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span>
      ) : null}
    </div>
  );
}

function OrganizationRow({
  t,
  organization,
  onDone
}: {
  t: T;
  organization: Organization;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const hasBlockers =
    (organization.usersCount ?? 0) +
      (organization.pendingInvitationsCount ?? 0) +
      (organization.brandsCount ?? 0) +
      (organization.themesCount ?? 0) >
    0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      slug: String(form.get("slug") ?? "").trim(),
      legal_name: String(form.get("legal_name") ?? "").trim(),
      display_name: String(form.get("display_name") ?? "").trim(),
      hq_country: String(form.get("hq_country") ?? "MX").trim().toUpperCase(),
      industry_primary: String(form.get("industry_primary") ?? "").trim(),
      status: String(form.get("status") ?? "active")
    };

    try {
      const res = await fetch(`/api/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("actions.saveError"));
      setMessage({ tone: "ok", text: t("organizations.saveSuccess") });
      setEditing(false);
      onDone();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("actions.saveError") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("organizations.deleteConfirm", { name: organization.name }))) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/organizations/${organization.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatDeleteBlockers(json, t));
      setMessage({ tone: "ok", text: t("organizations.deleteSuccess") });
      onDone();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("organizations.deleteError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="team-row team-row--org">
      {editing ? (
        <form className="org-form org-form--inline" onSubmit={save}>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.legalName")}</span>
              <input className="filter-input new-study-input" name="legal_name" required defaultValue={organization.legalName ?? organization.name} />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.displayName")}</span>
              <input className="filter-input new-study-input" name="display_name" defaultValue={organization.name} />
            </label>
          </div>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.slug")}</span>
              <input className="filter-input new-study-input" name="slug" required defaultValue={organization.slug ?? ""} />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.industry")}</span>
              <input className="filter-input new-study-input" name="industry_primary" defaultValue={organization.industryPrimary ?? ""} />
            </label>
          </div>
          <div className="new-study-grid">
            <label className="new-study-field">
              <span>{t("organizations.country")}</span>
              <input className="filter-input new-study-input" name="hq_country" defaultValue={organization.hqCountry ?? "MX"} maxLength={2} minLength={2} />
            </label>
            <label className="new-study-field">
              <span>{t("organizations.status")}</span>
              <select className="filter-input new-study-input" name="status" defaultValue={organization.status ?? "active"}>
                <option value="active">{t("organizations.statusActive")}</option>
                <option value="paused">{t("organizations.statusPaused")}</option>
                <option value="archived">{t("organizations.statusArchived")}</option>
              </select>
            </label>
          </div>
          <div className="team-form-actions">
            <button className="wizard-cta" type="submit" disabled={busy}>
              {busy ? t("actions.saving") : t("actions.save")}
            </button>
            <button className="wizard-cta wizard-cta--ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>
              {t("organizations.cancelCreate")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="team-row-main">
            <strong>{organization.name}</strong>
            <span className="team-row-email">{organization.slug ?? organization.id}</span>
            <div className="team-row-meta">
              <StatusBadge t={t} status={organization.status ?? "active"} />
              <span className="team-tag">{t("organizations.users", { count: organization.usersCount ?? 0 })}</span>
              <span className="team-tag">{t("organizations.brands", { count: organization.brandsCount ?? 0 })}</span>
              <span className="team-tag">{t("organizations.corpora", { count: organization.activeCorporaCount ?? 0 })}</span>
              {(organization.pendingInvitationsCount ?? 0) > 0 ? (
                <span className="team-row-sub">{t("organizations.pending", { count: organization.pendingInvitationsCount ?? 0 })}</span>
              ) : null}
            </div>
          </div>
          <div className="team-row-controls">
            <button className="wizard-cta wizard-cta--ghost" type="button" disabled={busy} onClick={() => setEditing(true)}>
              {t("organizations.edit")}
            </button>
            <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy || hasBlockers} onClick={remove}>
              {t("organizations.delete")}
            </button>
          </div>
        </>
      )}
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
      {!editing && hasBlockers ? <span className="team-msg team-msg--warn">{t("organizations.deleteBlocked")}</span> : null}
    </li>
  );
}

function InviteForm({ t, organizations, onDone }: { t: T; organizations: Organization[]; onDone: () => void }) {
  const [role, setRole] = useState<Role>("client_viewer");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const internal = isInternal(role);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const organization_id = String(form.get("organization_id") ?? "") || undefined;

    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, primary_role: role, organization_id: internal ? undefined : organization_id })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("invite.error"));

      if (json.email_sent) {
        setMessage({ tone: "ok", text: t("invite.successSent", { email }) });
      } else {
        setMessage({ tone: "warn", text: t("invite.successNoEmail", { error: json.email_error ?? "" }) });
      }
      (event.target as HTMLFormElement).reset();
      setRole("client_viewer");
      onDone();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("invite.error") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="new-study-panel">
      <div className="new-study-section-head">
        <h2>{t("invite.title")}</h2>
      </div>
      <form className="team-invite-form" onSubmit={onSubmit}>
        <div className="new-study-grid">
          <label className="new-study-field">
            <span>{t("invite.email")}</span>
            <input className="filter-input new-study-input" name="email" type="email" required maxLength={200} />
          </label>
          <label className="new-study-field">
            <span>{t("invite.role")}</span>
            <select className="filter-input new-study-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="new-study-field">
          <span>{t("invite.organization")}</span>
          {internal ? (
            <p className="page-head-sub">{t("invite.orgInternalHint")}</p>
          ) : (
            <select className="filter-input new-study-input" name="organization_id" required>
              <option value="">{t("invite.orgPlaceholder")}</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <div className="team-form-actions">
          <button className="wizard-cta" type="submit" disabled={submitting}>
            <Icon name="arrow-right" size={14} /> {submitting ? t("invite.submitting") : t("invite.submit")}
          </button>
          {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
        </div>
      </form>
    </section>
  );
}

function MemberRow({
  t,
  member,
  organizations,
  isSelf,
  onDone
}: {
  t: T;
  member: Member;
  organizations: Organization[];
  isSelf: boolean;
  onDone: () => void;
}) {
  const [role, setRole] = useState<Role>((member.primaryRole as Role) ?? "client_viewer");
  const [orgId, setOrgId] = useState<string>(member.organizationId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const internal = isInternal(role);

  const dirty =
    role !== member.primaryRole || (!internal && orgId !== (member.organizationId ?? ""));

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/team/users/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? t("actions.saveError"));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actions.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="team-row">
      <div className="team-row-main">
        <strong>{member.fullName || member.email}</strong>
        <span className="team-row-email">{member.email}</span>
        <div className="team-row-meta">
          <StatusBadge t={t} status={member.status} />
          {isSelf ? <span className="team-tag">{t("members.you")}</span> : null}
          <span className="team-row-sub">
            {member.lastLoginAt
              ? t("members.lastLogin", { date: fmtDate(member.lastLoginAt) })
              : t("members.neverLoggedIn")}
          </span>
        </div>
      </div>

      <div className="team-row-controls">
        <select
          className="filter-input"
          value={role}
          disabled={busy || isSelf}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>

        {internal ? (
          <span className="team-row-sub">{t("members.noOrg")}</span>
        ) : (
          <select className="filter-input" value={orgId} disabled={busy} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">{t("invite.orgPlaceholder")}</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}

        <button
          className="wizard-cta wizard-cta--ghost"
          type="button"
          disabled={busy || !dirty || (!internal && !orgId)}
          onClick={() => patch({ primary_role: role, organization_id: internal ? null : orgId })}
        >
          {busy ? t("actions.saving") : t("actions.save")}
        </button>

        {!isSelf ? (
          member.status === "suspended" ? (
            <button className="wizard-cta wizard-cta--ghost" type="button" disabled={busy} onClick={() => patch({ status: "active" })}>
              {t("actions.reactivate")}
            </button>
          ) : (
            <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={() => patch({ status: "suspended" })}>
              {t("actions.suspend")}
            </button>
          )
        ) : null}
      </div>
      {error ? <span className="team-msg team-msg--error">{error}</span> : null}
    </li>
  );
}

function InvitationRow({ t, invitation, onDone }: { t: T; invitation: Invitation; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await fetch(`/api/team/invitations/${invitation.id}`, { method: "DELETE" });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="team-row">
      <div className="team-row-main">
        <strong>{invitation.email}</strong>
        <div className="team-row-meta">
          <span className="team-tag">{t(`roles.${invitation.primaryRole}`)}</span>
          {invitation.organizationName ? <span className="team-row-sub">{invitation.organizationName}</span> : null}
          <span className="team-row-sub">{t("pending.invitedBy", { name: invitation.invitedByName ?? "—" })}</span>
          {invitation.expiresAt ? (
            <span className="team-row-sub">{t("pending.expires", { date: fmtDate(invitation.expiresAt) })}</span>
          ) : null}
        </div>
      </div>
      <div className="team-row-controls">
        <button className="wizard-cta wizard-cta--danger" type="button" disabled={busy} onClick={revoke}>
          {t("pending.revoke")}
        </button>
      </div>
    </li>
  );
}

function StatusBadge({ t, status }: { t: T; status: string }) {
  const known = ["active", "invited", "suspended", "pending", "paused", "archived"].includes(status) ? status : "active";
  return <span className={`team-status team-status--${known}`}>{t(`status.${known}`)}</span>;
}

function formatDeleteBlockers(json: { message?: string; blockers?: Record<string, number> }, t: T) {
  if (!json?.blockers) return json?.message ?? t("organizations.deleteError");

  const blockers = Object.entries(json.blockers)
    .filter(([key, value]) => key !== "exists" && Number(value) > 0)
    .map(([key, value]) => `${t(`organizations.blockers.${key}`)}: ${value}`)
    .join(" · ");

  return blockers ? `${json.message ?? t("organizations.deleteError")} ${blockers}` : json.message ?? t("organizations.deleteError");
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
