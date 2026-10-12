import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMfpEvalIdentity } from './fixture-identity.ts';

test('evaluation reads the manifest identity path and rejects a different fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mfp-eval-identity-'));
  try {
    const nested = join(directory, '.data/dev-corpus/identity.json');
    await mkdir(join(directory, '.data/dev-corpus'), { recursive: true });
    const identity = { fixture_key: 'rental-corpus-voyage-v1', workspace_id: 'workspace', organization_id: 'org', brand_id: 'brand',
      source_id: 'source', internal_user_id: 'internal', actor_user_id: 'actor' };
    await writeFile(nested, JSON.stringify(identity));
    const manifest = join(directory, 'fixture-manifest.json');
    await writeFile(manifest, JSON.stringify({ fixture_key: 'rental-corpus-voyage-v1', identity_path: nested }));
    assert.deepEqual(await loadMfpEvalIdentity(manifest), identity);
    await writeFile(nested, JSON.stringify({ ...identity, fixture_key: 'rental-corpus-v1' }));
    await assert.rejects(loadMfpEvalIdentity(manifest), /mfp_eval_fixture_identity_invalid/);
    await writeFile(nested, JSON.stringify(identity));
    await writeFile(manifest, JSON.stringify({ fixture_key: 'rental-corpus-v1', identity_path: nested }));
    await assert.rejects(loadMfpEvalIdentity(manifest), /mfp_eval_fixture_manifest_invalid/);
    await writeFile(manifest, JSON.stringify({ fixture_key: 'rental-corpus-voyage-v1', identity_path: join(tmpdir(), 'unrelated.json') }));
    await assert.rejects(loadMfpEvalIdentity(manifest), /mfp_eval_identity_path_invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
