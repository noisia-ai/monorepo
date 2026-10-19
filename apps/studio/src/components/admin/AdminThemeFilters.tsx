"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { WorkspaceSelect } from "@/components/admin/WorkspaceSelect";

export function AdminThemeFilters({
  industry: initialIndustry,
  labels,
  organization: initialOrganization,
  status: initialStatus
}: {
  industry?: string;
  labels: {
    apply: string;
    industry: string;
    industryPlaceholder: string;
    organization: string;
    organizationPlaceholder: string;
    search: string;
    status: string;
    statuses: Record<"all" | "active" | "archived" | "draft" | "published", string>;
  };
  organization?: string;
  status?: string;
}) {
  const router = useRouter();
  const [organization, setOrganization] = useState(initialOrganization ?? "");
  const [industry, setIndustry] = useState(initialIndustry ?? "");
  const [status, setStatus] = useState(initialStatus ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (organization.trim()) params.set("organization", organization.trim());
    if (industry.trim()) params.set("industry", industry.trim());
    if (status) params.set("status", status);
    router.push(`/studio/themes${params.size ? `?${params.toString()}` : ""}`);
  }

  return (
    <form className="admin-resource-toolbar admin-theme-toolbar" onSubmit={submit}>
      <label className="admin-resource-search">
        <MagnifyingGlass aria-hidden size={15} />
        <span className="sr-only">{labels.organization}</span>
        <input
          aria-label={labels.organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder={labels.organizationPlaceholder}
          value={organization}
        />
      </label>
      <label className="admin-resource-filter">
        <span className="sr-only">{labels.industry}</span>
        <input
          aria-label={labels.industry}
          onChange={(event) => setIndustry(event.target.value)}
          placeholder={labels.industryPlaceholder}
          value={industry}
        />
      </label>
      <WorkspaceSelect
        ariaLabel={labels.status}
        className="admin-resource-filter admin-resource-filter--status"
        name="status"
        onChange={setStatus}
        options={[
          { label: labels.statuses.all, value: "" },
          { label: labels.statuses.active, value: "active" },
          { label: labels.statuses.published, value: "published" },
          { label: labels.statuses.draft, value: "draft" },
          { label: labels.statuses.archived, value: "archived" }
        ]}
        value={status}
      />
      <button className="admin-button" type="submit">{labels.apply}</button>
    </form>
  );
}
