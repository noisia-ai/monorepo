import { canonicalizeSignalTimezone, validateSignalWorkspaceIdentityV1 } from "@noisia/query-engine";

export type SignalWorkspaceCorpusRole = "operational" | "strategic" | "legacy";

export type SignalWorkspaceUser = {
  id: string;
  userType: string;
  organizationId: string | null;
};

export type SignalWorkspaceLookup =
  | { workspaceId: string; workspaceSlug?: never; organizationId?: string }
  | { workspaceId?: never; workspaceSlug: string; organizationId?: string };

export type SignalWorkspaceCorpus = {
  id: string;
  name: string | null;
  role: SignalWorkspaceCorpusRole;
  status: string;
  validFrom: string;
  methodologySlug: string | null;
  outputId: string | null;
};

export type ResolvedSignalWorkspace = {
  contractVersion: "signal-backend-v1";
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  subject: { type: "brand" | "theme"; id: string };
  timezone: string;
  status: string;
  corpora: SignalWorkspaceCorpus[];
};

export type SignalWorkspaceStoreRow = Omit<ResolvedSignalWorkspace, "contractVersion"> & {
  hasBrandAccess: boolean;
};

type NormalizedSignalWorkspaceLookup = (
  | { workspaceId: string; workspaceSlug?: never }
  | { workspaceId?: never; workspaceSlug: string }
) & { organizationId: string | null };

export type SignalWorkspaceOption = {
  id: string;
  slug: string;
  name: string;
  subjectType: "brand" | "theme";
};

export interface SignalWorkspaceResolverStore {
  loadWorkspace(lookup: NormalizedSignalWorkspaceLookup, userId: string): Promise<SignalWorkspaceStoreRow | null>;
  loadWorkspaceForLegacyOutput?(outputId: string, userId: string): Promise<SignalWorkspaceStoreRow | null>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function canAccessSignalWorkspace(user: SignalWorkspaceUser, row: SignalWorkspaceStoreRow) {
  if (user.userType === "noisia_internal") return true;
  if (!user.organizationId || user.organizationId !== row.organizationId) return false;
  return row.subject.type === "theme" || row.hasBrandAccess;
}

export async function resolveSignalWorkspaceWithStore(
  store: SignalWorkspaceResolverStore,
  user: SignalWorkspaceUser,
  lookup: SignalWorkspaceLookup
): Promise<ResolvedSignalWorkspace | null> {
  const normalized = normalizeLookup(user, lookup);
  const row = await store.loadWorkspace(normalized, user.id);
  if (!row || !canAccessSignalWorkspace(user, row)) return null;
  return publicWorkspace(row);
}

export async function resolveSignalWorkspaceForUser(
  user: SignalWorkspaceUser,
  lookup: SignalWorkspaceLookup
) {
  return resolveSignalWorkspaceWithStore(postgresSignalWorkspaceStore, user, lookup);
}

export async function resolveLegacyOutputSignalWorkspaceForUser(
  user: SignalWorkspaceUser,
  outputId: string,
  store: SignalWorkspaceResolverStore = postgresSignalWorkspaceStore
) {
  const normalizedOutputId = outputId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedOutputId)) return null;
  const row = await store.loadWorkspaceForLegacyOutput?.(normalizedOutputId, user.id);
  if (!row || !canAccessSignalWorkspace(user, row)) return null;
  return publicWorkspace(row);
}

