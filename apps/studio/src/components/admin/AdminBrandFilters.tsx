"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { WorkspaceSelect } from "@/components/admin/WorkspaceSelect";

export function AdminBrandFilters({
  labels,
  organization: initialOrganization,
  query: initialQuery,
  status: initialStatus
}: {
  labels: {
    apply: string;
    organization: string;
    organizationPlaceholder: string;
    search: string;
    searchPlaceholder: string;
    status: string;
    statuses: Record<"active" | "all" | "archived" | "paused", string>;
  };
  organization?: string;
  query?: string;
  status?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [organization, setOrganization] = useState(initialOrganization ?? "");
  const [status, setStatus] = useState(initialStatus ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (organization.trim()) params.set("organization", organization.trim());
    if (status) params.set("status", status);
    router.push(`/studio/brands${params.size ? `?${params.toString()}` : ""}`);
  }

  return (
    <form className="admin-resource-toolbar" onSubmit={submit}>
      <label className="admin-resource-search">
        <MagnifyingGlass aria-hidden size={15} />
        <span className="sr-only">{labels.search}</span>
        <input
          aria-label={labels.search}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          value={query}
        />
      </label>
      <label className="admin-resource-filter">
        <span className="sr-only">{labels.organization}</span>
        <input
          aria-label={labels.organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder={labels.organizationPlaceholder}
          value={organization}
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
          { label: labels.statuses.paused, value: "paused" },
          { label: labels.statuses.archived, value: "archived" }
        ]}
        value={status}
      />
      <button className="admin-button" type="submit">{labels.apply}</button>
    </form>
  );
}
