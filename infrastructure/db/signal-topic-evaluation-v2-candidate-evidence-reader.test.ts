import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {signalTopicEvaluationDigestV2 as digest} from "@noisia/query-engine";
import {loadSignalTopicEvaluationV2CandidateEvidence as load} from "./signal-topic-evaluation-v2";

const scope={workspace_id:"11111111-1111-4111-8111-111111111111",run_key:"topic-evaluation-original",
  candidate_key:"topic.original"};
const actor={id:"22222222-2222-4222-8222-222222222222",user_type:"noisia_internal" as const};
const anchor={candidate_id:"33333333-3333-4333-8333-333333333333",
  run_id:"44444444-4444-4444-8444-444444444444",snapshot_id:"55555555-5555-4555-8555-555555555555",
  snapshot_digest:digest("original snapshot"),rights_digest:digest("original rights")};
const contentHash=(text:string)=>`sha256:${createHash("sha256")
  .update(text.normalize("NFKC").replace(/\s+/gu," ").trim()).digest("hex")}`;
function member(index:number,text=`Evidence ${index}`){
  const row={member_ref:digest({member:index}),source_record_digest:digest({source:index}),
    source_content_hash:contentHash(text),canonical_text_hash:`text-hash-${index}`,text_hash:`text-hash-${index}`,
    text_clean:text,rights_valid:true,canonical_valid:true,language:"es",market:"MX",scope:"primary_brand",
    published_month:"2026-05",stratum:"central" as const};
  return{...row,evidence_ref:digest({snapshot:anchor.snapshot_digest,member_ref:row.member_ref,
    source:row.source_record_digest})};
}
type FixtureOptions={count?:number;authorized?:boolean;missing?:boolean;members?:Record<string,unknown>[];
  bindings?:Array<{evidence_ref:string;member_ref:string|null}>;anchor?:Partial<typeof anchor>;
  availability?:{archives_available:boolean;imports_available:boolean;live_available:boolean};
  archived?:null|{proposal_digest:string;evidence_refs:string[];
    bindings:Array<{evidence_ref:string;member_ref:string|null}>};
  failAt?:"authorize"|"anchor"|"bindings"|"availability"|"archived"|"members";failure?:Error};
function fixture(options:FixtureOptions={}){
  const records=Array.from({length:options.count??3},(_,i)=>member(i))
    .sort((a,b)=>a.evidence_ref.localeCompare(b.evidence_ref));
  const bindings=options.bindings??records.map(({evidence_ref,member_ref})=>({evidence_ref,member_ref}));
  const queries:Array<{sql:string;values:unknown[]}>=[];
  const queryable={async query(sql:string,values:unknown[]=[]){
    queries.push({sql,values});
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CALL|BEGIN|COMMIT)\b/iu);
    let phase:FixtureOptions["failAt"];let rows:unknown[];
    if(sql.startsWith("SELECT EXISTS(")){phase="authorize";rows=[{authorized:options.authorized??true}];}
    else if(sql.startsWith("SELECT candidate.id")){phase="anchor";rows=options.missing?[]:[{...anchor,...options.anchor}];}
    else if(sql.startsWith("SELECT evidence.evidence_ref")){phase="bindings";rows=bindings;}
    else if(sql.includes("to_regclass")){phase="availability";rows=[options.availability??{
      archives_available:true,imports_available:true,live_available:false}];}
    else if(sql.startsWith("SELECT archive.source_proposal_digest")){phase="archived";
      rows=options.archived===null?[]:[options.archived??{proposal_digest:digest("proposal"),
        evidence_refs:bindings.map((row)=>row.evidence_ref),bindings}];}
    else if(sql.startsWith("WITH selected_citations")){phase="members";
      const selected=JSON.parse(values[2] as string) as typeof bindings;
      rows=(options.members??records).filter((row)=>selected.some((item)=>item.evidence_ref===row.evidence_ref));
    }else throw new Error("unexpected citation reader query");
    if(phase===options.failAt)throw options.failure;
    return{rows,rowCount:rows.length};
  }};
  return{records,bindings,queries,queryable:queryable as Parameters<typeof load>[0]["queryable"]};
}
function read(f:ReturnType<typeof fixture>,extra:Partial<Parameters<typeof load>[0]>={}){
  return load({queryable:f.queryable,...scope,actor,collection:"candidate",...extra});
}

