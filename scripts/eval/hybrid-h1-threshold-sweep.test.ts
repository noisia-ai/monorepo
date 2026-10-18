import assert from 'node:assert/strict';
import test from 'node:test';
import {sweepHybridThresholdsV1} from './hybrid-h1-threshold-sweep';
test('threshold selection uses dev only, reports missing positive predictions as FN and freezes before test',()=>{
 const rows=[{partition:'dev',truth:true,probability:.36},{partition:'dev',truth:false,probability:.31},
  {partition:'dev',truth:true,probability:null},{partition:'test',truth:true,probability:.99}] as const;
 const result=sweepHybridThresholdsV1(rows);
 assert.equal(result.selected_threshold,.35);
 assert.equal(result.test.tp,1);assert.equal(result.dev.find(r=>r.threshold===.35)?.fn,1);
 assert.equal(result.dev.find(r=>r.threshold===.3)?.fp,1);
 assert.equal(sweepHybridThresholdsV1([...rows.slice(0,3),{partition:'test',truth:false,probability:.99}]).selected_threshold,.35);
 assert.equal(result.new_provider_calls,0);
});
