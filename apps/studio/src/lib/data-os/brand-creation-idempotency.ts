import { signalSemanticContextProposalDigestV1 } from "@noisia/query-engine";

export type BrandCreationRequestV1 = {
  slug: string;
  name: string;
  display_name?: string | null;
  industry?: string | null;
  industry_sub?: string | null;
  countries: string[];
  description?: string | null;
  brand_seed_handles: string[];
  competitors: string[];
  knowledge_notes?: string | null;
  timezone: string;
  status: string;
  primary_brand_manager_user_id?: string | null;
};

/** Seals fields that create child rows as well as the brand row. A lost-response
 * retry must not silently keep different competitors or knowledge. */
export function brandCreationRequestDigestV1(organizationId: string, input: BrandCreationRequestV1) {
  return signalSemanticContextProposalDigestV1({
    contract_version: "brand-creation-request-v1",
    organization_id: organizationId,
    slug: input.slug,
    name: input.name,
    display_name: input.display_name ?? null,
    industry: input.industry ?? null,
    industry_sub: input.industry_sub ?? null,
    countries: input.countries,
    description: input.description ?? null,
    brand_seed_handles: input.brand_seed_handles,
    competitors: input.competitors,
    knowledge_notes: input.knowledge_notes ?? null,
    timezone: input.timezone,
    status: input.status,
    primary_brand_manager_user_id: input.primary_brand_manager_user_id ?? null
  });
}

export function storedBrandCreationRequestDigestV1(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).creation_request_digest;
  return typeof value === "string" ? value : null;
}
