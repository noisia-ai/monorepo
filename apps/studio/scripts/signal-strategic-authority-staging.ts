import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import {
  activateSignalDataGovernanceObjectV1,
  ensureSignalLicensingPolicyDraftV1,
  ensureSignalProvenancePolicyBindingDraftV1
} from "../src/lib/data-os/signal-data-governance";
import { reconcileSignalGovernedViewPolicyCandidateV1 } from "../src/lib/data-os/signal-governed-view-policy";
import { ensureSignalStrategicGovernedAuthorityV1 } from "../src/lib/data-os/signal-strategic-authority";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "../src/lib/data-os/signal-workspace";

const ROOT = "/Users/brandhon_o/Downloads/noisia-website";
const OUTPUT_DIR = resolve(ROOT,".data/signal-governed-serving/backend-07");
const DECISION_PATH = resolve(OUTPUT_DIR,"strategic-usage-decision.private.json");
const EXPECTED_DECISION_HASH = "sha256:cab07c436f1d3018f7ce38f742fee23358d3d3a87d173099d2ad2bd1318f4651";
const EXPECTED_DIRECT = "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER = "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT = "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const EXPECTED_0076 = "sha256:270a6d265202b14f329a6db36c1466b9d6426e23f825c0c97cfda455e785c759";
const RESTORE_AT = "2026-08-12T14:21:13.000Z";
const APP_NAME = "noisia-backend-07-strategic-authority";

type Decision = {
  contract_version: string;
  target: string;
  workspace_fixture: string;
  effective_from: string;
  effective_to: string;
  approved_import_batch_hashes: string[];
  licensing_policy: {
    policy_key: string;
    policy_version: number;
    usages: Record<string,"allowed">;
    explicitly_not_authorized: string[];
  };
};

type ContributingImport = {
  import_batch_id: string;
  data_source_id: string;
  import_status: string;
  source_status: string;
  quality_policy_id: string;
  retention_policy_id: string;
  retention_state: string;
  retention_mode: string;
  retain_until: string | null;
  retention_effective_to: string | null;
};

const candidateCte=`WITH governed_entities AS (
  SELECT workspace.id AS workspace_id,'primary_brand'::text AS scope,'brand'::text AS entity_type,
    workspace.brand_id AS entity_id FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
  UNION ALL SELECT workspace.id,'competitor','competitor',competitor.id
  FROM signal_workspaces workspace JOIN competitors competitor ON competitor.brand_id=workspace.brand_id
  JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
  WHERE workspace.id=$1::uuid
  UNION ALL SELECT workspace.id,'category','category',entity.id
  FROM signal_workspaces workspace JOIN intelligence_entities entity
    ON entity.organization_id=workspace.organization_id AND entity.brand_id=workspace.brand_id
  WHERE workspace.id=$1::uuid AND entity.status='active' AND entity.entity_type='category'
), candidate AS (SELECT DISTINCT assertion.mention_id FROM signal_mention_attributions assertion
  JOIN governed_entities entity ON entity.workspace_id=assertion.workspace_id
   AND entity.scope=assertion.scope AND entity.entity_type=assertion.entity_type AND entity.entity_id=assertion.entity_id
  JOIN mentions mention ON mention.id=assertion.mention_id AND mention.workspace_id=assertion.workspace_id
  WHERE assertion.workspace_id=$1::uuid AND assertion.attribution_basis='mention_semantic'
    AND assertion.is_current AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
    AND assertion.scope IN ('primary_brand','competitor','category')
    AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included')`;

