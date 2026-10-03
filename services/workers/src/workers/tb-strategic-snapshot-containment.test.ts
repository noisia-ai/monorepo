import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerDir = dirname(fileURLToPath(import.meta.url));

async function workerSource(fileName: string) {
  return readFile(join(workerDir, fileName), "utf8");
}

test("every strategic T&B pipeline boundary executes the database containment gate", async () => {
  const source = await workerSource("tb-shared.ts");
  assert.match(
    source,
    /markStepRunning[\s\S]+assertPipelineStepSnapshotContainment\(pipelineStepId, "before"\)/u
  );
  assert.match(
    source,
    /markStepCompleted[\s\S]+assertPipelineStepSnapshotContainment\(args\.pipelineStepId, "after"\)/u
  );
  assert.match(source, /SELECT assert_signal_tb_snapshot_containment\(/u);
});

test("preflight listening totals, platforms and languages are snapshot-scoped", async () => {
  const source = await workerSource("tb-step-preflight.ts");
  assert.match(source, /signal_strategic_sealed_sample_items membership/u);
  assert.match(source, /control\.snapshot_id = \$1::uuid/u);
  assert.match(source, /strategic_contract_version === "signal-tb-strategic-v2"/u);
  assert.doesNotMatch(source, /FROM mentions\s+WHERE study_corpus_id/u);
});

test("RAG monthly listening and source inventory cannot read beyond snapshot membership", async () => {
  const [rag, inventory] = await Promise.all([
    workerSource("tb-rag-context.ts"),
    workerSource("tb-data-os-source-inventory.ts")
  ]);
  assert.match(
    rag,
    /signal_strategic_sealed_sample_items membership[\s\S]+control\.snapshot_id=\$1::uuid[\s\S]+GROUP BY 1/u
  );
  assert.match(rag, /dataset_role = 'social_listening'[\s\S]+AND NOT \$2::boolean/u);
  assert.match(
    inventory,
    /corpus_mentions AS \([\s\S]+FROM corpus_snapshot_mentions membership[\s\S]+WHERE membership\.snapshot_id = \$2::uuid/u
  );
  assert.doesNotMatch(
    inventory,
    /corpus_mentions AS \([\s\S]+WHERE mention\.study_corpus_id = \$1::uuid/u
  );
});

test("RAG context assets persist independent version and lineage refs without corpus-wide listening", async () => {
  const source = await workerSource("tb-rag-context.ts");
  assert.match(source, /await recordAnalysisContextRefs\(tbAnalysisId, scope, structuredObservations\)/u);
  assert.match(source, /INSERT INTO tb_analysis_context_refs/g);
  assert.match(source, /source_version,[\s\S]+source_digest,[\s\S]+captured_at/u);
  assert.match(source, /'knowledge_base'[\s\S]+'triggers-barriers-methodology-v1'/u);
  assert.match(
    source,
    /dataset_role = 'social_listening'[\s\S]+AND NOT \$2::boolean/u
  );
  assert.match(
    source,
    /COALESCE\(observation\.dataset_role, ''\) NOT LIKE 'social_listening%'/u
  );
});

test("worker SQL tools use snapshot membership as the only listening authority", async () => {
  const source = await workerSource("corpus-sql.ts");
  assert.match(source, /JOIN corpus_snapshot_mentions csm ON csm\.snapshot_id=s\.snapshot_id/u);
  assert.match(source, /JOIN signal_strategic_sealed_sample_items sealed/u);
  assert.match(source, /JOIN mentions m ON m\.id = root\.mention_id/u);
  assert.match(source, /assertion\.attribution_basis\s*=\s*'mention_semantic'/u);
  assert.doesNotMatch(source, /m\.study_corpus_id\s*=\s*s\.study_corpus_id/u);
});
