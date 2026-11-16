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
