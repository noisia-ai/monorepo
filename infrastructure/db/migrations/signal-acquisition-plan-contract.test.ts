import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignalSentioneCsvIngester,
  resolveSignalSentioneProviderHeaderContractV1,
  SENTIONE_CSV_47_HEADERS_V1
} from "../sentione-csv-ingest";

test("SentiOne typed projection recognizes only the exact versioned 47-column contract", () => {
  assert.equal(SENTIONE_CSV_47_HEADERS_V1.length,47);
  const exact=resolveSignalSentioneProviderHeaderContractV1([
    `\ufeff${SENTIONE_CSV_47_HEADERS_V1[0]}`,...SENTIONE_CSV_47_HEADERS_V1.slice(1)
  ]);
  assert.equal(exact?.version,"sentione-csv-47-v1");
  assert.match(exact?.hash ?? "",/^sha256:[0-9a-f]{64}$/u);
  assert.equal(resolveSignalSentioneProviderHeaderContractV1([
    ...SENTIONE_CSV_47_HEADERS_V1.slice(0,-1),"Unknown provider field"
  ]),null);
  assert.equal(resolveSignalSentioneProviderHeaderContractV1([
    ...SENTIONE_CSV_47_HEADERS_V1
  ].reverse()),null);
});

test("SentiOne typed mapper projects the exact 47-column contract without canonical text",()=>{
  const values=new Map<string,string>([
    ["id","provider-record-1"],["Specific type","Post"],["Created","2026-04-05 12:30:00"],
    ["Added to system","2026-04-05 12:31:00"],["Domain","example.test"],
    ["Domain group","Facebook"],["Domain category","Social"],["Sentiment","Positive"],
    ["Sentiment points","4,5"],["Project name","Private project"],
    ["Total interactions","42"],["comments","3"],["views","100"],["wow","2"],
    ["Language","es"],["Country","MX"],["Tag","campaign|launch"],
    ["Keywords","voice, assistant"],["Thread ID","thread-private"]
  ]);
  const mapper=createSignalSentioneCsvIngester({query:async()=>({rows:[],rowCount:0})} as never);
  const observation=mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>values.get(header)??""));
  assert.ok(observation);
  assert.equal(observation.providerSchemaVersion,"sentione-csv-47-v1");
  assert.equal(observation.platform,"facebook");
  assert.equal(observation.providerSentimentScore,4.5);
  assert.equal(observation.engagement.engagement_total,42);
  assert.equal(observation.engagement.reaction_wow_count,2);
  assert.equal(observation.languageCode,"es");
  assert.equal(observation.countryCode,"MX");
  assert.equal(observation.terms.length,4);
  assert.match(observation.providerThreadKeyHash??"",/^sha256:[0-9a-f]{64}$/u);
  assert.equal("text" in observation,false);
  assert.equal("rawMetadata" in observation,false);
  assert.equal(mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1].reverse(),SENTIONE_CSV_47_HEADERS_V1.map(()=>"")),null);
});