test("candidate citations project only safe excerpts and metadata, preserving their exact references",async()=>{
  const text="Ａ useful\n opinion test@example.com https://example.org/private @person secret_abcdefghijk "+"x".repeat(750);
  const row=member(0,text),f=fixture({count:1,members:[{...row,mention_id:"private-mention",
    source_record_key:"private-source-key",provider_response:"private-response"}]});
  const result=await read(f);
  assert.equal(result.status,"available");assert.equal(result.total,1);assert.equal(result.limit,20);
  assert.equal(result.next_cursor,null);assert.equal(result.items[0]!.status,"available");
  const item=result.items[0]!;if(item.status!=="available")throw new Error("expected readable citation");
  assert.equal(item.excerpt.length,600);assert.match(item.excerpt,/\[email\].*\[url\].*\[handle\].*\[redacted\]/u);
  assert.equal(item.evidence_ref,row.evidence_ref);assert.equal(item.month,"2026-05");
  assert.deepEqual(Object.keys(item).sort(),["evidence_ref","excerpt","language","market","month","scope",
    "source_digest","status","stratum"].sort());
  assert.doesNotMatch(JSON.stringify(result),/private-|example\.org|@person|secret_abcdefghijk/u);
  assert.equal(result.topic_adoption,false);assert.equal(result.publication,false);assert.equal(result.serving,false);
});

test("archived refinement resolves its own receipt bindings and does not reuse candidate citations or sessions",async()=>{
  const record=member(30),binding={evidence_ref:record.evidence_ref,member_ref:record.member_ref};
  const f=fixture({members:[record],archived:{proposal_digest:digest("archived 2020 proposal"),
    evidence_refs:[binding.evidence_ref],bindings:[binding]}});
  const result=await read(f,{collection:"refinement"});
  assert.equal(result.total,1);assert.equal(result.items[0]!.evidence_ref,record.evidence_ref);
  assert.equal(result.items[0]!.status,"available");
  assert.ok(!f.queries.some(({sql})=>sql.startsWith("SELECT evidence.evidence_ref")));
  const sql=f.queries.find(({sql})=>sql.startsWith("SELECT archive.source"))!.sql;
  assert.match(sql,/receipt\.artifact->'refinement'->'evidence'/u);
  assert.match(sql,/run\.import_receipt_id=receipt\.id/u);assert.match(sql,/run\.origin='imported_result'/u);
  assert.doesNotMatch(sql,/expires_at|clock_timestamp|source_cluster_keys|session|navigation_trace/iu);
});

test("missing archive schema is unavailable; absent archived proposal is none; live-only remains unavailable",async()=>{
  for(const availability of [
    {archives_available:false,imports_available:false,live_available:false},
    {archives_available:true,imports_available:false,live_available:true}
  ]){
    const f=fixture({availability});const result=await read(f,{collection:"refinement"});
    assert.equal(result.status,"unavailable");assert.deepEqual(result.items,[]);assert.equal(result.total,0);
    assert.equal(f.queries.length,3);
  }
  const absent=await read(fixture({archived:null}),{collection:"refinement"});
  assert.equal(absent.status,"none");assert.equal(absent.next_cursor,null);
  const live=await read(fixture({archived:null,availability:{archives_available:true,imports_available:true,
    live_available:true}}),{collection:"refinement"});assert.equal(live.status,"unavailable");
});

test("rights loss retains the citation and does not expose any excerpt or metadata",async()=>{
  const f=fixture({count:1,members:[{...member(0),rights_valid:false,text_clean:"must not leak"}]});
  const result=await read(f);
  assert.equal(result.total,1);assert.deepEqual(result.items,[{evidence_ref:f.bindings[0]!.evidence_ref,
    status:"unavailable",reason:"rights_changed"}]);assert.doesNotMatch(JSON.stringify(result),/must not leak/u);
});

test("changed root, stored text hash, and content changed without updating its hash are unavailable",async()=>{
  for(const change of [{canonical_valid:false},{text_hash:"changed"},{text_clean:"changed without text_hash"},
    {source_content_hash:digest("forged")},{text_clean:null}]){
    const f=fixture({count:1,members:[{...member(0),...change}]});const result=await read(f);
    assert.deepEqual(result.items,[{evidence_ref:f.bindings[0]!.evidence_ref,
      status:"unavailable",reason:"source_changed"}]);
  }
});

