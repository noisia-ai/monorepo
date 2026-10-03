import { createSignalSentioneCsvIngester, SENTIONE_CSV_47_HEADERS_V1 } from "../../sentione-csv-ingest.ts";

const saved:Record<string,unknown>[]=[],observations:Record<string,unknown>[]=[];
const pool={async query(sql:string,params:unknown[]=[]){
  if(sql.includes("INSERT INTO mentions (")) {
    const columns=sql.match(/INSERT INTO mentions \(([^)]+)\)/u)![1]!.split(",").map(column=>column.trim());
    const rows=[];
    for(let offset=0;offset<params.length;offset+=columns.length) {
      const row=Object.fromEntries(columns.map((column,index)=>[column,params[offset+index]]));
      rows.push(row);saved.push(row);
    }
    return {rows};
  }
  if(sql.includes("FROM mentions mention"))return {rows:saved};
  if(sql.includes("WITH input AS")){observations.push(...JSON.parse(params[3] as string));return {rows:[]};}
  if(/UPDATE import_batches|record_signal_workspace_import_provenance_set_v1/u.test(sql))return {rows:[]};
  throw new Error("Unexpected SQL at isolated normalization boundary");
}};
const fixture:Record<string,string>[]=[
  {id:"timestamp-1",Created:"2026-01-01 04:30:00","Added to system":"2026-01-01 05:30:00", "Content of posts":"A synthetic source timestamp has an explicitly declared timezone."},
  {id:"timestamp-2",Created:"2026-11-01T01:30:00-05:00","Added to system":"2026-11-01T01:31:00-05:00","Content of posts":"An explicit offset resolves this synthetic repeated local hour."}
];
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
const bytes=new TextEncoder().encode(SENTIONE_CSV_47_HEADERS_V1.join(";")+"\n"+
  fixture.map(row=>SENTIONE_CSV_47_HEADERS_V1.map(header=>quote(row[header]??"")).join(";")).join("\n"));
let offset=0;
const result=await createSignalSentioneCsvIngester(pool as never).ingestSentioneCsvStream({
  workspaceId:"00000000-0000-4000-8000-000000000001",dataSourceId:"00000000-0000-4000-8000-000000000002",
  importBatchId:"00000000-0000-4000-8000-000000000003",sourceFileName:"timezone-fixture.csv",
  sourceTimezone:"America/Mexico_City",tuning:{chunkSize:1,insertConcurrency:1},
  stream:new ReadableStream({pull(controller){
    if(offset>=bytes.length){controller.close();return;}
    controller.enqueue(bytes.slice(offset,offset+7));offset+=7;
  }})
});
process.stdout.write(JSON.stringify({stats:result.stats,fileHash:result.fileHash,
  mentions:saved.map(row=>(row.published_at as Date).toISOString()),
  observations:observations.map(row=>({published:row.published_at,collected:row.provider_collected_at,hash:row.observation_hash}))}));