const env: Record<string,string> = {};
loadEnv({ path: resolve(ROOT,"apps/studio/.env.local"),processEnv: env });
if (process.env.NOISIA_SIGNAL_STRATEGIC_AUTHORITY_APPLY_APPROVED !== "true") {
  throw new Error("Strategic authority apply requires the explicit Backend 07 approval flag.");
}
const poolerUrl = env.DATABASE_URL?.trim();
if (!poolerUrl || env.DATABASE_SSL !== "true") throw new Error("Canonical staging connection is unavailable.");
const poolerParsed = new URL(poolerUrl);
const projectRef = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(poolerParsed.username).toLowerCase())?.[1];
if (!projectRef) throw new Error("Pooler project identity is unavailable.");
const directParsed = new URL(poolerParsed);
directParsed.hostname = `db.${projectRef}.supabase.co`;
directParsed.port = "5432";
directParsed.username = "postgres";
const directUrl = directParsed.toString();
if (fingerprint(directUrl) !== EXPECTED_DIRECT || fingerprint(poolerUrl) !== EXPECTED_POOLER
  || sha256(projectRef) !== EXPECTED_PROJECT) throw new Error("Staging identity mismatch.");
const restoreAgeHours = (Date.now()-Date.parse(RESTORE_AT))/3_600_000;
if (restoreAgeHours < 0 || restoreAgeHours > 24) throw new Error("A fresh restore point is required.");

const decisionBytes = await readFile(DECISION_PATH);
if (sha256(decisionBytes) !== EXPECTED_DECISION_HASH) throw new Error("Decision artifact checksum mismatch.");
const decision = JSON.parse(decisionBytes.toString("utf8")) as Decision;
if (decision.target !== "noisia-staging" || decision.workspace_fixture !== "laika"
  || Date.parse(decision.effective_to)-Date.parse(decision.effective_from) !== 7*24*60*60*1000
  || Object.keys(decision.licensing_policy.usages).sort().join(",")
    !== ["client-derived-metrics","client-mention-list","client-text-or-excerpt","llm-processing","strategic-analysis"].sort().join(",")
  || Object.values(decision.licensing_policy.usages).some((value) => value !== "allowed")
  || decision.licensing_policy.explicitly_not_authorized.join(",") !== "internal-qa"
  || decision.approved_import_batch_hashes.length !== 4
  || new Set(decision.approved_import_batch_hashes).size !== 4
  || decision.approved_import_batch_hashes.some((value) => !/^sha256:[0-9a-f]{64}$/u.test(value))) {
  throw new Error("Decision artifact violates the approved closed usage contract.");
}

