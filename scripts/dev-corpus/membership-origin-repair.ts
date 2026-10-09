/** Explicit, bounded provenance repair. No verdict/content changes and no provider requests. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {main,openDatabase} from './guard.mjs';
type RepairRow=Record<string,unknown>&{id:string;decided_via:string|null};
type Manifest={workspace_id:string;actor_user_id:string;decisions:Array<{root_id:string;concept_key:string;verdict:"belongs"|"not_belongs"}>};
function parseManifest(value:unknown):Manifest{
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'manifest object required');
 const v=value as Record<string,unknown>,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
 assert.deepEqual(Object.keys(v).sort(),['actor_user_id','decisions','workspace_id']);
 assert.ok(typeof v.workspace_id==='string'&&uuid.test(v.workspace_id));
 assert.ok(typeof v.actor_user_id==='string'&&uuid.test(v.actor_user_id));
 assert.ok(Array.isArray(v.decisions)&&v.decisions.length===3);
 for(const row of v.decisions){assert.ok(row&&typeof row==='object'&&!Array.isArray(row));
  assert.deepEqual(Object.keys(row).sort(),['concept_key','root_id','verdict']);
  assert.ok(typeof row.root_id==='string'&&uuid.test(row.root_id));assert.ok(typeof row.concept_key==='string'&&row.concept_key.length>0);
  assert.ok(row.verdict==='belongs'||row.verdict==='not_belongs');}
 return v as Manifest;
}
await main(async()=>{
 assert.equal(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_APPROVED,'true','explicit repair opt-in required');
 assert.ok(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_MANIFEST,'private manifest required');
 assert.ok(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_RECEIPT,'private receipt path required');
 const bytes=await readFile(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_MANIFEST!);
 const manifest=parseManifest(JSON.parse(bytes.toString('utf8')));
 assert.equal(new Set(manifest.decisions.map(r=>`${r.root_id}:${r.concept_key}`)).size,3,'three distinct targets required');
 const pool=await openDatabase(),c=await pool.connect();let committed=false;
 try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[manifest.workspace_id]);
  const rows=(await c.query(`SELECT o.* FROM signal_concept_membership_overrides o
   JOIN jsonb_to_recordset($3::jsonb) target(root_id uuid,concept_key text,verdict text)
    ON target.root_id=o.root_id AND target.concept_key=o.concept_key AND target.verdict=o.verdict
   WHERE o.workspace_id=$1 AND o.actor_user_id=$2 AND o.superseded_at IS NULL FOR UPDATE OF o`,
   [manifest.workspace_id,manifest.actor_user_id,JSON.stringify(manifest.decisions)])).rows as RepairRow[];
  assert.equal(rows.length,3,'all three exact active decisions must exist');
  assert.ok(rows.every(r=>r.decided_via===null||r.decided_via==='agent_assisted'),'never overwrite an explicitly human origin');
  const unchanged=(row:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='decided_via').sort(([a],[b])=>a.localeCompare(b))));
  const before=new Map(rows.map(r=>[r.id,unchanged(r)]));
  const updated=(await c.query(`UPDATE signal_concept_membership_overrides SET decided_via='agent_assisted'
   WHERE id=ANY($1::uuid[]) AND (decided_via IS NULL OR decided_via='agent_assisted') RETURNING *`,[rows.map(r=>r.id)])).rows as RepairRow[];
  assert.equal(updated.length,3);assert.ok(updated.every(r=>before.get(r.id)===unchanged(r)),'decision data must remain byte-equivalent');
  assert.equal((await c.query('SELECT count(*)::int count FROM signal_concept_membership_human_evaluation_v1 WHERE id=ANY($1::uuid[])',[rows.map(r=>r.id)])).rows[0].count,0);
  const receipt={version:'membership-origin-repair-v1',manifest_sha256:createHash('sha256').update(bytes).digest('hex'),matched:3,
   changed:rows.filter(r=>r.decided_via===null).length,replayed:rows.every(r=>r.decided_via==='agent_assisted'),human_evaluation_rows:0,verdicts_preserved:true,provider_requests:0,at:new Date().toISOString()};
  // Persist the reviewable receipt before committing; replay recovers an uncertain acknowledgement.
  await writeFile(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_RECEIPT!,JSON.stringify({...receipt,status:'prepared'},null,2)+'\n',{mode:0o600});
  const status=process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_DRY_RUN==='true'?'rolled_back':'committed';
  await c.query(status==='committed'?'COMMIT':'ROLLBACK');committed=true;await writeFile(process.env.NOISIA_MEMBERSHIP_ORIGIN_REPAIR_RECEIPT!,JSON.stringify({...receipt,status},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...receipt,status}));
 }catch(error){if(!committed)await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
});
