import { spawn,type ChildProcessWithoutNullStreams,type SpawnOptionsWithoutStdio } from "node:child_process";
import { lstat } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";

const DOCKER_BINARY="/Applications/Docker.app/Contents/Resources/bin/docker";
const ROUTING_KEY=/^DOCKER_/iu;
const SANITIZED_DOCKER_ENV=Object.freeze({PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C",LC_ALL:"C"});

type PathProof={kind:"file"|"socket"|"other";uid:number;nlink:number};
type Dependencies={
  environment?:NodeJS.ProcessEnv;
  currentUid?:number;
  homeDirectory?:string;
  probePath?(path:string):Promise<PathProof>;
  spawnProcess?:typeof spawn;
};

export class SignalTopicEvaluationLabDockerTransportError extends Error{
  constructor(public readonly code:string){super(code);this.name="SignalTopicEvaluationLabDockerTransportError";}
}

function assertCleanDockerEnvironment(environment:NodeJS.ProcessEnv){
  if(Object.keys(environment).some((key)=>ROUTING_KEY.test(key))){
    throw new SignalTopicEvaluationLabDockerTransportError(
      "topic_evaluation_lab_docker_routing_environment_forbidden");
  }
}

async function realProbePath(path:string):Promise<PathProof>{
  const value=await lstat(path);
  return{kind:value.isFile()?"file":value.isSocket()?"socket":"other",uid:value.uid,nlink:value.nlink};
}

export async function resolveSignalTopicEvaluationLabDockerTransportV1(
  dependencies:Dependencies={}){
  assertCleanDockerEnvironment(dependencies.environment??process.env);
  const currentUid=dependencies.currentUid??(typeof process.getuid==="function"?process.getuid():-1);
  const homeDirectory=dependencies.homeDirectory??userInfo().homedir;
  const socketPath=resolve(homeDirectory,".docker/run/docker.sock");
  const probe=dependencies.probePath??realProbePath;
  let binary:PathProof;let socket:PathProof;
  try{[binary,socket]=await Promise.all([probe(DOCKER_BINARY),probe(socketPath)]);}
  catch{throw new SignalTopicEvaluationLabDockerTransportError(
    "topic_evaluation_lab_local_docker_transport_unavailable");}
  if(currentUid<0||binary.kind!=="file"||binary.uid!==currentUid||binary.nlink!==1
      ||socket.kind!=="socket"||socket.uid!==currentUid||socket.nlink!==1){
    throw new SignalTopicEvaluationLabDockerTransportError(
      "topic_evaluation_lab_local_docker_transport_invalid");
  }
  return{binary:DOCKER_BINARY,host:`unix://${socketPath}`,environment:SANITIZED_DOCKER_ENV};
}

export async function spawnSignalTopicEvaluationLabDockerV1(args:string[],options:
  Omit<SpawnOptionsWithoutStdio,"env">&{stdio:["pipe","pipe","pipe"]}={stdio:["pipe","pipe","pipe"]},
  dependencies:Dependencies={}):Promise<ChildProcessWithoutNullStreams>{
  const transport=await resolveSignalTopicEvaluationLabDockerTransportV1(dependencies);
  return(dependencies.spawnProcess??spawn)(transport.binary,["--host",transport.host,...args],
    {...options,env:transport.environment}) as ChildProcessWithoutNullStreams;
}

export async function runSignalTopicEvaluationLabDockerV1(args:string[],input?:Buffer,
  dependencies:Dependencies={}){
  const child=await spawnSignalTopicEvaluationLabDockerV1(args,{stdio:["pipe","pipe","pipe"]},dependencies);
  return new Promise<string>((resolveRun,reject)=>{
    const stdout:Buffer[]=[];let size=0;
    child.stdout.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size<=1024*1024)stdout.push(chunk);});
    child.stderr.on("data",()=>undefined);
    child.on("error",()=>reject(new SignalTopicEvaluationLabDockerTransportError(
      "topic_evaluation_lab_docker_exec_failed")));
    child.on("close",(code)=>{if(code!==0||size>1024*1024)reject(new
      SignalTopicEvaluationLabDockerTransportError("topic_evaluation_lab_docker_exec_failed"));
    else resolveRun(Buffer.concat(stdout).toString("utf8").trim());});
    child.stdin.end(input);
  });
}