const direct = new pg.Client({ connectionString: directUrl,ssl:{rejectUnauthorized:false},application_name:APP_NAME });
const peer = new pg.Client({ connectionString: poolerUrl,ssl:{rejectUnauthorized:false},application_name:`${APP_NAME}-peer` });
await Promise.all([direct.connect(),peer.connect()]);
let privateEvidence: Record<string,unknown>;
try {
  await configure(direct);await configure(peer);
  const [before,peerBefore] = await Promise.all([readSnapshot(direct),readSnapshot(peer)]);
  if (stable(publicSnapshot(before)) !== stable(publicSnapshot(peerBefore))) throw new Error("Direct/pooler preflight mismatch.");
  await assertConnections(direct);
  if (before.ledger.at(-1)?.ordinal !== 76 || before.ledger.at(-1)?.checksum_sha256 !== EXPECTED_0076) {
    throw new Error("Expected 0059-0076 ledger is unavailable.");
  }

  await direct.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let transition: Record<string,unknown>;
  try {
    await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["noisia:backend-07:strategic-authority"]);
    const locked = await readSnapshotInTransaction(direct);
    if (stable(publicSnapshot(locked)) !== stable(publicSnapshot(before))) throw new Error("Protected preflight CAS drifted.");
    const workspaceRow = await loadWorkspaceActor(direct);
    const workspace: ResolvedSignalWorkspace = {
      contractVersion:"signal-backend-v1",id:workspaceRow.workspace_id,
      organizationId:workspaceRow.organization_id,slug:"laika",name:workspaceRow.workspace_name,
      subject:{type:"brand",id:workspaceRow.brand_id},timezone:workspaceRow.timezone,
      status:"active",corpora:[]
    };
    const actor: SignalWorkspaceUser = {
      id:workspaceRow.actor_id,userType:"noisia_internal",organizationId:workspaceRow.actor_organization_id
    };
    const contributing = await loadContributingImports(direct,workspace.id);
    if (contributing.length !== 4
      || stable(contributing.map((row) => sha256(row.import_batch_id)).sort())
        !== stable([...decision.approved_import_batch_hashes].sort())
      || contributing.some((row) => row.import_status !== "completed"
      || row.source_status !== "active" || row.quality_policy_id !== contributing[0]!.quality_policy_id
      || row.retention_policy_id !== contributing[0]!.retention_policy_id)) {
      throw new Error("Contributing import provenance is incomplete or heterogeneous.");
    }
    const authority = contributing[0]!;
    if (authority.retention_state !== "allowed"
      || (authority.retention_effective_to && Date.parse(authority.retention_effective_to) < Date.parse(decision.effective_to))
      || (authority.retention_mode === "until" && (!authority.retain_until
        || Date.parse(authority.retain_until) < Date.parse(decision.effective_to)))) {
      throw new Error("Existing retention does not cover the approved seven-day window.");
    }
    const approvalEvidenceHash = EXPECTED_DECISION_HASH;
    const transitionState = (await direct.query<{policies:number;bindings:number;strategic:number}>(`
      SELECT
        (SELECT count(*)::int FROM signal_licensing_policies WHERE workspace_id=$1::uuid
          AND policy_key=$2 AND policy_version=$3 AND status='active') AS policies,
        (SELECT count(*)::int FROM signal_provenance_policy_bindings binding
          JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
          WHERE binding.workspace_id=$1::uuid AND binding.import_batch_id IS NOT NULL
            AND binding.status='active' AND licensing.policy_key=$2 AND licensing.policy_version=$3) AS bindings,
        (SELECT count(*)::int FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid
          AND module_key='triggers-barriers' AND view_key='strategic'
          AND binding_status='current') AS strategic
    `,[workspace.id,decision.licensing_policy.policy_key,decision.licensing_policy.policy_version])).rows[0]!;
    const replay = transitionState.policies===1 && transitionState.bindings===4 && transitionState.strategic===1;
    if (!replay && (transitionState.policies!==0 || transitionState.bindings!==0 || transitionState.strategic!==0)) {
      throw new Error("Strategic authority transition is partial and cannot be resumed implicitly.");
    }
    const operationalBefore = await loadOperationalState(direct,workspace.id);
    if (operationalBefore.length !== 12) throw new Error("Expected twelve current operational bindings.");
    if (!replay) {
      for (const prior of operationalBefore) {
        const digest = (await direct.query<{digest:string}>(`
          SELECT signal_governed_view_binding_digest_v1($1::uuid) AS digest
        `,[prior.binding_id])).rows[0]!.digest;
        await direct.query(`SELECT withdraw_signal_governed_view_binding(
          $1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7
        )`,[workspace.id,prior.module_key,prior.view_key,actor.id,prior.binding_id,digest,
          idem(`withdraw:${prior.module_key}:${prior.view_key}`,approvalEvidenceHash)]);
      }
    }
    const licensingDraft = await ensureSignalLicensingPolicyDraftV1({
      queryable: direct,organizationId: workspace.organizationId,actor,
      definition:{workspace_id:workspace.id,policy_key:decision.licensing_policy.policy_key,
        policy_version:decision.licensing_policy.policy_version,approval_evidence_hash:approvalEvidenceHash,
        usages:Object.entries(decision.licensing_policy.usages).map(([usage_purpose,licenseDecision]) => ({
          usage_purpose:usage_purpose as never,decision:licenseDecision
        }))},idempotencyKey:idem("licensing-policy",approvalEvidenceHash),
      effectiveFrom:decision.effective_from,effectiveTo:decision.effective_to
    });
    const licensingActivation = await activateSignalDataGovernanceObjectV1({
      queryable:direct,workspaceId:workspace.id,actor,objectKind:"licensing-policy",
      objectId:licensingDraft.policy_id,idempotencyKey:idem("activate-licensing",approvalEvidenceHash)
    });
    const licensingPersisted = (await direct.query<{status:string;effective_from:string;effective_to:string|null;
      usages:Record<string,string>}>(`SELECT licensing.status,licensing.effective_from::text,
        licensing.effective_to::text,COALESCE((SELECT jsonb_object_agg(usage.usage_purpose,usage.decision)
          FROM signal_licensing_policy_usages usage WHERE usage.licensing_policy_id=licensing.id),'{}') AS usages
        FROM signal_licensing_policies licensing WHERE licensing.id=$1::uuid`,[licensingDraft.policy_id])).rows[0];
    if (!licensingPersisted || licensingPersisted.status !== "active"
      || Date.parse(licensingPersisted.effective_from) !== Date.parse(decision.effective_from)
      || Date.parse(licensingPersisted.effective_to ?? "") !== Date.parse(decision.effective_to)
      || stable(licensingPersisted.usages) !== stable(decision.licensing_policy.usages)) {
      throw new Error("Persisted licensing policy does not match the approved bounded decision.");
    }
    const bindingResults: Array<Record<string,unknown>> = [];
    for (const item of contributing) {
      const existing = await direct.query<{ id:string;binding_version:number;quality_policy_id:string;
        retention_policy_id:string;licensing_policy_id:string;status:string;
        effective_from:string;effective_to:string|null }>(`
        SELECT id::text,binding_version,quality_policy_id::text,retention_policy_id::text,
          licensing_policy_id::text,status,effective_from::text,effective_to::text
        FROM signal_provenance_policy_bindings
        WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid AND import_batch_id=$3::uuid
          AND licensing_policy_id=$4::uuid ORDER BY binding_version DESC
      `,[workspace.id,item.data_source_id,item.import_batch_id,licensingDraft.policy_id]);
      const persisted = existing.rows[0];
      const bindingVersion = persisted?.binding_version ?? Number((await direct.query<{version:number}>(`
        SELECT COALESCE(max(binding_version),0)::int+1 AS version
        FROM signal_provenance_policy_bindings
        WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid AND import_batch_id=$3::uuid
      `,[workspace.id,item.data_source_id,item.import_batch_id])).rows[0]!.version);
      if (persisted && (persisted.quality_policy_id !== item.quality_policy_id
        || persisted.retention_policy_id !== item.retention_policy_id
        || persisted.status !== "active"
        || Date.parse(persisted.effective_from) !== Date.parse(decision.effective_from)
        || Date.parse(persisted.effective_to ?? "") !== Date.parse(decision.effective_to))) {
        throw new Error("Persisted import-specific binding has incompatible authorities.");
      }
      const draft = await ensureSignalProvenancePolicyBindingDraftV1({
        queryable:direct,actor,definition:{workspace_id:workspace.id,data_source_id:item.data_source_id,
          import_batch_id:item.import_batch_id,binding_version:bindingVersion,
          quality_policy_id:item.quality_policy_id,retention_policy_id:item.retention_policy_id,
          licensing_policy_id:licensingDraft.policy_id},
        idempotencyKey:idem(`import-binding:${item.import_batch_id}`,approvalEvidenceHash),
        effectiveFrom:decision.effective_from,effectiveTo:decision.effective_to
      });
      const activation = await activateSignalDataGovernanceObjectV1({
        queryable:direct,workspaceId:workspace.id,actor,objectKind:"provenance-binding",
        objectId:draft.binding_id,
        idempotencyKey:idem(`activate-import-binding:${item.import_batch_id}`,approvalEvidenceHash)
      });
      bindingResults.push({ import_hash:sha256(item.import_batch_id),binding_hash:sha256(draft.binding_id),
        version:bindingVersion,created:draft.created,activated:activation.activated,replayed:activation.replayed });
    }
    const operationalResults: Array<Record<string,unknown>> = [];
    for (const prior of operationalBefore) {
      const result = await reconcileSignalGovernedViewPolicyCandidateV1({
        workspace,actor,viewKey:prior.view_key,policyBundleId:prior.policy_bundle_id,
        moduleKey:prior.module_key,reconcileMemberships:true,queryable:direct
      });
      if (result.compilation_status !== "ready" || result.governance_unknown_count !== 0
        || result.actual_membership_count !== prior.membership_count
        || result.actual_membership_digest !== prior.membership_digest
        || result.population_id !== prior.population_id || result.alias_membership_count !== 0) {
        throw new Error(`Operational ${prior.module_key}/${prior.view_key} changed its denominator.`);
      }
      let rotated = false;
      if (!replay) {
        await direct.query(`SELECT promote_signal_governed_view_binding(
          $1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,'promote',$7
        )`,[workspace.id,prior.module_key,prior.view_key,prior.policy_bundle_id,
          result.population_id,actor.id,idem(`repromote:${prior.module_key}:${prior.view_key}`,approvalEvidenceHash)]);
        rotated = true;
      } else if (prior.policy_compilation_id !== result.policy_compilation_id) {
        throw new Error(`Replay found a stale operational binding for ${prior.module_key}/${prior.view_key}.`);
      }
      operationalResults.push({module_key:prior.module_key,view_key:prior.view_key,
        population_hash:sha256(result.population_id),membership_count:result.actual_membership_count,
        membership_digest:result.actual_membership_digest,coverage_unknown:result.governance_unknown_count,
        binding_rotated:rotated});
    }
    const strategic = await ensureSignalStrategicGovernedAuthorityV1({
      queryable:direct,workspace,actor,idempotencyKey:approvalEvidenceHash
    });
    if (Date.parse(strategic.next_policy_transition_at) > Date.parse(decision.effective_to)) {
      throw new Error("Strategic compilation outlives its import-specific licensing decision.");
    }
    if (!strategic.binding_id) {
      throw new Error("Strategic staging apply requires the explicitly promoted binding.");
    }
    const lockedAfter = await readSnapshotInTransaction(direct);
    assertProtectedInvariant(before,lockedAfter);
    await direct.query("COMMIT");
    transition = {workspace,actor:{actor_hash:sha256(actor.id),user_type:actor.userType},
      decision_hash:approvalEvidenceHash,licensing:{policy_hash:sha256(licensingDraft.policy_id),
        policy_key:decision.licensing_policy.policy_key,policy_version:decision.licensing_policy.policy_version,
        created:licensingDraft.created,activated:licensingActivation.activated,replayed:licensingActivation.replayed},
      import_bindings:bindingResults,operational:operationalResults,
      strategic:{...strategic,policy_bundle_id:sha256(strategic.policy_bundle_id),
        base_population_id:sha256(strategic.base_population_id),population_id:sha256(strategic.population_id),
        policy_compilation_id:sha256(strategic.policy_compilation_id),binding_id:sha256(strategic.binding_id),
        governance_evaluation_id:sha256(strategic.governance_evaluation_id)}};
  } catch (error) {
    await direct.query("ROLLBACK").catch(()=>undefined);
    throw error;
  }
  const [after,peerAfter] = await Promise.all([readSnapshot(direct),readSnapshot(peer)]);
  if (stable(publicSnapshot(after)) !== stable(publicSnapshot(peerAfter))) throw new Error("Direct/pooler verify mismatch.");
  assertProtectedInvariant(before,after);
  privateEvidence = {contract_version:"signal-backend-07-strategic-authority-evidence-private-v1",
    captured_at:new Date().toISOString(),target:"noisia-staging",restore_point:{at:RESTORE_AT,
      age_hours:Math.round(restoreAgeHours*10)/10},identity:{direct_fingerprint:EXPECTED_DIRECT,
      pooler_fingerprint:EXPECTED_POOLER,project_ref_hash:EXPECTED_PROJECT},before,transition,after,
    jobs_enqueued:0,provider_calls:0};
} finally {
  await Promise.all([direct.end(),peer.end()]);
}

