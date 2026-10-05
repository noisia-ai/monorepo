import assert from "node:assert/strict";
import test from "node:test";

import { founderRecoveryAllowed } from "./founder-recovery";

const subject = {
  email: "founder@noisia.ai",
  kindeEmail: "founder@noisia.ai",
  kindeId: "kinde-founder",
  primaryRole: "client_viewer",
  userType: "client",
  organizationId: null,
  status: "active"
};
const config = {
  environment: "dev-test",
  service: "mfp-studio",
  enabled: "true",
  email: "founder@noisia.ai",
  expiresAt: "2026-10-05T20:00:00.000Z"
};
const now = new Date("2026-10-05T19:00:00.000Z");

test("founder recovery accepts only the Kinde-authenticated, allowlisted viewer on MFP dev-test", () => {
  assert.equal(founderRecoveryAllowed(subject, config, now), true);
  for (const changed of [
    { config: { ...config, environment: "production" } },
    { config: { ...config, service: "studio-uat" } },
    { config: { ...config, enabled: "false" } },
    { config: { ...config, email: "another@noisia.ai" } },
    { config: { ...config, expiresAt: "2026-10-05T18:00:00.000Z" } },
    { subject: { ...subject, kindeEmail: "another@noisia.ai" } },
    { subject: { ...subject, kindeId: "local:fixture" } },
    { subject: { ...subject, primaryRole: "client_admin" } },
    { subject: { ...subject, organizationId: "other-org" } },
    { subject: { ...subject, status: "suspended" } }
  ]) {
    assert.equal(founderRecoveryAllowed(changed.subject ?? subject, changed.config ?? config, now), false);
  }
});
