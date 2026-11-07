import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkspaceTopicComputationStatus } from './signal-workspace-topic-computation-ui';
import { useWorkspaceTopicComputation } from '@/components/brands/useWorkspaceTopicComputation';

test('a disabled legacy computation hook performs no read, evidence read or paid request', async () => {
  const previous = globalThis.fetch; let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response('', {status: 503}); }) as typeof fetch;
  const holder: {current: ReturnType<typeof useWorkspaceTopicComputation> | null} = {current: null};
  const initial: WorkspaceTopicComputationStatus = {
    contract_version: 'signal-workspace-topic-search-v1', mode: 'workspace', workspace_id: 'workspace',
    request_scope: 'actor-workspace', can_execute: true, observed_at: '2026-10-11T20:00:00.000001Z',
    preflight: {state:'ready',embedding_run_id:'00000000-0000-4000-8000-000000000001',missing_prototypes:0},
    active_run:null,latest_run:null,latest_ready:{id:'ready',status:'ready',progress:100,denominator:40,
      processed_roots:40,expected_chunks:40,processed_chunks:40,evaluated_topic_pairs:40,
      retained_candidate_pairs:40,omitted_candidate_pairs:0,error_code:null,
      created_at:'2026-10-11T20:00:00Z',completed_at:'2026-10-11T20:00:01Z'},
    request_run:null,is_current:true
  };
  function Probe({enabled}: {enabled: boolean}) {
    holder.current = useWorkspaceTopicComputation({workspaceId:'workspace',termKey:'charges',catalogVersion:'catalog',enabled,initial});
    return null;
  }
  try {
    renderToStaticMarkup(<Probe enabled={false}/>);
    assert.equal(holder.current!.reading, false);
    assert.equal(holder.current!.canStart, false);
    await holder.current!.read(); await holder.current!.readResults(); await holder.current!.start();
    assert.equal(requests, 0);
    renderToStaticMarkup(<Probe enabled={true}/>);
    assert.equal(holder.current!.canStart, true);
    await holder.current!.readResults();
    assert.equal(requests, 1, 'enabled legacy workspaces still read recorded evidence');
    await holder.current!.read();
    assert.equal(requests, 2, 'legacy workspaces retain the same explicit status reader');
  } finally { globalThis.fetch = previous; }
});