await mkdir(OUTPUT_DIR,{recursive:true,mode:0o700});
const privatePath = resolve(OUTPUT_DIR,"strategic-authority.private.json");
await writeFile(privatePath,`${JSON.stringify(privateEvidence,null,2)}\n`,{mode:0o600});
await chmod(privatePath,0o600);
const transition = privateEvidence.transition as Record<string,unknown>;
const sanitized = {contract_version:"signal-backend-07-strategic-authority-evidence-sanitized-v1",
  captured_at:privateEvidence.captured_at,target:"noisia-staging",restore_point:privateEvidence.restore_point,
  identity:privateEvidence.identity,decision_hash:EXPECTED_DECISION_HASH,
  licensing:transition.licensing,import_bindings:transition.import_bindings,
  operational:transition.operational,strategic:transition.strategic,
  protected_before:publicSnapshot(privateEvidence.before as Snapshot),
  protected_after:publicSnapshot(privateEvidence.after as Snapshot),jobs_enqueued:0,provider_calls:0,
  private_artifact_sha256:sha256(await readFile(privatePath))};
const sanitizedPath = resolve(OUTPUT_DIR,"strategic-authority.sanitized.json");
await writeFile(sanitizedPath,`${JSON.stringify(sanitized,null,2)}\n`,{mode:0o600});await chmod(sanitizedPath,0o600);
process.stdout.write(JSON.stringify({ok:true,target:"noisia-staging",jobs_enqueued:0,provider_calls:0,
  operational_compilations:(sanitized.operational as unknown[]).length,
  strategic_membership_count:(sanitized.strategic as {membership_count:number}).membership_count,
  sanitized_sha256:sha256(await readFile(sanitizedPath))})+"\n");