export async function listSignalWorkspaceOptionsForUser(
  user: SignalWorkspaceUser
): Promise<SignalWorkspaceOption[]> {
  const { pool } = await import("@/lib/db");
  const isInternal = user.userType === "noisia_internal";
  const result = await pool.query<{
    id: string;
    slug: string;
    name: string;
    subject_type: "brand" | "theme";
  }>(
    `SELECT
       workspace.id::text,
       workspace.slug,
       CASE
         WHEN workspace.brand_id IS NOT NULL
           THEN COALESCE(brand.display_name, brand.name, workspace.slug)
         ELSE COALESCE(theme.name, workspace.slug)
       END AS name,
       CASE WHEN workspace.brand_id IS NOT NULL THEN 'brand' ELSE 'theme' END AS subject_type
     FROM signal_workspaces workspace
     LEFT JOIN brands brand ON brand.id = workspace.brand_id
     LEFT JOIN themes theme ON theme.id = workspace.theme_id
     WHERE workspace.status = 'active'
       AND (
         $2::boolean
         OR (
           workspace.organization_id = $3::uuid
           AND (
             workspace.theme_id IS NOT NULL
             OR EXISTS (
               SELECT 1
               FROM user_brand_access access
               WHERE access.user_id = $1::uuid
                 AND access.brand_id = workspace.brand_id
                 AND access.revoked_at IS NULL
             )
           )
         )
       )
     ORDER BY lower(
       CASE
         WHEN workspace.brand_id IS NOT NULL
           THEN COALESCE(brand.display_name, brand.name, workspace.slug)
         ELSE COALESCE(theme.name, workspace.slug)
       END
     ), workspace.id`,
    [user.id, isInternal, user.organizationId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    subjectType: row.subject_type
  }));
}

function normalizeLookup(
  user: SignalWorkspaceUser,
  lookup: SignalWorkspaceLookup
): NormalizedSignalWorkspaceLookup {
  const organizationId = (lookup.organizationId ?? user.organizationId)?.trim().toLowerCase();
  if (
    (!organizationId || !UUID_PATTERN.test(organizationId))
    && user.userType !== "noisia_internal"
  ) {
    throw new Error("organizationId is required and must be a UUID when resolving a Signal workspace.");
  }
  if (lookup.workspaceId) {
    const workspaceId = lookup.workspaceId.trim().toLowerCase();
    if (!UUID_PATTERN.test(workspaceId)) throw new Error("workspaceId must be a UUID.");
    return { workspaceId, organizationId: organizationId ?? null };
  }
  if (!lookup.workspaceSlug) throw new Error("workspaceSlug is required.");
  const workspaceSlug = lookup.workspaceSlug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(workspaceSlug)) throw new Error("workspaceSlug must be canonical.");
  return { workspaceSlug, organizationId: organizationId as string };
}

function publicWorkspace(row: SignalWorkspaceStoreRow): ResolvedSignalWorkspace {
  const identity = validateSignalWorkspaceIdentityV1({
    workspace_id: row.id,
    organization_id: row.organizationId,
    workspace_slug: row.slug,
    subject: row.subject,
    timezone: canonicalizeSignalTimezone(row.timezone)
  });
  return {
    contractVersion: identity.contract_version,
    id: identity.workspace_id,
    organizationId: identity.organization_id,
    slug: identity.workspace_slug,
    name: row.name,
    subject: identity.subject,
    timezone: identity.timezone,
    status: row.status,
    corpora: row.corpora
  };
}

const postgresSignalWorkspaceStore: SignalWorkspaceResolverStore = {
  async loadWorkspace(lookup, userId) {
    const { pool } = await import("@/lib/db");
    if (lookup.workspaceId && !lookup.organizationId) {
      const result = await pool.query(
        workspaceSelectSql("sw.id = $1::uuid", 2),
        [lookup.workspaceId, userId]
      );
      return mapWorkspaceRow(result.rows[0]);
    }
    if (lookup.workspaceSlug && !lookup.organizationId) {
      const result = await pool.query(
        workspaceSelectSql(`sw.slug = $1 AND (
          SELECT COUNT(*)
          FROM signal_workspaces candidate
          WHERE candidate.slug = $1
            AND candidate.status <> 'archived'
        ) = 1`, 2),
        [lookup.workspaceSlug, userId]
      );
      return mapWorkspaceRow(result.rows[0]);
    }
    const params = lookup.workspaceId
      ? [lookup.organizationId, lookup.workspaceId, userId]
      : [lookup.organizationId, lookup.workspaceSlug, userId];
    const predicate = lookup.workspaceId ? "sw.id = $2::uuid" : "sw.slug = $2";
    const result = await pool.query(
      workspaceSelectSql(`${predicate} AND sw.organization_id = $1::uuid`, 3),
      params
    );
    return mapWorkspaceRow(result.rows[0]);
  },

  async loadWorkspaceForLegacyOutput(outputId, userId) {
    const { pool } = await import("@/lib/db");
    const result = await pool.query(
      workspaceSelectSql(`EXISTS (
        SELECT 1
        FROM published_outputs po
        JOIN signal_workspace_corpora mapped
          ON mapped.study_corpus_id = po.study_corpus_id
         AND mapped.workspace_id = sw.id
         AND mapped.valid_to IS NULL
        WHERE po.id = $1::uuid
      )`, 2),
      [outputId, userId]
    );
    return mapWorkspaceRow(result.rows[0]);
  }
};

