import {invertSignalListeningSurveyReaderV1,assertSurveyReaderNegativeFixturesV1,restoreSignalListeningSurveyBeforeLinearV1} from './signal-listening-survey-source-chain.test-support';
import {invertWirePopulationMetadataV1} from './signal-listening-wire-population.oracle';
import assert from 'node:assert/strict';
import test from 'node:test';
import {invertCompactListeningRunsV1} from './signal-listening-compact-population.oracle';
import {readFile} from 'node:fs/promises';
import {projectionMetadataBeforeLinearJoinsV1,projectionBeforeRawSha256V1,projectionBeforeNormalizedSha256V1,projectionSurveyConditionalShaV1,projectionSurveyConditionalBeforeLinearShaV1,projectionSurveyMetadataBeforeLinearV1,projectionSurveyBeforeLinearRawShaV1,assertProjectionSurveyLinearPlanV1,projectionShaV1,projectionHelperPartsV1,unchangedSourcePartsV1,assertProjectionLinearPlanV1,sanitizeProjectionLinearPlanV1,type ProjectionPlanV1} from './signal-listening-projection-linear-joins.oracle';
import {assertCompiler21006NegativeFixturesV1,invertSignalListeningCompiler21006V1} from './signal-listening-compiler-source-chain.test-support';
const listeningChangeOnlyContextLineV1="  context_registration:'change_only',\n";
function assertProjectionSuffixAfterListeningContextOptInV1(compactSuffix:string){
 // First recover baseline T using only the two compact calls and cost formula.
 // Then retain the historical CE38 inverse and complete suffix hash below.
 const suffix=invertCompactListeningRunsV1(compactSuffix);
 // The separately reviewed Listening adapter opt-in is outside the projection
 // helper. Invert only that exact addition, retaining the original suffix hash.
 const at=suffix.indexOf(listeningChangeOnlyContextLineV1+"  policy_action:'mass_labeling_jev',feature:'mass_labeling',select_labeler:false,\n");
 assert.ok(at>=0,'Listening change-only opt-in must precede its original policy fields');
 assert.equal(suffix.indexOf(listeningChangeOnlyContextLineV1),at,'one literal Listening context opt-in is required');
 assert.equal(suffix.lastIndexOf(listeningChangeOnlyContextLineV1),at,'duplicate Listening context opt-ins are forbidden');
 const previous=suffix.slice(0,at)+suffix.slice(at+listeningChangeOnlyContextLineV1.length);
 assert.equal(projectionShaV1(previous),unchangedSourcePartsV1.suffix,'removing only the registered opt-in must recover the complete frozen suffix');
}
test('linear join oracle freezes complete a883 nine-bind query with exact raw98e48 and observed623e identities',()=>{
 assert.equal(projectionShaV1(projectionMetadataBeforeLinearJoinsV1),projectionBeforeRawSha256V1);
 assert.equal(projectionShaV1(projectionMetadataBeforeLinearJoinsV1.replace(/\s+/g,' ').trim()),projectionBeforeNormalizedSha256V1);
 assert.equal(Math.max(...[...projectionMetadataBeforeLinearJoinsV1.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]))),9);
});
test('linear join candidate changes only two bounded projection joins beyond materialized barriers',async()=>{
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 const beforeSurvey=invertSignalListeningSurveyReaderV1(source),parts=projectionHelperPartsV1(invertSignalListeningCompiler21006V1(invertWirePopulationMetadataV1(beforeSurvey)));
 for(const key of ['prefix','helperOutsideSql'] as const)assert.equal(projectionShaV1(parts[key]),unchangedSourcePartsV1[key]);
 assertProjectionSuffixAfterListeningContextOptInV1(parts.suffix);
 assert.ok(parts.sql.includes('fit_matches AS MATERIALIZED('));assert.ok(parts.sql.includes('projection_rows AS MATERIALIZED('));
 assert.ok(parts.sql.includes('FROM pending p FULL JOIN fitting f ON f.root_id=p.root_id'));
 assert.ok(parts.sql.includes('FROM fit_matches p WHERE p.root_id IS NOT NULL AND p.fitting_root_id IS NOT NULL AND p.n<=256'));
 assert.ok(parts.sql.includes('FROM prefix FULL JOIN projections ON projections.root_id=prefix.root_id'));
 assert.ok(parts.sql.includes('FROM projection_rows WHERE root_id IS NOT NULL ORDER BY root_id'));
 assert.ok(parts.sql.includes('NOT signal_listening_human_decision_exists_v1('),'public EXISTS helper remains literal');
 assert.ok(!/human_revision|human_decisions|CREATE INDEX|SET LOCAL|force_hash|SECURITY DEFINER/.test(parts.sql));
 const start=parts.sql.indexOf('   fit_matches AS MATERIALIZED('),end=parts.sql.lastIndexOf('ORDER BY root_id')+'ORDER BY root_id'.length;assert.ok(start>=0&&end>start);
 const previous=projectionMetadataBeforeLinearJoinsV1.slice(projectionMetadataBeforeLinearJoinsV1.indexOf('   projections AS MATERIALIZED('));
 assert.equal(parts.sql.slice(0,start)+previous,projectionMetadataBeforeLinearJoinsV1,'every clause before the two join changes is literal');
});
test('projection source chain rejects missing, duplicate, moved or altered context opt-ins and unrelated suffix edits',async()=>{
 const current=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),beforeSurvey=invertSignalListeningSurveyReaderV1(current);assertSurveyReaderNegativeFixturesV1(current);assertCompiler21006NegativeFixturesV1(beforeSurvey);
 const {suffix}=projectionHelperPartsV1(invertSignalListeningCompiler21006V1(invertWirePopulationMetadataV1(beforeSurvey)));
 assertProjectionSuffixAfterListeningContextOptInV1(suffix);
 const unrelatedNeedle=' const limit=options.page_size??200;';assert.equal(current.split(unrelatedNeedle).length-1,1);
 const unrelated=current.replace(unrelatedNeedle,' const limit=options.page_size??201;');
 assert.throws(()=>assertProjectionSuffixAfterListeningContextOptInV1(projectionHelperPartsV1(invertSignalListeningCompiler21006V1(invertWirePopulationMetadataV1(invertSignalListeningSurveyReaderV1(unrelated)))).suffix),
  'unrelated runtime edit survives compiler inverse and fails the frozen suffix hash');
 const without=suffix.replace(listeningChangeOnlyContextLineV1,'');
 for(const [name,changed] of [
  ['missing',without],
  ['duplicate',suffix.replace(listeningChangeOnlyContextLineV1,listeningChangeOnlyContextLineV1.repeat(2))],
  ['moved',without+listeningChangeOnlyContextLineV1],
  ['altered',suffix.replace(listeningChangeOnlyContextLineV1,"  context_registration:'always',\n")],
  ['unrelated suffix edit',suffix+'\n'],
 ] as const){
  assert.notEqual(changed,suffix,`${name} fixture must change the real source`);
  assert.throws(()=>assertProjectionSuffixAfterListeningContextOptInV1(changed),name);
 }
});
test('projection parser selects actual reviewed legacy/survey SQL and rejects unknown or altered interpolations',async()=>{
 const current=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),previous=invertSignalListeningSurveyReaderV1(current);
 const legacy=projectionHelperPartsV1(current).sql,survey=projectionHelperPartsV1(current,'survey').sql,old=projectionHelperPartsV1(previous).sql;
 const before='   ), prefix AS MATERIALIZED(',after='   )  , prefix AS MATERIALIZED(';
 assert.equal(old.split(before).length,2);assert.equal(legacy,old.replace(before,after),'the actual legacy SQL changes only the registered conditional-boundary whitespace');
 assert.equal(projectionShaV1(legacy),'e0e77f33997b8607a83acdb505a14576520964ef9807ef4edc1d8deca16f84d2');
 assert.equal(projectionShaV1(survey),'739613a2fceb44f3c00aa9b8b114efe3fd81a6bd76975841cc725773a2419e24');
 assert.ok(survey.includes('survey_state_bytes AS MATERIALIZED('));assert.ok(survey.includes('FROM survey_state_bytes ORDER BY root_id'));
 assert.ok(!legacy.includes('survey_state_bytes'));assert.ok(legacy.includes('fit_matches AS MATERIALIZED('));
 for(const sql of[legacy,survey]){assert.ok(!sql.includes('${'));assert.equal(Math.max(...[...sql.matchAll(/\$(\d+)/gu)].map(match=>Number(match[1]))),9);}
 assert.equal(projectionSurveyConditionalShaV1,'286feb6391f173c80a079d3edfa339e5d981e4939fd437879f78f0c9cae2fe52');
 assert.throws(()=>projectionHelperPartsV1(previous,'survey'),'historical source cannot silently impersonate survey SQL');
 const projectionStart=current.indexOf('async function inputProjectionMetadata(');assert.ok(projectionStart>=0);
 const mutateProjection=(before:string,after:string)=>current.slice(0,projectionStart)+current.slice(projectionStart).replace(before,after);
 const unknown=mutateProjection('p.body_octets::bigint','${notReviewed}');
 for(const selection of['legacy','survey']as const){
  assert.throws(()=>projectionHelperPartsV1(unknown,selection),/unknown interpolation/);
  for(const mutation of[mutateProjection('c.query<ListeningInputProjectionRowV1&{state_json_bytes?:string}>','c.query<UnknownProjectionRow>'),
   mutateProjection('survey_state_bytes AS MATERIALIZED(','survey_state_bytes AS NOT MATERIALIZED('),
   mutateProjection('FROM projection_rows WHERE root_id IS NOT NULL ORDER BY root_id`}', 'FROM projection_rows WHERE root_id IS NULL ORDER BY root_id`}'),
   mutateProjection('${selection.survey?`','${otherSelection?`'),mutateProjection('${noHumanDecision}','${noHumanDecision} ${noHumanDecision}')]){
   assert.notEqual(mutation,current);assert.throws(()=>projectionHelperPartsV1(mutation,selection),'both branches and known interpolation counts remain closed');
  }
 }
});
test('survey linear source chain preserves exact Source1dd and its independent complete survey query',async()=>{
 const current=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),previous=restoreSignalListeningSurveyBeforeLinearV1(current);
 assert.equal(projectionShaV1(previous),'017203dd09945b8b41a160d1596306b3017b6d316634be73df5bbe9c62cfceb7','linear inverse restores EVERY Source1dd runtime byte');
 assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),projectionSurveyBeforeLinearRawShaV1);
 assert.equal(projectionSurveyBeforeLinearRawShaV1,'275ecac70aae04661a936a7c152c59a530ddb831ac1fb3ace81197d005f64758');
 const start=previous.indexOf('${selection.survey?`'),stop=previous.indexOf('`}',start);assert.ok(start>=0&&stop>start);
 assert.equal(projectionShaV1(previous.slice(start,stop+2)),projectionSurveyConditionalBeforeLinearShaV1);
 assert.equal(projectionSurveyConditionalBeforeLinearShaV1,'4c14b89470b35063ebaae014a5562d470076cb6552292f581a82a7c89a861d0b');
 assert.throws(()=>projectionHelperPartsV1(previous,'survey'),'the historical survey conditional cannot impersonate the current graph');
 assertSurveyReaderNegativeFixturesV1(current);
 const sql=projectionHelperPartsV1(current,'survey').sql;
 for(const fragment of ['FROM pending p FULL JOIN survey_fitting fitting ON fitting.root_id=p.root_id',
  'FROM survey_fit_matches p WHERE p.root_id IS NOT NULL AND p.fitting_root_id IS NOT NULL AND p.n<=256',
  'FROM survey_prefix prefix FULL JOIN survey_projection projection ON projection.root_id=prefix.root_id',
  'CASE WHEN metadata.cumulative_bytes<=$9::numeric THEN octet_length(to_json(item.text)::text)::text END state_json_bytes',
  'FROM survey_state_bytes ORDER BY root_id'])assert.ok(sql.includes(fragment),fragment);
 assert.ok(!sql.includes('LEFT JOIN survey_projection'));assert.ok(!sql.includes('JOIN survey_state_bytes encoded'));
});
type R={root:string|null;input?:string;n?:number;key?:string};
function join<L,R>(left:L[],right:R[],on:(l:L,r:R)=>boolean,full=false):Array<[L|null,R|null]>{const seen=new Set<number>(),out:Array<[L|null,R|null]>=[];for(const l of left){let matched=false;right.forEach((r,i)=>{if(on(l,r)){matched=true;seen.add(i);out.push([l,r]);}});if(!matched)out.push([l,null]);}if(full)right.forEach((r,i)=>{if(!seen.has(i))out.push([null,r]);});return out;}
const same=(a:R,b:R)=>a.root!==null&&b.root!==null&&a.root===b.root;
const bag=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)).sort();
test('FULL barrier postfilters preserve inner and left bags including NULLs, unmatched rows and duplicate identities',()=>{
 const pending:R[]=[{root:'a',input:'i',n:1,key:'x'},{root:'a',input:'i',n:2,key:'y'},{root:'a',input:'different-digest',n:1,key:'z'},{root:'b',input:'j',n:257,key:'x'},{root:null,input:'z',n:1,key:'null'}];
 for(const p of [pending,pending.slice(0,1),[]])for(const fitting of [[{root:'a'},{root:'a'},{root:'unmatched'},{root:null}],[]]){
  const original=join(p,fitting,same).filter(([l,r])=>l!==null&&r!==null&&l.n!<=256);
  const barrier=join(p,fitting,same,true).filter(([l,r])=>l?.root!=null&&r?.root!=null&&l.n!<=256);assert.deepEqual(bag(barrier),bag(original));
 }
 const prefix=[{root:'a',bytes:'8192'},{root:'a',bytes:'8192'},{root:'b',bytes:'9000'}],projections=[{root:'a',keys:['x','y']},{root:'a',keys:['x','y']},{root:'unmatched',keys:[]}];
 const left=join(prefix,projections,same),full=join(prefix,projections,same,true).filter(([l])=>l?.root!=null);assert.deepEqual(bag(full),bag(left));
 assert.ok(full.some(([l,r])=>l?.root==='b'&&r===null),'non-fitting sentinel remains a left row with NULL projection');
});
function plan(loops=1):ProjectionPlanV1{return{'Node Type':'Sort',Plans:[{'Node Type':'Hash Join','Join Type':'Full','Subplan Name':'CTE fit_matches','Actual Loops':loops,Plans:[{'Node Type':'CTE Scan','CTE Name':'fitting','Actual Loops':loops,'Actual Rows':4096}]},{'Node Type':'Merge Join','Join Type':'Full','Subplan Name':'CTE projection_rows','Actual Loops':loops,Plans:[{'Node Type':'CTE Scan','CTE Name':'projections','Actual Loops':loops,'Actual Rows':4096}]}]};}
test('plan oracle rejects rescans and reduced joins, records zero as zero and strips SQL predicates',()=>{
 assertProjectionLinearPlanV1(plan());const zero=assertProjectionLinearPlanV1(plan(0));assert.equal(zero.scans.fitting![0]!['Actual Loops'],0);
 assert.throws(()=>assertProjectionLinearPlanV1(plan(2)));const reduced=plan();reduced.Plans![0]!['Join Type']='Left';assert.throws(()=>assertProjectionLinearPlanV1(reduced));
 const hidden=plan();hidden['Filter']='private SQL/bind';hidden['Query Text']='private SQL';hidden.Plans![0]!['Hash Cond']='private identifier';const clean=sanitizeProjectionLinearPlanV1(hidden);assert.ok(!JSON.stringify(clean).includes('private'));
});

