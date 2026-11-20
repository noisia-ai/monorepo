// Test-only counterpart of the typed PL/pgSQL EXECUTE USING arguments. node-pg
// otherwise sends unknown parameter OIDs, including polymorphic JSON slots.
export const listeningStatementOracleParameterTypesV1=['uuid','uuid','uuid','uuid','text','uuid[]','text','jsonb']as const;
export function anchorListeningStatementOracleParametersV1(sql:string):string{
 if(!/^\s*WITH\b/u.test(sql)||/\br16_oracle_parameter_types\b/u.test(sql))throw new Error('listening_oracle_query_shape');
 const types=listeningStatementOracleParameterTypesV1.map((type,n)=>'$'+(n+1)+'::'+type+' AS p'+(n+1)).join(',');
 // Parsing this unused, side-effect-free CTE supplies all OIDs. The original
 // CTEs, SELECT and result flags remain unchanged; no public function is edited.
 return 'WITH r16_oracle_parameter_types AS (SELECT '+types+'),'+sql.replace(/^\s*WITH\b/u,'');
}

// Values actually consumed by the two expected-row validations, plus call ID
// for multiplicity/lineage assertions. The source CTE may carry extra fields.
export const listeningExpectedOracleColumnsV1=['id','request','request_digest','i','selected_count','digests','basis','expected_request']as const;
export function listeningExpectedProjectionOracleSqlV1(validation:string,json=false){
 const end=validation.indexOf('\n   SELECT COALESCE(');
 if(end<0)throw Error('listening_oracle_expected_shape');
 const projection='SELECT '+listeningExpectedOracleColumnsV1.map(name=>'e.'+name).join(',')+' FROM expected e';
 // Keep the JSON representation as SQL text: parsing it in JS would round
 // high-precision numeric values nested inside a native JSONB input.
 const result=json?'SELECT to_jsonb(p)::text value FROM ('+projection+') p ORDER BY p.id':projection+' ORDER BY e.id';
 return anchorListeningStatementOracleParametersV1(validation.slice(0,end)+'\n'+result);
}
