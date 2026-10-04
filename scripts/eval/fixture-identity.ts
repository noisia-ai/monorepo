import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export type MfpEvalIdentity = {
  fixture_key: 'rental-corpus-voyage-v1';
  workspace_id: string;
  source_id: string;
  internal_user_id: string;
  actor_user_id: string;
};

export async function loadMfpEvalIdentity(manifestFile = '.data/dev-corpus/voyage-real/fixture-manifest.json'): Promise<MfpEvalIdentity> {
  const manifestPath = resolve(manifestFile);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { identity_path?: string };
  if (!manifest.identity_path) throw new Error('mfp_eval_identity_path_invalid');
  const fixtureDirectory = dirname(manifestPath);
  const identityPath = isAbsolute(manifest.identity_path)
    ? resolve(manifest.identity_path) : resolve(fixtureDirectory, manifest.identity_path);
  const relativePath = relative(fixtureDirectory, identityPath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('mfp_eval_identity_path_invalid');
  const identity = JSON.parse(await readFile(identityPath, 'utf8')) as Partial<MfpEvalIdentity>;
  if (identity.fixture_key !== 'rental-corpus-voyage-v1' || !identity.workspace_id || !identity.source_id ||
      !identity.internal_user_id || !identity.actor_user_id) throw new Error('mfp_eval_fixture_identity_invalid');
  return identity as MfpEvalIdentity;
}
