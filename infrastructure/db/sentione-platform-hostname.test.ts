import assert from "node:assert/strict";
import test from "node:test";
import { createSignalSentioneCsvIngester, SENTIONE_CSV_47_HEADERS_V1 } from "./sentione-csv-ingest";

// The real typed mapper must resolve source authority without reading content
// as a platform, and this fixture must never reach persistence or transport.
const mapper = createSignalSentioneCsvIngester({ query: async () => {
  throw new Error("platform_fixture_sql_forbidden");
} });

const cases = [
  { name: "Video uses the YouTube host despite an isolated x in the query",
    group: "Video", url: "https://www.youtube.com/watch?v=-x-", platform: "youtube" },
  { name: "a foreign domain in query parameters is not source authority",
    group: "", url: "https://example.test/?ref=twitter.com", platform: "unknown" },
  { name: "explicit Reddit wins over the linked domain and mention content",
    group: "Reddit", url: "https://www.youtube.com/watch?v=other", platform: "reddit" },
  { name: "missing platform and URL remain unknown despite mention content",
    group: "", url: "", platform: "unknown" },
  { name: "real subdomains remain accepted with case and port normalization",
    group: "Video", url: "https://M.YouTube.COM:443/watch?v=fixture", platform: "youtube" },
  { name: "a platform name embedded in another hostname is rejected",
    group: "Video", url: "https://notyoutube.com/watch?v=fixture", platform: "unknown" },
  { name: "a platform domain followed by a foreign suffix is rejected",
    group: "Video", url: "https://youtube.com.example.test/watch?v=fixture", platform: "unknown" },
  { name: "a platform domain in URL credentials is not the hostname",
    group: "Video", url: "https://youtube.com@example.test/watch?v=fixture", platform: "unknown" }
] as const;

for (const fixture of cases) {
  test(`SentiOne platform: ${fixture.name}`, () => {
    const values: Record<string, string> = {
      id: "platform-fixture", Created: "2026-04-05T12:00:00Z", "Specific type": "Post",
      "Domain group": fixture.group, "Link to the source": fixture.url,
      "Content of posts": "People compare this product on X, TikTok and Facebook.",
      Context: "YouTube and Reddit are mentioned as alternatives."
    };
    const observation = mapper.mapSignalSentioneProviderObservationV1(
      [...SENTIONE_CSV_47_HEADERS_V1], SENTIONE_CSV_47_HEADERS_V1.map(header => values[header] ?? "")
    );
    assert.ok(observation);
    assert.equal(observation.platform, fixture.platform);
  });
}
