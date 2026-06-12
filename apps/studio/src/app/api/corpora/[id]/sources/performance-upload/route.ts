import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getCorpusForUser } from "@/lib/data/corpora";
import { pool } from "@/lib/db";
import {
  parsePerformanceCsv,
  type NormalizedPerformanceRecord,
  type PerformanceFieldMapping
} from "@/lib/signal-pulse/performance-import";
import type { PoolClient } from "pg";

export const runtime = "nodejs";
export const maxDuration = 300;

const INSERT_BATCH_SIZE = 250;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const { id } = await context.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "preview" ? "preview" : "import";
  const provider = cleanParam(url.searchParams.get("provider")) || "file";
  const sourceLabel = cleanParam(url.searchParams.get("source_label")) || "Performance export";
  const fileName = cleanParam(url.searchParams.get("file_name")) || sourceLabel;
  const defaultPlatform = cleanParam(url.searchParams.get("platform")) || provider;
  const defaultChannel = cleanParam(url.searchParams.get("channel")) || "paid";
  const mapping = parseMapping(url.searchParams.get("mapping"));
  const text = await request.text();
  if (!text.trim()) {
    return Response.json(
      { error: "validation_error", message: "Performance CSV file is required." },
      { status: 422 }
    );
  }

  const parsed = parsePerformanceCsv(text, {
    mapping,
    defaultPlatform,
    defaultChannel,
    sourceFileName: fileName
  });

  if (mode === "preview") {
    return Response.json({
      ok: true,
      mode,
      mapping: parsed.mapping,
      stats: parsed.stats,
      warnings: parsed.warnings,
      preview: parsed.preview
    });
  }

  const corpus = await getCorpusForUser(session.appUser, id);
  if (!corpus) {
    return Response.json({ error: "not_found", message: "Corpus not found or not accessible." }, { status: 404 });
  }

  if (parsed.records.length === 0) {
    return Response.json(
      {
        error: "no_valid_records",
        message: "No valid performance rows found. Confirm date, entity and at least one metric mapping.",
        mapping: parsed.mapping,
        stats: parsed.stats,
        warnings: parsed.warnings,
        preview: parsed.preview
      },
      { status: 422 }
    );
  }

  const client = await pool.connect();
  let dataSourceId: string | null = null;
  let syncRunId: string | null = null;
  try {
    await client.query("BEGIN");
    const source = await client.query<{ id: string }>(
      `
        INSERT INTO data_sources (
          study_corpus_id, organization_id, brand_id, source_type, provider,
          connection_method, name, mapping, mapping_version, role, status, visibility
        )
        VALUES ($1, $2, $3, 'performance', $4, 'file_upload', $5, $6::jsonb, 1, $7::jsonb, 'active', 'internal')
        RETURNING id::text
      `,
      [
        corpus.id,
        corpus.organizationId,
        corpus.brandId,
        provider,
        sourceLabel,
        JSON.stringify(parsed.mapping),
        JSON.stringify({
          feeds: ["paid_organic", "chart_aggregates", "source_health"],
          signal_pulse: true
        })
      ]
    );
    dataSourceId = source.rows[0]?.id ?? null;
    if (!dataSourceId) throw new Error("Could not create data source.");

    const sync = await client.query<{ id: string }>(
      `
        INSERT INTO source_sync_runs (
          data_source_id, status, records_total, records_valid, records_duplicate,
          records_failed, coverage_start, coverage_end
        )
        VALUES ($1, 'running', $2, 0, $3, $4, $5::date, $6::date)
        RETURNING id::text
      `,
      [
        dataSourceId,
        parsed.stats.records_total,
        parsed.stats.duplicate_keys,
        parsed.stats.records_failed,
        parsed.stats.coverage_start,
        parsed.stats.coverage_end
      ]
    );
    syncRunId = sync.rows[0]?.id ?? null;
    if (!syncRunId) throw new Error("Could not create source sync run.");

    const inserted = await insertPerformanceRecords({
      client,
      corpusId: corpus.id,
      dataSourceId,
      records: parsed.records
    });
    const duplicateCount = parsed.stats.duplicate_keys + Math.max(0, parsed.records.length - inserted);

    await client.query(
      `
        UPDATE source_sync_runs
        SET status = 'completed',
            finished_at = NOW(),
            records_valid = $1,
            records_duplicate = $2,
            records_failed = $3,
            coverage_start = $4::date,
            coverage_end = $5::date
        WHERE id = $6
      `,
      [
        inserted,
        duplicateCount,
        parsed.stats.records_failed,
        parsed.stats.coverage_start,
        parsed.stats.coverage_end,
        syncRunId
      ]
    );
    await client.query("ANALYZE performance_records");
    await client.query("COMMIT");

    return Response.json({
      ok: true,
      mode,
      data_source_id: dataSourceId,
      source_sync_run_id: syncRunId,
      mapping: parsed.mapping,
      stats: {
        ...parsed.stats,
        records_inserted: inserted,
        duplicate_keys: duplicateCount
      },
      warnings: parsed.warnings,
      preview: parsed.preview
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (syncRunId) {
      await pool.query(
        `UPDATE source_sync_runs
         SET status = 'failed', finished_at = NOW(), error_summary = $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ message }), syncRunId]
      ).catch(() => undefined);
    }
    if (dataSourceId) {
      await pool.query(`UPDATE data_sources SET status = 'broken', updated_at = NOW() WHERE id = $1`, [dataSourceId]).catch(() => undefined);
    }
    return Response.json({ error: "performance_import_failed", message }, { status: 500 });
  } finally {
    client.release();
  }
}

async function insertPerformanceRecords(args: {
  client: PoolClient;
  corpusId: string;
  dataSourceId: string;
  records: NormalizedPerformanceRecord[];
}) {
  let inserted = 0;
  for (let offset = 0; offset < args.records.length; offset += INSERT_BATCH_SIZE) {
    const batch = args.records.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];
    batch.forEach((record) => {
      const base = values.length;
      values.push(
        args.corpusId,
        args.dataSourceId,
        record.externalId,
        record.entityKind,
        record.entityName,
        record.parentExternalId,
        record.platform,
        record.channel,
        record.objective,
        record.recordDate,
        record.granularity,
        record.spend,
        record.impressions,
        record.reach,
        record.clicks,
        record.videoViews,
        record.engagement,
        record.conversions,
        record.ctr,
        record.cpm,
        record.cpc,
        record.creativeText,
        record.creativeAssetRef,
        JSON.stringify(record.metrics),
        JSON.stringify(record.rawMetadata)
      );
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::date, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23}, $${base + 24}::jsonb, $${base + 25}::jsonb)`
      );
    });
    if (tuples.length === 0) continue;
    const result = await args.client.query(
      `
        INSERT INTO performance_records (
          study_corpus_id, data_source_id, external_id, entity_kind, entity_name,
          parent_external_id, platform, channel, objective, record_date, granularity,
          spend, impressions, reach, clicks, video_views, engagement, conversions,
          ctr, cpm, cpc, creative_text, creative_asset_ref, metrics, raw_metadata
        )
        VALUES ${tuples.join(",")}
        ON CONFLICT (study_corpus_id, platform, external_id, record_date, granularity)
        DO UPDATE SET
          data_source_id = EXCLUDED.data_source_id,
          entity_kind = EXCLUDED.entity_kind,
          entity_name = EXCLUDED.entity_name,
          parent_external_id = EXCLUDED.parent_external_id,
          channel = EXCLUDED.channel,
          objective = EXCLUDED.objective,
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          reach = EXCLUDED.reach,
          clicks = EXCLUDED.clicks,
          video_views = EXCLUDED.video_views,
          engagement = EXCLUDED.engagement,
          conversions = EXCLUDED.conversions,
          ctr = EXCLUDED.ctr,
          cpm = EXCLUDED.cpm,
          cpc = EXCLUDED.cpc,
          creative_text = EXCLUDED.creative_text,
          creative_asset_ref = EXCLUDED.creative_asset_ref,
          metrics = EXCLUDED.metrics,
          raw_metadata = EXCLUDED.raw_metadata
        RETURNING id
      `,
      values
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

function parseMapping(value: string | null): PerformanceFieldMapping | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PerformanceFieldMapping : undefined;
  } catch {
    return undefined;
  }
}

function cleanParam(value: string | null) {
  return value?.trim().slice(0, 180) ?? "";
}