type Snapshot = Awaited<ReturnType<typeof readSnapshotInTransaction>>;

async function configure(client: pg.Client) {
  await client.query("SET statement_timeout='120s'");await client.query("SET lock_timeout='15s'");
  await client.query("SET idle_in_transaction_session_timeout='5min'");
}

async function readSnapshot(client: pg.Client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try { const result=await readSnapshotInTransaction(client);await client.query("COMMIT");return result; }
  catch(error){await client.query("ROLLBACK");throw error;}
}

async function readSnapshotInTransaction(client: pg.Client) {
  const ledger=(await client.query(`SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 59 AND 76 ORDER BY ordinal`)).rows;
  const workspace=(await client.query(`SELECT workspace.id::text AS workspace_id,
      workspace.organization_id::text,workspace.brand_id::text,workspace.status,workspace.timezone
    FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id WHERE brand.slug='laika'`)).rows;
  if(workspace.length!==1)throw new Error("Laika identity is unavailable or ambiguous.");
  const workspaceId=workspace[0].workspace_id;
  const v1=(await client.query(`SELECT count(*)::int AS memberships,
      count(*) FILTER(WHERE membership_status='included' AND removed_at IS NULL)::int AS included,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(concat_ws(':',mention_id::text,
        membership_status,COALESCE(membership_reason,'∅'),COALESCE(removed_at::text,'∅')),',' ORDER BY mention_id),''),'UTF8')),'hex') AS digest
    FROM signal_population_memberships membership JOIN signal_population_definitions population
      ON population.id=membership.population_id
    WHERE population.workspace_id=$1::uuid AND population.population_key='primary-brand-operational'
      AND population.version=1`,[workspaceId])).rows[0];
  const immutable=(await client.query(`SELECT
    (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row_value)::text,',' ORDER BY id),''),'UTF8')),'hex')
      FROM signal_workspace_population_pointers row_value WHERE workspace_id=$1::uuid) AS pointers,
    (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row_value)::text,',' ORDER BY id),''),'UTF8')),'hex')
      FROM signal_mention_attributions row_value WHERE workspace_id=$1::uuid) AS assertions,
    (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row_value)::text,',' ORDER BY id),''),'UTF8')),'hex')
      FROM signal_mention_attribution_review_events row_value WHERE workspace_id=$1::uuid) AS review,
    (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(row_value)::text,',' ORDER BY id),''),'UTF8')),'hex')
      FROM signal_mention_import_memberships row_value WHERE workspace_id=$1::uuid) AS provenance_memberships,
    (SELECT 'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(batch)::text,',' ORDER BY batch.id),''),'UTF8')),'hex')
      FROM import_batches batch WHERE batch.workspace_id=$1::uuid) AS import_batches,
    (SELECT count(*)::int FROM signal_strategic_run_outbox WHERE workspace_id=$1::uuid) AS run_jobs,
    (SELECT count(*)::int FROM signal_strategic_step_outbox WHERE workspace_id=$1::uuid) AS step_jobs,
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE workspace_id=$1::uuid) AS runs`,[workspaceId])).rows[0];
  const other=(await client.query(`SELECT count(*)::int AS workspace_count,
      'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(workspace)::text,',' ORDER BY workspace.id),''),'UTF8')),'hex') AS digest
    FROM signal_workspaces workspace WHERE workspace.id<>$1::uuid`,[workspaceId])).rows[0];
  const operational=await loadOperationalState(client,workspaceId);
  const strategic=(await client.query(`SELECT
    (SELECT count(*)::int FROM signal_population_policy_bundles WHERE workspace_id=$1::uuid
      AND policy_key='triggers-barriers-strategic-governed') AS bundles,
    (SELECT count(*)::int FROM signal_population_policy_compilations WHERE workspace_id=$1::uuid
      AND module_key='triggers-barriers' AND view_key='strategic' AND is_current) AS compilations,
    (SELECT count(*)::int FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid
      AND module_key='triggers-barriers' AND view_key='strategic' AND binding_status='current') AS bindings`,[workspaceId])).rows[0];
  return {ledger,workspace,v1,immutable,other,operational,strategic};
}

