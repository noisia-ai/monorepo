import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {validateSignalCorpusTextChunksV1,SignalWorkspaceCorpusPreparationError,type SignalCorpusTextChunksV1} from "./signal-workspace-corpus-preparation";
const hash=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
function metadata(text:string,ranges:Array<[number,number]>):SignalCorpusTextChunksV1{return {
  contract_version:"corpus-text-chunks-v1",offset_unit:"utf16",max_code_units:1400,text_sha256:hash(text),code_units:text.length,
  chunks:ranges.map(([start,end])=>({start,end,sha256:hash(text.slice(start,end))}))
};}
test("full text chunk metadata covers content beyond the former eighty-chunk cap",()=>{
 const text="x".repeat(1400*82+4);const ranges:Array<[number,number]>=[];
 for(let start=0;start<text.length;start+=1400)ranges.push([start,Math.min(start+1400,text.length)]);
 const chunks=metadata(text,ranges);assert.equal(chunks.chunks.length,83);
 validateSignalCorpusTextChunksV1(text,hash(text),chunks);
 const truncated={...chunks,chunks:chunks.chunks.slice(0,80)};
 assert.throws(()=>validateSignalCorpusTextChunksV1(text,hash(text),truncated),SignalWorkspaceCorpusPreparationError);
});
test("chunk coverage preserves exact whitespace and never splits a UTF16 surrogate pair",()=>{
 const text="x".repeat(1399)+"😀 \n";const good=metadata(text,[[0,1399],[1399,text.length]]);
 validateSignalCorpusTextChunksV1(text,hash(text),good);
 const split=metadata(text,[[0,1400],[1400,text.length]]);
 assert.throws(()=>validateSignalCorpusTextChunksV1(text,hash(text),split),/corpus_preparation_chunk_integrity_failed/);
 const gap=metadata(text,[[0,1399],[1400,text.length]]);
 assert.throws(()=>validateSignalCorpusTextChunksV1(text,hash(text),gap),/corpus_preparation_chunk_integrity_failed/);
});
test("changed asset, wrong hash, altered policy and empty coverage fail closed",()=>{
 const text="Full source text \n";const good=metadata(text,[[0,text.length]]);
 for(const patch of [{text_sha256:hash("other")},{code_units:text.length-1},{chunks:[]},
  {contract_version:"another-policy"},{chunks:[{...good.chunks[0]!,sha256:hash("other")}]}]){
  assert.throws(()=>validateSignalCorpusTextChunksV1(text,hash(text),{...good,...patch} as SignalCorpusTextChunksV1),/corpus_preparation_chunk_integrity_failed/);
 }
 assert.throws(()=>validateSignalCorpusTextChunksV1(text+" changed",hash(text),good),/corpus_preparation_chunk_integrity_failed/);
});
