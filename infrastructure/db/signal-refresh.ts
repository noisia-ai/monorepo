export type SignalDataAcceptanceInput = {
  studyCorpusId: string;
  sourceKey: string;
  dataSourceId?: string | null;
  sourceSyncRunId?: string | null;
  importBatchId?: string | null;
  corpusRevision?: number | null;
  acceptedAt?: Date;
  materializedAt?: Date;
};

export type SignalDataAcceptance = {
  watermarkId: string;
  invalidationId: string | null;
  workspaceId: string;
  changed: boolean;
};

export type SignalWorkspaceDataAcceptanceInput = {
  workspaceId: string;
  sourceKey: string;
  dataSourceId: string;
  importBatchId: string;
  acceptedAt?: Date;
  materializedAt?: Date;
};

export type SignalWorkspaceDataAcceptance = {
  watermarkId: string;
  invalidationId: string | null;
  workspaceId: string;
  populationId: string | null;
  changed: boolean;
};

type Queryable = {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function recordSignalDataAcceptance(
  queryable: Queryable,
  input: SignalDataAcceptanceInput
): Promise<SignalDataAcceptance[]> {
  const sourceKey = input.sourceKey.trim();
  if (!sourceKey) throw new Error("sourceKey is required.");
  if (Boolean(input.sourceSyncRunId) === Boolean(input.importBatchId)) {
    throw new Error("Exactly one of sourceSyncRunId or importBatchId is required.");
  }
  const acceptedAt = input.acceptedAt ?? new Date();
  const materializedAt = input.materializedAt ?? acceptedAt;
  const result = await queryable.query(
    `
      SELECT watermark_id::text, invalidation_id::text, workspace_id::text, changed
      FROM record_signal_data_acceptance($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8)
    `,
    [
      input.studyCorpusId,
      sourceKey,
      input.dataSourceId ?? null,
      input.sourceSyncRunId ?? null,
      input.importBatchId ?? null,
      input.corpusRevision ?? null,
      acceptedAt,
      materializedAt
    ]
  );
  return result.rows.map((row) => ({
    watermarkId: String(row.watermark_id),
    invalidationId: row.invalidation_id == null ? null : String(row.invalidation_id),
    workspaceId: String(row.workspace_id),
    changed: row.changed === true
  }));
}

export async function recordSignalWorkspaceDataAcceptance(
  queryable: Queryable,
  input: SignalWorkspaceDataAcceptanceInput
): Promise<SignalWorkspaceDataAcceptance> {
  const sourceKey = input.sourceKey.trim();
  if (!sourceKey) throw new Error("sourceKey is required.");
  const acceptedAt = input.acceptedAt ?? new Date();
  const materializedAt = input.materializedAt ?? acceptedAt;
  const result = await queryable.query(
    `
      SELECT watermark_id::text, invalidation_id::text,
        workspace_id::text, population_id::text, changed
      FROM record_signal_workspace_data_acceptance_v2($1::uuid, $2, $3::uuid, $4::uuid, $5, $6)
    `,
    [
      input.workspaceId,
      sourceKey,
      input.dataSourceId,
      input.importBatchId,
      acceptedAt,
      materializedAt
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Workspace acceptance did not return a watermark.");
  return {
    watermarkId: String(row.watermark_id),
    invalidationId: row.invalidation_id == null ? null : String(row.invalidation_id),
    workspaceId: String(row.workspace_id),
    populationId: row.population_id == null ? null : String(row.population_id),
    changed: row.changed === true
  };
}