function publicSnapshot(snapshot: Snapshot) {
  return {ledger:snapshot.ledger,workspace_identity_hash:sha256(stable(snapshot.workspace)),v1:snapshot.v1,
    immutable:snapshot.immutable,other:snapshot.other,operational:snapshot.operational.map((row)=>({
      module_key:row.module_key,view_key:row.view_key,policy_bundle_hash:sha256(row.policy_bundle_id),
      population_hash:sha256(row.population_id),membership_count:row.membership_count,
      membership_digest:row.membership_digest,governance_unknown_count:row.governance_unknown_count,
      current_binding:true})),strategic:snapshot.strategic};
}

function assertProtectedInvariant(before: Snapshot,after: Snapshot) {
  if(stable(before.v1)!==stable(after.v1)||stable(before.immutable)!==stable(after.immutable)
    ||stable(before.other)!==stable(after.other))throw new Error("Protected state changed.");
  const projection=(rows:Snapshot["operational"])=>rows.map((row)=>({module_key:row.module_key,
    view_key:row.view_key,policy_bundle_id:row.policy_bundle_id,population_id:row.population_id,
    membership_count:row.membership_count,membership_digest:row.membership_digest,
    governance_unknown_count:row.governance_unknown_count}));
  if(stable(projection(before.operational))!==stable(projection(after.operational))) {
    throw new Error("Operational denominators or authorities changed.");
  }
  if(after.immutable.run_jobs!==0||after.immutable.step_jobs!==0||after.immutable.runs!==0) {
    throw new Error("Strategic transition created a run or job.");
  }
}

