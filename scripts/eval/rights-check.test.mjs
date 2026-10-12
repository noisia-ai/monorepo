import test from 'node:test';
import assert from 'node:assert/strict';
import { mfpEvalRightsCensusValid } from './rights-check.ts';

test('two completed fixture loads require the same authorized source and no activity',()=>{
  const state={accepted_batches:2,accepted_sources:1,authorized_batches:2,authorized_sources:1,
    expected_source_batches:2,active_runs:0,unsettled_calls:0};
  assert.equal(mfpEvalRightsCensusValid(state,true),true);
  assert.equal(mfpEvalRightsCensusValid({...state,authorized_batches:1},true),false);
  assert.equal(mfpEvalRightsCensusValid({...state,expected_source_batches:1},true),false);
  assert.equal(mfpEvalRightsCensusValid({...state,accepted_batches:3},true),false);
  assert.equal(mfpEvalRightsCensusValid({...state,unsettled_calls:1},true),false);
  assert.equal(mfpEvalRightsCensusValid(state,false),false);
});
