import { and, desc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type {
  SignalMentionScopeV1
} from "@noisia/query-engine";
import {
  SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
  validateSignalWorkspaceImportInputV1
} from "@noisia/query-engine";
import {
  competitors,
  dataSources,
  importBatches,
  recordSignalDataAcceptance,
  recordSignalWorkspaceDataAcceptance,
  signalRefreshPolicies,
  sourceSyncRuns
} from "@noisia/db";

import { advanceCorpusRevision } from "@/lib/corpus/revision";
import { ingestSentioneCsvStream } from "@/lib/csv/sentione";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import type { SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import { db, pool } from "@/lib/db";

export type WorkspaceIngestionContext = {
  workspaceId: string;
  dataSourceId: string;
  studyCorpusId: string | null;
};

export async function resolveWorkspaceIngestionForCorpus(
  studyCorpusId: string,
  sourceSystem: string
): Promise<WorkspaceIngestionContext> {
  const result = await pool.query<{
    workspace_id: string;
    data_source_id: string;
  }>(`
    WITH resolved AS (
      SELECT workspace.id AS workspace_id
      FROM study_corpora corpus
      JOIN signal_workspaces workspace
        ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
       AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
      WHERE corpus.id = $1::uuid
        AND workspace.status = 'active'
      ORDER BY workspace.created_at, workspace.id
      LIMIT 1
    )
    SELECT
      resolved.workspace_id::text,
      ensure_signal_compatibility_data_source(
        resolved.workspace_id,
        $2
      )::text AS data_source_id
    FROM resolved
  `, [studyCorpusId, sourceSystem]);
  const row = result.rows[0];
  if (!row) throw new Error("Study corpus does not resolve to an active Signal workspace.");
  return {
    workspaceId: row.workspace_id,
    dataSourceId: row.data_source_id,
    studyCorpusId
  };
}

export async function resolveSignalWorkspaceIdForStudyCorpus(studyCorpusId: string) {
  const result = await pool.query<{ workspace_id: string }>(`
    SELECT workspace.id::text AS workspace_id
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE corpus.id = $1::uuid
      AND workspace.status = 'active'
    ORDER BY workspace.created_at, workspace.id
    LIMIT 1
  `, [studyCorpusId]);
  const workspaceId = result.rows[0]?.workspace_id;
  if (!workspaceId) throw new Error("Study corpus does not resolve to an active Signal workspace.");
  return workspaceId;
}

export async function validateWorkspaceStudyContribution(
  workspaceId: string,
  studyCorpusId: string | null
) {
  if (!studyCorpusId) return null;
  const result = await pool.query<{ id: string }>(`
    SELECT corpus.id::text
    FROM study_corpora corpus
    JOIN signal_workspaces workspace
      ON workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
     AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    WHERE workspace.id = $1::uuid
      AND corpus.id = $2::uuid
    LIMIT 1
  `, [workspaceId, studyCorpusId]);
  if (!result.rows[0]) {
    throw new WorkspaceIngestionValidationError(
      "Contributing study must belong to the same Signal workspace."
    );
  }
  return studyCorpusId;
}

export async function listWorkspaceDataSources(workspaceId: string) {
  return db
    .select({
      id: dataSources.id,
      name: dataSources.name,
      sourceKey: dataSources.sourceKey,
      sourceContractVersion: dataSources.sourceContractVersion,
      provider: dataSources.provider,
      sourceType: dataSources.sourceType,
      connectionMethod: dataSources.connectionMethod,
      role: dataSources.role,
      governedScope: dataSources.governedScope,
      governedEntityId: dataSources.governedEntityId,
      scopeReviewStatus: dataSources.scopeReviewStatus,
      status: dataSources.status,
      createdAt: dataSources.createdAt,
      updatedAt: dataSources.updatedAt
    })
    .from(dataSources)
    .where(eq(dataSources.workspaceId, workspaceId))
    .orderBy(desc(dataSources.updatedAt), desc(dataSources.createdAt));
}

export async function createWorkspaceDataSource(args: {
  workspace: ResolvedSignalWorkspace;
  userId: string;
  input: {
    name: string;
    provider: string;
    source_type: string;
    connection_method: string;
    scope: SignalMentionScopeV1;
    entity_id: string | null;
  };
}) {
  const brandId = args.workspace.subject.type === "brand"
    ? args.workspace.subject.id
    : null;
  if (args.input.scope === "primary_brand" && args.input.entity_id && args.input.entity_id !== brandId) {
    throw new WorkspaceIngestionValidationError(
      "Primary brand source entity must be the workspace brand."
    );
  }
  if (args.input.scope === "competitor") {
    if (!brandId || !args.input.entity_id) {
      throw new WorkspaceIngestionValidationError(
        "Competitor source requires a governed competitor entity_id."
      );
    }
    const [competitor] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(and(
        eq(competitors.id, args.input.entity_id),
        eq(competitors.brandId, brandId)
      ))
      .limit(1);
    if (!competitor) {
      throw new WorkspaceIngestionValidationError(
        "Competitor entity does not belong to the workspace brand."
      );
    }
  }
  const governedEntityId = args.input.scope === "primary_brand"
    ? brandId
    : args.input.entity_id;
  const [created] = await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(dataSources)
      .values({
        workspaceId: args.workspace.id,
        organizationId: args.workspace.organizationId,
        brandId,
        sourceType: args.input.source_type,
        provider: args.input.provider,
        connectionMethod: args.input.connection_method,
        name: args.input.name,
        mapping: {},
        mappingVersion: 1,
        role: {
          ownership: "workspace",
          scope: args.input.scope,
          entity_id: governedEntityId,
          contract_version: SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION
        },
        governedScope: args.input.scope,
        governedEntityType: governedEntityType(args.input.scope),
        governedEntityId,
        scopePolicyVersion: "workspace-source-scope-v1",
        scopeReviewStatus: "approved",
        scopeApprovedByUserId: args.userId,
        scopeApprovalSource: "workspace_source_creation",
        scopeApprovedAt: new Date(),
        status: "active",
        visibility: "internal"
      })
      .returning({ id: dataSources.id });
    if (!source) throw new Error("Workspace source could not be created.");
    await tx
      .insert(signalRefreshPolicies)
      .values({
        workspaceId: args.workspace.id,
        dataSourceId: source.id,
        sourceKey: `source-${source.id}`,
        adapterKey: args.input.connection_method,
        cadence: "manual",
        timezone: args.workspace.timezone,
        enabled: false,
        ownerUserId: args.userId,
        metadata: { source: "workspace-source-api-v1" }
      })
      .onConflictDoNothing();
    return [source] as const;
  });
  return {
    id: created.id,
    name: args.input.name,
    provider: args.input.provider,
    source_type: args.input.source_type,
    connection_method: args.input.connection_method,
    scope: args.input.scope,
    entity_id: governedEntityId,
    status: "active"
  };
}

