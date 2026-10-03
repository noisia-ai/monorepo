import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, assertSignalWorkspaceEmbeddingProfileV1,
  boundSignalWorkspaceEmbeddingInputTokensV1, quoteSignalWorkspaceEmbeddingCostV1,
  signalWorkspaceEmbeddingCostMicroUsdV1, signalWorkspaceEmbeddingDigestV1,
  validateSignalWorkspaceEmbeddingInputsV1, validateSignalWorkspaceEmbeddingResponseV1,
  type SignalWorkspaceEmbeddingResponseV1
} from "./signal-workspace-embeddings-v1";

const input = (text: string) => ({text,chunk_sha256:`sha256:${createHash("sha256").update(text).digest("hex")}`});
const vector = () => [1,...Array.from({length:1023},()=>0)];
const response = ():SignalWorkspaceEmbeddingResponseV1 => ({model:"voyage-4-large",total_tokens:6,
  embeddings:[{index:1,vector:vector()},{index:0,vector:vector()}],
  provider_request_id:"request-safe",response_digest:`sha256:${"a".repeat(64)}`});

test("cache identity seals retrieval role, dimension, tokenizer and price without accepting alternatives",()=>{
  assertSignalWorkspaceEmbeddingProfileV1(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1);
  for(const changes of [{input_type:"query"},{dimensions:512},{truncation:true},{output_dtype:"int8"},{tokenizer_revision:"other"}]) {
    assert.throws(()=>assertSignalWorkspaceEmbeddingProfileV1({...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,...changes}));
  }
  assert.equal(signalWorkspaceEmbeddingDigestV1({a:1,b:2}),signalWorkspaceEmbeddingDigestV1({b:2,a:1}));
});

test("bounds account for NFC expansion and per-call rounding while preserving original text",()=>{
  const texts=["\u0390".repeat(700),"  nacional\n\ntexto  ","🚗".repeat(700)];
  const quote=quoteSignalWorkspaceEmbeddingCostV1({input_bytes:texts.reduce((n,t)=>n+Buffer.byteLength(t),0),chunk_count:texts.length});
  const cost=texts.reduce((n,t)=>n+signalWorkspaceEmbeddingCostMicroUsdV1(boundSignalWorkspaceEmbeddingInputTokensV1(t)),0);
  assert.ok(quote.estimated_max_cost_micro_usd>=cost);
  assert.ok(boundSignalWorkspaceEmbeddingInputTokensV1(texts[0]!)>Buffer.byteLength(texts[0]!));
  assert.equal(input(texts[1]!).text,"  nacional\n\ntexto  ");
  assert.equal(signalWorkspaceEmbeddingCostMicroUsdV1(1),1);
  assert.equal(signalWorkspaceEmbeddingCostMicroUsdV1(100),12);
  assert.equal(quoteSignalWorkspaceEmbeddingCostV1({input_bytes:0,chunk_count:0}).estimated_max_cost_micro_usd,0);
  assert.throws(()=>quoteSignalWorkspaceEmbeddingCostV1({input_bytes:Number.MAX_SAFE_INTEGER,chunk_count:1}));
  assert.throws(()=>boundSignalWorkspaceEmbeddingInputTokensV1("\ud800"));
  assert.throws(()=>boundSignalWorkspaceEmbeddingInputTokensV1("\udc00"));
});

test("transport rejects oversized, duplicate or altered batches before any provider call",()=>{
  assert.ok(validateSignalWorkspaceEmbeddingInputsV1([input("hola"),input("mundo")])>0);
  assert.throws(()=>validateSignalWorkspaceEmbeddingInputsV1([input("same"),input("same")]));
  assert.throws(()=>validateSignalWorkspaceEmbeddingInputsV1([{...input("x"),text:"y"}]));
  assert.throws(()=>validateSignalWorkspaceEmbeddingInputsV1(Array.from({length:128},(_,i)=>input(`${i}`+"界".repeat(1397)))));
  assert.throws(()=>validateSignalWorkspaceEmbeddingInputsV1(Array.from({length:129},(_,i)=>input(String(i)))));
});

test("response must cover every index with a usable float32 vector and retain excessive usage for the ledger",()=>{
  const inputs=[input("hola"),input("mundo")];
  validateSignalWorkspaceEmbeddingResponseV1(inputs,response());
  validateSignalWorkspaceEmbeddingResponseV1(inputs,{...response(),total_tokens:999999});
  for(const change of [
    {embeddings:[{index:0,vector:vector()},{index:0,vector:vector()}]},
    {embeddings:[{index:0,vector:vector()}]},
    {embeddings:[{index:0,vector:[1]},{index:1,vector:vector()}]},
    {embeddings:[{index:0,vector:Array.from({length:1024},()=>NaN)},{index:1,vector:vector()}]},
    {embeddings:[{index:0,vector:Array.from({length:1024},()=>1e-100)},{index:1,vector:vector()}]},
    {total_tokens:0},{total_tokens:1.2},{model:"other"}
  ]) assert.throws(()=>validateSignalWorkspaceEmbeddingResponseV1(inputs,{...response(),...change}));
});
