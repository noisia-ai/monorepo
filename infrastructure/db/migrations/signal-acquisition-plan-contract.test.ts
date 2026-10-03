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
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>values.get(header)??""),
    {sourceTimezone:"UTC"});
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

  const redditValues=new Map(values);
  redditValues.set("Domain group","Reddit");
  redditValues.set("Content of posts","People compare this product with X and TikTok.");
  const reddit=mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>redditValues.get(header)??""),
    {sourceTimezone:"UTC"});
  assert.equal(reddit?.platform,"reddit","mention text cannot override the provider's explicit platform");

  const videoValues=new Map(values);
  videoValues.set("Domain group","Video");
  videoValues.set("Link to the source","https://www.youtube.com/watch?v=-x-");
  const video=mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>videoValues.get(header)??""),
    {sourceTimezone:"UTC"});
  assert.equal(video?.platform,"youtube","URL fallback uses the hostname, not its path or query");

  const unknownValues=new Map(values);
  unknownValues.set("Domain group","Video");
  unknownValues.set("Link to the source","https://example.test/?ref=twitter.com");
  const unknown=mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>unknownValues.get(header)??""),
    {sourceTimezone:"UTC"});
  assert.equal(unknown?.platform,"unknown","foreign domains in URL parameters cannot name the platform");

  redditValues.set("Link to the source","https://www.youtube.com/watch?v=other");
  const explicitReddit=mapper.mapSignalSentioneProviderObservationV1(
    [...SENTIONE_CSV_47_HEADERS_V1],SENTIONE_CSV_47_HEADERS_V1.map((header)=>redditValues.get(header)??""),
    {sourceTimezone:"UTC"});
  assert.equal(explicitReddit?.platform,"reddit","explicit provider platform wins over the linked domain");
});