export async function createWorkspaceDataSourceProductV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  input: {
    name: string;
    provider: string;
    source_type: string;
    connection_method: string;
    scope: SignalMentionScopeV1;
    entity_id: string | null;
  };
}) {
  const brandId = args.workspace.subject.type === "brand" ? args.workspace.subject.id : null;
  const governedEntityId = args.input.scope === "primary_brand" ? brandId : args.input.entity_id;
  if (!brandId || (args.input.scope === "primary_brand" && args.input.entity_id
      && args.input.entity_id !== brandId)) {
    throw new WorkspaceIngestionValidationError("Primary brand source entity must be the workspace brand.");
  }
  if (["competitor","category","reference"].includes(args.input.scope) && !governedEntityId) {
    throw new WorkspaceIngestionValidationError("Attributed source requires a governed entity_id.");
  }
  const operation = await beginSignalProductOperationV1<{
    id: string; name: string; provider: string; source_type: string; connection_method: string;
    scope: SignalMentionScopeV1; entity_id: string | null; status: "active";
  }>({
    queryable: args.queryable,workspace: args.workspace,actor: args.actor,
    action: "create-source",idempotencyKey: args.idempotencyKey,input: args.input
  });
  if (operation.replay !== null) return operation.replay;
  const entityAllowed = await args.queryable.query<{ allowed: boolean }>(`
    SELECT CASE $4::text
      WHEN 'primary_brand' THEN $5::uuid=$3::uuid
      WHEN 'competitor' THEN EXISTS (SELECT 1 FROM competitors competitor
        JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
        WHERE competitor.id=$5::uuid AND competitor.brand_id=$3::uuid
          AND competitor.status='current')
      WHEN 'category' THEN EXISTS (SELECT 1 FROM intelligence_entities entity
        WHERE entity.id=$5::uuid AND entity.organization_id=$2::uuid AND entity.brand_id=$3::uuid
          AND entity.entity_type='category' AND entity.status='active')
      WHEN 'reference' THEN EXISTS (SELECT 1 FROM intelligence_entities entity
        WHERE entity.id=$5::uuid AND entity.organization_id=$2::uuid AND entity.brand_id=$3::uuid
          AND entity.entity_type='reference' AND entity.status='active')
      ELSE $5::uuid IS NULL END AS allowed
    FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
      AND workspace.organization_id=$2::uuid AND workspace.brand_id=$3::uuid
  `,[args.workspace.id,args.workspace.organizationId,brandId,args.input.scope,governedEntityId]);
  if (entityAllowed.rows[0]?.allowed !== true) {
    throw new WorkspaceIngestionValidationError("Source entity is unavailable or cross-workspace.");
  }
  const created = await args.queryable.query<{ id: string }>(`
    INSERT INTO data_sources (
      workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,
      mapping,mapping_version,role,governed_scope,governed_entity_type,governed_entity_id,
      scope_policy_version,scope_review_status,scope_approved_by_user_id,
      scope_approval_source,scope_approved_at,status,visibility
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'{}'::jsonb,1,
      jsonb_build_object('ownership','workspace','scope',$8::text,'entity_id',$9::text,
        'contract_version',$10::text),$8,$11,$9::uuid,'workspace-source-scope-v1','approved',
      $12::uuid,'workspace_source_creation',clock_timestamp(),'active','internal')
    RETURNING id::text
  `,[args.workspace.id,args.workspace.organizationId,brandId,args.input.source_type,
    args.input.provider,args.input.connection_method,args.input.name,args.input.scope,
    governedEntityId,SIGNAL_WORKSPACE_DATA_PLANE_CONTRACT_VERSION,
    governedEntityType(args.input.scope),args.actor.id]);
  const sourceId = created.rows[0]?.id;
  if (!sourceId) throw new Error("Workspace source could not be created.");
  await args.queryable.query(`
    INSERT INTO signal_refresh_policies (
      workspace_id,data_source_id,source_key,adapter_key,cadence,timezone,enabled,owner_user_id,metadata
    ) VALUES ($1::uuid,$2::uuid,$3,$4,'manual',$5,false,$6::uuid,
      jsonb_build_object('source','workspace-source-api-v1'))
  `,[args.workspace.id,sourceId,`source-${sourceId}`,args.input.connection_method,
    args.workspace.timezone,args.actor.id]);
  const result = {
    id: sourceId,name: args.input.name,provider: args.input.provider,
    source_type: args.input.source_type,connection_method: args.input.connection_method,
    scope: args.input.scope,entity_id: governedEntityId,status: "active" as const
  };
  await completeSignalProductOperationV1({
    queryable: args.queryable,workspaceId: args.workspace.id,key: operation.key,result
  });
  return result;
}