test("normalization matches the existing NFKC/whitespace content binding",async()=>{
  const row=member(0,"Ａ\n café"),f=fixture({count:1,members:[{...row,text_clean:"A   café"}]});
  assert.equal((await read(f)).items[0]!.status,"available");
});

test("missing, ambiguous or incorrectly hashed membership is an explicit unavailable citation",async()=>{
  for(const members of [[],[{...member(0),member_ref:null}],[member(0),member(0)],
    [{...member(0),source_record_digest:digest("wrong source")}],[{...member(0),member_ref:digest("wrong member")}]]){
    const f=fixture({count:1,members});const result=await read(f);
    assert.equal(result.total,1);assert.deepEqual(result.items,[{evidence_ref:f.bindings[0]!.evidence_ref,
      status:"unavailable",reason:"reference_unavailable"}]);
  }
});

test("archive references remain in the list when receipt bindings are missing or ambiguous",async()=>{
  const row=member(0),binding={evidence_ref:row.evidence_ref,member_ref:row.member_ref};
  for(const bindings of [[],[binding,binding]]){
    const f=fixture({members:[],archived:{proposal_digest:digest("proposal"),evidence_refs:[row.evidence_ref],bindings}});
    const result=await read(f,{collection:"refinement"});
    assert.equal(result.total,1);assert.equal(result.items[0]!.status,"unavailable");
    const query=f.queries.at(-1)!;assert.equal(JSON.parse(query.values[2] as string)[0].member_ref,null);
  }
});

test("pagination returns all 48 exact refs, including unavailable citations, in bounded stable pages",async()=>{
  const records=Array.from({length:48},(_,i)=>({...member(i),rights_valid:i!==0}));
  const f=fixture({count:48,members:records});let cursor:string|null=null;const refs:string[]=[];
  const lengths:number[]=[];let unavailable=0;
  do{const result=await read(f,{cursor});assert.equal(result.total,48);lengths.push(result.items.length);
    unavailable+=result.items.filter((item)=>item.status==="unavailable").length;
    refs.push(...result.items.map((item)=>item.evidence_ref));cursor=result.next_cursor;
    if(cursor)assert.ok(cursor.length<=512);
  }while(cursor);
  assert.deepEqual(lengths,[20,20,8]);assert.deepEqual(refs,f.bindings.map((row)=>row.evidence_ref));
  assert.equal(unavailable,1);
  for(const query of f.queries.filter(({sql})=>sql.startsWith("WITH selected_citations"))){
    assert.ok(JSON.parse(query.values[2] as string).length<=20);assert.match(query.sql,/LIMIT 20/u);
  }
});

test("cursor cannot cross workspace, run, candidate, snapshot, rights, collection, reference set or page size",async()=>{
  const f=fixture({count:4});const cursor=(await read(f,{limit:2})).next_cursor!;
  for(const extra of [{workspace_id:"66666666-6666-4666-8666-666666666666"},
    {run_key:"topic-evaluation-other"},{candidate_key:"topic.other"},{collection:"refinement" as const},{limit:3}]){
    await assert.rejects(read(f,{cursor,limit:2,...extra}),{code:"topic_evaluation_v2_candidate_evidence_cursor_invalid"});
  }
  for(const change of [{snapshot_id:"77777777-7777-4777-8777-777777777777"},
    {snapshot_digest:digest("new snapshot")},{rights_digest:digest("changed rights")}]){
    await assert.rejects(read(fixture({count:4,anchor:change}),{cursor,limit:2}),{status:422});
  }
  await assert.rejects(read(fixture({count:5}),{cursor,limit:2}),{status:422});
  const altered=JSON.parse(Buffer.from(cursor,"base64url").toString());altered.after=digest("absent");
  await assert.rejects(read(f,{cursor:Buffer.from(JSON.stringify(altered)).toString("base64url"),limit:2}),{status:422});
});