function workspaceSelectSql(predicate: string, userParameter: number) {
  return `
    SELECT
      sw.id::text,
      sw.organization_id::text,
      sw.slug,
      CASE
        WHEN sw.brand_id IS NOT NULL THEN (
          SELECT COALESCE(brand.display_name, brand.name, sw.slug)
          FROM brands brand
          WHERE brand.id = sw.brand_id
        )
        ELSE (
          SELECT COALESCE(theme.name, sw.slug)
          FROM themes theme
          WHERE theme.id = sw.theme_id
        )
      END AS subject_name,
      sw.brand_id::text,
      sw.theme_id::text,
      sw.timezone,
      sw.status,
      EXISTS (
        SELECT 1
        FROM user_brand_access uba
        WHERE uba.user_id = $${userParameter}::uuid
          AND uba.brand_id = sw.brand_id
          AND uba.revoked_at IS NULL
      ) AS has_brand_access,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', sc.id,
            'name', sc.name,
            'role', swc.role,
            'status', sc.status,
            'validFrom', swc.valid_from,
            'methodologySlug', methodology.slug,
            'outputId', (
              SELECT output.id::text
              FROM published_outputs output
              WHERE output.study_corpus_id = sc.id
                AND output.status = 'published'
                AND output.archived_at IS NULL
              ORDER BY output.published_at DESC NULLS LAST, output.updated_at DESC, output.id
              LIMIT 1
            )
          ) ORDER BY swc.role, swc.valid_from DESC, sc.id
        ) FILTER (WHERE swc.id IS NOT NULL),
        '[]'::jsonb
      ) AS corpora
    FROM signal_workspaces sw
    LEFT JOIN signal_workspace_corpora swc
      ON swc.workspace_id = sw.id
     AND swc.valid_to IS NULL
    LEFT JOIN study_corpora sc ON sc.id = swc.study_corpus_id
    LEFT JOIN methodologies methodology ON methodology.id = sc.methodology_id
    WHERE sw.status <> 'archived'
      AND ${predicate}
    GROUP BY sw.id
    LIMIT 1
  `;
}

function mapWorkspaceRow(input: unknown): SignalWorkspaceStoreRow | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const brandId = typeof row.brand_id === "string" ? row.brand_id : null;
  const themeId = typeof row.theme_id === "string" ? row.theme_id : null;
  if ((!brandId && !themeId) || (brandId && themeId)) return null;
  const corpora = Array.isArray(row.corpora) ? row.corpora : [];
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    slug: String(row.slug),
    name: typeof row.subject_name === "string" ? row.subject_name : String(row.slug),
    subject: brandId ? { type: "brand", id: brandId } : { type: "theme", id: themeId as string },
    timezone: String(row.timezone),
    status: String(row.status),
    hasBrandAccess: row.has_brand_access === true,
    corpora: corpora.map((item) => {
      const corpus = item as Record<string, unknown>;
      return {
        id: String(corpus.id),
        name: corpus.name == null ? null : String(corpus.name),
        role: String(corpus.role) as SignalWorkspaceCorpusRole,
        status: String(corpus.status),
        validFrom: new Date(String(corpus.validFrom)).toISOString(),
        methodologySlug:
          typeof corpus.methodologySlug === "string" ? corpus.methodologySlug : null,
        outputId: typeof corpus.outputId === "string" ? corpus.outputId : null
      };
    })
  };
}
