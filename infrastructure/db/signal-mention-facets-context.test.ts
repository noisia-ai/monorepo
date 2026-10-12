import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { entityContextDigestV1 } from "@noisia/query-engine";
import { inspectFacetContextChangeV1 } from "./signal-mention-facets";

test("CE transition fences re-included roots and entities seen by any labeler", async () => {
  const previous = {entities:[
    {entity_id:"brand",kind:"primary_brand" as const,name:"Brand",aliases:[],disambiguation:null},
    {entity_id:"retired",kind:"competitor" as const,name:"Retired",aliases:[],disambiguation:null},
  ]};
  const sql: string[] = [];
  const client = {async query(text: string) {
    sql.push(text);
    if (text.includes("AS brand_name")) return {rows:[{workspace_id:"workspace",brand_id:"brand",brand_name:"Brand",brand_slug:"brand"}]};
    if (text.includes("'primary_brand'::text AS scope")) return {rows:[
      {scope:"primary_brand",entity_id:"brand",entity_label:"Brand",aliases:["Nova"],disambiguation:null},
    ]};
    if (text.includes("SELECT context,digest,version_no")) return {rows:[{context:previous,digest:entityContextDigestV1(previous),version_no:2}]};
    if (text.includes("FROM mentions mention")) return {rows:[
      {root_id:"re-included",title:null,full_text:"A Nova product",entity_ids:[]},
      {root_id:"old-labeler",title:null,full_text:"Ambiguous discussion",entity_ids:["retired"]},
      {root_id:"unaffected",title:null,full_text:"Generic discussion",entity_ids:[]},
    ]};
    return {rows:[]};
  }} as unknown as Pick<PoolClient,"query">;
  const result = await inspectFacetContextChangeV1(client,"workspace");
  assert.equal(result.diff.affected_mode,"targeted");
  assert.deepEqual(result.affected,["re-included","old-labeler"]);
  assert.ok(sql.some((query) => query.includes("FROM mentions mention")
    && query.includes("signal_mention_facet_labels") && !query.includes("signal_mention_facets_current_v1")));
});
