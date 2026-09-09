import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Pool } from "pg";
import { AdminSourceCaptureScopes } from "../../components/admin/AdminSourceCaptureScopes";
import { ADMIN_SOURCE_CAPTURE_SCOPES_SQL, mapAdminSourceCaptureScopes, type AdminSourceCaptureScopeRow } from "./admin-source-capture-scopes";

Object.assign(globalThis, { React });
const counts = { import_accepted_files: "4", import_scope_primary_brand: "1", import_scope_competitor: "2",
  import_scope_category: "0", import_scope_reference: "0", import_scope_unknown: "1" };
test("accepted file counts preserve unknown scopes and distinguish zero from unavailable", () => {
  assert.deepEqual(mapAdminSourceCaptureScopes(counts), { accepted_files: 4, primary_brand: 1, competitor: 2, category: 0, reference: 0, unknown: 1 });
  assert.equal(mapAdminSourceCaptureScopes({ ...counts, import_accepted_files: 0, import_scope_primary_brand: 0,
    import_scope_competitor: 0, import_scope_unknown: 0 }).accepted_files, 0);
  for (const patch of [{ import_accepted_files: "9007199254740992" }, { import_accepted_files: 5 },
    { import_scope_unknown: -1 }, { import_scope_category: "1.5" }]) assert.throws(() => mapAdminSourceCaptureScopes({ ...counts, ...patch }));
});
for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.AdminWorkspace.brand.sources.captureScopes;
  const render = (summary: ComponentProps<typeof AdminSourceCaptureScopes>["summary"]) => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, timeZone: "UTC", messages } as ComponentProps<typeof NextIntlClientProvider>, createElement(AdminSourceCaptureScopes, { summary })));
  test(`${locale}: scopes name accepted files, preserve mixed/unknown and add no review or selection controls`, () => {
    const html = render(mapAdminSourceCaptureScopes(counts));
    for (const text of [copy.primary_brand, copy.competitor, copy.unknown]) assert.ok(html.includes(text));
    assert.ok(!html.includes(copy.category)); assert.ok(!html.includes(copy.reference));
    assert.match(html, locale === "es-MX" ? /1 archivo.*2 archivos.*1 archivo/u : /1 file.*2 files.*1 file/u);
    assert.doesNotMatch(html, /button|input|approved|badge/u);
    assert.ok(render(null).includes(copy.unavailable));
    assert.ok(render({ accepted_files: 0, primary_brand: 0, competitor: 0, category: 0, reference: 0, unknown: 0 }).includes(copy.empty));
  });
}

test("Postgres read-only: source scopes use accepted receipts, exclude duplicate/rejected/pending uploads and verify slot bindings", {
  skip: !process.env.ADMIN_SOURCE_SCOPES_TEST_DATABASE_URL
}, async () => {
  const url = new URL(process.env.ADMIN_SOURCE_SCOPES_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "only isolated local Postgres is allowed");
  const pool = new Pool({ connectionString: url.href, max: 1 });
  const client = await pool.connect();
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const workspace = id(1), foreign = id(2), plan = id(3), a = id(10), b = id(11), empty = id(12), other = id(13);
  const sources = [a, b, empty].map(id => ({ id, workspace_id: workspace })).concat([{ id: other, workspace_id: foreign }]);
  const slots = ["primary_brand", "competitor", "category", "reference"].map((scope, index) => ({ id: id(20 + index), workspace_id: workspace,
    plan_id: plan, definition_hash: "slot-digest", scope })).concat([{ id: id(24), workspace_id: foreign, plan_id: plan, definition_hash: "slot-digest", scope: "category" }]);
  let serial = 100;
  const batch = (source: string, scope: number | null, status = "completed", patch = {}) => ({ id: id(serial++), data_source_id: source,
    workspace_id: workspace, status, acquisition_slot_id: scope === null ? null : id(scope), acquisition_plan_id: plan,
    acquisition_slot_digest: "slot-digest", source_file_name: "export.csv", source_file_hash: "same-file", ...patch });
  const batches = [batch(a, 20), batch(a, 20, "completed", { source_file_hash: "different-file" }),
    batch(a, 21, "failed", { failure_code: "content_already_accepted" }), batch(a, 22, "failed", { failure_code: "source_timestamp_invalid" }), batch(a, 21, "processing"),
    batch(b, 21), batch(b, 22), batch(a, 23), batch(a, 20, "completed", { acquisition_slot_digest: "wrong" }),
    batch(a, 24), batch(a, 20, "completed", { acquisition_plan_id: id(99) }), batch(a, null),
    batch(other, 22, "completed", { workspace_id: foreign }), batch(other, 22)];
  try {
    await client.query("BEGIN READ ONLY");
    assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
    const result = await client.query<AdminSourceCaptureScopeRow & { data_source_id: string }>(`
      WITH data_sources AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(id uuid,workspace_id uuid)),
      signal_acquisition_slots AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS value(id uuid,workspace_id uuid,plan_id uuid,definition_hash text,scope text)),
      import_batches AS (SELECT * FROM jsonb_to_recordset($4::jsonb) AS value(id uuid,data_source_id uuid,workspace_id uuid,status text,
        acquisition_slot_id uuid,acquisition_plan_id uuid,acquisition_slot_digest text))
      ${ADMIN_SOURCE_CAPTURE_SCOPES_SQL}`, [workspace, JSON.stringify(sources), JSON.stringify(slots), JSON.stringify(batches)]);
    const bySource = new Map(result.rows.map(row => [row.data_source_id, mapAdminSourceCaptureScopes(row)]));
    assert.equal(bySource.size, 2); assert.ok(!bySource.has(empty)); assert.ok(!bySource.has(other));
    assert.deepEqual(bySource.get(a), { accepted_files: 7, primary_brand: 2, competitor: 0, category: 0, reference: 1, unknown: 4 });
    assert.deepEqual(bySource.get(b), { accepted_files: 2, primary_brand: 0, competitor: 1, category: 1, reference: 0, unknown: 0 });
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
