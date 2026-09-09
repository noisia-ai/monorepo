import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { scheduleSignalWorkspaceNumericUpdatesV1 } from '../signal-workspace-numeric-producer';

test('numeric admission failure advances the bounded cursor and later candidates still run', async () => {
  const workspaces = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'];
  const database = { query: async (_sql: string, params: unknown[]) => ({ rows: workspaces
    .filter(id => params[0] === null || id > String(params[0]))
    .slice(0, Number(params[1])).map(workspace_id => ({workspace_id})) }) } as unknown as Pool;
  const visits: string[] = [];
  const durable = new Map<string, string>();
  const admit: NonNullable<Parameters<typeof scheduleSignalWorkspaceNumericUpdatesV1>[0]['admit']> = async ({workspace_id}) => {
    visits.push(workspace_id);
    const existed = durable.has(workspace_id);
    if (!existed) durable.set(workspace_id, `numeric:${workspace_id}:revision2`);
    if (workspace_id === workspaces[0] && !existed)
      throw Object.assign(new Error('private compiler or transport detail'), {code:'ECONNRESET'});
    return { contract_version:'workspace-numeric-readiness-v1',workspace_id,desired_revision:'2',state:'already_handled',
      reason_code:null,has_pending_work:false,execution_id:durable.get(workspace_id)!,embedding_run_id:null,
      admitted:!existed,replayed:existed };
  };
  const first = await scheduleSignalWorkspaceNumericUpdatesV1({database,limit:2,admit});
  assert.equal(first.inspected, 2); assert.equal(first.admitted, 1);
  assert.deepEqual(first.failures, [{workspace_id:workspaces[0],error_code:'workspace_numeric_admission_unavailable'}]);
  assert.equal(first.results[0]?.workspace_id, workspaces[1]); assert.equal(first.next_cursor, workspaces[1]);
  assert.ok(!JSON.stringify(first).includes('private compiler'));
  const second = await scheduleSignalWorkspaceNumericUpdatesV1({database,limit:2,admit,after_workspace_id:first.next_cursor});
  assert.equal(second.admitted, 1); assert.deepEqual(second.failures, []); assert.equal(second.next_cursor, null);
  const recovered = await scheduleSignalWorkspaceNumericUpdatesV1({database,limit:2,admit,after_workspace_id:second.next_cursor});
  assert.equal(recovered.admitted, 0); assert.equal(recovered.results[0]?.replayed, true);
  assert.equal(recovered.results[0]?.execution_id, `numeric:${workspaces[0]}:revision2`);
  assert.equal(durable.size, 3, 'unknown acknowledgement does not create a successor intent');
  assert.deepEqual(visits, [workspaces[0],workspaces[1],workspaces[2],workspaces[0],workspaces[1]]);
});