test("malformed cursors and invalid closed requests fail before querying",async()=>{
  for(const cursor of ["", "not-json", "x".repeat(513),Buffer.from("null").toString("base64url"),
    Buffer.from(JSON.stringify({binding:digest("x"),after:digest("y"),mention_id:"arbitrary"})).toString("base64url")]){
    const f=fixture();await assert.rejects(read(f,{cursor}),{status:422});assert.equal(f.queries.length,0);
  }
  for(const extra of [{limit:0},{limit:21},{limit:1.5},{limit:NaN},{collection:"all" as never},
    {candidate_key:"OTHER KEY"},{run_key:"Invalid-Run"},{candidate_key:"arbitrary/id"}]){
    const f=fixture();await assert.rejects(read(f,extra),{status:422});assert.equal(f.queries.length,0);
  }
});

test("actor authorization and exact candidate not-found failures do not expose citations",async()=>{
  const client=fixture();await assert.rejects(read(client,{actor:{...actor,user_type:"client"} as never}),{status:403});
  assert.equal(client.queries.length,0);
  const invalid=fixture({authorized:false});await assert.rejects(read(invalid),{status:403});
  assert.equal(invalid.queries.length,1);
  const missing=fixture({missing:true});await assert.rejects(read(missing),{status:404});assert.equal(missing.queries.length,2);
});

test("arbitrary SQL and authorization errors propagate, never becoming archive-unavailable",async()=>{
  for(const failAt of ["authorize","anchor","bindings","members","availability","archived"] as const){
    const failure=Object.assign(new Error("database failed"),{code:"42501"}),f=fixture({failure,failAt});
    await assert.rejects(read(f,{collection:["availability","archived"].includes(failAt)?"refinement":"candidate"}),
      (error)=>error===failure);
  }
});

test("SQL binds original run/snapshot, preserves left-joined missing sources and never filters source clusters",async()=>{
  const f=fixture();await read(f);
  assert.deepEqual(f.queries[0]!.values,[scope.workspace_id,actor.id]);
  assert.deepEqual(f.queries[1]!.values,Object.values(scope));
  const anchorSql=f.queries[1]!.sql;
  assert.match(anchorSql,/snapshot\.id=run\.snapshot_id/u);assert.match(anchorSql,/run\.workspace_id=candidate\.workspace_id/u);
  assert.match(anchorSql,/run\.status='completed'/u);assert.match(anchorSql,/NOT candidate\.adopted/u);
  assert.match(anchorSql,/NOT candidate\.published AND NOT candidate\.serving/u);
  assert.doesNotMatch(anchorSql,/ORDER BY snapshot|semantic_context_generations|editorial/u);
  assert.deepEqual(f.queries[2]!.values,[anchor.candidate_id,anchor.run_id,scope.workspace_id,anchor.snapshot_id]);
  assert.match(f.queries[2]!.sql,/retrieval\.run_id=\$2::uuid AND retrieval\.workspace_id=\$3::uuid/u);
  // 0112 retrievals have no snapshot_id; that binding belongs to the run and linked evidence.
  assert.doesNotMatch(f.queries[2]!.sql,/retrieval\.snapshot_id/u);
  assert.match(f.queries[2]!.sql,/linked\.snapshot_id=\$4::uuid/u);
  const sql=f.queries[3]!.sql;assert.match(sql,/LEFT JOIN mentions/u);assert.match(sql,/membership\.snapshot_id=\$2::uuid/u);
  assert.match(sql,/mention\.id=mention\.canonical_mention_id/u);assert.match(sql,/mention\.text_hash=membership\.canonical_text_hash/u);
  assert.match(sql,/source\.status='active'/u);assert.match(sql,/mention\.inclusion_status='included'/u);
  assert.doesNotMatch(f.queries.map(({sql})=>sql).join("\n"),/source_cluster_keys|provider_|outbox|session_id/u);
});

test("oversized and duplicate reference sets fail closed before any mention query",async()=>{
  const many=fixture({count:49});await assert.rejects(read(many),{code:"topic_evaluation_v2_candidate_evidence_invalid"});
  assert.equal(many.queries.length,3);
  const binding={evidence_ref:member(0).evidence_ref,member_ref:member(0).member_ref};
  await assert.rejects(read(fixture({bindings:[binding,binding]})),{status:409});
});

test("the original explanation remains in the detail payload and this reader does not change its contract",()=>{
  const source=readFileSync(new URL("./signal-topic-evaluation-v2.ts",import.meta.url),"utf8");
  assert.match(source,/base_model_payload:row\.base_payload,base_model_payload_digest:row\.base_payload_digest/u);
  assert.match(source,/contract_version:"signal-topic-evaluation-v2-candidate-detail-v1"/u);
});
