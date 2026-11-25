import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, requestOrigin } from "./site";

const request = (headers: Record<string, string>) => new Request("http://0.0.0.0:8080/e/abc", { headers });

test("requestOrigin uses the forwarded host, not the server's own address", () => {
  assert.equal(requestOrigin(request({ host: "0.0.0.0:8080", "x-forwarded-host": "noisia.ai", "x-forwarded-proto": "https" })).href, "https://noisia.ai/");
  assert.equal(requestOrigin(request({ host: "noisia.ai", "x-forwarded-proto": "https" })).href, "https://noisia.ai/");
});

test("requestOrigin keeps http only when the proxy says so, and falls back on bad hosts", () => {
  assert.equal(requestOrigin(request({ host: "localhost:3010" })).href, "http://localhost:3010/");
  assert.equal(requestOrigin(request({ host: "evil.com/path", "x-forwarded-proto": "https" })).origin, new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai").origin);
});

test("requestOrigin never builds a link on a host that is not the site's", () => {
  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai").origin;
  assert.equal(requestOrigin(request({ host: "0.0.0.0:8080", "x-forwarded-host": "evil.com", "x-forwarded-proto": "https" })).origin, site);
  assert.equal(requestOrigin(request({ host: "evil.com", "x-forwarded-proto": "https" })).origin, site);
  assert.equal(requestOrigin(request({ host: "0.0.0.0:8080", "x-forwarded-host": "www.noisia.ai", "x-forwarded-proto": "https" })).href, "https://www.noisia.ai/");
});

test("clientIp trusts Cloudflare's header and never the first forwarded entry", () => {
  assert.equal(clientIp(request({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(request({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" })), "198.51.100.9");
  assert.equal(clientIp(request({})), "unknown");
});