export async function createWorkspaceConnectorSourceProductV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  input: {
    contract_version: "signal-data-source-connector-v1";
    name: string;
    provider: string;
    source_type: string;
    connection_method: string;
  };
}) {
  const brandId = args.workspace.subject.type === "brand" ? args.workspace.subject.id : null;
  if (!brandId) throw new WorkspaceIngestionValidationError("Connector sources require a brand workspace.");
  const operation = await beginSignalProductOperationV1<{
    source_key: string; name: string; provider: string; source_type: string;
    connection_method: string; status: "active"; readiness: "governance_pending";
  }>({
    queryable: args.queryable, workspace: args.workspace, actor: args.actor,
    action: "create-source", idempotencyKey: args.idempotencyKey, input: args.input
  });
  if (operation.replay !== null) return operation.replay;
  const sourceId = randomUUID();
  const sourceKey = `source-sha256-${createHash("sha256").update(sourceId).digest("hex")}`;
  const created = await args.queryable.query<{ source_key: string }>(`
    INSERT INTO data_sources(
      id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,name,
      source_contract_version,source_key,mapping,mapping_version,role,
      governed_scope,governed_entity_type,governed_entity_id,scope_policy_version,
      scope_review_status,scope_approved_by_user_id,scope_approval_source,scope_approved_at,
      status,visibility
    ) VALUES(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,
      'signal-data-source-connector-v1',$9,'{}'::jsonb,1,
      jsonb_build_object('ownership','workspace','contract_version','signal-data-source-connector-v1'),
      NULL,NULL,NULL,NULL,'pending',NULL,NULL,NULL,'active','internal'
    ) RETURNING source_key
  `,[sourceId,args.workspace.id,args.workspace.organizationId,brandId,args.input.source_type,
    args.input.provider,args.input.connection_method,args.input.name,sourceKey]);
  if (created.rows[0]?.source_key !== sourceKey) throw new Error("Connector source was not created.");
  await args.queryable.query(`
    INSERT INTO signal_refresh_policies(
      workspace_id,data_source_id,source_key,adapter_key,cadence,timezone,enabled,owner_user_id,metadata
    ) VALUES($1::uuid,$2::uuid,$3,$4,'manual',$5,false,$6::uuid,
      jsonb_build_object('source','signal-data-source-connector-v1'))
    ON CONFLICT DO NOTHING
  `,[args.workspace.id,sourceId,sourceKey,args.input.connection_method,args.workspace.timezone,args.actor.id]);
  const result = {
    source_key: sourceKey, name: args.input.name, provider: args.input.provider,
    source_type: args.input.source_type, connection_method: args.input.connection_method,
    status: "active" as const, readiness: "governance_pending" as const
  };
  await completeSignalProductOperationV1({
    queryable: args.queryable, workspaceId: args.workspace.id, key: operation.key, result
  });
  return result;
}

