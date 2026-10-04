import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openDatabase, main } from './guard.mjs';
function id(key: string) { const h=createHash('sha256').update(key).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; }
await main(async () => {
  const input=JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  if (!/^[a-z0-9-]{3,60}$/u.test(input.fixture_key) || input.brand.competitors?.length < 2 || !input.category) throw new Error('mfp_seed_input_invalid');
  const pool=await openDatabase();
  try {
    const organizationId=id(`${input.fixture_key}:org`),internalId=id(`${input.fixture_key}:internal`),clientId=id(`${input.fixture_key}:client`),brandId=id(`${input.fixture_key}:brand`);
    await pool.query(`INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,$3,'active') ON CONFLICT(id) DO NOTHING`,[organizationId,`mfp-${input.fixture_key}`,input.organization_name]);
    // Bootstrap only harness identities. Product brand creation below uses the exact client-admin service.
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
      ($1,$2,'MFP internal operator','noisia_internal','noisia_admin',$5,'active'),
      ($3,$4,'MFP client operator','client','client_admin',$5,'active') ON CONFLICT(id) DO NOTHING`,
      [internalId,`mfp-internal-${input.fixture_key}@example.test`,clientId,input.client_email??`mfp-client-${input.fixture_key}@example.test`,organizationId]);
    const {db}=await import('../../apps/studio/src/lib/db');
    const {users}=await import('../../infrastructure/db/index');
    const actor=(await db.select().from(users)).find(row=>row.id===clientId);
    if (!actor || actor.status!=='active' || actor.organizationId!==organizationId || actor.primaryRole!=='client_admin') throw new Error('mfp_seed_actor_changed');
    const {createBrandForActorV1}=await import('../../apps/studio/src/lib/data-os/brand-creation-service');
    const response=await createBrandForActorV1(new Request('https://mfp.invalid/api/brands',{method:'POST',headers:{'Idempotency-Key':brandId,'Content-Type':'application/json'},body:JSON.stringify({
      ...input.brand,organization_id:organizationId,brand_seed_handles:input.brand.aliases??[],preparation:{idempotency_key:brandId}
    })}),actor);
    if (response.status!==201) throw new Error('mfp_seed_brand_creation_failed');
    const created=await response.json();
    const {resolveSignalWorkspaceForUser}=await import('../../apps/studio/src/lib/data-os/signal-workspace');
    const workspace=await resolveSignalWorkspaceForUser(actor,{workspaceId:created.signal_workspace.id});
    if (!workspace) throw new Error('mfp_seed_workspace_unavailable');
    const {prepareWorkspaceManualImportInTransactionV1}=await import('../../apps/studio/src/lib/data-os/workspace-manual-import-setup');
    const setup=await prepareWorkspaceManualImportInTransactionV1({workspace,actor,access:'manual-import',idempotencyKey:id(`${input.fixture_key}:source`),input:{
      contract_version:'signal-workspace-manual-import-setup-v1',provider:'sentione',source_name:input.source_name??'MFP development corpus',category_name:input.category,
      rights:{storage_and_analysis:true,external_ai_processing:true,retention_until:null}
    }});
    const source=(await pool.query('SELECT id FROM data_sources WHERE workspace_id=$1 AND source_key=$2',[workspace.id,setup.source_key])).rows[0];
    await mkdir('.data/dev-corpus',{recursive:true,mode:0o700});
    await writeFile('.data/dev-corpus/identity.json',JSON.stringify({fixture_key:input.fixture_key,organization_id:organizationId,actor_user_id:clientId,internal_user_id:internalId,
      brand_id:brandId,workspace_id:workspace.id,source_id:source.id,source_key:setup.source_key,timezone:workspace.timezone}),{mode:0o600});
    console.log(JSON.stringify({status:'seeded',replayed:created.replayed,provider_calls:0,processing_policy:created.brand_context_policy.status,
      mfp_actions:'pending_ws2',budget_micro_usd:input.budget_micro_usd??null,cap_micro_usd:input.cap_micro_usd??null}));
  } finally { await pool.end(); }
});
