import assert from'node:assert/strict';
import test from'node:test';
import type{PoolClient}from'pg';
import type{SignalStudyConfigurationRecordV1}from'../signal-study-core';
import{loadSignalStudyAcquisitionQueryMetadataV1,resolveSignalStudyQueryMetadataV1}from'../signal-study-query-metadata';
import{signalStudyQueryBiasV1}from'@noisia/query-engine';
const cfg={id:'synthetic-configuration',workspace_id:'synthetic-workspace',envelope:{study:{cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z'}}}}as unknown as SignalStudyConfigurationRecordV1;
function client(value:unknown){let reads=0;return{get reads(){return reads;},c:{query:async(_sql:string,params:unknown[])=>{reads++;assert.deepEqual(params,[cfg.workspace_id,cfg.id,JSON.stringify(cfg.envelope)]);return{rows:[value]};}}as unknown as PoolClient};}
test('automatic acquisition terms preserve real vocabulary without inventing a problem comparison',async()=>{
 const db=client({source_batches:2,unavailable_batches:0,terms:['brake failure','bicycle']}),metadata=await loadSignalStudyAcquisitionQueryMetadataV1(db.c,cfg);
 assert.deepEqual(metadata.query_terms,['brake failure','bicycle']);assert.deepEqual(metadata.problem_terms,[]);assert.equal(metadata.acquisition_query_metadata?.complete,true);assert.equal(db.reads,1);
 const bias=signalStudyQueryBiasV1({...metadata,subject_roots:20,brand_baseline_roots:200});assert.equal(bias.status,'unknown_query_metadata');assert.equal(bias.base_ratio,.1);
 const partial=await loadSignalStudyAcquisitionQueryMetadataV1(client({source_batches:2,unavailable_batches:1,terms:['bicycle']}).c,cfg);assert.equal(partial.acquisition_query_metadata?.complete,false);
 const missing=await loadSignalStudyAcquisitionQueryMetadataV1(client({source_batches:0,unavailable_batches:0,terms:[]}).c,cfg);assert.equal(missing.acquisition_query_metadata?.complete,false);
});
test('metadata capacity rejects rather than truncates vocabulary or fabricates complete coverage',async()=>{
 for(const value of[{source_batches:1,unavailable_batches:0,terms:Array(501).fill('term')},{source_batches:1,unavailable_batches:0,terms:['x'.repeat(241)]},{source_batches:1,unavailable_batches:2,terms:[]}])await assert.rejects(loadSignalStudyAcquisitionQueryMetadataV1(client(value).c,cfg),/query_metadata_/);
});
test('retry recovers frozen automatic provenance while explicit and historical defaults retain request identity',async()=>{
 const db=client({source_batches:1,unavailable_batches:0,terms:['new imports']}),first=await resolveSignalStudyQueryMetadataV1(db.c,cfg,{});assert.equal(db.reads,1);
 const original={...first,query_terms:['frozen old query']};assert.deepEqual(await resolveSignalStudyQueryMetadataV1(db.c,cfg,{},original),original);assert.equal(db.reads,1);
 assert.deepEqual(await resolveSignalStudyQueryMetadataV1(db.c,cfg,{}, {query_terms:['historically explicit'],problem_terms:['problem']}),{query_terms:[],problem_terms:[]});assert.equal(db.reads,1);
 assert.deepEqual(await resolveSignalStudyQueryMetadataV1(db.c,cfg,{query_terms:['explicit'],problem_terms:['problem']}),{query_terms:['explicit'],problem_terms:['problem']});assert.equal(db.reads,1);
});
