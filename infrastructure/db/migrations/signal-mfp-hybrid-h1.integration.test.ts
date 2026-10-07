import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";
import { selectHybridClaudeInputsV1 } from "../signal-hybrid-runs";
import type { LabelingRunV1 } from "../signal-labeling-runs";
import { selectMembershipInputsV1 } from "../signal-concept-memberships";
import { hybridH1PopulationSqlV1 } from "../../../scripts/eval/hybrid-h1-population";
import { hybridH1ClaudeAdmissionPopulationSqlV1, hybridH1JevAdmissionPopulationSqlV1 } from "../signal-hybrid-admission-population";

test("migrated H1 schema is workspace isolated, reviewable and rollback safe", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" });
  const scoped = await database.connect();
  try {
    assert.equal((await scoped.query("SELECT current_database() name")).rows[0].name, "noisia_mfp_ci");
    await scoped.query("BEGIN");
    const fixture = await createProcessingPolicyIdentitiesV1({ database, scoped });
    assert.equal((await scoped.query("SELECT count(*)::int n FROM signal_hybrid_membership_routes")).rows[0].n, 0,
      "migration does not select H1 by default");
    const digest = `sha256:${"a".repeat(64)}`;
    const version = randomUUID();
    await scoped.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
      VALUES($1,'facets','typesafe','jev-1.13.0',$2,$2,$2,'{}'::jsonb)`, [version, digest]);
    await scoped.query(`INSERT INTO signal_hybrid_membership_routes(workspace_id,route,route_digest,jev_labeler_digest,
      claude_labeler_digest,jev_facets_labeler_version_id,configured_by_user_id) VALUES($1,'hybrid_h1',$2,$2,$2,$3,$4)`,
      [fixture.first.workspace_id, digest, version, fixture.actors.firstAdmin]);
    assert.equal((await scoped.query("SELECT count(*)::int n FROM signal_hybrid_membership_routes WHERE workspace_id=$1",
      [fixture.second.workspace_id])).rows[0].n, 0, "sibling workspace remains on standard route");
    assert.deepEqual(await selectHybridClaudeInputsV1(scoped, {workspace_id:fixture.first.workspace_id,
      cursor_root_id:null,membership_snapshot:{hybrid_stage:"claude",route_digest:digest,
        jev_run_id:randomUUID(),concepts:[]}} as unknown as LabelingRunV1),[],
      "the Claude stage query is valid on the migrated schema and has no unsolicited work");
    const emptyRun = {workspace_id:fixture.first.workspace_id,cursor_root_id:null,labeler_digest:digest,
      membership_snapshot:{concepts:[],preview:false,sample_root_ids:null}} as unknown as LabelingRunV1;
    assert.deepEqual(await selectMembershipInputsV1(scoped,emptyRun,true),[],
      "the JEV rights-gated selector is valid on migrated schema");
    const source = randomUUID(), root = randomUUID();
    await scoped.query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,status,source_contract_version,source_key)
      VALUES($1,$2,$3,$4,'social-listening','fixture','csv','H1 synthetic','active',
        'signal-data-source-connector-v1',$5)`,
      [source, fixture.first.workspace_id, fixture.first.organization_id, fixture.first.brand_id,
        `source-sha256-${createHash("sha256").update(source).digest("hex")}`]);
    await scoped.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
      source_system,text_hash,text_clean,text_length,published_at,platform,inclusion_status)
      VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,'h1-root',$1::text,'h1-ci',$4,
        'Synthetic mention',17,now(),'fixture','included')`,
      [root, fixture.first.workspace_id, source, `sha256:${createHash("sha256").update(root).digest("hex")}`]);
    const insert = (verdict: string, concept: string, jev: unknown, claude: unknown, citation: unknown) => scoped.query(`
      INSERT INTO signal_hybrid_membership_decisions(workspace_id,root_id,root_fingerprint,concept_key,definition_digest,
        entity_context_digest,effective_entities_digest,route_digest,result_digest,verdict,jev,claude,citation)
      VALUES($1,$2,$3,$4,$5,$5,$5,$5,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
      [fixture.first.workspace_id, root, digest, concept, digest, verdict,
        JSON.stringify(jev), claude === null ? null : JSON.stringify(claude), JSON.stringify(citation)]);
    await insert("not_belongs", "negative", { verdict: "not_belongs", probability: 0.2 }, null, []);
    await insert("review_required", "review", { verdict: "belongs", probability: 0.7, citation: { quote: "Synthetic mention" } },
      { verdict: "not_belongs", citation: { quote: "Synthetic mention" } }, []);
    assert.equal((await scoped.query("SELECT count(*)::int n FROM signal_hybrid_membership_decisions WHERE verdict='review_required' AND workspace_id=$1",
      [fixture.first.workspace_id])).rows[0].n, 1);
    await scoped.query("SAVEPOINT invalid_review");
    await assert.rejects(insert("review_required", "invalid", { verdict: "belongs", probability: 0.7 },
      { verdict: "not_belongs" }, []), /check constraint|23514/u);
    await scoped.query("ROLLBACK TO SAVEPOINT invalid_review");
    assert.equal((await scoped.query("SELECT relrowsecurity FROM pg_class WHERE oid='signal_hybrid_membership_decisions'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await scoped.query(`SELECT count(*)::int n FROM pg_class c,
      LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) grant_item
      WHERE c.oid='signal_hybrid_membership_decisions'::regclass AND grant_item.grantee=0
        AND grant_item.privilege_type='SELECT'`)).rows[0].n, 0);
    assert.match((await scoped.query("SELECT pg_get_viewdef('signal_concept_memberships_current_v1'::regclass) definition")).rows[0].definition,
      /signal_hybrid_membership_decisions/u);
    await scoped.query(`CREATE TEMP TABLE signal_mention_facets_current_v1 (
      workspace_id uuid,root_id uuid,input_digest text,full_text text,requires_context_review boolean) ON COMMIT DROP`);
    await scoped.query(`CREATE TEMP TABLE signal_membership_evidence_rights_v1 (
      workspace_id uuid,root_id uuid,metrics boolean,evidence boolean) ON COMMIT DROP`);
    await scoped.query(`CREATE TEMP TABLE signal_mention_facet_labels (
      workspace_id uuid,root_id uuid,input_digest text,facets jsonb,relevance text,status text,
      entity_context_digest text,labeler_digest text,created_at timestamptz) ON COMMIT DROP`);
    await scoped.query("SET LOCAL search_path=pg_temp,public,extensions");
    const deniedRoot = randomUUID(), siblingRoot = randomUUID();
    await scoped.query(`INSERT INTO signal_mention_facets_current_v1 VALUES
      ($1,$2,$4,$5,false),($1,$3,$4,$5,false),($6,$7,$4,$5,false)`,
      [fixture.first.workspace_id, root, deniedRoot, digest, "Synthetic mention", fixture.second.workspace_id, siblingRoot]);
    await scoped.query(`INSERT INTO signal_membership_evidence_rights_v1 VALUES
      ($1,$2,true,true),($1,$3,true,false),($4,$5,true,true)`,
      [fixture.first.workspace_id, root, deniedRoot, fixture.second.workspace_id, siblingRoot]);
    await scoped.query(`INSERT INTO signal_mention_facet_labels
      SELECT workspace_id,root_id,input_digest,'{}'::jsonb,'relevant','labeled',$1,$1,now()
      FROM signal_mention_facets_current_v1`, [digest]);
    const population = (await scoped.query<{root_id:string}>(hybridH1PopulationSqlV1,
      [fixture.first.workspace_id, version])).rows;
    assert.deepEqual(population.map(row => row.root_id), [root],
      "the exact labeler and evidence rights select only the fixture root");
    const plan = JSON.stringify((await scoped.query(`EXPLAIN (FORMAT JSON) ${hybridH1PopulationSqlV1}`,
      [fixture.first.workspace_id, version])).rows[0]["QUERY PLAN"]);
    for (const cte of ["current_facets", "authorized_roots", "jev_labels"]) assert.match(plan,
      new RegExp(`"CTE Name":"${cte}"`, "u"), `the governed ${cte} input is materialized once`);
    await scoped.query(`CREATE TEMP TABLE signal_concept_memberships_current_v1 (
      workspace_id uuid,root_id uuid,root_fingerprint text,concept_key text,definition_digest text,
      entity_context_digest text,effective_entities_digest text,labeler_digest text,verdict text) ON COMMIT DROP`);
    await scoped.query(`INSERT INTO signal_concept_memberships_current_v1 VALUES
      ($1,$2,$4,'h1',$4,$4,$4,$4,'pending'),
      ($1,$3,$4,'denied',$4,$4,$4,$4,'pending'),
      ($5,$6,$4,'sibling',$4,$4,$4,$4,'pending'),
      ($1,$2,$4,'completed',$4,$4,$4,$4,'belongs')`,
      [fixture.first.workspace_id, root, deniedRoot, digest, fixture.second.workspace_id, siblingRoot]);
    const admission = (await scoped.query<{roots:number;pairs:number;characters:string}>(
      hybridH1JevAdmissionPopulationSqlV1,[fixture.first.workspace_id,digest])).rows[0];
    assert.deepEqual(admission,{roots:1,pairs:1,characters:String("Synthetic mention".length)},
      "JEV admission estimates only pending pairs with evidence rights in the selected workspace");
    const admissionPlan = JSON.stringify((await scoped.query(`EXPLAIN (FORMAT JSON) ${hybridH1JevAdmissionPopulationSqlV1}`,
      [fixture.first.workspace_id,digest])).rows[0]["QUERY PLAN"]);
    for (const cte of ["current_memberships", "current_facets", "authorized_roots", "applied_results"])
      assert.match(admissionPlan,new RegExp(`"CTE Name":"${cte}"`,"u"),`materialized H1 admission ${cte}`);
    await scoped.query(`CREATE TEMP TABLE signal_labeling_runs (
      id uuid,workspace_id uuid,kind text,status text,membership_snapshot jsonb) ON COMMIT DROP`);
    await scoped.query(`CREATE TEMP TABLE signal_labeling_calls (
      run_id uuid,results jsonb,inputs jsonb,status text,results_applied boolean) ON COMMIT DROP`);
    const jevRun = randomUUID();
    await scoped.query(`INSERT INTO signal_labeling_runs VALUES
      ($1,$2,'membership','completed',jsonb_build_object('hybrid_stage','jev','route_digest',$3::text))`,
      [jevRun,fixture.first.workspace_id,digest]);
    await scoped.query(`INSERT INTO signal_labeling_calls VALUES
      ($1,jsonb_build_array(jsonb_build_object('root_id',$2::text,'root_fingerprint',$3::text,
        'concept_key','h1','definition_digest',$3::text,'entity_context_digest',$3::text,
        'effective_entities_digest',$3::text,'jev',jsonb_build_object('verdict','belongs'))),'[]'::jsonb,'settled',true)`,
      [jevRun,root,digest]);
    assert.deepEqual((await scoped.query(hybridH1JevAdmissionPopulationSqlV1,
      [fixture.first.workspace_id,digest])).rows[0],{roots:0,pairs:0,characters:"0"},
      "the exact settled JEV pair is excluded from another admission");
    assert.deepEqual((await scoped.query(hybridH1ClaudeAdmissionPopulationSqlV1,
      [fixture.first.workspace_id,digest])).rows[0],{roots:1,pairs:1,characters:String("Synthetic mention".length)},
      "Claude admission counts the settled JEV positive with evidence rights");
    await scoped.query("ROLLBACK");
    assert.equal((await database.query("SELECT count(*)::int n FROM signal_hybrid_membership_routes WHERE workspace_id=$1",
      [fixture.first.workspace_id])).rows[0].n, 0);
  } finally { await scoped.query("ROLLBACK").catch(() => undefined); scoped.release(); await database.end(); }
});
