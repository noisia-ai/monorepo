import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createSignalSentioneCsvIngester, SENTIONE_CSV_47_HEADERS_V1 } from "../sentione-csv-ingest";

type SavedRow = Record<string, unknown>;

async function ingest(bytes: Uint8Array, chunkSize: number) {
  const saved: SavedRow[] = [];
  const observations: Array<Record<string, unknown>> = [];
  // A local sink captures the SQL boundary; no database or provider is involved.
  const pool = { async query(sql: string, params: unknown[] = []) {
    if (sql.includes("INSERT INTO mentions (")) {
      const columns = sql.match(/INSERT INTO mentions \(([^)]+)\)/u)![1]!.split(",").map((s) => s.trim());
      const rows: SavedRow[] = [];
      for (let offset = 0; offset < params.length; offset += columns.length) {
        const row = Object.fromEntries(columns.map((name, index) => [name, params[offset + index]]));
        saved.push(row);
        rows.push(row);
      }
      return { rows };
    }
    if (sql.includes("FROM mentions mention")) {
      const hashes = new Set(params[2] as string[]), ids = new Set(params[3] as string[]);
      return { rows: saved.filter((row) => hashes.has(row.text_hash as string) || ids.has(row.provider_record_id as string)) };
    }
    if (sql.includes("WITH input AS")) {
      observations.push(...JSON.parse(params[3] as string) as Array<Record<string, unknown>>);
      return { rows: [] };
    }
    assert.match(sql, /UPDATE import_batches|record_signal_workspace_import_provenance_set_v1/u);
    return { rows: [] };
  } };
  let offset = 0;
  const result = await createSignalSentioneCsvIngester(pool as never).ingestSentioneCsvStream({
    workspaceId: crypto.randomUUID(), dataSourceId: crypto.randomUUID(), importBatchId: crypto.randomUUID(),
    sourceFileName: "synthetic.csv", tuning: { chunkSize: 2, insertConcurrency: 1 },
    stream: new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    } })
  });
  return { ...result, saved, observations };
}

const quote = (value: string) => `"${value.replace(/"/gu, '""')}"`;
const fixture = (values: Array<Record<string, string>>, delimiter: string, finalNewline: boolean) => {
  const headers = [...SENTIONE_CSV_47_HEADERS_V1];
  return new TextEncoder().encode(`\ufeff${headers.join(delimiter)}\r\n${values.map((row) =>
    headers.map((h) => quote(row[h] ?? "")).join(delimiter)).join("\r\n")}${finalNewline ? "\r\n" : ""}`);
};

test("SentiOne stream preserves empty quoted fields and literal quotes across byte boundaries", async () => {
  const values: Array<Record<string, string>> = [
    { id: "synthetic-1", "Content of posts": '"Una opinión"; con separadores,\r\nsaltos y emoji 🚗 suficientemente larga.', Country: "", Title: "", Context: "", Language: "es" },
    { id: "synthetic-2", "Content of posts": "", Title: "Título de respaldo suficientemente largo para inclusión", Country: "MX", Language: "es-mx" },
    { id: "synthetic-3", "Content of posts": '"', Title: "", Country: "", Context: '""' },
    { id: "synthetic-4", "Content of posts": 'Final con comilla literal y contenido largo "', Country: "AZ" }
  ];
  for (const delimiter of [";", ","]) for (const finalNewline of [true, false]) {
    const bytes = fixture(values, delimiter, finalNewline);
    for (const chunkSize of [1, 2, 3, 7, 31, 512, bytes.length]) {
      const result = await ingest(bytes, chunkSize);
      assert.deepEqual(result.stats, { record_count: 4, included_count: 3, excluded_count: 1, duplicate_count: 0 });
      assert.equal(result.fileHash, crypto.createHash("sha256").update(bytes).digest("hex"));
      assert.equal(result.saved.length, values.length);
      for (let i = 0; i < values.length; i++) {
        const expected = values[i]! as Record<string, string>;
        const actual = result.saved[i]!;
        const row = (JSON.parse(actual.raw_metadata as string) as { row: Record<string, string> }).row;
        for (const header of SENTIONE_CSV_47_HEADERS_V1) {
          assert.equal(row[header.toLowerCase()], expected[header] ?? "", `${delimiter}/${chunkSize}/${header}`);
        }
        assert.equal(actual.text_raw, expected["Content of posts"] || expected.Title || "");
        assert.equal(actual.country, expected.Country || null);
      }
      assert.equal(result.observations[0]?.country_code, null);
      assert.deepEqual(result.observations[0]?.terms, []);
      assert.equal(result.observations[0]?.author_ref_hash, null);
      assert.equal(result.observations[0]?.provider_thread_key_hash, null);
    }
  }
});

test("SentiOne empty content falls back to its title before text deduplication", async () => {
  const text = "Un título que también llega como contenido de otra fila";
  const bytes = fixture([
    { id: "first", "Content of posts": "", Title: text },
    { id: "second", "Content of posts": text },
    { id: "third", "Content of posts": "Un tercer registro completamente independiente y válido" }
  ], ";", false);
  for (const chunkSize of [1, 5, bytes.length]) {
    const result = await ingest(bytes, chunkSize);
    assert.deepEqual(result.stats, { record_count: 3, included_count: 2, excluded_count: 0, duplicate_count: 1 });
    assert.equal(result.saved[0]?.text_raw, text);
    assert.equal(result.saved[0]?.text_hash, crypto.createHash("sha256").update(text.toLowerCase()).digest("hex"));
  }
});
