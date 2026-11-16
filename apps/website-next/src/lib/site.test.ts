import assert from "node:assert/strict";
import { test } from "node:test";
import { requestOrigin } from "./site";

const request = (headers: Record<string, string>) => new Request("http://0.0.0.0:8080/e/abc", { headers });

test("requestOrigin uses the forwarded host, not the server's own address", () => {
  assert.equal(requestOrigin(request({ host: "0.0.0.0:8080", "x-forwarded-host": "noisia.ai", "x-forwarded-proto": "https" })).href, "https://noisia.ai/");
  assert.equal(requestOrigin(request({ host: "noisia.ai", "x-forwarded-proto": "https" })).href, "https://noisia.ai/");
});

test("requestOrigin keeps http only when the proxy says so, and falls back on bad hosts", () => {
  assert.equal(requestOrigin(request({ host: "localhost:3010" })).href, "http://localhost:3010/");
  assert.equal(requestOrigin(request({ host: "evil.com/path", "x-forwarded-proto": "https" })).origin, new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai").origin);
});
