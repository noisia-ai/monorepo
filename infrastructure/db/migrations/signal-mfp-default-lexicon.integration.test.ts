import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createMassLabelingProductDatabaseFixtureV1 } from "./signal-mass-labeling-product-database.synthetic.fixture";
import { syntheticImportedWorkspaceFixtureV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { loadMassLabelingStudyPolicyWithClientV1 } from "../signal-mass-labeling-study-policy";

test("inherited category matches follow seed changes and serialize concurrent sources", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const {database,cleanup}=await createMassLabelingProductDatabaseFixtureV1();
  const scoped=await database.connect();
  let first:PoolClient|undefined;
  let second:PoolClient|undefined;
  try {
    const fixture=await syntheticImportedWorkspaceFixtureV1({database,scoped,query:database.query.bind(database),cleanup:async()=>{}});
    const workspace=fixture.workspace_id;
    await database.query("INSERT INTO signal_mass_labeling_default_lexicons(workspace_id,lexicon_terms) VALUES($1,signal_mass_labeling_default_lexicon_v1($1))",[workspace]);
    await database.query(`INSERT INTO signal_mass_labeling_category_matches(workspace_id,policy_revision,root_id,matched)
      SELECT workspace_id,0,id,signal_mass_labeling_category_matches_v1(text_clean,signal_mass_labeling_default_lexicon_v1(workspace_id))
      FROM mentions WHERE workspace_id=$1`,[workspace]);
    const verify=async(expected:boolean)=>{
      const settings=await loadMassLabelingStudyPolicyWithClientV1(scoped,workspace);
      const stored=(await database.query("SELECT lexicon_terms FROM signal_mass_labeling_default_lexicons WHERE workspace_id=$1",[workspace])).rows[0]!;
      assert.deepEqual([...stored.lexicon_terms].sort(),[...settings.lexicon_terms].sort());
      const matches=(await database.query(`SELECT cache.matched,signal_mass_labeling_category_matches_v1(mention.text_clean,$2::text[]) expected
        FROM signal_mass_labeling_category_matches cache JOIN mentions mention ON mention.workspace_id=cache.workspace_id AND mention.id=cache.root_id
        WHERE cache.workspace_id=$1 AND cache.policy_revision=0`,[workspace,settings.lexicon_terms])).rows;
      assert.equal(matches.length,3);
      assert.ok(matches.every(row=>row.matched===row.expected&&row.matched===expected));
    };
    await verify(false);
    await database.query("UPDATE brands SET industry='bicycle' WHERE id=$1",[fixture.brand_id]);
    await verify(true);
    await database.query("UPDATE brands SET industry='absent category' WHERE id=$1",[fixture.brand_id]);
    await verify(false);
    const entity=randomUUID();
    await database.query("INSERT INTO intelligence_entities(id,brand_id,entity_type,canonical_name,status) VALUES($1,$2,'category','unmatched name','active')",[entity,fixture.brand_id]);
    await database.query("INSERT INTO entity_aliases(entity_id,alias) VALUES($1,'bicycle')",[entity]);
    await verify(true);
    await database.query("DELETE FROM entity_aliases WHERE entity_id=$1",[entity]);
    await verify(false);
    await database.query("UPDATE brands SET brand_seed_handles=ARRAY['bicycle'] WHERE id=$1",[fixture.brand_id]);
    await verify(true);
    await database.query("UPDATE brands SET brand_seed_handles=ARRAY[]::text[] WHERE id=$1",[fixture.brand_id]);
    await verify(false);
    const profile=randomUUID(),product=randomUUID(),seed=randomUUID(),competitor=randomUUID();
    await database.query("INSERT INTO brand_os_profiles(id,brand_id,name,status,version) VALUES($1,$2,'Synthetic lexical profile','draft',999)",[profile,fixture.brand_id]);
    await database.query("INSERT INTO brand_os_products(id,brand_os_profile_id,name,status) VALUES($1,$2,'bicycle','active')",[product,profile]);
    await verify(false);
    await database.query("UPDATE brand_os_profiles SET status='active' WHERE id=$1",[profile]);
    await verify(true);
    await database.query("DELETE FROM brand_os_products WHERE id=$1",[product]);
    await verify(false);
    await database.query("INSERT INTO brand_seeds(id,canonical_name,active) VALUES($1,$2,true)",[seed,`Synthetic seed ${seed}`]);
    await database.query("INSERT INTO competitors(id,brand_id,competitor_brand_seed_id,status,effective_from,updated_at) VALUES($1,$2,$3,'current',clock_timestamp(),clock_timestamp())",[competitor,fixture.brand_id,seed]);
    await verify(false);
    await database.query("UPDATE brand_seeds SET aliases=ARRAY['bicycle'] WHERE id=$1",[seed]);
    await verify(true);
    await database.query("UPDATE brand_seeds SET active=false WHERE id=$1",[seed]);
    await verify(false);
    await database.query("UPDATE intelligence_entities SET canonical_name='bicycle' WHERE id=$1",[entity]);
    await verify(true);
    await database.query("UPDATE intelligence_entities SET canonical_name='unmatched name' WHERE id=$1",[entity]);
    await verify(false);
    first=await database.connect();second=await database.connect();
    await first.query("BEGIN");await second.query("BEGIN");
    await first.query("UPDATE brands SET industry_sub='bicycle' WHERE id=$1",[fixture.brand_id]);
    const pid=(await second.query("SELECT pg_backend_pid() pid")).rows[0]!.pid;
    const pending=second.query("UPDATE intelligence_entities SET canonical_name='repair' WHERE id=$1",[entity]);
    let waiting=false;
    for(let attempt=0;attempt<100&&!waiting;attempt++){
      waiting=(await database.query("SELECT wait_event='advisory' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;
      if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,"different seed sources share the lexical writer lock");
    await first.query("COMMIT");await pending;await second.query("COMMIT");
    await verify(true);
    await first.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await first.query("SELECT * FROM signal_mass_labeling_default_lexicons WHERE workspace_id=$1",[workspace]);
    await second.query("UPDATE brands SET industry='appointment' WHERE id=$1",[fixture.brand_id]);
    await assert.rejects(first.query("INSERT INTO entity_aliases(entity_id,alias) VALUES($1,'orange')",[entity]),
      (error:unknown)=>(error as {code:string}).code==="40001");
    await first.query("ROLLBACK");
    await verify(true);
  }finally{
    await first?.query("ROLLBACK");await second?.query("ROLLBACK");
    first?.release();second?.release();scoped.release();await cleanup();
  }
});
