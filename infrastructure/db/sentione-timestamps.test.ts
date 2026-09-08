import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSentioneTimestampParser, SentioneTimestampError } from "./sentione-timestamps";
import { createSignalSentioneCsvIngester, SENTIONE_CSV_47_HEADERS_V1 } from "./sentione-csv-ingest";

const errorCode=(code:string,field?:string)=>(error:unknown)=>error instanceof SentioneTimestampError
  && error.code===code && (field===undefined || error.field===field);

test("explicit offsets retain their instant without any source or host timezone",()=>{
  const parser=createSentioneTimestampParser();
  for(const [value,expected] of [
    ["2026-01-01T04:30:00Z","2026-01-01T04:30:00.000Z"],
    ["2026-01-01 04:30:00-06:00","2026-01-01T10:30:00.000Z"],
    ["2026-01-01T04:30:00.125+0530","2025-12-31T23:00:00.125Z"],
    ["2026-11-01T01:30:00-04:00","2026-11-01T05:30:00.000Z"],
    ["2026-11-01T01:30:00-05:00","2026-11-01T06:30:00.000Z"]
  ]) {
    assert.equal(parser.required(value!).toISOString(),expected);
    assert.equal(createSentioneTimestampParser("Asia/Tokyo").required(value!).toISOString(),expected);
  }
});

test("naive timestamps and date-only values require an explicit valid IANA source zone",()=>{
  for(const value of ["2026-01-01 04:30:00","2026-01-01"]) {
    assert.throws(()=>createSentioneTimestampParser().required(value),errorCode("source_timezone_required","Created"));
  }
  for(const zone of [""," ","Mexico","Invalid/Zone","UTC+06:00"]) {
    assert.throws(()=>createSentioneTimestampParser(zone),errorCode("source_timezone_invalid"));
  }
  assert.equal(createSentioneTimestampParser("America/Mexico_City").required("2026-01-01 04:30:00").toISOString(),"2026-01-01T10:30:00.000Z");
  assert.equal(createSentioneTimestampParser("Asia/Kathmandu").required("2026-01-01").toISOString(),"2025-12-31T18:15:00.000Z");
  assert.equal(createSentioneTimestampParser("UTC").required("2024-02-29T23:59:59.9").toISOString(),"2024-02-29T23:59:59.900Z");
});

test("missing publication and impossible timestamps fail without epoch or calendar rollover",()=>{
  const parser=createSentioneTimestampParser("UTC");
  assert.throws(()=>parser.required(""),errorCode("source_timestamp_required","Created"));
  assert.equal(parser.optional(" "),null);
  for(const value of ["2026-02-29 12:00:00","2026-04-31T00:00:00Z","2026-13-01","2026-00-01",
    "2026-01-00","2026-01-01T24:00:00Z","2026-01-01T00:60:00Z","2026-01-01T00:00:60Z",
    "2026-01-01T12:00:00+24:00","2026-01-01T12:00:00+05:60","2026-01-01T00:00:00.1234Z",
    "01/02/2026","not-a-date"]) {
    assert.throws(()=>parser.required(value),errorCode("source_timestamp_invalid","Created"),value);
  }
  assert.throws(()=>parser.optional("not-a-date"),errorCode("source_timestamp_invalid","Added to system"));
});

test("DST gaps and repeated times require an explicit offset, including non-hour transitions",()=>{
  const ny=createSentioneTimestampParser("America/New_York");
  assert.throws(()=>ny.required("2026-03-08 02:30:00"),errorCode("source_timestamp_nonexistent"));
  assert.throws(()=>ny.optional("2026-11-01 01:30:00"),errorCode("source_timestamp_ambiguous","Added to system"));
  assert.equal(ny.required("2026-03-08 03:00:00").toISOString(),"2026-03-08T07:00:00.000Z");
  const lordHowe=createSentioneTimestampParser("Australia/Lord_Howe");
  assert.throws(()=>lordHowe.required("2026-04-05 01:45:00"),errorCode("source_timestamp_ambiguous"));
  assert.throws(()=>lordHowe.required("2026-10-04 02:15:00"),errorCode("source_timestamp_nonexistent"));
  assert.throws(()=>createSentioneTimestampParser("Pacific/Apia").required("2011-12-30 12:00:00"),
    errorCode("source_timestamp_nonexistent"));
});

test("both typed timestamps share the same declared source zone and fail with their column",()=>{
  const mapper=createSignalSentioneCsvIngester({query:async()=>{throw new Error("No SQL in mapper");}} as never);
  const values:Record<string,string>={id:"timestamp-fixture",Created:"2026-01-01 04:30:00","Added to system":"2026-01-01 05:30:00"};
  const cells=()=>SENTIONE_CSV_47_HEADERS_V1.map(header=>values[header]??"");
  const result=mapper.mapSignalSentioneProviderObservationV1([...SENTIONE_CSV_47_HEADERS_V1],cells(),{sourceTimezone:"America/Mexico_City"});
  assert.equal(result?.publishedAt,"2026-01-01T10:30:00.000Z");
  assert.equal(result?.providerCollectedAt,"2026-01-01T11:30:00.000Z");
  assert.throws(()=>mapper.mapSignalSentioneProviderObservationV1([...SENTIONE_CSV_47_HEADERS_V1],cells()),errorCode("source_timezone_required","Created"));
  values.Created="2026-01-01T04:30:00Z";
  assert.throws(()=>mapper.mapSignalSentioneProviderObservationV1([...SENTIONE_CSV_47_HEADERS_V1],cells()),errorCode("source_timezone_required","Added to system"));
});

