export type QueryPackReadinessPack = {
  id?: string | null;
  status?: string | null;
  mentionsReturned?: number | null;
  linkedMentionCount?: number | null;
};

export type QueryPackReadinessBatch = {
  queryPackId?: string | null;
  status?: string | null;
  includedCount?: number | null;
};

const importedPackStatuses = new Set(["imported", "approved"]);

export function queryPackHasData(
  pack: QueryPackReadinessPack,
  batches: QueryPackReadinessBatch[] = []
) {
  if (Number(pack.mentionsReturned ?? 0) > 0) return true;
  if (Number(pack.linkedMentionCount ?? 0) > 0) return true;
  if (pack.status && importedPackStatuses.has(pack.status)) return true;
  if (!pack.id) return false;

  return batches.some((batch) => {
    if (batch.queryPackId !== pack.id || batch.status !== "completed") return false;
    return Number(batch.includedCount ?? 0) > 0;
  });
}

export function queryPackHasDirectCsv(
  pack: QueryPackReadinessPack,
  batches: QueryPackReadinessBatch[] = []
) {
  if (!pack.id) return false;

  return batches.some((batch) => {
    if (batch.queryPackId !== pack.id || batch.status !== "completed") return false;
    return Number(batch.includedCount ?? 0) > 0;
  });
}
