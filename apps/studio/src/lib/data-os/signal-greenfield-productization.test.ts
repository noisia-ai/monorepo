import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../",import.meta.url);

async function source(path: string) {
  return readFile(new URL(path,root),"utf8");
}

test("greenfield Admin mutations are authenticated, idempotent and server-owned",async () => {
  const [governance,sources,views,promote,strategic] = await Promise.all([
    source("src/app/api/data-os/signal/[workspaceId]/governance/route.ts"),
    source("src/app/api/data-os/signal/[workspaceId]/sources/route.ts"),
    source("src/app/api/data-os/signal/[workspaceId]/governed-views/route.ts"),
    source("src/app/api/data-os/signal/[workspaceId]/governed-views/[viewKey]/promote/route.ts"),
    source("src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/authority/route.ts")
  ]);
  for (const route of [governance,sources,views,promote,strategic]) {
    assert.match(route,/loadSignalWorkspaceContextForManagement/u);
    assert.match(route,/Idempotency-Key/u);
    assert.doesNotMatch(route,/population_id|policy_bundle_id|binding_id/u);
  }
  assert.match(governance,/z\.discriminatedUnion\("action"/u);
  assert.match(views,/z\.enum\(\["brand", "competition", "category", "all-governed"\]\)/u);
  assert.match(promote,/expected_set_digest/u);
  assert.match(strategic,/z\.enum\(\["reconcile", "promote"\]\)/u);
});

test("workspace-native Review never launches paused multimethod lenses",async () => {
  const [button,reviewRoute,runPage,releases] = await Promise.all([
    source("src/components/analysis/ApproveAnalysisButton.tsx"),
    source("src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/runs/[analysisId]/review/route.ts"),
    source("src/app/studio/brands/[id]/reports/runs/[analysisId]/page.tsx"),
    source("src/components/admin/StrategicReleaseManager.tsx")
  ]);
  assert.match(button,/if \(!workspaceId\) \{\s*setIsLaunchingLenses/u);
  assert.match(button,/reports\/triggers-barriers\/runs\/\$\{analysisId\}\/review/u);
  assert.match(reviewRoute,/reviewAndPrepareSignalStrategicReleaseV2/u);
  assert.match(runPage,/TbAnalysisReviewPage/u);
  assert.match(button,/if \(!workspaceId\) \{\s*setIsLaunchingLenses/u);
  assert.match(releases,/action: "promote"/u);
});

test("product-owned readers resolve closed views without client authority ids",async () => {
  const [boundary,workspacePage,launcher] = await Promise.all([
    source("src/lib/data-os/signal-module-serving-scope.ts"),
    source("src/components/signal-v2/SignalV2WorkspacePage.tsx"),
    source("src/components/admin/StrategicReportLauncher.tsx")
  ]);
  assert.match(boundary,/normalizeSignalClientGovernedViewKeyV1/u);
  assert.match(boundary,/population_id|policy_bundle_id|binding_id/u);
  assert.match(boundary,/client_authority_input_forbidden|authority/u);
  assert.match(workspacePage,/brand-monitoring|topics-narratives|mentions/u);
  assert.match(workspacePage,/key === "study" \|\| key === "mention" \|\| key === "view"/u);
  assert.match(launcher,/method: "GET"/u);
  assert.match(launcher,/budget_confirmed/u);
  assert.match(launcher,/preflight_digest/u);
  assert.match(launcher,/const \[budgetConfirmed, setBudgetConfirmed\] = useState\(false\)/u);
  assert.match(
    launcher,
    /preflight\?\.ready && preflight\.launch_authorized && !budgetConfirmed/u
  );
});

test("Backend 09 product surfaces contain no Laika fixture identity",async () => {
  const paths = [
    "src/lib/data-os/signal-governance-control-plane.ts",
    "src/lib/data-os/signal-governed-view-orchestrator.ts",
    "src/lib/data-os/signal-strategic-product.ts",
    "src/components/admin/GovernancePreparationManager.tsx",
    "src/components/admin/GovernedViewsManager.tsx",
    "src/components/admin/StrategicAuthorityManager.tsx"
  ];
  for (const path of paths) assert.doesNotMatch(await source(path),/laika/iu,path);
});

test("Brand OS competitor lifecycle sends idempotency authority from the Admin client",async () => {
  const manager = await source("src/components/brands/CompetitorManager.tsx");
  const idempotencyHeaders = manager.match(/"Idempotency-Key": crypto\.randomUUID\(\)/gu) ?? [];

  assert.equal(idempotencyHeaders.length,3);
  assert.match(manager,/method: "POST"/u);
  assert.match(manager,/method: "DELETE"/u);
});
