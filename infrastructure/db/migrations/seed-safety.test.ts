import assert from "node:assert/strict";
import test from "node:test";

import { isLocalDatabaseUrl, requireSafeDatabaseWriteTarget } from "../seeds/connection";

test("seed safety guard allows only local database URLs by default", () => {
  assert.equal(isLocalDatabaseUrl("postgres://user:pass@localhost:5432/db"), true);
  assert.equal(isLocalDatabaseUrl("postgres://user:pass@127.0.0.1:5432/db"), true);
  assert.equal(isLocalDatabaseUrl("postgres://user:pass@example.supabase.co:5432/db"), false);

  assert.throws(
    () => requireSafeDatabaseWriteTarget("postgres://user:pass@example.supabase.co:5432/db", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }),
    /Refusing to run db:seed/
  );
});

test("seed safety guard requires an explicit remote override", () => {
  process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST = "true";
  try {
    assert.doesNotThrow(() => requireSafeDatabaseWriteTarget("postgres://user:pass@example.supabase.co:5432/db", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }));
  } finally {
    delete process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST;
  }
});

test("methodology-only seed uses the same remote safety contract", () => {
  assert.throws(
    () => requireSafeDatabaseWriteTarget("postgres://user:pass@example.supabase.co:5432/db", {
      operation: "db:seed:methodologies",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }),
    /Refusing to run db:seed:methodologies/
  );
});
