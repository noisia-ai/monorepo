import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import ts from "typescript";
import {SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS,SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS,
  type SignalTaxonomyInsightContextRefV1} from "@noisia/query-engine";

const source = await readFile(
  new URL("./signal-taxonomy-insights.ts", import.meta.url),
  "utf8"
);

test("taxonomy insights remain evidence-bound and use bounded web research", () => {
  assert.match(source, /supporting_mention_ids/u);
  assert.match(source, /counterevidence_mention_ids/u);
  assert.match(source, /webSearch_20250305/u);
  assert.match(source, /SIGNAL_TAXONOMY_INSIGHT_MAX_WEB_SEARCHES/u);
  assert.match(source, /External context never proves causality/u);
  assert.match(source, /Do not assume a country or market/u);
  assert.doesNotMatch(source, /country:\s*"MX"/u);
  assert.match(source, /causal_claims = '\[\]'::jsonb/u);
});

test("every sampled mention has a durable ledger and completed results are transactional", () => {
  assert.match(source, /upsertSampleAnalysisLedger/u);
  assert.match(source, /submitted_for_analysis/u);
  assert.match(source, /analysis_failed/u);
  assert.match(source, /analysis_status: "completed"/u);
  assert.match(source, /BEGIN/u);
  assert.match(source, /record_feature_values/u);
  assert.match(source, /analyzed_not_cited/u);
  assert.match(source, /metric_interpretation/u);
  assert.match(source, /anthropic:web_search/u);
  assert.match(source, /COMMIT/u);
});
test("Worker context keeps the exact corpus and global Brand KB across briefs, assertions and sources", async () => {
  // Compile only the actual read-only loader. Importing the job module would
  // initialize its global Pool and provider SDKs, which this test never needs.
  const parsed=ts.createSourceFile('reader.ts',source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.TS);
  const reader=parsed.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='loadGovernedContext');
  const compact=parsed.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='compactText');
  assert.ok(reader&&compact);
  const js=ts.transpileModule(reader.getText(parsed)+'\n'+compact.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const uuid=(n:number)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
  const corpusA=uuid(1),corpusB=uuid(2),brand=uuid(3);
  const evidence=[{id:'a',brand,corpus:corpusA,content:'Evidence A'},{id:'b',brand,corpus:corpusB,content:'Evidence B'},
    {id:'global',brand,corpus:null,content:'Global Brand KB'},{id:'foreign',brand:'other',corpus:null,content:'Other brand KB'}];
  const queried:string[]=[];
  const queryable={async query(sql:string,values:unknown[]=[]){
    if(sql.includes('FROM brand_os_objectives')||sql.includes('FROM brand_os_audiences'))return{rows:[]};
    const kind=sql.includes('FROM brand_os_briefs')?'brief':sql.includes('FROM knowledge_assertions')?'assertion':'source';
    queried.push(kind);assert.deepEqual(values,[corpusA,brand]);
    if(kind==='brief')assert.match(sql,/brief\.study_corpus_id = \$1::uuid\s+OR \(\$2::uuid IS NOT NULL AND profile\.brand_id = \$2::uuid AND brief\.study_corpus_id IS NULL\)/u);
    else assert.match(sql,/source\.study_corpus_id = \$1::uuid\s+OR \(\$2::uuid IS NOT NULL AND source\.brand_id = \$2::uuid AND source\.study_corpus_id IS NULL\)/u);
    return{rows:evidence.filter(item=>item.corpus===values[0]||item.brand===values[1]&&item.corpus===null)
      .map(item=>({id:uuid(({brief:10,assertion:20,source:30}[kind])+evidence.indexOf(item)),title:item.id,content:item.content,raw_text:item.content,extracted_payload:{}}))};
  }};
  const load=new Function('pool','SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS','SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS','sha256',
    js+'\nreturn loadGovernedContext;')(queryable,SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_REFS,SIGNAL_TAXONOMY_INSIGHT_MAX_CONTEXT_CHARS,
    (value:string)=>`sha256:${createHash('sha256').update(value).digest('hex')}`) as
    (args:{packet:{study_corpus_id:string;brand_id:string}})=>Promise<SignalTaxonomyInsightContextRefV1[]>;
  const args={packet:{study_corpus_id:corpusA,brand_id:brand}};
  const first=await load(args);
  assert.deepEqual(queried,['brief','assertion','source']);
  assert.deepEqual(first.map(item=>item.source_id),[10,12,20,22,30,32].map(uuid));
  evidence[1]!.content='Changed corpus B';assert.deepEqual(await load(args),first);
  evidence[2]!.content='Changed global KB';assert.notDeepEqual(await load(args),first);
});
