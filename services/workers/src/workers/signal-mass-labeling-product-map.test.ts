import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { materializeMassLabelingProductMapV2 } from "./signal-mass-labeling-product-map";
import type { SignalWorkspaceEngineDatabaseV1 } from "@noisia/db";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

for (const broken of ["empty", "revoked", "unreadable"] as const) test(`a ${broken} first workspace releases the drainer for the second workspace`, async () => {
  const first = { id: "first", workspace_id: "workspace-one", actor_user_id: "actor-one" };
  const second = { id: "second", workspace_id: "workspace-two", actor_user_id: "actor-two" };
  const states = new Map<string, string>();
  const inputs: string[] = [];
  const database = { async connect() { return { release() {}, async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith("WITH candidate AS")) {
      const row = [first, second].find(item => !states.has(item.id));
      if (row) states.set(row.id, "processing");
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("SELECT id,artifact_key,content")) return { rows: ["assignments.guided.jsonl", "mass-labeling-consolidation.json", "interpretation-result.json"].map((name, index) => ({
      id: `${values[1]}-${index}`, artifact_key: name, content: { storage_key: `${values[1]}/${name}`, sha256: "synthetic", size_bytes: 20, media_type: "application/json" }
    })) };
    if (sql.startsWith("UPDATE signal_mass_labeling_product_materializations")) { states.set(String(values[0]), String(values[2])); return { rows: [] }; }
    throw new Error("unexpected_synthetic_query");
  } }; } } as unknown as SignalWorkspaceEngineDatabaseV1;
  const storage: WorkspaceEngineStorageV1 = { async put() { throw new Error("unused"); }, async get(args) {
    if (broken === "unreadable" && args.execution_id === "first") throw new Error("workspace_engine_storage_unavailable");
    const topics = broken === "empty" && args.execution_id === "first" ? [] : [{ topic_key: "tea", name: "Tea", definition: "Tea drinking", group_ids: ["guided:one"] }];
    const raw = args.stored.storage_key.endsWith("mass-labeling-consolidation.json") ? JSON.stringify({ output: { topics } }) : "synthetic";
    await writeFile(args.destination, raw);
  } };
  const adopt = async (args: Parameters<NonNullable<Parameters<typeof materializeMassLabelingProductMapV2>[0]["adopt"]>>[0]) => {
    inputs.push(args.workspace_id);
    if (broken === "revoked" && args.workspace_id === "workspace-one") throw new Error("mass_labeling_forbidden");
    return { map_id: "new-map", map_digest: "digest", replayed: false };
  };
  const failed = await materializeMassLabelingProductMapV2({ database, storage, adopt });
  assert.equal(failed.materialized, false);
  assert.equal(states.get("first"), broken === "empty" ? "empty" : "failed");
  const completed = await materializeMassLabelingProductMapV2({ database, storage, adopt });
  assert.equal(completed.materialized, true);
  assert.equal(states.get("second"), "completed");
  assert.ok(inputs.includes("workspace-two"));
});
