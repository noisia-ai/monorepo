import { randomBytes } from "node:crypto";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface,type Interface } from "node:readline";

import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME } from "./signal-topic-evaluation-lab-host-provenance-v2";
import { spawnSignalTopicEvaluationLabDockerV1 } from
  "./signal-topic-evaluation-lab-docker-transport-v2";

type Pending={token:string;expectsRows:boolean;kind:"transaction"|"advisory"|"read"|"write";lines:string[];
  resolve(value:{rows:unknown[];rowCount:number|null}):void;reject(error:Error):void};

/** Bounded local diagnostic metadata: it exposes no SQL text or provider information. */
export class SignalTopicEvaluationLabWriteErrorV2 extends Error {
  constructor(readonly code:string,readonly sqlstate:string|null,readonly domain_code:string|null){super(code);}
}

/**
 * Dedicated mutable Lab transport. It uses the same externally anchored Docker socket/container
 * as LAB-1, but is intentionally separate from the SELECT-only preflight pool. Values are encoded
 * as UTF-8 base64 SQL expressions; no caller value is ever used as SQL source text.
 */
class DockerPsqlLabWriteClientV2{
  private readonly child:ChildProcessWithoutNullStreams;
  private readonly lines:Interface;
  private pending:Pending|undefined;
  private closed=false;
  private stderr="";

  private constructor(child:ChildProcessWithoutNullStreams){
    this.child=child;this.lines=createInterface({input:child.stdout,crlfDelay:Infinity});
    this.lines.on("line",(line)=>this.onLine(line));child.stderr.on("data",(chunk:Buffer)=>{
      if(Buffer.byteLength(this.stderr,"utf8")<4_096)this.stderr+=chunk.toString("utf8").slice(0,4_096);
    });
    // `close`, unlike `exit`, waits for stderr to drain, so an adversarial proof can assert the
    // database SQLSTATE/domain without surfacing any raw SQL text.
    child.on("error",()=>this.fail());child.on("close",()=>this.fail());
  }

  static async create(database:string){
    const child=await spawnSignalTopicEvaluationLabDockerV1(["exec","--interactive",
      SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc","--quiet","--tuples-only",
      "--no-align","--set","ON_ERROR_STOP=1","--set","VERBOSITY=verbose","--username","postgres","--dbname",database],
    {stdio:["pipe","pipe","pipe"]});
    return new DockerPsqlLabWriteClientV2(child);
  }

  query<T=Record<string,unknown>>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number|null}>{
    if(this.closed||this.pending)throw new Error("topic_evaluation_lab_write_query_state_invalid");
    let normalized:string;
    try{normalized=bindValues(sql.trim().replace(/;+$/u,""),values);}
    catch{throw new Error("topic_evaluation_lab_write_query_parameters_invalid");}
    if(!normalized||/\\(?:copy|include|i|o|!|set|connect)\b/iu.test(normalized)){
      throw new Error("topic_evaluation_lab_write_query_text_invalid");
    }
    const command=/^(?:BEGIN|COMMIT|ROLLBACK|SET\s+CONSTRAINTS|SELECT\s+pg_advisory_xact_lock)\b/iu
      .test(normalized);
    const expectsRows=/^(?:SELECT|WITH)\b/iu.test(normalized)||/\bRETURNING\b/iu.test(normalized);
    const kind=/^(?:BEGIN|COMMIT|ROLLBACK|SET\s+CONSTRAINTS)\b/iu.test(normalized)?"transaction"
      :/^SELECT\s+pg_advisory_xact_lock\b/iu.test(normalized)?"advisory"
        :expectsRows?"read":"write";
    const token=`__noisia_lab_write_${randomBytes(12).toString("hex")}__`;
    const body=command?`${normalized};`:(expectsRows
      ?`WITH _noisia_lab_result AS (${normalized}) SELECT COALESCE(json_agg(row_to_json(_noisia_lab_result)), '[]'::json)::text FROM _noisia_lab_result;`
      :`${normalized}; SELECT '[]'::text;`);
    return new Promise((resolve,reject)=>{
      this.pending={token,expectsRows:expectsRows&&!command,kind,lines:[],resolve:resolve as Pending["resolve"],reject};
      this.child.stdin.write(`${body}\n\\echo ${token}\n`);
    });
  }

  release(){if(this.closed)return;this.closed=true;this.lines.close();this.child.stdin.end();}

  private onLine(line:string){
    const pending=this.pending;if(!pending)return;
    if(line!==pending.token){if(line.trim()!=="")pending.lines.push(line);return;}
    this.pending=undefined;
    if(!pending.expectsRows){pending.resolve({rows:[],rowCount:null});return;}
    try{const rows=JSON.parse(pending.lines.join(""));if(!Array.isArray(rows))throw new Error("invalid");
      pending.resolve({rows,rowCount:rows.length});}
    catch{pending.reject(new Error("topic_evaluation_lab_write_result_invalid"));}
  }

  private fail(){if(this.closed)return;this.closed=true;const pending=this.pending;this.pending=undefined;
    if(pending){const diagnostic=extractSqlDiagnosticV2(this.stderr);
      pending.reject(new SignalTopicEvaluationLabWriteErrorV2(
        `topic_evaluation_lab_local_postgres_write_${pending.kind}_failed`,diagnostic.sqlstate,diagnostic.domain_code));}}
}

function extractSqlDiagnosticV2(stderr:string){
  const sqlstate=/ERROR:\s+([0-9A-Z]{5}):/u.exec(stderr)?.[1]??null;
  const domain=/ERROR:\s+[0-9A-Z]{5}:\s*(topic_refinement_[a-z0-9_]+)/u.exec(stderr)?.[1]??null;
  return{sqlstate,domain_code:domain};
}

function bindValues(sql:string,values:unknown[]){
  const used=new Set<number>();
  const bound=sql.replace(/\$(\d+)/gu,(_match,indexRaw:string)=>{
    const index=Number(indexRaw)-1;if(index<0||index>=values.length)throw new Error(
      "topic_evaluation_lab_write_parameter_invalid");used.add(index);return sqlValue(values[index]);
  });
  if(used.size!==values.length)throw new Error("topic_evaluation_lab_write_parameter_invalid");
  return bound;
}

function sqlValue(value:unknown):string{
  if(value===null||value===undefined)return "NULL";
  if(typeof value==="boolean")return value?"TRUE":"FALSE";
  if(typeof value==="number"&&Number.isSafeInteger(value))return String(value);
  if(Array.isArray(value))return `ARRAY[${value.map((item)=>sqlValue(item)).join(",")}]`;
  const serialized=typeof value==="string"?value:JSON.stringify(value);
  if(typeof serialized!=="string")throw new Error("topic_evaluation_lab_write_parameter_invalid");
  const encoded=Buffer.from(serialized,"utf8").toString("base64");
  return `convert_from(decode('${encoded}','base64'),'utf8')`;
}

/** The caller must verify its own fixed host-receipt contract before opening this clone-scoped pool. */
export function createSignalTopicEvaluationLabDockerWritePoolV2(anchor:{clone_name:string}){
  return{connect:async()=>DockerPsqlLabWriteClientV2.create(anchor.clone_name),
    query:async<T=Record<string,unknown>>(sql:string,values?:unknown[])=>{
      const client=await DockerPsqlLabWriteClientV2.create(anchor.clone_name);
      try{return await client.query<T>(sql,values);}finally{client.release();}
    }};
}

export const signalTopicEvaluationLabBindValuesForTestV2=bindValues;
export const signalTopicEvaluationLabExtractSqlDiagnosticForTestV2=extractSqlDiagnosticV2;
