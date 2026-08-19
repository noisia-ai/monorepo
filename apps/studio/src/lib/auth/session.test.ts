import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

import { isLocalAuthOverrideEnabled } from "./local-auth";
import { loginPath } from "./redirects";

const ENV_KEYS = [
  "NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE",
  "NOISIA_LOCAL_AUTH_EMAIL",
  "NODE_ENV",
  "VERCEL_ENV",
  "RAILWAY_ENVIRONMENT",
  "KINDE_SITE_URL"
] as const;

function withEnv(values: Partial<Record<typeof ENV_KEYS[number], string | undefined>>, run: () => void) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const env = process.env as Record<string, string | undefined>;
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test("local auth override requires explicit dev-only flags", () => {
  withEnv({
    NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE: "true",
    NOISIA_LOCAL_AUTH_EMAIL: "signal-pulse-smoke@noisia.local",
    NODE_ENV: "development"
  }, () => {
    assert.equal(isLocalAuthOverrideEnabled(), true);
  });

  withEnv({
    NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE: "true",
    NOISIA_LOCAL_AUTH_EMAIL: "signal-pulse-smoke@noisia.local",
    NODE_ENV: "production"
  }, () => {
    assert.equal(isLocalAuthOverrideEnabled(), false);
  });

  withEnv({
    NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE: "false",
    NOISIA_LOCAL_AUTH_EMAIL: "signal-pulse-smoke@noisia.local",
    NODE_ENV: "development"
  }, () => {
    assert.equal(isLocalAuthOverrideEnabled(), false);
  });
});

test("login paths start on the configured canonical Kinde site", () => {
  withEnv({ KINDE_SITE_URL: "https://studio-uat.example.com" }, () => {
    assert.equal(
      loginPath("/studio/brands"),
      "https://studio-uat.example.com/api/auth/login?post_login_redirect_url=%2Fauth%2Fcontinue%3Fnext%3D%252Fstudio%252Fbrands"
    );
  });

  withEnv({ KINDE_SITE_URL: undefined }, () => {
    assert.equal(
      loginPath("/studio"),
      "/api/auth/login?post_login_redirect_url=%2Fauth%2Fcontinue%3Fnext%3D%252Fstudio"
    );
  });
});
