import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {assertColdListeningDiagnosticEnvironmentV1,coldListeningDiagnosticModeV1,extractColdListeningFullArmV1} from './cold-listening-plan-diagnostic.mjs';
const env={GITHUB_ACTIONS:'true',NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',NOISIA_R16_NATIVE_FIXTURE_PG:'true',NOISIA_SIGNAL_LISTENING_ENABLED:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/noisia_mfp_ci'};
test('cold-plan command requires separate real CI ownership; environment syntax cannot accredit a Pool',()=>{
 assert.doesNotThrow(()=>assertColdListeningDiagnosticEnvironmentV1(env));
 for(const delta of [{GITHUB_ACTIONS:'false'},{NOISIA_R16_LOCAL_PG_LAB:'r16-durable-pages-pg17'},
  {NOISIA_R16_NATIVE_FIXTURE_PG:'false'},{NOISIA_SIGNAL_LISTENING_ENABLED:'false'},
  {DATABASE_URL:'postgresql://postgres:synthetic@remote.invalid:5432/noisia_mfp_ci'},
  {DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:51772/preserved_archive'},
  {ANTHROPIC_API_KEY:'synthetic-but-forbidden'},{TYPESAFE_API_KEY:'synthetic-but-forbidden'},{VOYAGE_API_KEY:'synthetic-but-forbidden'}]){
  assert.throws(()=>assertColdListeningDiagnosticEnvironmentV1({...env,...delta}));
 }
});
test('1002 control is explicit and 32768 stops before any full quote or row census',()=>{
 assert.equal(coldListeningDiagnosticModeV1(1002),'controlled_before_after_analyze');
 assert.equal(coldListeningDiagnosticModeV1(32768),'plan_only_before_quote');
 for(const n of [0,3,1000,1003,32769,NaN])assert.throws(()=>coldListeningDiagnosticModeV1(n));
});
test('EXPLAIN extracts the actual full arm and only annotates native parameter types',async()=>{
 const source=await readFile(new URL('../../infrastructure/db/migrations/0315_signal_listening_population_lexical_plan.sql',import.meta.url),'utf8');
 const extract=(value:string)=>value.split('RETURN QUERY EXECUTE $population$')[1]!.split('$population$ USING')[0]!.trim();
 const original=extract(source),typed=extractColdListeningFullArmV1(source).trim();
 // Remove only our added annotations: the SQL body and every predicate remain.
 const positions=[...original.matchAll(/\$([1-6])(?![0-9:]|\s*::)/gu)];let offset=0;let expected=original;
 const types=['uuid','uuid','uuid','text','uuid[]','text'];
 for(const position of positions){const at=position.index!+offset+position[0].length,cast='::'+types[Number(position[1])-1];expected=expected.slice(0,at)+cast+expected.slice(at);offset+=cast.length;}
 assert.equal(typed,expected);assert.ok(typed.includes('$5::uuid[] IS NULL'));assert.ok(!typed.includes('::uuid::uuid'));
 assert.throws(()=>extractColdListeningFullArmV1('SELECT 1'),/full_arm_unrecognized/);
});
