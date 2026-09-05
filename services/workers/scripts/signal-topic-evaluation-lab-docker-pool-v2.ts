import { randomBytes } from "node:crypto";
import { spawn,type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface,type Interface } from "node:readline";

import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
  type SignalTopicEvaluationLabHostReceiptV1 } from "./signal-topic-evaluation-lab-host-provenance-v2";

type Pending={token:string;command:boolean;lines:string[];
  resolve(value:{rows:unknown[]}):void;reject(error:Error):void};

class DockerPsqlLabClientV1{
  private readonly child:ChildProcessWithoutNullStreams;
  private readonly lines:Interface;
  private pending:Pending|undefined;
  private closed=false;

  constructor(database:string){
    this.child=spawn("docker",["exec","--interactive",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
      "psql","--no-psqlrc","--quiet","--tuples-only","--no-align","--set","ON_ERROR_STOP=1",
      "--username","postgres","--dbname",database],{stdio:["pipe","pipe","pipe"]});
    this.lines=createInterface({input:this.child.stdout,crlfDelay:Infinity});
    this.lines.on("line",(line)=>this.onLine(line));
    this.child.stderr.on("data",()=>undefined);
    this.child.on("error",()=>this.fail());
    this.child.on("exit",()=>this.fail());
  }

  query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[]}>{
    if(this.closed||this.pending||values?.length)throw new Error("topic_evaluation_lab_query_invalid");
    const normalized=sql.trim().replace(/;+$/u,"");
    const command=normalized==="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"||normalized==="ROLLBACK";
    if(!command&&!/^SELECT\b/iu.test(normalized))throw new Error("topic_evaluation_lab_query_invalid");
    const token=`__noisia_lab_${randomBytes(12).toString("hex")}__`;
    const body=command?`${normalized};`:
      `SELECT COALESCE(json_agg(row_to_json(_noisia_lab_row)), '[]'::json)::text FROM (${normalized}) _noisia_lab_row;`;
    return new Promise<{rows:T[]}>((resolve,reject)=>{
      this.pending={token,command,lines:[],resolve:resolve as Pending["resolve"],reject};
      this.child.stdin.write(`${body}\n\\echo ${token}\n`);
    });
  }

  release(){
    if(this.closed)return;this.closed=true;this.lines.close();this.child.stdin.end();
  }

  private onLine(line:string){
    const pending=this.pending;if(!pending)return;
    if(line!==pending.token){if(line.trim()!=="")pending.lines.push(line);return;}
    this.pending=undefined;
    if(pending.command){pending.resolve({rows:[]});return;}
    try{
      const raw=pending.lines.join("");const rows=JSON.parse(raw);
      if(!Array.isArray(rows))throw new Error("invalid");
      pending.resolve({rows});
    }catch{pending.reject(new Error("topic_evaluation_lab_query_result_invalid"));}
  }

  private fail(){
    if(this.closed)return;this.closed=true;
    const pending=this.pending;this.pending=undefined;
    pending?.reject(new Error("topic_evaluation_lab_local_postgres_session_failed"));
  }
}

export function createSignalTopicEvaluationLabDockerPoolV1(anchor:SignalTopicEvaluationLabHostReceiptV1){
  return{connect:async()=>new DockerPsqlLabClientV1(anchor.clone_name)};
}
