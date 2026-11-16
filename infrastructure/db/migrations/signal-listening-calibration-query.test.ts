import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {extractSignalListeningCalibrationQueryV1 as extract} from './signal-listening-calibration-query';
const migrationBody=async(name:string)=>{
 const sql=await readFile(new URL(name,import.meta.url),'utf8');
 const body=sql.match(/AS \$function\$([\s\S]+?)\$function\$;/u)?.[1];
 assert.ok(body,'the fixture must read the actual migration body');return body;
};
for(const [name,dynamic] of [
 ['0317_signal_listening_bounded_provenance_plan.sql',false],
 ['0321_signal_listening_bounded_custom_plan.sql',true],
 ['0326_signal_listening_final_answer_slice.sql',true],
] as const)test('extracts the actual bounded SQL bytes from '+name,async()=>{
 const prosrc=await migrationBody(name),actual=extract({prosrc,lanname:'plpgsql'});
 const start=dynamic?'RETURN QUERY EXECUTE $bounded$':'ELSE\n  RETURN QUERY\n';
 const first=prosrc.indexOf(start);assert.ok(first>=0);
 const from=first+start.length,to=dynamic?prosrc.indexOf('$bounded$ USING w,cid,mid,ctx,roots,purpose;',from):prosrc.lastIndexOf(';\n END IF;');
 assert.ok(to>from);assert.equal(actual,prosrc.slice(from,to));
 assert.match(actual,/^\s*WITH eligible_batches AS MATERIALIZED/u);
 assert.match(actual,/signal_mass_labeling_items/u);
 assert.ok(!actual.includes('RETURN QUERY'));assert.ok(!actual.includes('$bounded$'));
 assert.notEqual(actual,prosrc,'the full-population arm must not enter the native index proof');
});
test('supports historical SQL and static PL/pgSQL without changing named arguments',()=>{
 const sql='SELECT w,cid,mid,ctx,roots,purpose';assert.equal(extract({prosrc:sql,lanname:'sql'}),sql);
 const body='BEGIN IF roots IS NULL THEN RETURN QUERY EXECUTE $population$SELECT 1$population$ USING w,cid,mid,ctx,roots,purpose; ELSE RETURN QUERY '+sql+'; END IF; END';
 assert.equal(extract({prosrc:body,lanname:'plpgsql'}),sql);
});
test('requires matching case-sensitive tags and all six native USING names in order',async()=>{
 const original=await migrationBody('0326_signal_listening_final_answer_slice.sql');
 const invalid=[
  original.replace('$bounded$ USING','$other$ USING'),
  original.replace('$bounded$ USING','$Bounded$ USING'),
  original.replace('USING w,cid,mid,ctx,roots,purpose;\n END IF;','USING cid,w,mid,ctx,roots,purpose;\n END IF;'),
  original.replace('USING w,cid,mid,ctx,roots,purpose;\n END IF;','USING w,cid,mid,ctx,roots;\n END IF;'),
  original.replace('USING w,cid,mid,ctx,roots,purpose;\n END IF;','USING w,cid,mid,ctx,roots,purpose,other;\n END IF;'),
  original.replace('USING w,cid,mid,ctx,roots,purpose;\n END IF;','USING w,cid,mid,ctx,roots,purpose::text;\n END IF;'),
  original.replace('$bounded$ USING w,cid,mid,ctx,roots,purpose;','$bounded$;'),
  original.replace('RETURN QUERY EXECUTE $bounded$','RETURN QUERY EXECUTE format($bounded$'),
 ];
 for(const prosrc of invalid)assert.throws(()=>extract({prosrc,lanname:'plpgsql'}),/format_unsupported/);
 const retagged=original.replaceAll('$bounded$','$bounded_2$');
 assert.equal(extract({prosrc:retagged,lanname:'plpgsql'}),extract({prosrc:original,lanname:'plpgsql'}));
});
test('fails closed for missing, ambiguous, unknown-language and nonquery bodies',()=>{
 for(const reader of [
  {prosrc:'',lanname:'sql'},{prosrc:'SELECT 1',lanname:'plpgsql'},
  {prosrc:'SELECT 1',lanname:'plpython3u'},{prosrc:'BEGIN ELSE RETURN QUERY UPDATE x SET y=1; END IF; END',lanname:'plpgsql'},
  {prosrc:'BEGIN ELSE RETURN QUERY SELECT 1; ELSE RETURN QUERY SELECT 2; END IF; END',lanname:'plpgsql'},
  {prosrc:'BEGIN ELSE RETURN NEXT 1; END IF; END',lanname:'plpgsql'},
 ])assert.throws(()=>extract(reader),/format_unsupported/);
});
test('retains tagged SQL bytes while allowing native keyword and USING whitespace',()=>{
 const sql="\n SELECT $1::uuid, $5::uuid[], 'USING is SQL text'\n";
 const prosrc='BEGIN IF roots IS NULL THEN RETURN QUERY SELECT 1; ELSE return query execute $$'+sql+'$$ using W, CID, MID, CTX, ROOTS, PURPOSE; END IF; END';
 assert.equal(extract({prosrc,lanname:'plpgsql'}),sql);
});
