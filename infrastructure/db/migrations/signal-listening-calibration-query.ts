/** Extract the deployed bounded SELECT for EXPLAIN without maintaining a copy
 * of the production query. This is a test-only format reader, not a SQL parser. */
export function extractSignalListeningCalibrationQueryV1(reader:{prosrc:string;lanname:string}):string{
 const fail=():never=>{throw Error('listening_calibration_query_format_unsupported');};
 if(typeof reader.prosrc!=='string'||!reader.prosrc.trim())return fail();
 const query=(sql:string)=>{if(!/^\s*(?:WITH|SELECT)\b/iu.test(sql))return fail();return sql;};
 if(reader.lanname==='sql')return query(reader.prosrc);
 if(reader.lanname!=='plpgsql')return fail();
 // There must be exactly one top-level bounded branch in the known reader.
 // Unknown/ambiguous future formats must not silently EXPLAIN another arm.
 if([...reader.prosrc.matchAll(/\bELSE\s+RETURN\s+QUERY\b/giu)].length!==1)return fail();
 const bounded=reader.prosrc.match(/\bELSE\s+RETURN\s+QUERY\s+([\s\S]+?);\s*END\s+IF\s*;\s*END\s*$/iu)?.[1];
 if(!bounded)return fail();
 if(!/^EXECUTE\b/iu.test(bounded))return query(bounded);
 const start=bounded.match(/^EXECUTE\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)/iu);
 if(!start)return fail();
 const tag=start[1]!,rest=bounded.slice(start[0].length),close=rest.indexOf(tag);
 // Dollar-quote tags are case-sensitive even though SQL keywords are not.
 if(close<0)return fail();
 const using=rest.slice(close+tag.length).match(/^\s+USING\s+([\s\S]+?)\s*$/iu)?.[1];
 if(!using)return fail();
 const names=using.split(',').map(name=>name.trim().toLowerCase());
 if(names.join(',')!=='w,cid,mid,ctx,roots,purpose')return fail();
 return query(rest.slice(0,close));
}
