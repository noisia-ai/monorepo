import{mkdtemp,stat,rm}from'node:fs/promises';
import{basename,join}from'node:path';
import{tmpdir}from'node:os';
import{hashWorkspaceEngineFileV1}from'./signal-workspace-engine-files';
import{buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1}from'./signal-workspace-engine-storage';
import type{ListeningOrphanNumericResultV1}from'./signal-listening-orphan-regroup';
export type ListeningDiscoveryNumericArtifactDescriptorV1={workspace_id:string;execution_id:string;checkpoint_id:string;name:string;
 sha256:string;size_bytes:number;storage_key?:string};
export type ListeningDiscoveryNumericStorageV1={
 reference(descriptor:ListeningDiscoveryNumericArtifactDescriptorV1):{storage_key:string};
 store(descriptor:ListeningDiscoveryNumericArtifactDescriptorV1):Promise<{storage_key:string;sha256:string;size_bytes:number;verified:true}>;
 verify(descriptor:ListeningDiscoveryNumericArtifactDescriptorV1&{storage_key:string}):Promise<boolean>;
};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const logical=/^(?:(?:input|output)\/)?[a-z][a-z0-9_.-]{0,100}$/u,sha=/^sha256:[a-f0-9]{64}$/u;
function fail(reason:string):never{throw Error('listening_discovery_numeric_storage_'+reason);}
/** Native private multipart custody. Local paths exist only in this transient
 * upload closure; a recovery instance verifies remote references with no files.
 * DB ownership/CAS is mandatory before invoking these callbacks. */
export function createListeningDiscoveryNumericStorageV1(args:{storage:WorkspaceEngineStorageV1;
 scope?:{workspace_id:string;execution_id:string};artifacts?:ListeningOrphanNumericResultV1['artifacts']}):ListeningDiscoveryNumericStorageV1{
 const artifacts=new Map((args.artifacts??[]).map(artifact=>[artifact.name,artifact]));
 if(artifacts.size!==(args.artifacts??[]).length||artifacts.size&&!args.scope)fail('scope_invalid');
 function reference(d:ListeningDiscoveryNumericArtifactDescriptorV1){
  if(![d.workspace_id,d.execution_id,d.checkpoint_id].every(id=>uuid.test(id))||!logical.test(d.name)||d.name.includes('..')||!sha.test(d.sha256)
   ||!Number.isSafeInteger(d.size_bytes)||d.size_bytes<0||args.scope&&(d.workspace_id!==args.scope.workspace_id||d.execution_id!==args.scope.execution_id))fail('descriptor_invalid');
  const storage_key=buildWorkspaceEngineStorageKeyV1(d.workspace_id,d.checkpoint_id,basename(d.name),d.sha256);
  if(d.storage_key!==undefined&&d.storage_key!==storage_key)fail('descriptor_invalid');return{storage_key};
 }
 async function verify(d:ListeningDiscoveryNumericArtifactDescriptorV1&{storage_key:string}){
  let directory:string|undefined;
  try{reference(d);directory=await mkdtemp(join(tmpdir(),'noisia-numeric-readback-'));const destination=join(directory,'artifact.bin');
   await args.storage.get({workspace_id:d.workspace_id,execution_id:d.checkpoint_id,
    stored:{storage_key:d.storage_key,sha256:d.sha256,size_bytes:d.size_bytes,media_type:'application/octet-stream'},destination});
   return(await stat(destination)).size===d.size_bytes&&await hashWorkspaceEngineFileV1(destination)===d.sha256;
  }catch{return false;}finally{if(directory)await rm(directory,{recursive:true,force:true});}
 }
 return{reference,verify,async store(d){
  const ref=reference(d),artifact=artifacts.get(d.name);
  if(!artifact||artifact.sha256!==d.sha256||artifact.size_bytes!==d.size_bytes||basename(artifact.file)!==basename(d.name))fail('local_artifact_unavailable');
  if(!args.storage.assertReady)fail('preflight_unavailable');await args.storage.assertReady();
  const stored=await args.storage.put({workspace_id:d.workspace_id,execution_id:d.checkpoint_id,file:artifact.file,
   sha256:d.sha256,size_bytes:d.size_bytes,media_type:'application/octet-stream'});
  if(stored.storage_key!==ref.storage_key||stored.sha256!==d.sha256||stored.size_bytes!==d.size_bytes
   ||!await verify({...d,storage_key:stored.storage_key}))fail('verification_failed');
  return{storage_key:stored.storage_key,sha256:stored.sha256,size_bytes:stored.size_bytes,verified:true};
 }};
}
