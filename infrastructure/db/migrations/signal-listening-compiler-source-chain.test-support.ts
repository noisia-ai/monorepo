import assert from 'node:assert/strict';

export const compilerImport21006V1 = "import {signalListeningJevIdentityV1,validateSignalListeningConfigurationV1,labelerDigestV1,compileSignalListeningSnapshotV1,buildSignalListeningCompiledRequestV1,\n signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';";
export const historicalImportBeforeCompiler21006V1 = "import {signalListeningJevIdentityV1,validateSignalListeningConfigurationV1,labelerDigestV1,buildSignalListeningJevRequestV1,\n signalWorkspaceEmbeddingDigestV1 as digest,type SignalListeningInputV1,type SignalListeningResultV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';";

const authorityLine21006V1 = "  authority:async(c,run)=>{await owner(c,run,false);},";
const pendingLine21006V1 = "  pending:async(c,run)=>(await pendingAndAvailable(c,run)).pending,";
export const compilerBeforeSubmit21006V1 = "  beforeSubmit:async(c,run,calls)=>{\n   await owner(c,run);\n   const snapshot=compileSignalListeningSnapshotV1(config(run));\n   for(const call of calls){if(call.inputs.length!==1||digest(call.request)!==digest(buildSignalListeningCompiledRequestV1(call.inputs[0]!,snapshot)))fail('listening_request_invalid');}\n  },";
export const historicalBeforeSubmit21006V1 = "  beforeSubmit:async(c,run,calls)=>{\n   await owner(c,run);\n   const configuration=config(run);\n   for(const call of calls){if(call.inputs.length!==1||digest(call.request)!==digest(buildSignalListeningJevRequestV1(call.inputs[0]!,configuration)))fail('listening_request_invalid');}\n  },";

const count = (source: string, value: string) => source.split(value).length - 1;

/** Invert only the reviewed 21006 compiler import and beforeSubmit source delta.
 * Other edits remain visible to the older frozen CE38/compact/projection hashes. */
export function invertSignalListeningCompiler21006V1(source: string): string {
  assert.equal(count(source, compilerImport21006V1), 1, 'compiler 21006 import must appear exactly once');
  assert.equal(count(source, historicalImportBeforeCompiler21006V1), 0, 'old request builder cannot stand in for compiler 21006');
  assert.equal(count(source, compilerBeforeSubmit21006V1), 1, 'compiler 21006 beforeSubmit must appear exactly once');
  assert.equal(count(source, historicalBeforeSubmit21006V1), 0, 'old beforeSubmit cannot stand in for compiler 21006');
  const batch = `${authorityLine21006V1}\n${compilerBeforeSubmit21006V1}\n${pendingLine21006V1}`;
  const oldBatch = `${authorityLine21006V1}\n${historicalBeforeSubmit21006V1}\n${pendingLine21006V1}`;
  assert.equal(count(source, batch), 1, 'compiler beforeSubmit must remain between its authority and pending anchors');
  assert.ok(source.indexOf(compilerImport21006V1) < source.indexOf(batch), 'compiler import must precede the submit block');
  const normalized = source.replace(compilerImport21006V1, historicalImportBeforeCompiler21006V1).replace(batch, oldBatch);
  assert.equal(count(normalized, historicalImportBeforeCompiler21006V1), 1);
  assert.equal(count(normalized, historicalBeforeSubmit21006V1), 1);
  assert.equal(normalized.replace(historicalImportBeforeCompiler21006V1, compilerImport21006V1)
    .replace(oldBatch, batch), source, 'inverse compiler transform must recover the exact source bytes');
  return normalized;
}

/** Adversarial fixtures prove only the exact compiler delta is normalized. */
export function assertCompiler21006NegativeFixturesV1(source: string): void {
  const batch = `${authorityLine21006V1}\n${compilerBeforeSubmit21006V1}\n${pendingLine21006V1}`;
  const moved = source.replace(batch, `${authorityLine21006V1}\n${pendingLine21006V1}\n${compilerBeforeSubmit21006V1}`);
  const unrelatedNeedle = ' const limit=options.page_size??200;';
  assert.equal(count(source, unrelatedNeedle), 1, 'third-party edit fixture must match one exact source line');
  const unrelated = source.replace(unrelatedNeedle, ' const limit=options.page_size??201;');
  const cases: Array<[string, string]> = [
    ['missing compiler import', source.replace(compilerImport21006V1, '')],
    ['duplicate compiler import', source.replace(compilerImport21006V1, `${compilerImport21006V1}\n${compilerImport21006V1}`)],
    ['old profile import', source.replace(compilerImport21006V1, historicalImportBeforeCompiler21006V1)],
    ['missing beforeSubmit block', source.replace(batch, `${authorityLine21006V1}\n${pendingLine21006V1}`)],
    ['old beforeSubmit without matching compiler import', source.replace(compilerBeforeSubmit21006V1, historicalBeforeSubmit21006V1)],
    ['duplicate beforeSubmit block', source.replace(batch, `${authorityLine21006V1}\n${compilerBeforeSubmit21006V1}\n${compilerBeforeSubmit21006V1}\n${pendingLine21006V1}`)],
    ['moved beforeSubmit block', moved],
    ['altered compiler call', source.replace('compileSignalListeningSnapshotV1(config(run))', 'compileSignalListeningSnapshotV1(config(run)) /* altered */')],
  ];
  for (const [name, changed] of cases) {
    assert.notEqual(changed, source, `${name} fixture changes the actual source`);
    assert.throws(() => invertSignalListeningCompiler21006V1(changed), name);
  }
  assert.notEqual(unrelated, source, 'unrelated source edit fixture changes the actual source');
  assert.notEqual(invertSignalListeningCompiler21006V1(unrelated), invertSignalListeningCompiler21006V1(source),
    'unrelated changes survive normalization for rejection by the frozen source hashes');
}
