/** Stamp complete audit evidence before serializing the final artifact. */
export function serializeStandardV2ReportV1(report:{raw_audit:Record<string,unknown>;[key:string]:unknown},globalCallDelta:number){
 if(!Number.isSafeInteger(globalCallDelta))throw new Error('mfp_standard_global_call_delta_invalid');
 return JSON.stringify({...report,raw_audit:{...report.raw_audit,global_non_experiment_call_delta:globalCallDelta}},null,2)+'\n';
}