test("full streaming normalization has identical instants and observation hashes under different host TZ",()=>{
  const script=new URL("./migrations/fixtures/sentione-timestamp-host.mts",import.meta.url);
  const run=(timezone:string)=>JSON.parse(execFileSync(process.execPath,["--import","tsx",script.pathname],
    {env:{...process.env,TZ:timezone},encoding:"utf8"}));
  const utc=run("UTC"),honolulu=run("Pacific/Honolulu");
  assert.deepEqual(utc,honolulu);
  assert.equal(utc.stats.record_count,2);
  assert.deepEqual(utc.mentions,["2026-01-01T10:30:00.000Z","2026-11-01T06:30:00.000Z"]);
  assert.deepEqual(utc.observations.map((row:{collected:string})=>row.collected),
    ["2026-01-01T11:30:00.000Z","2026-11-01T06:31:00.000Z"]);
  assert.equal(utc.observations.length,2);
});

test("verification inspects the same CSV stream before persistence and hashes through a late timestamp error",async()=>{
  let sqlCalls=0;
  const parser=createSignalSentioneCsvIngester({query:async()=>{sqlCalls++;throw new Error("Inspection must not query SQL");}} as never);
  const rows=Array.from({length:601},(_,index):Record<string,string>=>({
    id:`inspection-${index}`,Created:"2026-01-01 12:00:00","Added to system":"2026-01-01 12:01:00",
    "Content of posts":`Synthetic quoted text ${index}; with a newline\nand a literal "quote".`
  }));
  const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
  const encode=()=>new TextEncoder().encode(`\ufeff${SENTIONE_CSV_47_HEADERS_V1.join(";")}\r\n`+
    rows.map(row=>SENTIONE_CSV_47_HEADERS_V1.map(header=>quote(row[header]??"")).join(";")).join("\r\n"));
  const inspect=async(bytes:Uint8Array,sourceTimezone:string)=>{
    let read=0,cancelled=false;
    const result=await parser.inspectSentioneCsvStream({sourceTimezone,stream:new ReadableStream({pull(controller){
      if(read>=bytes.length){controller.close();return;}
      const end=Math.min(read+31,bytes.length);controller.enqueue(bytes.slice(read,end));read=end;
    },cancel(){cancelled=true;}})});
    assert.equal(result.fileHash,createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.sizeBytes,bytes.length);assert.equal(read,bytes.length);assert.equal(cancelled,false);
    assert.equal(sqlCalls,0);
    return result;
  };
  const valid=await inspect(encode(),"America/New_York");
  assert.equal(valid.validationError,null);
  rows[600]!.Created="2026-11-01 01:30:00";
  const invalid=await inspect(encode(),"America/New_York");
  assert.ok(errorCode("source_timestamp_ambiguous","Created")(invalid.validationError));
  rows[600]!.Created="2026-01-01 12:00:00";
  rows[600]!["Added to system"]="2026-11-01 01:30:00";
  const collected=await inspect(encode(),"America/New_York");
  assert.ok(errorCode("source_timestamp_ambiguous","Added to system")(collected.validationError));
  const badZone=await inspect(encode(),"Invalid/Zone");
  assert.ok(errorCode("source_timezone_invalid")(badZone.validationError));
});

test("inspection rejects transport failures and aborts without returning a partial hash or retaining its reader",async()=>{
  let sqlCalls=0;
  const parser=createSignalSentioneCsvIngester({query:async()=>{sqlCalls++;throw new Error("Inspection must not query SQL");}} as never);
  for(const [created,sourceTimezone] of [
    ["2026-01-01 12:00:00","UTC"],
    ["2026-02-30 12:00:00","UTC"],
    ["2026-01-01 12:00:00","Invalid/Zone"]
  ] as const) {
    for(const transportError of [new Error("Synthetic stream failure"),new DOMException("Synthetic stream abort","AbortError")]) {
      const bytes=new TextEncoder().encode(`id;Created\ntransport-fixture;${created}\n`);
      let pulls=0,releases=0;
      const cancelReasons:unknown[]=[];
      const stream=new ReadableStream<Uint8Array>({pull(controller){
        if(pulls++===0)controller.enqueue(bytes);
        else controller.error(transportError);
      }},{highWaterMark:0});
      const getReader=stream.getReader.bind(stream);
      Object.defineProperty(stream,"getReader",{value:()=>{
        const reader=getReader();
        const cancel=reader.cancel.bind(reader),releaseLock=reader.releaseLock.bind(reader);
        reader.cancel=(reason)=>{cancelReasons.push(reason);return cancel(reason);};
        reader.releaseLock=()=>{releases++;releaseLock();};
        return reader;
      }});
      // The second pull happens after the complete first row has been inspected.
      // A retained validation error must never turn a failed transport into a result.
      await assert.rejects(parser.inspectSentioneCsvStream({stream,sourceTimezone}),
        (error:unknown)=>error===transportError);
      assert.equal(pulls,2);
      assert.deepEqual(cancelReasons,[transportError]);
      assert.equal(releases,1);
      assert.equal(stream.locked,false);
      assert.equal(sqlCalls,0);
    }
  }
});
