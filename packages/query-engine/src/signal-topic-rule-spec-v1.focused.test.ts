import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileSignalTopicRuleSpecV1,parseSignalTopicRuleSpecV1,signalTopicRuleSpecDigestV1,
  SIGNAL_TOPIC_RULE_COMPILER_V1,SIGNAL_TOPIC_RULE_LIMITS_V1,type SignalTopicRuleSpecV1 }
  from "./signal-topic-rule-spec-v1";

const base=():SignalTopicRuleSpecV1=>({contract_version:"signal-topic-rule-spec-v1",kind:"topic",
  label:"Echo campaign",definition:"Mentions discussing the Echo football campaign.",
  lexical:{any:["Echo football","Alexa campaign"],all:["experience"],not:["customer service"]},
  filters:{languages:["en"],markets:["US"],scopes:["primary_brand"]}});

test("closed rule spec accepts explicit bounded fields and canonicalizes without mutating input",()=>{
  const input={...base(),label:" Echo campaign ",lexical:{any:[" Echo\t football ","Alexa campaign","Echo football"],
    all:["experience","experience"],not:["customer service"]},filters:{languages:["es","en","en"],
    markets:["US","MX","US"],scopes:["primary_brand","category","category"]}};
  const before=JSON.stringify(input),canonical=parseSignalTopicRuleSpecV1(input);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(canonical.lexical,{any:["Alexa campaign","Echo football"],all:["experience"],not:["customer service"]});
  assert.deepEqual(canonical.filters,{languages:["en","es"],markets:["MX","US"],scopes:["category","primary_brand"]});
  assert.equal(canonical.label,"Echo campaign");
  assert.deepEqual(parseSignalTopicRuleSpecV1(canonical),canonical,"canonicalization is idempotent");
});