async function assertConnections(client:pg.Client){const row=(await client.query(`SELECT
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle' AND application_name NOT IN ($1,$2))::int AS incompatible,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND COALESCE(application_name,'')~*'(studio|worker|bullmq)')::int AS named_apps,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle' AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int AS writers
    FROM pg_stat_activity WHERE datname=current_database()`,[APP_NAME,`${APP_NAME}-peer`])).rows[0];
  if(row.incompatible||row.named_apps||row.writers)throw new Error("Incompatible staging connection detected.");}

async function loadWorkspaceActor(client:pg.Client){const rows=(await client.query(`SELECT
    workspace.id::text AS workspace_id,workspace.organization_id::text,workspace.brand_id::text,
    brand.name AS workspace_name,workspace.timezone,actor.id::text AS actor_id,
    actor.organization_id::text AS actor_organization_id
    FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
    JOIN LATERAL (SELECT candidate.* FROM users candidate
      WHERE candidate.status='active' AND candidate.user_type='noisia_internal'
        AND signal_data_governance_actor_is_valid(workspace.id,candidate.id)
      ORDER BY candidate.created_at,candidate.id LIMIT 1) actor ON true
    WHERE brand.slug='laika' AND workspace.status='active'`)).rows;
  if(rows.length!==1)throw new Error("Internal actor is unavailable or ambiguous.");return rows[0];}

