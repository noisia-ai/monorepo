export class WorkspaceAsyncImportError extends Error {
  constructor(public readonly code:string,public readonly status:number){
    super(code);this.name="WorkspaceAsyncImportError";
  }
}

export function resolveWorkspaceImportRevisionModeV1(args:{
  contentRevisionMode?:"append_only"|"revise_existing";
  access?:"manual-import";
  mfpWorkspaceEnabled?:boolean;
  acquisition?:unknown;
  supersedesImportBatchId?:string|null;
},env:Record<string,string|undefined>=process.env):"append_only"|"revise_existing"{
  const mode=args.contentRevisionMode??"append_only";
  if(!["append_only","revise_existing"].includes(mode))throw new WorkspaceAsyncImportError("content_revision_mode_invalid",422);
  if(mode==="revise_existing"&&(env.NOISIA_MFP_ENABLED!=="true"||args.mfpWorkspaceEnabled!==true||args.access!=="manual-import"
    ||!args.acquisition||args.supersedesImportBatchId))throw new WorkspaceAsyncImportError("content_revision_unavailable",409);
  return mode;
}
