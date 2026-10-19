/** Counts accepted files by capture intent, not semantic membership or a connector's governed scope. */
export const ADMIN_SOURCE_CAPTURE_SCOPES = ["primary_brand", "competitor", "category", "reference", "unknown"] as const;
export type AdminSourceCaptureScope = typeof ADMIN_SOURCE_CAPTURE_SCOPES[number];
export type AdminSourceImportCaptureScopes = { accepted_files: number } & Record<AdminSourceCaptureScope, number>;
export type AdminSourceCaptureScopeRow = Record<`import_scope_${AdminSourceCaptureScope}` | "import_accepted_files", number | string>;

export function mapAdminSourceCaptureScopes(row: AdminSourceCaptureScopeRow): AdminSourceImportCaptureScopes {
  const count = (value: number | string) => {
    const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error("admin_source_capture_count_invalid");
    return parsed;
  };
  const scopes = Object.fromEntries(ADMIN_SOURCE_CAPTURE_SCOPES.map(scope => [scope, count(row[`import_scope_${scope}`])])) as Record<AdminSourceCaptureScope, number>;
  const accepted_files = count(row.import_accepted_files);
  if (Object.values(scopes).reduce((sum, value) => sum + value, 0) !== accepted_files) throw new Error("admin_source_capture_count_invalid");
  return { accepted_files, ...scopes };
}

/** Embedded once in the existing workspace source query. Source/workspace and
 * slot/plan/digest bindings match the receipt summary; failed file replays,
 * rejected files and work in progress are not accepted files. */
export const ADMIN_SOURCE_CAPTURE_SCOPES_SQL = `
  SELECT batch.data_source_id,
    count(*) AS import_accepted_files,
    count(*) FILTER (WHERE slot.scope='primary_brand') AS import_scope_primary_brand,
    count(*) FILTER (WHERE slot.scope='competitor') AS import_scope_competitor,
    count(*) FILTER (WHERE slot.scope='category') AS import_scope_category,
    count(*) FILTER (WHERE slot.scope='reference') AS import_scope_reference,
    count(*) FILTER (WHERE slot.scope IS NULL OR slot.scope NOT IN ('primary_brand','competitor','category','reference')) AS import_scope_unknown
  FROM import_batches batch
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=batch.workspace_id
  LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id AND slot.workspace_id=batch.workspace_id
    AND slot.plan_id=batch.acquisition_plan_id AND slot.definition_hash=batch.acquisition_slot_digest
  WHERE batch.workspace_id=$1::uuid AND batch.status='completed'
  GROUP BY batch.data_source_id
`;
