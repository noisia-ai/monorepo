import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {workspaceProjectionFixtureV1} from './signal-workspace-topic-projection.fixture';
import {assertClientWorkspaceEntryV1} from './signal-client-workspace-entry.assertions';

const enabled=process.env.NOISIA_CLIENT_WORKSPACE_ENTRY_PG_APPROVED==='true';

test('assigned clients enter without a report and select current Signal Topics independently of execution authority',{
  skip:!enabled,timeout:90_000,
},async t=>{
  // Existing complete 3-root/133-chunk local fixture; no Python or provider.
  // Synthetic baseline receipts belong to the internal fixture actor, not clients.
  let applied=false;
  const f=await workspaceProjectionFixtureV1({migrations:[
    '0141_signal_workspace_editorial_repair.sql','0142_signal_workspace_terminal_transport.sql',
    '0143_signal_workspace_editorial_revision.sql','0144_signal_workspace_engine_progress.sql',
    '0145_signal_workspace_incremental_numeric.sql','0146_signal_workspace_incremental_projection.sql',
    '0147_signal_workspace_interpretation_admission.sql',
  ],onCheckpoint:async({query})=>{
    if(applied)return;applied=true;
    for(const file of ['0148_signal_workspace_incremental_editorial.sql','0149_signal_workspace_incremental_editorial_ledger.sql',
      '0150_signal_workspace_incremental_editorial_preparation.sql','0151_signal_workspace_incremental_editorial_serving.sql',
      '0152_signal_workspace_incremental_editorial_renewal.sql']) await query(await readFile(new URL(file,import.meta.url),'utf8'));
  }});
  await assertClientWorkspaceEntryV1(t,f);
});