async function loadContributingImports(client:pg.Client,workspaceId:string){return (await client.query(`${candidateCte}, contributing AS (
  SELECT membership.import_batch_id,membership.data_source_id FROM candidate
  JOIN mentions lineage ON lineage.workspace_id=$1::uuid AND lineage.canonical_mention_id=candidate.mention_id
  JOIN signal_mention_import_memberships membership ON membership.workspace_id=$1::uuid AND membership.mention_id=lineage.id
  GROUP BY membership.import_batch_id,membership.data_source_id)
  SELECT contributing.import_batch_id::text,contributing.data_source_id::text,
    batch.status AS import_status,source.status AS source_status,
    binding.quality_policy_id::text,binding.retention_policy_id::text,
    retention.retention_state,retention.retention_mode,retention.retain_until::text,
    retention.effective_to::text AS retention_effective_to
  FROM contributing JOIN import_batches batch ON batch.id=contributing.import_batch_id
  JOIN data_sources source ON source.id=contributing.data_source_id
  JOIN LATERAL (SELECT candidate.* FROM signal_provenance_policy_bindings candidate
    WHERE candidate.workspace_id=$1::uuid AND candidate.data_source_id=contributing.data_source_id
      AND candidate.status='active' AND candidate.effective_from<=clock_timestamp()
      AND (candidate.effective_to IS NULL OR candidate.effective_to>clock_timestamp())
      AND (candidate.import_batch_id=contributing.import_batch_id OR candidate.import_batch_id IS NULL)
    ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,candidate.binding_version DESC LIMIT 1) binding ON true
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
  ORDER BY contributing.import_batch_id`,[workspaceId])).rows as ContributingImport[];}

async function loadOperationalState(client:pg.Client,workspaceId:string){return (await client.query(`SELECT
  binding.id::text AS binding_id,binding.policy_compilation_id::text, binding.policy_bundle_id::text,
  binding.population_id::text, binding.module_key,binding.view_key,
  population.membership_digest,(SELECT count(*)::int FROM signal_population_memberships membership
    WHERE membership.population_id=population.id AND membership.membership_status='included' AND membership.removed_at IS NULL) AS membership_count,
  compilation.governance_unknown_count
  FROM signal_governed_view_bindings binding JOIN signal_population_definitions population ON population.id=binding.population_id
  JOIN signal_population_policy_compilations compilation ON compilation.id=binding.policy_compilation_id
  WHERE binding.workspace_id=$1::uuid AND binding.binding_status='current'
    AND binding.module_key IN ('brand-monitoring','mentions','topics-narratives')
    AND binding.view_key IN ('brand','competition','category','all-governed')
  ORDER BY binding.module_key,binding.view_key`,[workspaceId])).rows as Array<{binding_id:string;
    policy_compilation_id:string;policy_bundle_id:string;population_id:string;module_key:"brand-monitoring"|"mentions"|"topics-narratives";
    view_key:"brand"|"competition"|"category"|"all-governed";membership_digest:string;membership_count:number;
    governance_unknown_count:number}>;}

function idem(identity:string,decisionHash:string){return sha256(`signal-backend-07:${identity}:${decisionHash}`);}
function fingerprint(value:string){const parsed=new URL(value);return sha256([parsed.protocol,parsed.hostname.toLowerCase(),
  parsed.port||"5432",parsed.pathname.replace(/^\//u,""),parsed.username].join("|"));}
function sha256(value:string|Buffer){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stable(value:unknown):string{return Array.isArray(value)?`[${value.map(stable).join(",")}]`:value&&typeof value==="object"
  ?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  :JSON.stringify(value);}
