export type HybridRightsPlanV1={"Index Cond"?:string;"Subplan Name"?:string;Plans?:HybridRightsPlanV1[];[key:string]:unknown};
export const HYBRID_RIGHTS_DIAGNOSTIC_TABLES_V1=[
 "mentions","signal_labeling_calls","signal_mention_import_memberships","import_batches",
 "signal_provenance_policy_bindings","signal_licensing_policies","signal_retention_policies","signal_licensing_policy_usages",
] as const;
export const HYBRID_RIGHTS_DIAGNOSTIC_SETTINGS_V1=[
 "statement_timeout","lock_timeout","plan_cache_mode","jit","jit_above_cost","jit_inline_above_cost","jit_optimize_above_cost",
 "work_mem","effective_cache_size","random_page_cost","seq_page_cost","cpu_tuple_cost","cpu_index_tuple_cost","cpu_operator_cost",
 "default_statistics_target","max_parallel_workers_per_gather","enable_seqscan","enable_indexscan","enable_indexonlyscan",
 "enable_bitmapscan","enable_nestloop","enable_hashjoin","enable_mergejoin","enable_material","enable_memoize","join_collapse_limit","from_collapse_limit",
] as const;
const fields=[
 ["node_type","Node Type"],["relation","Relation Name"],["alias","Alias"],["index","Index Name"],
 ["parent_relationship","Parent Relationship"],["subplan","Subplan Name"],["cte","CTE Name"],["join_type","Join Type"],["inner_unique","Inner Unique"],
 ["index_cond","Index Cond"],["recheck_cond","Recheck Cond"],["filter","Filter"],["join_filter","Join Filter"],["hash_cond","Hash Cond"],["merge_cond","Merge Cond"],
 ["plan_rows","Plan Rows"],["plan_width","Plan Width"],["actual_rows","Actual Rows"],["actual_loops","Actual Loops"],
 ["startup_cost","Startup Cost"],["total_cost","Total Cost"],["actual_startup_ms","Actual Startup Time"],["actual_total_ms","Actual Total Time"],
 ["shared_hit_blocks","Shared Hit Blocks"],["shared_read_blocks","Shared Read Blocks"],["temp_read_blocks","Temp Read Blocks"],["temp_written_blocks","Temp Written Blocks"],
] as const;
export function redactHybridRightsDiagnosticV1(value:string){
 return value.replace(/'(?:[^']|'')*'/gu,"'<literal>'")
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,"<uuid>");
}
/** Emit scalar allowlisted fields only. Raw Output/Settings/expressions outside
 * this list never reach logs; paths preserve nesting without exposing row IDs. */
export function projectHybridRightsPlanDiagnosticV1(plan:HybridRightsPlanV1){
 const result:Array<Record<string,string|number|boolean|null>>=[];
 const visit=(node:HybridRightsPlanV1,path:string,parent:string|null)=>{
  const row:Record<string,string|number|boolean|null>={path,parent_path:parent};
  for(const [output,input] of fields){const value=node[input];
   if(typeof value==='string')row[output]=redactHybridRightsDiagnosticV1(value);
   else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))row[output]=value;
  }
  result.push(row);node.Plans?.forEach((child,index)=>visit(child,path+'.'+index,path));
 };
 visit(plan,"root",null);return result;
}