function surveyPlan(loops=1):ProjectionPlanV1{return{'Node Type':'Sort',Plans:[
 {'Node Type':'Hash Join','Join Type':'Full','Subplan Name':'CTE survey_fit_matches','Actual Loops':loops,Plans:[{'Node Type':'CTE Scan','CTE Name':'survey_fitting','Actual Loops':loops}]},
 {'Node Type':'Hash Join','Join Type':'Full','Subplan Name':'CTE survey_projection_rows','Actual Loops':loops,Plans:[{'Node Type':'CTE Scan','CTE Name':'survey_projection','Actual Loops':loops}]},
 {'Node Type':'Nested Loop','Subplan Name':'CTE survey_state_bytes','Actual Loops':loops,Plans:[{'Node Type':'CTE Scan','CTE Name':'survey_projection_rows','Actual Loops':loops},
  {'Node Type':'Index Scan','Relation Name':'signal_mass_labeling_items','Actual Loops':4096}]},
 {'Node Type':'CTE Scan','CTE Name':'survey_state_bytes','Actual Loops':loops}]};}
test('survey plan oracle rejects materialized rescans, missing scans and reduced barriers but permits proportional indexed item probes',()=>{
 assertProjectionSurveyLinearPlanV1(surveyPlan());assert.equal(assertProjectionSurveyLinearPlanV1(surveyPlan(0)).scans.survey_fitting![0]!['Actual Loops'],0);
 assert.throws(()=>assertProjectionSurveyLinearPlanV1(surveyPlan(2)));
 const missing=surveyPlan();missing.Plans!.pop();assert.throws(()=>assertProjectionSurveyLinearPlanV1(missing));
 const reduced=surveyPlan();reduced.Plans![0]!['Join Type']='Left';assert.throws(()=>assertProjectionSurveyLinearPlanV1(reduced));
 const rescan=surveyPlan();rescan.Plans!.push({'Node Type':'CTE Scan','CTE Name':'pending','Actual Loops':4096});assert.throws(()=>assertProjectionSurveyLinearPlanV1(rescan));
});