export async function createWorkspaceConnectorSourceProductInTransactionV1(args: Omit<
  Parameters<typeof createWorkspaceConnectorSourceProductV1>[0], "queryable"
>,serializationAttempt=0) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await createWorkspaceConnectorSourceProductV1({ ...args,queryable: client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isSerializationFailure(error)&&serializationAttempt<2) {
      return createWorkspaceConnectorSourceProductInTransactionV1(args,serializationAttempt+1);
    }
    throw error;
  } finally { client.release(); }
}

function isSerializationFailure(error:unknown){
  return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:unknown}).code==="40001";
}

export async function createWorkspaceDataSourceProductInTransactionV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  input: {
    name: string;
    provider: string;
    source_type: string;
    connection_method: string;
    scope: SignalMentionScopeV1;
    entity_id: string | null;
  };
}) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await createWorkspaceDataSourceProductV1({ ...args,queryable: client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorkspaceDataSourceImports(workspaceId: string, sourceId: string) {
  const [source] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, sourceId),
      eq(dataSources.workspaceId, workspaceId)
    ))
    .limit(1);
  if (!source) return null;
  return db
    .select({
      id: importBatches.id,
      status: importBatches.status,
      sourceFileName: importBatches.sourceFileName,
      recordCount: importBatches.recordCount,
      includedCount: importBatches.includedCount,
      excludedCount: importBatches.excludedCount,
      duplicateCount: importBatches.duplicateCount,
      contributedByStudyCorpusId: importBatches.contributedByStudyCorpusId,
      createdAt: importBatches.createdAt
    })
    .from(importBatches)
    .where(and(
      eq(importBatches.workspaceId, workspaceId),
      eq(importBatches.dataSourceId, sourceId)
    ))
    .orderBy(desc(importBatches.createdAt))
    .limit(100);
}

export async function resolveWorkspaceDataSourceImportInput(args: {
  workspaceId: string;
  sourceId: string;
  contributedByStudyCorpusId: unknown;
}) {
  const [source] = await db
    .select({
      governedScope: dataSources.governedScope,
      scopeReviewStatus: dataSources.scopeReviewStatus,
      status: dataSources.status
    })
    .from(dataSources)
    .where(and(
      eq(dataSources.id, args.sourceId),
      eq(dataSources.workspaceId, args.workspaceId)
    ))
    .limit(1);
  if (!source || source.status !== "active") throw new WorkspaceSourceNotFoundError();
  if (!source.governedScope) {
    throw new WorkspaceIngestionValidationError(
      "Workspace source must have an explicit governed scope before importing."
    );
  }
  return validateSignalWorkspaceImportInputV1({
    scope: source.governedScope,
    contributed_by_study_corpus_id: args.contributedByStudyCorpusId
  });
}

