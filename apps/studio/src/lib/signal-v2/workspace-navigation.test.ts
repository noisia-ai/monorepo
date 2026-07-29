import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import type { SignalStrategicReleaseSummary } from "@/lib/data-os/signal-strategic-releases";
import {
  buildSignalStrategicStudyNavigation,
  findSignalStrategicStudy
} from "./workspace-navigation";

const workspace: ResolvedSignalWorkspace = {
  contractVersion: "signal-backend-v1",
  id: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  slug: "laika",
  name: "Laika Mascotas",
  subject: { type: "brand", id: "30000000-0000-4000-8000-000000000001" },
  timezone: "America/Mexico_City",
  status: "active",
  corpora: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      name: "Monitoreo vivo",
      role: "operational",
      status: "corpus_approved",
      validFrom: "2026-07-01T00:00:00.000Z",
      methodologySlug: "signal-pulse",
      outputId: null
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      name: "Decisión de compra · Jul 2026",
      role: "strategic",
      status: "corpus_approved",
      validFrom: "2026-07-02T00:00:00.000Z",
      methodologySlug: "triggers-barriers",
      outputId: "50000000-0000-4000-8000-000000000001"
    }
  ]
};

const release: SignalStrategicReleaseSummary = {
  release_id: "60000000-0000-4000-8000-000000000001",
  study_corpus_id: "40000000-0000-4000-8000-000000000002",
  release_key: "strategic:2026-07-25",
  title: "Decisión de compra · Jul 2026",
  status: "published",
  visibility: "client",
  period_start: "2026-07-01",
  period_end: "2026-07-25",
  corpus_revision: 2,
  snapshot_id: "70000000-0000-4000-8000-000000000001",
  comparison_base_analysis_id: null,
  approved_at: "2026-07-26T00:00:00.000Z",
  published_at: "2026-07-26T00:00:00.000Z",
  is_current: true,
  artifact_count: 5,
  temporal_metric_count: 8,
  movement_counts: {},
  artifacts: []
};

test("builds one named Signal page per Triggers & Barriers corpus", () => {
  const studies = buildSignalStrategicStudyNavigation({ workspace, releases: [release] });
  assert.equal(studies.length, 1);
  assert.equal(studies[0]?.title, "Decisión de compra · Jul 2026");
  assert.equal(studies[0]?.href, `/signal/laika?study=${studies[0]?.id}`);
  assert.equal(studies[0]?.currentRelease?.release_id, release.release_id);
  assert.equal(findSignalStrategicStudy(studies, studies[0]?.id)?.id, studies[0]?.id);
});
