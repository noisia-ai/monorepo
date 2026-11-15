import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID,createHash}from'node:crypto';
import{redactSignalStudyTextV1,signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import{withSignalStudyFixtureV1}from'./signal-study.synthetic.fixture';
import{claimSignalStudyExecutionV1,readSignalStudyRuntimeSourceV1,releaseSignalStudyExecutionV1}from'../signal-study-executions';
import{signalStudyKnownAuthorPrivacyV1,type SignalStudyAuthorMetadataV1}from'../signal-study-author-privacy';
import type{StudyRuntimeRootV1}from'../../../services/workers/src/workers/signal-study-runtime';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
test('native Study freezes scoped known-author privacy from original imports without rewriting historical sources',{
 skip:process.env.NOISIA_R16_STUDY_PG!=='true',timeout:180000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const first=await f.request(1000000),lease=await claimSignalStudyExecutionV1({database:f.database,execution_id:first.id});assert.ok(lease);
 const source=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(source);assert.equal(source.roots.length,3);
 const rows=(await f.database.query<SignalStudyAuthorMetadataV1&{id:string;author_id:string}>(`SELECT m.id,m.source_author_label_recorded,m.source_author_label,m.raw_metadata->>'author' legacy_author,a.display_name linked_author_display_name,a.handle linked_author_handle,a.id author_id
  FROM mentions m LEFT JOIN authors a ON a.id=m.author_id WHERE m.workspace_id=$1 AND m.id=ANY($2::uuid[]) ORDER BY m.id`,[f.workspace_id,f.roots])).rows;
 assert.equal(rows.length,3);for(const row of rows){const root:StudyRuntimeRootV1=source.roots.find(r=>r.root_id===row.id)!;const expected=signalStudyKnownAuthorPrivacyV1(row);assert.deepEqual(root.private_person_names,expected.private_person_names);
  const proof=JSON.parse(root.embedding_proof.proof_json),stored=(await f.database.query('SELECT private_person_names,proof_json,proof_digest FROM signal_study_source_roots WHERE workspace_id=$1 AND execution_id=$2 AND root_id=$3',[f.workspace_id,first.id,row.id])).rows[0];assert.deepEqual(stored.private_person_names,expected.private_person_names);assert.ok(proof.author_privacy,'native source must freeze its known-author privacy provenance');assert.equal(proof.author_privacy.contract_version,expected.contract_version);assert.equal(proof.author_privacy.metadata_digest,expected.metadata_digest);assert.equal(digest(proof.author_privacy.metadata_snapshot),expected.metadata_digest);assert.equal(proof.author_privacy.author_id,row.author_id);assert.equal(proof.author_privacy.roster_digest,digest(root.private_person_names));assert.equal(sha(stored.proof_json),stored.proof_digest);
  const quote=root.text;assert.ok(root.text.includes(quote));const display=redactSignalStudyTextV1(quote,root.private_person_names);assert.doesNotMatch(display.display_text,/@fixture_user/u);
  if(row.source_author_label){assert.deepEqual(root.private_person_names,['Known Fixture Person Zero']);assert.doesNotMatch(display.display_text,/Known Fixture Person Zero/u);assert.equal(root.private_person_names.some(n=>n.startsWith('Ignored')),false);}
  else if(row.source_author_label_recorded)assert.deepEqual(root.private_person_names,[],'explicit null never revives a stale legacy or linked identity');
  else{assert.ok(root.private_person_names.includes('Known Legacy Person Two'));assert.ok(root.private_person_names.includes('Linked Fixture Person Two'));assert.doesNotMatch(display.display_text,/Known Legacy Person Two|Linked Fixture Person Two/u);}
 }
 await assert.rejects(readSignalStudyRuntimeSourceV1({database:f.database,lease:{...lease,workspace_id:randomUUID()}}),/study_execution_unavailable/);
 const legacy=rows.find(r=>!r.source_author_label_recorded)!;await f.database.query('UPDATE authors SET display_name=$2 WHERE id=$1',[legacy.author_id,'Changed Known Alias']);
 const frozen=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(frozen);assert.equal(frozen.source_digest,source.source_digest);assert.deepEqual(frozen.roots.map(r=>r.private_person_names),source.roots.map(r=>r.private_person_names),'later linked metadata is not overlaid on a frozen cut');
 const secondStudy=await f.createStudy(),second=await secondStudy.request(1000000),nextLease=await claimSignalStudyExecutionV1({database:f.database,execution_id:second.id});assert.ok(nextLease);const next=await readSignalStudyRuntimeSourceV1({database:f.database,lease:nextLease});assert.ok(next);assert.ok(next.roots.find(r=>r.root_id===legacy.id)!.private_person_names.includes('Changed Known Alias'),'only a new admitted source snapshots new known metadata');
 await releaseSignalStudyExecutionV1({database:f.database,lease});await releaseSignalStudyExecutionV1({database:f.database,lease:nextLease});
},{study_author_metadata:true}));