export async function ingestWorkspaceDataSourceCsv(args: {
  workspace: ResolvedSignalWorkspace;
  sourceId: string;
  userId: string;
  contributedByStudyCorpusId: string | null;
  fileName: string;
  stream: ReadableStream<Uint8Array>;
  productOperation?: { idempotencyKey: string; requestDigest: string };
}) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.id, args.sourceId),
      eq(dataSources.workspaceId, args.workspace.id)
    ))
    .limit(1);
  if (!source || source.status !== "active") {
    throw new WorkspaceSourceNotFoundError();
  }
  if (!source.governedScope) {
    throw new WorkspaceIngestionValidationError(
      "Workspace source must have an explicit governed scope before importing."
    );
  }
  const scope = source.governedScope as SignalMentionScopeV1;
  await validateWorkspaceStudyContribution(
    args.workspace.id,
    args.contributedByStudyCorpusId
  );
  const entityId = source.governedEntityId;
  const entityLabel = readRoleString(source.role, "entity_label") ?? source.name;
  const legacyScope = legacyScopeFields(scope);
  const [batch] = await db
    .insert(importBatches)
    .values({
      workspaceId: args.workspace.id,
      studyCorpusId: args.contributedByStudyCorpusId,
      contributedByStudyCorpusId: args.contributedByStudyCorpusId,
      dataSourceId: source.id,
      mentionType: legacyScope.mentionType,
      competitorId: scope === "competitor" && entityId ? entityId : null,
      entityKind: legacyScope.entityKind,
      entityLabel,
      sourceSystem: source.provider,
      sourceFileName: args.fileName,
      sourceFileHash: "pending",
      productIdempotencyKey: args.productOperation?.idempotencyKey,
      productRequestDigest: args.productOperation?.requestDigest,
      importedByUserId: args.userId,
      status: "processing"
    })
    .returning();
  if (!batch) throw new Error("Workspace import batch could not be created.");

  try {
    const { stats, fileHash } = await ingestSentioneCsvStream({
      workspaceId: args.workspace.id,
      dataSourceId: source.id,
      corpusId: args.contributedByStudyCorpusId,
      importBatchId: batch.id,
      sourceFileName: args.fileName,
      entityLabel,
      stream: args.stream
    });
    await db
      .update(importBatches)
      .set({
        recordCount: stats.record_count,
        includedCount: stats.included_count,
        excludedCount: stats.excluded_count,
        duplicateCount: stats.duplicate_count,
        sourceFileHash: fileHash,
        status: "completed"
      })
      .where(and(
        eq(importBatches.id, batch.id),
        eq(importBatches.workspaceId, args.workspace.id)
      ));
    await db.insert(sourceSyncRuns).values({
      workspaceId: args.workspace.id,
      dataSourceId: source.id,
      finishedAt: new Date(),
      status: "completed",
      recordsTotal: stats.record_count,
      recordsValid: stats.included_count + stats.excluded_count,
      recordsDuplicate: stats.duplicate_count,
      recordsFailed: 0,
      errorSummary: {}
    });
    const acceptedAt = new Date();
    const workspaceAcceptance = await recordSignalWorkspaceDataAcceptance(pool, {
      workspaceId: args.workspace.id,
      sourceKey: `source-${source.id}`,
      dataSourceId: source.id,
      importBatchId: batch.id,
      acceptedAt,
      materializedAt: acceptedAt
    });
    let corpusRevision: number | null = null;
    let compatibilityAcceptanceCount = 0;
    if (args.contributedByStudyCorpusId) {
      const persistedCount = stats.included_count + stats.excluded_count;
      corpusRevision = persistedCount > 0
        ? await advanceCorpusRevision(args.contributedByStudyCorpusId)
        : null;
      const compatibilityAcceptances = await recordSignalDataAcceptance(pool, {
        studyCorpusId: args.contributedByStudyCorpusId,
        sourceKey: `source-${source.id}`,
        dataSourceId: source.id,
        importBatchId: batch.id,
        corpusRevision,
        acceptedAt,
        materializedAt: acceptedAt
      });
      compatibilityAcceptanceCount = compatibilityAcceptances.length;
    }
    return {
      sourceId: source.id,
      batchId: batch.id,
      scope,
      stats,
      corpusRevision,
      workspaceAcceptance,
      compatibilityAcceptanceCount
    };
  } catch (error) {
    await db
      .update(importBatches)
      .set({ status: "failed" })
      .where(eq(importBatches.id, batch.id));
    throw error;
  }
}

