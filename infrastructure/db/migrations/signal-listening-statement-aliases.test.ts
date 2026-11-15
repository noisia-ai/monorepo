import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

// PostgreSQL binds PL/pgSQL statements at first execution, so CREATE FUNCTION
// alone does not detect a composite variable sharing a SQL relation alias.
// Native insert/mark coverage remains in signal-listening-money-batches.
const source=await readFile(new URL('./0318_signal_listening_statement_population.sql',import.meta.url),'utf8');
function collisions(sql:string){
 const result:string[]=[];
 const functions=[...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+)\([^]*?\bAS \$\$([^]*?)END \$\$;/gu)];
 for(const [,name,body]of functions){
  const declaration=/\bDECLARE([^]*?)\bBEGIN/u.exec(body!)?.[1];
  if(!declaration)continue;
  const locals=new Set(declaration.split(';').map(part=>/^\s*(\w+)\s+/u.exec(part)?.[1]).filter(Boolean));
  // Dynamic SQL is a different SQL namespace; quoted bodies are not parsed as
  // PL/pgSQL expressions and must not produce a false collision here.
  const statements=body!.replace(/\$(\w+)\$[^]*?\$\1\$/gu,' ').replace(/'(?:''|[^'])*'/gu,' ').replace(/--[^\n]*/gu,' ');
  for(const [,relation,alias]of statements.matchAll(/\b(?:FROM|JOIN)\s+(\w+(?:\.\w+)?)(?:\([^;]*?\))?\s+(?:AS\s+)?(\w+)/giu)){
   if(locals.has(alias))result.push(`${name}: ${relation} alias ${alias} shadows a local variable`);
  }
 }
 return{functions:functions.map(match=>match[1]),collisions:result};
}
test('0318 static SQL relation aliases never shadow PL/pgSQL local variables',()=>{
 const checked=collisions(source);assert.equal(checked.functions.length,4);
 assert.deepEqual(checked.collisions,[]);
});
test('alias regression detects both first-use trigger branches while ignoring dynamic SQL',()=>{
 const bad=source.replaceAll('signal_listening_runs call_owner ON call_owner.','signal_listening_runs owner ON owner.').replaceAll('AND call_owner.workspace_id=n.workspace_id','AND owner.workspace_id=n.workspace_id');
 assert.equal(collisions(bad).collisions.filter(value=>value.startsWith('signal_listening_statement_money_v1:')).length,2);
 const dynamic="CREATE FUNCTION dynamic_only() RETURNS void LANGUAGE plpgsql AS $$ DECLARE owner record; BEGIN EXECUTE 'SELECT n.* FROM signal_listening_runs owner'; END $$;";
 assert.deepEqual(collisions(dynamic).collisions,[]);
});