test("any is OR, all is AND, not is AND NOT; all phrase content is parameterized",()=>{
  const compiled=compileSignalTopicRuleSpecV1(base());
  assert.deepEqual(compiled.values,["Alexa campaign","Echo football","experience","customer service",
    ["en"],["US"],["primary_brand"]]);
  assert.match(compiled.lexical_predicate,/phraseto_tsquery\('simple', \$1::text\)\) OR /u);
  assert.match(compiled.lexical_predicate,/AND \(\(to_tsvector/u);
  assert.match(compiled.lexical_predicate,/AND \(NOT \(to_tsvector/u);
  assert.match(compiled.lexical_predicate,/phraseto_tsquery\('simple', \$4::text\)/u);
  assert.equal(compiled.filter_predicate,
    "(COALESCE(eligible.language = ANY($5::text[]), FALSE) AND COALESCE(eligible.market = ANY($6::text[]), FALSE) AND COALESCE(eligible.scope = ANY($7::text[]), FALSE))");
  assert.equal(compiled.predicate,`(${compiled.filter_predicate} AND ${compiled.lexical_predicate})`);
  assert.doesNotMatch(compiled.predicate,/Echo|Alexa|experience|customer|US|primary_brand/u);
  assert.deepEqual([...compiled.predicate.matchAll(/eligible\.(\w+)/gu)].map((match)=>match[1])
    .filter((name,index,values)=>values.indexOf(name)===index).sort(),["language","market","scope","text_clean"]);
});

test("empty filters impose no restriction; an any-only or all-only positive phrase remains required",()=>{
  for(const lexical of[{any:["echo"],all:[],not:[]},{any:[],all:["echo","voice"],not:[]}]){
    const compiled=compileSignalTopicRuleSpecV1({...base(),lexical,filters:{languages:[],markets:[],scopes:[]}});
    assert.equal(compiled.filter_predicate,"TRUE");
    assert.deepEqual(compiled.values,lexical.any.length?lexical.any:lexical.all);
    assert.doesNotMatch(compiled.lexical_predicate,/TRUE|NOT/u);
  }
  for(const lexical of[{any:[],all:[],not:[]},{any:[],all:[],not:["spam"]}])
    assert.throws(()=>compileSignalTopicRuleSpecV1({...base(),lexical}),/positive_term_required/u);
});

test("every object level rejects unknown SQL, regex, code, model and arbitrary field inputs",()=>{
  const values=[{...base(),sql:"SELECT true"},{...base(),regex:".*"},{...base(),javascript:"return true"},
    {...base(),model_payload:{claude:"not a rule"}},{...base(),kind:"narrative"},
    {...base(),lexical:{...base().lexical,expression:"echo & voice"}},
    {...base(),filters:{...base().filters,column:"private_source"}},
    {...base(),filters:{...base().filters,raw_sql:"TRUE"}},
    {...base(),lexical:{any:[{literal:"echo"}],all:[],not:[]}},
    {...base(),contract_version:"signal-topic-rule-spec-v2"}];
  for(const value of values)assert.throws(()=>compileSignalTopicRuleSpecV1(value));
  for(const field of Object.keys(base())){
    const input={...base()}as Record<string,unknown>;delete input[field];
    assert.throws(()=>parseSignalTopicRuleSpecV1(input),field);
  }
  assert.throws(()=>parseSignalTopicRuleSpecV1({...base(),filters:{languages:[],markets:[]}}));
  assert.throws(()=>parseSignalTopicRuleSpecV1({...base(),lexical:{any:["echo"],all:[]}}));
});

test("SQL and tsquery metacharacters remain ordinary phrase values, not executable syntax",()=>{
  const literals=["echo'; DROP TABLE users; --","voice | camera:*","foo.*(bar)","O'Reilly",'"smart display"',"a \\ b"];
  for(const literal of literals){
    const compiled=compileSignalTopicRuleSpecV1({...base(),lexical:{any:[literal],all:[],not:[]},
      filters:{languages:[],markets:[],scopes:[]}});
    assert.deepEqual(compiled.values,[literal]);
    assert.doesNotMatch(compiled.predicate,/DROP|users|camera|O'Reilly|smart display|foo|bar|--/u);
    assert.match(compiled.predicate,/phraseto_tsquery\('simple', \$1::text\)/u);
    assert.doesNotMatch(compiled.predicate,/websearch_to_tsquery|\bto_tsquery\(|regexp|LIKE|ILIKE/u);
  }
});

test("nonword-only, control characters, malformed filters and all configured bounds fail closed",()=>{
  for(const term of[" ","| & ! () :*","😀",String.fromCharCode(0),"hello\u0000world","x".repeat(161)])
    assert.throws(()=>parseSignalTopicRuleSpecV1({...base(),lexical:{any:[term],all:[],not:[]}}));
  for(const value of[{...base(),label:"x".repeat(161)},{...base(),label:" "},{...base(),definition:"x".repeat(1501)},
    {...base(),definition:"\u0000"},
    {...base(),lexical:{any:Array.from({length:17},(_,i)=>`term ${i}`),all:[],not:[]}},
    {...base(),lexical:{any:Array(16).fill("a"),all:Array(16).fill("b"),not:["c"]}},
    {...base(),filters:{...base().filters,languages:Array(17).fill("en")}},
    {...base(),filters:{...base().filters,languages:["en-US"]}},
    {...base(),filters:{...base().filters,languages:["EN"]}},
    {...base(),filters:{...base().filters,markets:["us"]}},
    {...base(),filters:{...base().filters,markets:["USA"]}},
    {...base(),filters:{...base().filters,scopes:["global"]}}])assert.throws(()=>parseSignalTopicRuleSpecV1(value));
  assert.equal(SIGNAL_TOPIC_RULE_LIMITS_V1.total_terms,32);
  assert.equal(parseSignalTopicRuleSpecV1({...base(),lexical:{any:["漢字","niño","123"],all:[],not:[]}}).lexical.any.length,3);
});

test("canonical digest is stable across input ordering/dedup; lexical case and Unicode are not guessed",()=>{
  const spec=base(),first=compileSignalTopicRuleSpecV1(spec);
  const reordered={filters:{scopes:["primary_brand"],markets:["US"],languages:["en"]},
    lexical:{not:["customer service"],all:["experience"],any:["Alexa campaign","Echo football","Echo football"]},
    definition:spec.definition,label:spec.label,kind:spec.kind,contract_version:spec.contract_version};
  assert.equal(first.spec_digest,signalTopicRuleSpecDigestV1(reordered));
  assert.equal(first.plan_hash,compileSignalTopicRuleSpecV1(reordered).plan_hash);
  assert.match(first.spec_digest,/^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(first.spec_digest,compileSignalTopicRuleSpecV1({...spec,label:"Other label"}).spec_digest);
  const normalized=parseSignalTopicRuleSpecV1({...spec,lexical:{any:["Echo","echo","café","cafe\u0301","²","2"],all:[],not:[]}});
  assert.equal(normalized.lexical.any.length,6,"case/Unicode normalization stays with the declared PostgreSQL tokenizer");
  assert.equal(first.compiler_version,SIGNAL_TOPIC_RULE_COMPILER_V1);
  const {spec:ignoredSpec,spec_digest,compiler_version,predicate,filter_predicate,lexical_predicate,values}=first;
  assert.ok(ignoredSpec);
  const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:
    value!==null&&typeof value==="object"?`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(",")}}`:JSON.stringify(value);
  const expected=`sha256:${createHash("sha256").update(stable({spec_digest,compiler_version,predicate,filter_predicate,lexical_predicate,values})).digest("hex")}`;
  assert.equal(first.plan_hash,expected);
});

test("placeholder relocation is bounded, deterministic, preserves semantic plan hash and leaves no unbound parameters",()=>{
  const first=compileSignalTopicRuleSpecV1(base()),relocated=compileSignalTopicRuleSpecV1(base(),{placeholderOffset:3});
  assert.equal(first.spec_digest,relocated.spec_digest);assert.equal(first.plan_hash,relocated.plan_hash);
  assert.deepEqual(first.values,relocated.values);
  const placeholders=[...new Set([...relocated.predicate.matchAll(/\$(\d+)/gu)].map((match)=>Number(match[1])))].sort((a,b)=>a-b);
  assert.deepEqual(placeholders,[4,5,6,7,8,9,10]);
  assert.equal(relocated.predicate,first.predicate.replace(/\$(\d+)/gu,(_whole,index:string)=>`$${Number(index)+3}`));
  for(const offset of[-1,0.5,NaN,Infinity,1001,"3",null])
    assert.throws(()=>compileSignalTopicRuleSpecV1(base(),{placeholderOffset:offset}as never));
  assert.throws(()=>compileSignalTopicRuleSpecV1(base(),{placeholderOffset:0,alias:"evil"}as never));
  assert.match(compileSignalTopicRuleSpecV1(base(),{placeholderOffset:1000}).predicate,/\$1001/u);
});

test("compiler is exported as a pure candidate-trial compiler with no execution/transport/adoption dependencies",async()=>{
  const [source,index]=await Promise.all([
    readFile(new URL("./signal-topic-rule-spec-v1.ts",import.meta.url),"utf8"),
    readFile(new URL("./index.ts",import.meta.url),"utf8")]);
  assert.match(index,/export \* from "\.\/signal-topic-rule-spec-v1"/u);
  assert.doesNotMatch(source,/fetch\(|process\.env|\.query\(|new Pool|Anthropic|supabase|execute\(/u);
  assert.match(source,/NOT a regex/u);assert.match(source,/semantic assignment or gold label/u);
});