export async function ingestWorkspaceDataSourceCsvProductV1(args: {
  workspace: ResolvedSignalWorkspace;
  sourceId: string;
  userId: string;
  contributedByStudyCorpusId: string | null;
  fileName: string;
  stream: ReadableStream<Uint8Array>;
  idempotencyKey: string;
}) {
  const rawKey = args.idempotencyKey.trim();
  if (rawKey.length < 8 || rawKey.length > 500) {
    throw new WorkspaceIngestionValidationError("Idempotency-Key must be between 8 and 500 characters.");
  }
  const key = digest(`signal-workspace-import-v1\u001f${rawKey}`);
  const requestDigest = digest(JSON.stringify({
    contract_version: "signal-workspace-import-v1",
    workspace_id: args.workspace.id,
    source_id: args.sourceId,
    contributed_by_study_corpus_id: args.contributedByStudyCorpusId,
    file_name: args.fileName
  }));
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[
      `signal-workspace-import:${args.workspace.id}:${key}`
    ]);
    const existing = await lockClient.query<{
      id: string; product_request_digest: string; status: string; source_file_hash: string;
      record_count: number; included_count: number; excluded_count: number; duplicate_count: number;
      scope: SignalMentionScopeV1; corpus_revision: number | null; watermark_id: string | null;
    }>(`
      SELECT batch.id::text,batch.product_request_digest,batch.status,batch.source_file_hash,
        COALESCE(batch.record_count,0)::int AS record_count,
        COALESCE(batch.included_count,0)::int AS included_count,
        COALESCE(batch.excluded_count,0)::int AS excluded_count,
        COALESCE(batch.duplicate_count,0)::int AS duplicate_count,
        source.governed_scope AS scope,corpus.corpus_revision::int,
        watermark.id::text AS watermark_id
      FROM import_batches batch
      JOIN data_sources source ON source.id=batch.data_source_id
      LEFT JOIN study_corpora corpus ON corpus.id=batch.contributed_by_study_corpus_id
      LEFT JOIN LATERAL (SELECT candidate.id FROM signal_data_watermarks candidate
        WHERE candidate.workspace_id=batch.workspace_id
          AND candidate.last_import_batch_id=batch.id ORDER BY candidate.created_at DESC LIMIT 1) watermark ON true
      WHERE batch.workspace_id=$1::uuid AND batch.product_idempotency_key=$2
    `,[args.workspace.id,key]);
    const replay = existing.rows[0];
    if (replay) {
      if (replay.product_request_digest !== requestDigest) {
        throw new WorkspaceIngestionValidationError("Idempotency-Key was reused with incompatible import input.");
      }
      if (replay.status !== "completed" || !/^[0-9a-f]{64}$/u.test(replay.source_file_hash)) {
        throw new WorkspaceIngestionValidationError("Previous import attempt is incomplete and requires operator review.");
      }
      const retryHash = await hashReadableStream(args.stream);
      if (retryHash !== replay.source_file_hash) {
        throw new WorkspaceIngestionValidationError("Idempotency-Key was reused with different CSV content.");
      }
      return {
        sourceId: args.sourceId,batchId: replay.id,scope: replay.scope,
        stats: { record_count: replay.record_count,included_count: replay.included_count,
          excluded_count: replay.excluded_count,duplicate_count: replay.duplicate_count },
        corpusRevision: replay.corpus_revision,
        workspaceAcceptance: { watermarkId: replay.watermark_id,changed: false },
        compatibilityAcceptanceCount: 0,
        replayed: true as const
      };
    }
    const created = await ingestWorkspaceDataSourceCsv({
      ...args,productOperation: { idempotencyKey: key,requestDigest }
    });
    return { ...created,replayed: false as const };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[
      `signal-workspace-import:${args.workspace.id}:${key}`
    ]).catch(() => undefined);
    lockClient.release();
  }
}

export class WorkspaceIngestionValidationError extends Error {}
export class WorkspaceSourceNotFoundError extends Error {}

function readRoleString(input: unknown, key: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function legacyScopeFields(scope: SignalMentionScopeV1) {
  if (scope === "primary_brand") return { mentionType: "brand" as const, entityKind: "primary_brand" };
  if (scope === "competitor") return { mentionType: "competitor" as const, entityKind: "competitor" };
  if (scope === "category") return { mentionType: "industry" as const, entityKind: "category" };
  return { mentionType: null, entityKind: scope };
}

function governedEntityType(scope: SignalMentionScopeV1) {
  if (scope === "primary_brand") return "brand";
  return scope;
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function hashReadableStream(stream: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      hash.update(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest("hex");
}
