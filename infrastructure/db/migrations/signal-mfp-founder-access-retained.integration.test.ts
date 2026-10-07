import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import test from "node:test";
import type {Pool} from "pg";
import {createProcessingPolicyIdentitiesV1} from "./signal-processing-policy.fixture";

test("removing founder recovery leaves internal admin authority intact",{
  skip:process.env.NOISIA_MFP_FOUNDER_ACCESS_PG_TEST!=="true",timeout:120_000
},async()=>{
  assert.equal(existsSync(new URL("../../../apps/studio/src/app/founder-recovery/page.tsx",import.meta.url)),false,
    "the temporary self-promotion route must stay removed");
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),scoped=await pool.connect();
  try{
    const before=(await scoped.query("SELECT count(*)::int n FROM users")).rows[0].n;
    await scoped.query("BEGIN");
    const identities=await createProcessingPolicyIdentitiesV1({database:pool,scoped});
    const internal=(await scoped.query<{status:string;user_type:string;primary_role:string}>(
      "SELECT status,user_type,primary_role FROM users WHERE id=$1::uuid",[identities.actors.internal])).rows[0];
    assert.deepEqual(internal,{status:"active",user_type:"noisia_internal",primary_role:"noisia_admin"});
    await scoped.query("ROLLBACK");
    assert.equal((await pool.query("SELECT count(*)::int n FROM users")).rows[0].n,before,
      "the synthetic actor leaves no persistent identity");
  }finally{await scoped.query("ROLLBACK").catch(()=>undefined);scoped.release();await pool.end();}
});
