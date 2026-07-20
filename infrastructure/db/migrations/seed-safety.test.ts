import assert from "node:assert/strict";
import test from "node:test";

import { databaseUrlLooksProductionLike, isLocalDatabaseUrl, requireSafeDatabaseWriteTarget } from "../seeds/connection";

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

test("seed safety guard requires a remote override and confirmed target", () => {
  process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST = "true";
  try {
    assert.throws(() => requireSafeDatabaseWriteTarget("postgres://user:pass@example.supabase.co:5432/db", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }), /NOISIA_REMOTE_DATABASE_TARGET/);

    process.env.NOISIA_REMOTE_DATABASE_TARGET = "staging";
    assert.doesNotThrow(() => requireSafeDatabaseWriteTarget("postgres://user:pass@example.supabase.co:5432/db", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }));
  } finally {
    delete process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST;
    delete process.env.NOISIA_REMOTE_DATABASE_TARGET;
  }
});

test("remote safety guard rejects production-like URLs even with a staging target", () => {
  assert.equal(databaseUrlLooksProductionLike("postgres://user:pass@db-prod.example.com:5432/noisia"), true);
  assert.equal(databaseUrlLooksProductionLike("postgres://user:pass@db.example.com:5432/noisia_production"), true);
  assert.equal(databaseUrlLooksProductionLike("postgres://user:pass@db.example.com:5432/noisia_staging"), false);

  process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST = "true";
  process.env.NOISIA_REMOTE_DATABASE_TARGET = "staging";
  try {
    assert.throws(() => requireSafeDatabaseWriteTarget("postgres://user:pass@db-prod.example.com:5432/noisia", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }), /production-like environment markers/);

    assert.doesNotThrow(() => requireSafeDatabaseWriteTarget("postgres://user:pass@db.example.com:5432/noisia_staging", {
      operation: "db:seed",
      allowRemoteEnv: "NOISIA_DB_SEED_ALLOW_REMOTE_TEST"
    }));
  } finally {
    delete process.env.NOISIA_DB_SEED_ALLOW_REMOTE_TEST;
    delete process.env.NOISIA_REMOTE_DATABASE_TARGET;
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
