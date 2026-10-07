import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";

test("founder internal role persists in the verified MFP database after route removal",{
  skip:process.env.NOISIA_MFP_FOUNDER_ACCESS_PG_TEST!=="true" || !process.env.NOISIA_MFP_FOUNDER_USER_ID,timeout:30_000
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase();
  try{
    const row=(await pool.query<{retained:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM users WHERE id=$1::uuid AND status='active'
        AND user_type='noisia_internal' AND primary_role='noisia_admin') retained`,
      [process.env.NOISIA_MFP_FOUNDER_USER_ID])).rows[0];
    assert.equal(row?.retained,true,"the granted role must survive removing the temporary UI route");
  }finally{await pool.end();}
});
