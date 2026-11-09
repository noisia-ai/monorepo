import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

/** Compare with the immutable pre-projection contract, including NULLs. */
export async function assertMassLabelingServingProjectionV1(query:PoolClient["query"],workspace:string,map:string){
 const migration=await readFile(new URL("./0282_signal_mass_labeling_study_policy.sql",import.meta.url),"utf8");
 const original=migration.split("CREATE OR REPLACE VIEW signal_mass_labeling_memberships_v1 AS")[1]!.trim().replace(/;$/u,"");
 const checked=(await query(`WITH original AS(${original}),
   expected AS(SELECT * FROM original WHERE workspace_id=$1 AND map_id=$2),
   actual AS(SELECT * FROM signal_mass_labeling_memberships_v1 WHERE workspace_id=$1 AND map_id=$2),
   differences AS((SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
     UNION ALL(SELECT * FROM actual EXCEPT ALL SELECT * FROM expected))
   SELECT count(*)::int n FROM differences`,[workspace,map])).rows[0]!;
 assert.equal(checked.n,0,"projection preserves every original membership column, including unasked candidates and overrides");
 const segments=(await query(`SELECT count(*)::int roots,bool_and(segment.conversation_segment=
   signal_mass_labeling_r13_segment_v1(mention.text_clean,result.probabilities)) correct
   FROM signal_mass_labeling_items item JOIN signal_mass_labeling_root_segments segment
    ON segment.map_id=item.map_id AND segment.root_id=item.root_id
   JOIN mentions mention ON mention.workspace_id=item.workspace_id AND mention.id=item.root_id
   LEFT JOIN signal_mass_labeling_results result ON result.map_id=item.map_id AND result.root_id=item.root_id
   WHERE item.workspace_id=$1 AND item.map_id=$2`,[workspace,map])).rows[0]!;
 assert.equal(segments.correct,true);
 assert.equal(segments.roots,(await query("SELECT root_count FROM signal_mass_labeling_maps WHERE workspace_id=$1 AND id=$2",[workspace,map])).rows[0]!.root_count);
}

/** Rehearse adoption after receipts and corrections already exist. */
export async function assertMassLabelingProjectionBackfillV1(query:PoolClient["query"],workspace:string,map:string){
 const migration=await readFile(new URL("./0288_signal_mass_labeling_serving_projection.sql",import.meta.url),"utf8");
 await query("SAVEPOINT projection_backfill_rehearsal");
 await query(`DROP TRIGGER mass_labeling_serving_items ON signal_mass_labeling_items;
   DROP TRIGGER mass_labeling_serving_results ON signal_mass_labeling_results;
   DROP TRIGGER mass_labeling_serving_text ON mentions;
   DROP FUNCTION materialize_signal_mass_labeling_serving_items_v1(),materialize_signal_mass_labeling_serving_results_v1(),refresh_signal_mass_labeling_serving_text_v1();
   DROP TABLE signal_mass_labeling_root_segments,signal_mass_labeling_topic_probabilities CASCADE`);
 await query(migration);
 await assertMassLabelingServingProjectionV1(query,workspace,map);
 await query("ROLLBACK TO SAVEPOINT projection_backfill_rehearsal");
 await query("RELEASE SAVEPOINT projection_backfill_rehearsal");
}
