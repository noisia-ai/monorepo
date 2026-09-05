import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalTopicEvaluationLabDockerTransportV1,
  spawnSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";

const validProbe=async(path:string)=>({kind:path.endsWith("docker.sock")?"socket" as const:"file" as const,
  uid:501,nlink:1});

test("ambient Docker routing and configuration fail before path probes or process spawn",async()=>{
  for(const key of ["DOCKER_HOST","DOCKER_CONTEXT","DOCKER_CONFIG","DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY","DOCKER_API_VERSION"]){
    let probes=0;let spawns=0;
    await assert.rejects(spawnSignalTopicEvaluationLabDockerV1(["version"],{stdio:["pipe","pipe","pipe"]},{
      environment:{[key]:"attacker-controlled"},currentUid:501,homeDirectory:"/Users/operator",
      probePath:async(path)=>{probes+=1;return validProbe(path);},
      spawnProcess:((..._args:unknown[])=>{spawns+=1;throw new Error("must not spawn");}) as never}),
    /topic_evaluation_lab_docker_routing_environment_forbidden/u);
    assert.equal(probes,0);assert.equal(spawns,0);
  }
});

test("transport is fixed to the current OS user's owned Unix socket and a sanitized environment",async()=>{
  const transport=await resolveSignalTopicEvaluationLabDockerTransportV1({environment:{PATH:"ignored"},
    currentUid:501,homeDirectory:"/Users/operator",probePath:validProbe});
  assert.equal(transport.binary,"/Applications/Docker.app/Contents/Resources/bin/docker");
  assert.equal(transport.host,"unix:///Users/operator/.docker/run/docker.sock");
  assert.deepEqual(transport.environment,{PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C",LC_ALL:"C"});
  assert.equal(Object.hasOwn(transport.environment,"HOME"),false);
});

test("Docker process receives the explicit Unix host and never ambient context state",async()=>{
  let invocation:{binary:string;args:string[];options:Record<string,unknown>}|undefined;
  const child={} as never;
  const returned=await spawnSignalTopicEvaluationLabDockerV1(["inspect","fixed-container"],
    {stdio:["pipe","pipe","pipe"]},{environment:{PATH:"attacker-path"},currentUid:501,
      homeDirectory:"/Users/operator",probePath:validProbe,
      spawnProcess:((binary:string,args:string[],options:Record<string,unknown>)=>{
        invocation={binary,args,options};return child;}) as never});
  assert.equal(returned,child);
  assert.equal(invocation?.binary,"/Applications/Docker.app/Contents/Resources/bin/docker");
  assert.deepEqual(invocation?.args,["--host","unix:///Users/operator/.docker/run/docker.sock",
    "inspect","fixed-container"]);
  assert.deepEqual(invocation?.options.env,
    {PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C",LC_ALL:"C"});
});

test("wrong socket kind or ownership fails before spawn",async()=>{
  for(const changed of [{kind:"file" as const,uid:501,nlink:1},
    {kind:"socket" as const,uid:502,nlink:1},{kind:"socket" as const,uid:501,nlink:2}]){
    let spawns=0;
    await assert.rejects(spawnSignalTopicEvaluationLabDockerV1(["version"],{stdio:["pipe","pipe","pipe"]},{
      environment:{},currentUid:501,homeDirectory:"/Users/operator",
      probePath:async(path)=>path.endsWith("docker.sock")?changed:{kind:"file",uid:501,nlink:1},
      spawnProcess:((..._args:unknown[])=>{spawns+=1;throw new Error("must not spawn");}) as never}),
    /topic_evaluation_lab_local_docker_transport_invalid/u);
    assert.equal(spawns,0);
  }
});
