"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AdminResourceSection, AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceSelect, WorkspaceSelectField } from "@/components/admin/WorkspaceSelect";
import { Icon } from "@/components/ui/Icon";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import {
  brandAccessLevelForRole,
  canAccessPortal,
  canAccessStudio,
  canApproveAnalysis,
  canCreateBrandOrTheme,
  canManageCorpus,
  canManageTeam,
  canViewClientOutputs
} from "@/lib/auth/roles";

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
  const [view, setView] = useState<"members" | "pending" | "roles" | "organizations">("members");
  const [drawer, setDrawer] = useState<"invite" | "organization" | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);

  const actions = view === "organizations"
    ? <button className="admin-button admin-button--primary" onClick={() => setDrawer("organization")} type="button"><Icon name="sparkle" size={14} />{t("organizations.new")}</button>
    : view === "roles"
      ? null
      : <button className="admin-button admin-button--primary" onClick={() => setDrawer("invite")} type="button"><Icon name="sparkle" size={14} />{t("invite.title")}</button>;

  return (
    <div className="admin-team">
      <AdminResourceSection actions={actions} subtitle={t("directory.subtitle")} title={t("directory.title")}>
        <div className="admin-index-toolbar admin-index-toolbar--tabs-only">
          <div aria-label={t("directory.tabsLabel")} className="admin-tabs" role="tablist">
            <button aria-selected={view === "members"} className="admin-tabs__item" data-active={view === "members" ? "true" : undefined} onClick={() => setView("members")} role="tab" type="button">{t("members.title")}<span>{members.length}</span></button>
            <button aria-selected={view === "pending"} className="admin-tabs__item" data-active={view === "pending" ? "true" : undefined} onClick={() => setView("pending")} role="tab" type="button">{t("pending.title")}<span>{invitations.length}</span></button>
            <button aria-selected={view === "roles"} className="admin-tabs__item" data-active={view === "roles" ? "true" : undefined} onClick={() => setView("roles")} role="tab" type="button">{t("roleCatalog.title")}<span>{ROLES.length}</span></button>
            <button aria-selected={view === "organizations"} className="admin-tabs__item" data-active={view === "organizations" ? "true" : undefined} onClick={() => setView("organizations")} role="tab" type="button">{t("organizations.title")}<span>{organizations.length}</span></button>
          </div>
        </div>

        <div aria-live="polite" className="admin-resource-view">
          {view === "members" ? members.length === 0 ? (
            <div className="admin-empty"><p>{t("members.empty")}</p></div>
          ) : (
            <ul className="admin-resource-list">
              {members.map((member) => (
                <MemberRow
                  isSelf={member.id === currentUserId}
                  key={member.id}
                  member={member}
                  onOpen={() => setSelectedMember(member)}
                  t={t}
                />
              ))}
            </ul>
          ) : null}

          {view === "pending" ? invitations.length === 0 ? (
            <div className="admin-empty"><p>{t("pending.empty")}</p></div>
          ) : (
            <ul className="admin-resource-list">
              {invitations.map((invitation) => <InvitationRow invitation={invitation} key={invitation.id} onDone={() => router.refresh()} t={t} />)}
            </ul>
          ) : null}

          {view === "roles" ? (
            <ul className="admin-resource-list">
              {ROLES.map((role) => (
                <RoleRow
                  assignedCount={members.filter((member) => member.primaryRole === role).length}
                  key={role}
                  onOpen={() => setSelectedRole(role)}
                  role={role}
                  t={t}
                />
              ))}
            </ul>
          ) : null}

          {view === "organizations" ? organizations.length === 0 ? (
            <div className="admin-empty"><p>{t("organizations.empty")}</p></div>
          ) : (
            <ul className="admin-resource-list">
              {organizations.map((organization) => <OrganizationRow key={organization.id} onDone={() => router.refresh()} onEdit={() => setSelectedOrganization(organization)} organization={organization} t={t} />)}
            </ul>
          ) : null}
        </div>
      </AdminResourceSection>

      {drawer === "invite" ? (
        <WorkspaceDrawer ariaLabel={t("invite.title")} closeLabel={t("drawer.close")} eyebrow={t("eyebrow")} onClose={() => setDrawer(null)} title={t("invite.title")}>
          <InviteForm onClose={() => setDrawer(null)} onDone={() => router.refresh()} organizations={organizations} t={t} />
        </WorkspaceDrawer>
      ) : null}
      {drawer === "organization" ? (
        <WorkspaceDrawer ariaLabel={t("organizations.new")} closeLabel={t("drawer.close")} eyebrow={t("eyebrow")} onClose={() => setDrawer(null)} title={t("organizations.new")}>
          <CreateOrganizationForm onClose={() => setDrawer(null)} onDone={() => router.refresh()} t={t} />
        </WorkspaceDrawer>
      ) : null}
      {selectedRole ? (
        <WorkspaceDrawer
          ariaLabel={t("roleCatalog.detailAria", { role: t(`roles.${selectedRole}`) })}
          closeLabel={t("drawer.close")}
          eyebrow={t("roleCatalog.eyebrow")}
          onClose={() => setSelectedRole(null)}
          title={t(`roles.${selectedRole}`)}
        >
          <RoleDetail members={members} role={selectedRole} t={t} />
        </WorkspaceDrawer>
      ) : null}
      {selectedMember ? (
        <WorkspaceDrawer
          ariaLabel={t("members.detailAria", { name: selectedMember.fullName || selectedMember.email })}
          closeLabel={t("drawer.close")}
          eyebrow={t("members.eyebrow")}
          onClose={() => setSelectedMember(null)}
          title={selectedMember.fullName || selectedMember.email}
        >
          <MemberDetail
            isSelf={selectedMember.id === currentUserId}
            member={selectedMember}
            onDone={() => router.refresh()}
            organizations={organizations}
            t={t}
          />
        </WorkspaceDrawer>
      ) : null}
      {selectedOrganization ? (
        <WorkspaceDrawer
          ariaLabel={t("organizations.detailAria", { name: selectedOrganization.name })}
          closeLabel={t("drawer.close")}
          eyebrow={t("organizations.eyebrow")}
          onClose={() => setSelectedOrganization(null)}
          title={selectedOrganization.name}
        >
          <OrganizationEditForm
            onClose={() => setSelectedOrganization(null)}
            onDone={() => router.refresh()}
            organization={selectedOrganization}
            t={t}
          />
        </WorkspaceDrawer>
      ) : null}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function RoleRow({
  assignedCount,
  onOpen,
  role,
  t
}: {
  assignedCount: number;
  onOpen: () => void;
  role: Role;
  t: T;
}) {
  return (
    <li>
      <button className="admin-resource-row admin-resource-row--button" onClick={onOpen} type="button">
        <span className="admin-resource-row__main">
          <strong>{t(`roles.${role}`)}</strong>
          <span className="admin-resource-row__secondary">{t(`roleCatalog.descriptions.${role}`)}</span>
          <span className="admin-resource-row__meta">
            <span className="team-tag">{t("roleCatalog.assigned", { count: assignedCount })}</span>
            <span className="admin-resource-row__secondary">{t(isInternal(role) ? "roleCatalog.internal" : "roleCatalog.client")}</span>
          </span>
        </span>
        <span className="admin-resource-row__open-label">
          {t("roleCatalog.open")}
          <Icon name="arrow-right" size={14} />
        </span>
      </button>
    </li>
  );
}

function RoleDetail({ members, role, t }: { members: Member[]; role: Role; t: T }) {
  const assigned = members.filter((member) => member.primaryRole === role);
  const capabilities = roleCapabilities(role, t);

  return (
    <div className="team-role-detail">
      <p className="team-role-detail__intro">{t(`roleCatalog.descriptions.${role}`)}</p>

      <section className="team-role-detail__section">
        <header>
          <div>
            <h3>{t("roleCatalog.accessTitle")}</h3>
            <p>{t("roleCatalog.accessSubtitle")}</p>
          </div>
          <AdminStatus state={isInternal(role) ? "warning" : "good"}>
            {t(isInternal(role) ? "roleCatalog.internal" : "roleCatalog.client")}
          </AdminStatus>
        </header>
        <dl className="team-role-capabilities">
          {capabilities.map((capability) => (
            <div key={capability.key}>
              <dt>
                <strong>{capability.label}</strong>
                <small>{capability.description}</small>
              </dt>
              <dd>
                <AdminStatus state={capability.allowed ? "good" : "not_available"}>
                  {capability.value ?? t(capability.allowed ? "roleCatalog.allowed" : "roleCatalog.notAllowed")}
                </AdminStatus>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="team-role-detail__section">
        <header>
          <div>
            <h3>{t("roleCatalog.peopleTitle")}</h3>
            <p>{t("roleCatalog.peopleSubtitle")}</p>
          </div>
          <span className="team-tag">{t("roleCatalog.assigned", { count: assigned.length })}</span>
        </header>
        {assigned.length > 0 ? (
          <ul className="team-role-people">
            {assigned.map((member) => (
              <li key={member.id}>
                <span>
                  <strong>{member.fullName || member.email}</strong>
                  <small>{member.email}</small>
                </span>
                <StatusBadge status={member.status} t={t} />
              </li>
            ))}
          </ul>
        ) : <p className="team-role-detail__empty">{t("roleCatalog.peopleEmpty")}</p>}
      </section>
    </div>
  );
}

function roleCapabilities(role: Role, t: T) {
  const accessLevel = brandAccessLevelForRole(role);
  return [
    {
      key: "studio",
      label: t("roleCatalog.capabilities.studio.title"),
      description: t("roleCatalog.capabilities.studio.description"),
      allowed: canAccessStudio(role)
    },
    {
      key: "signal",
      label: t("roleCatalog.capabilities.signal.title"),
      description: t("roleCatalog.capabilities.signal.description"),
      allowed: canAccessPortal(role)
    },
    {
      key: "brands",
      label: t("roleCatalog.capabilities.brands.title"),
      description: t("roleCatalog.capabilities.brands.description"),
      allowed: canCreateBrandOrTheme(role)
    },
    {
      key: "studies",
      label: t("roleCatalog.capabilities.studies.title"),
      description: t("roleCatalog.capabilities.studies.description"),
      allowed: canManageCorpus(role)
    },
    {
      key: "review",
      label: t("roleCatalog.capabilities.review.title"),
      description: t("roleCatalog.capabilities.review.description"),
      allowed: canApproveAnalysis(role)
    },
    {
      key: "team",
      label: t("roleCatalog.capabilities.team.title"),
      description: t("roleCatalog.capabilities.team.description"),
      allowed: canManageTeam(role)
    },
    {
      key: "outputs",
      label: t("roleCatalog.capabilities.outputs.title"),
      description: t("roleCatalog.capabilities.outputs.description"),
      allowed: canViewClientOutputs(role)
    },
    {
      key: "brandAccess",
      label: t("roleCatalog.capabilities.brandAccess.title"),
      description: t("roleCatalog.capabilities.brandAccess.description"),
      allowed: true,
      value: t(`roleCatalog.brandAccess.${accessLevel}`)
    }
  ];
}

function CreateOrganizationForm({ t, onDone, onClose }: { t: T; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("active");
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
      onDone();
      onClose();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("organizations.createError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form admin-drawer-form" onSubmit={onSubmit}>
          <div className="admin-form__row">
            <label className="admin-form-field">
              <span>{t("organizations.legalName")}</span>
              <input name="legal_name" required minLength={2} maxLength={180} />
            </label>
            <label className="admin-form-field">
              <span>{t("organizations.displayName")}</span>
              <input name="display_name" maxLength={180} />
            </label>
          </div>
          <div className="admin-form__row">
            <label className="admin-form-field">
              <span>{t("organizations.slug")}</span>
              <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </label>
            <label className="admin-form-field">
              <span>{t("organizations.industry")}</span>
              <input name="industry_primary" maxLength={80} />
            </label>
          </div>
          <div className="admin-form__row">
            <label className="admin-form-field">
              <span>{t("organizations.country")}</span>
              <input name="hq_country" defaultValue="MX" maxLength={2} minLength={2} />
            </label>
            <WorkspaceSelectField ariaLabel={t("organizations.status")} label={t("organizations.status")} name="status" onChange={setStatus} options={organizationStatusOptions(t)} value={status} />
          </div>
          <div className="admin-form-actions">
            <button className="admin-button admin-button--primary" type="submit" disabled={busy}>
              <Icon name={busy ? "spinner" : "check"} size={14} /> {busy ? t("organizations.creating") : t("organizations.create")}
            </button>
            <button className="admin-button" disabled={busy} onClick={onClose} type="button">{t("organizations.cancelCreate")}</button>
            {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
          </div>
    </form>
  );
}

function OrganizationEditForm({
  onClose,
  onDone,
  organization,
  t
}: {
  onClose: () => void;
  onDone: () => void;
  organization: Organization;
  t: T;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(organization.status ?? "active");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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
      const response = await fetch(`/api/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.message ?? t("actions.saveError"));
      onDone();
      onClose();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : t("actions.saveError") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form admin-drawer-form" onSubmit={save}>
      <p className="admin-drawer-form__intro">{t("organizations.editSubtitle")}</p>
      <div className="admin-form__row">
        <label className="admin-form-field">
          <span>{t("organizations.legalName")}</span>
          <input defaultValue={organization.legalName ?? organization.name} name="legal_name" required />
        </label>
        <label className="admin-form-field">
          <span>{t("organizations.displayName")}</span>
          <input defaultValue={organization.name} name="display_name" />
        </label>
      </div>
      <div className="admin-form__row">
        <label className="admin-form-field">
          <span>{t("organizations.slug")}</span>
          <input defaultValue={organization.slug ?? ""} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
        </label>
        <label className="admin-form-field">
          <span>{t("organizations.industry")}</span>
          <input defaultValue={organization.industryPrimary ?? ""} name="industry_primary" />
        </label>
      </div>
      <div className="admin-form__row">
        <label className="admin-form-field">
          <span>{t("organizations.country")}</span>
          <input defaultValue={organization.hqCountry ?? "MX"} maxLength={2} minLength={2} name="hq_country" />
        </label>
        <WorkspaceSelectField ariaLabel={t("organizations.status")} label={t("organizations.status")} name="status" onChange={setStatus} options={organizationStatusOptions(t)} value={status} />
      </div>
      <div className="admin-form-actions">
        <button className="admin-button admin-button--primary" disabled={busy} type="submit">
          {busy ? t("actions.saving") : t("actions.save")}
        </button>
        <button className="admin-button" disabled={busy} onClick={onClose} type="button">{t("organizations.cancelCreate")}</button>
        {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
      </div>
    </form>
  );
}

function OrganizationRow({
  t,
  organization,
  onEdit,
  onDone
}: {
  t: T;
  organization: Organization;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const hasBlockers =
    (organization.usersCount ?? 0) +
      (organization.pendingInvitationsCount ?? 0) +
      (organization.brandsCount ?? 0) +
      (organization.themesCount ?? 0) >
    0;

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
    <li className="admin-resource-row admin-resource-row--organization">
      <div className="admin-resource-row__main">
        <strong>{organization.name}</strong>
        <span className="admin-resource-row__secondary">{organization.slug ?? organization.id}</span>
        <div className="admin-resource-row__meta">
          <StatusBadge t={t} status={organization.status ?? "active"} />
          <span className="team-tag">{t("organizations.users", { count: organization.usersCount ?? 0 })}</span>
          <span className="team-tag">{t("organizations.brands", { count: organization.brandsCount ?? 0 })}</span>
          <span className="team-tag">{t("organizations.corpora", { count: organization.activeCorporaCount ?? 0 })}</span>
          {(organization.pendingInvitationsCount ?? 0) > 0 ? (
            <span className="admin-resource-row__secondary">{t("organizations.pending", { count: organization.pendingInvitationsCount ?? 0 })}</span>
          ) : null}
        </div>
      </div>
      <div className="admin-resource-row__actions">
        <button className="admin-button" type="button" disabled={busy} onClick={onEdit}>
          {t("organizations.edit")}
        </button>
        <button className="admin-button admin-button--danger" type="button" disabled={busy || hasBlockers} onClick={remove}>
          {t("organizations.delete")}
        </button>
      </div>
      {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
      {hasBlockers ? <span className="team-msg team-msg--warn">{t("organizations.deleteBlocked")}</span> : null}
    </li>
  );
}

function InviteForm({ t, organizations, onDone, onClose }: { t: T; organizations: Organization[]; onDone: () => void; onClose: () => void }) {
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
      <form className="admin-form admin-drawer-form" onSubmit={onSubmit}>
        <div className="admin-form__row">
          <label className="admin-form-field">
            <span>{t("invite.email")}</span>
            <input name="email" type="email" required maxLength={200} />
          </label>
          <WorkspaceSelectField ariaLabel={t("invite.role")} label={t("invite.role")} name="primary_role" onChange={(value) => setRole(value as Role)} options={roleOptions(t)} value={role} />
        </div>
        <label className="admin-form-field">
          <span>{t("invite.organization")}</span>
          {internal ? (
            <small>{t("invite.orgInternalHint")}</small>
          ) : <OrganizationSelect organizations={organizations} t={t} />}
        </label>

        <div className="admin-form-actions">
          <button className="admin-button admin-button--primary" type="submit" disabled={submitting}>
            <Icon name="arrow-right" size={14} /> {submitting ? t("invite.submitting") : t("invite.submit")}
          </button>
          <button className="admin-button" disabled={submitting} onClick={onClose} type="button">{t("organizations.cancelCreate")}</button>
          {message ? <span className={`team-msg team-msg--${message.tone}`}>{message.text}</span> : null}
        </div>
      </form>
  );
}

function MemberRow({
  t,
  member,
  isSelf,
  onOpen
}: {
  t: T;
  member: Member;
  isSelf: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button className="admin-resource-row admin-resource-row--button" onClick={onOpen} type="button">
        <span className="admin-resource-row__main">
          <strong>{member.fullName || member.email}</strong>
          <span className="admin-resource-row__secondary">{member.email}</span>
          <span className="admin-resource-row__meta">
            <StatusBadge t={t} status={member.status} />
            {isSelf ? <span className="team-tag">{t("members.you")}</span> : null}
            <span className="team-tag">{t(`roles.${member.primaryRole}`)}</span>
            {member.organizationName ? <span className="admin-resource-row__secondary">{member.organizationName}</span> : null}
            <span className="admin-resource-row__secondary">
              {member.lastLoginAt
                ? t("members.lastLogin", { date: fmtDate(member.lastLoginAt) })
                : t("members.neverLoggedIn")}
            </span>
          </span>
        </span>
        <span className="admin-resource-row__open-label">
          {t("members.open")}
          <Icon name="arrow-right" size={14} />
        </span>
      </button>
    </li>
  );
}

function MemberDetail({
  isSelf,
  member,
  onDone,
  organizations,
  t
}: {
  isSelf: boolean;
  member: Member;
  onDone: () => void;
  organizations: Organization[];
  t: T;
}) {
  const [role, setRole] = useState<Role>((member.primaryRole as Role) ?? "client_viewer");
  const [orgId, setOrgId] = useState(member.organizationId ?? "");
  const [status, setStatus] = useState(member.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const internal = isInternal(role);
  const dirty = role !== member.primaryRole || (!internal && orgId !== (member.organizationId ?? ""));

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
      if (typeof body.status === "string") setStatus(body.status);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actions.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-member-detail">
      <div className="team-member-detail__summary">
        <div>
          <p>{member.email}</p>
          <span>{member.lastLoginAt ? t("members.lastLogin", { date: fmtDate(member.lastLoginAt) }) : t("members.neverLoggedIn")}</span>
        </div>
        <StatusBadge status={status} t={t} />
      </div>

      <form className="admin-form admin-drawer-form" onSubmit={(event) => {
        event.preventDefault();
        void patch({ primary_role: role, organization_id: internal ? null : orgId });
      }}>
        <div className="admin-drawer-form__intro">
          <strong>{t("members.accessTitle")}</strong>
          <p>{t("members.accessSubtitle")}</p>
        </div>
        <WorkspaceSelectField ariaLabel={t("members.roleLabel", { name: member.fullName || member.email })} disabled={busy || isSelf} label={t("invite.role")} name={`role-${member.id}`} onChange={(value) => setRole(value as Role)} options={roleOptions(t)} value={role} />
        {internal ? (
          <div className="admin-form-field">
            <span>{t("invite.organization")}</span>
            <small>{t("invite.orgInternalHint")}</small>
          </div>
        ) : (
          <WorkspaceSelectField ariaLabel={t("members.organizationLabel", { name: member.fullName || member.email })} disabled={busy} label={t("invite.organization")} name={`organization-${member.id}`} onChange={setOrgId} options={[{ value: "", label: t("invite.orgPlaceholder") }, ...organizations.map((organization) => ({ value: organization.id, label: organization.name }))]} value={orgId} />
        )}
        <div className="admin-form-actions">
          <button className="admin-button admin-button--primary" disabled={busy || !dirty || (!internal && !orgId)} type="submit">
            {busy ? t("actions.saving") : t("actions.save")}
          </button>
          {!isSelf ? status === "suspended" ? (
            <button className="admin-button" disabled={busy} onClick={() => void patch({ status: "active" })} type="button">{t("actions.reactivate")}</button>
          ) : (
            <button className="admin-button admin-button--danger" disabled={busy} onClick={() => void patch({ status: "suspended" })} type="button">{t("actions.suspend")}</button>
          ) : null}
          {error ? <span className="team-msg team-msg--error">{error}</span> : null}
        </div>
      </form>
    </div>
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
    <li className="admin-resource-row">
      <div className="admin-resource-row__main">
        <strong>{invitation.email}</strong>
        <div className="admin-resource-row__meta">
          <span className="team-tag">{t(`roles.${invitation.primaryRole}`)}</span>
          {invitation.organizationName ? <span className="admin-resource-row__secondary">{invitation.organizationName}</span> : null}
          <span className="admin-resource-row__secondary">{t("pending.invitedBy", { name: invitation.invitedByName ?? "—" })}</span>
          {invitation.expiresAt ? (
            <span className="admin-resource-row__secondary">{t("pending.expires", { date: fmtDate(invitation.expiresAt) })}</span>
          ) : null}
        </div>
      </div>
      <div className="admin-resource-row__actions">
        <button className="admin-button admin-button--danger" type="button" disabled={busy} onClick={revoke}>
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

function organizationStatusOptions(t: T) {
  return [
    { value: "active", label: t("organizations.statusActive") },
    { value: "paused", label: t("organizations.statusPaused") },
    { value: "archived", label: t("organizations.statusArchived") }
  ];
}

function roleOptions(t: T) {
  return ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }));
}

function OrganizationSelect({ organizations, t }: { organizations: Organization[]; t: T }) {
  const [organizationId, setOrganizationId] = useState("");
  return (
    <WorkspaceSelect
      ariaLabel={t("invite.organization")}
      name="organization_id"
      onChange={setOrganizationId}
      options={[{ value: "", label: t("invite.orgPlaceholder") }, ...organizations.map((organization) => ({ value: organization.id, label: organization.name }))]}
      value={organizationId}
    />
  );
}
