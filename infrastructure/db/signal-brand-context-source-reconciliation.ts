import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { signalSemanticContextProposalDigestV1 as digest } from '@noisia/query-engine';
import { resolveSignalBrandContextAuthorityV1, type BrandContextWorkspaceV1 } from './signal-brand-context-authority';
import { readSignalBrandOsCanonicalSnapshotV1, signalBrandOsCanonicalSnapshotHashV1 } from './signal-brand-os-snapshot';
import { buildSignalSemanticContextProposalRuntimeLineageV1, planSignalSemanticContextProposalCapacityForAuthorityV1,
  SignalSemanticContextProposalExecutionError, type SignalSemanticContextProposalRuntimeConfigurationV1 } from './signal-semantic-context-proposal';

export type SignalBrandContextSourceReconciliationV1 = {
  contract_version: 'brand-context-source-reconciliation-v1'; reconciliation_id: string; workspace_id: string;
  generation_id: string | null; generation_key: string | null;
  state: 'current' | 'awaiting_authorization' | 'awaiting_settlement'; replayed: boolean;
};
export type SignalBrandContextSourceReconciliationArgsV1 = {
  database: Pick<Pool, 'connect'>; workspace_id: string; actor_user_id: string; idempotency_key: string;
  /** Required CAS, including null for the first generation. Never inferred from a browser's stale price. */
  expected_generation_id: string | null;
  /** Server configuration only. No admission, cap, quote, or provider health can authorize spend here. */
  configuration: SignalSemanticContextProposalRuntimeConfigurationV1;
};
type Head = { id: string; generation_key: string; generation_version: number; status: 'draft' | 'published';
  brand_os_profile_id: string; brand_os_digest: string; knowledge_digest: string; locale_context_digest: string };
type Begun = { replayed: boolean; result?: SignalBrandContextSourceReconciliationV1;
  reconciliation_id: string; workspace: BrandContextWorkspaceV1; head: Head | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (code: string, status = 409): never => { throw new SignalSemanticContextProposalExecutionError(code, status); };

/** One free transaction: lock/CAS -> current Brand OS snapshot -> empty semantic
 * successor -> preparation receipt. A paid or ambiguous owner is never rewritten.
 * A fresh quote/confirmation is a later, separate transaction using SQL0156/0157's exact digest. */
export async function reconcileSignalBrandContextSourceV1(args: SignalBrandContextSourceReconciliationArgsV1): Promise<SignalBrandContextSourceReconciliationV1> {
  if (!uuid.test(args.workspace_id) || !uuid.test(args.actor_user_id)
    || args.expected_generation_id !== null && !uuid.test(args.expected_generation_id)
    || !/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)) return fail('brand_context_reconciliation_request_invalid', 422);
  const client = await args.database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const begun = (await client.query<{ value: Begun }>(
      'SELECT begin_signal_brand_context_source_reconciliation_v1($1::uuid,$2::uuid,$3,$4::uuid) value',
      [args.workspace_id,args.actor_user_id,args.idempotency_key,args.expected_generation_id])).rows[0]?.value;
    if (!begun) return fail('brand_context_reconciliation_unavailable');
    if (begun.replayed) {
      if (!begun.result) return fail('brand_context_reconciliation_incomplete');
      await client.query('COMMIT'); return {...begun.result,replayed:true};
    }
    const ws = begun.workspace, head = begun.head;
    await refreshAutomaticKnowledge(client, ws);
    await reconcileProfile(client, ws, args.actor_user_id, args.idempotency_key);
    const authority = await resolveSignalBrandContextAuthorityV1({queryable:client,workspace:ws});
    const matchingDigests = head && head.brand_os_profile_id === authority.brandOsProfileId
      && head.brand_os_digest === authority.brandOsDigest && head.knowledge_digest === authority.knowledgeDigest
      && head.locale_context_digest === authority.localeContextDigest;
    const sourceCurrent = head ? (await client.query<{current:boolean}>(
      'SELECT signal_brand_context_processing_source_current_v1($1::uuid) current',[head.id])).rows[0]?.current === true : false;
    if (matchingDigests && !sourceCurrent) return fail('brand_context_source_stale');
    const current = matchingDigests && sourceCurrent;
    let generationId = head?.id ?? null, generationKey = head?.generation_key ?? null;
    let state: SignalBrandContextSourceReconciliationV1['state'];
    if (current) {
      const used = (await client.query('SELECT id FROM signal_semantic_context_proposal_runs WHERE generation_id=$1::uuid', [head.id])).rows.length > 0;
      state = head.status === 'published' || used ? 'current' : 'awaiting_authorization';
    } else if (head && !(await client.query<{safe:boolean}>(
      'SELECT signal_brand_context_source_successor_safe_v1($1::uuid) safe',[head.id])).rows[0]?.safe) {
      // No child while a request can still produce a response or spend is unresolved.
      state = 'awaiting_settlement';
    } else {
      if (!args.configuration.available) return fail('brand_context_reconciliation_configuration_required');
      const version = (head?.generation_version ?? 0) + 1;
      generationKey = `semantic-context-v${version}`; generationId = randomUUID();
      const capacity = await planSignalSemanticContextProposalCapacityForAuthorityV1({queryable:client,
        workspace:{id:ws.id,organization_id:ws.organizationId,brand_id:ws.subject.id},authority:{
          generation_key:generationKey,brand_os_profile_id:authority.brandOsProfileId,brand_os_digest:authority.brandOsDigest,
          knowledge_digest:authority.knowledgeDigest,locale_context_digest:authority.localeContextDigest,
          primary_locale:authority.primaryLocale,locale_variants:authority.localeVariants,markets:authority.markets,timezone:authority.timezone}});
      const lineage = buildSignalSemanticContextProposalRuntimeLineageV1(args.configuration,capacity);
      const action = head ? 'reconcile-semantic-context-generation' : 'create-semantic-context-draft';
      const op = await beginOperation(client,args,`${begun.reconciliation_id}:generation`,action,
        {source_authority_digest:authority.sourceAuthorityDigest,expected_generation_id:args.expected_generation_id});
      const draftDigest = digest({contract_version:'signal-semantic-context-pack-v1',generation_key:generationKey,
        source_authority_digest:authority.sourceAuthorityDigest,elements:[]});
      const artifact = (await client.query<{id:string}>(`INSERT INTO analysis_artifacts(workspace_id,workspace_artifact_kind,
        workspace_authority_digest,artifact_key,artifact_type,content,review_status,revision,metadata)
        VALUES($1::uuid,'semantic_context',$2,$3,'semantic_context_pack_generation',$4::jsonb,'needs_review',1,$5::jsonb) RETURNING id`,
      [ws.id,authority.sourceAuthorityDigest,generationKey,JSON.stringify({contract_version:'signal-semantic-context-pack-v1',generation_version:version,lifecycle_state:'draft'}),
        JSON.stringify({authority_only:true,source_reconciliation_id:begun.reconciliation_id})])).rows[0]!;
      await client.query('UPDATE signal_brand_context_source_reconciliations SET generation_id=$2::uuid WHERE id=$1::uuid', [begun.reconciliation_id,generationId]);
      const reason = !head ? null : head.brand_os_profile_id!==authority.brandOsProfileId || head.brand_os_digest!==authority.brandOsDigest
        ? 'brand_os_drift' : head.knowledge_digest!==authority.knowledgeDigest ? 'knowledge_drift' : 'locale_market_drift';
      await client.query(`INSERT INTO signal_semantic_context_generations(id,workspace_id,artifact_id,generation_key,generation_version,
        status,supersedes_generation_id,supersession_reason,brand_os_profile_id,brand_os_profile_version,brand_os_digest,
        knowledge_generation_key,knowledge_digest,locale_context_digest,primary_locale,locale_variants,markets,timezone,
        proposal_model,proposal_model_version,proposal_prompt_digest,proposal_pricing_version,proposal_provider_lineage,
        proposal_provider_lineage_digest,draft_digest,created_operation_id,created_by_user_id)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,'draft',$6::uuid,$7,$8::uuid,$9,$10,$11,$12,$13,$14,$15::text[],$16::text[],$17,
          $18,$19,$20,$21,$22::jsonb,$23,$24,$25::uuid,$26::uuid)`,
      [generationId,ws.id,artifact.id,generationKey,version,head?.id??null,reason,authority.brandOsProfileId,authority.brandOsProfileVersion,
        authority.brandOsDigest,authority.knowledgeGenerationKey,authority.knowledgeDigest,authority.localeContextDigest,
        authority.primaryLocale,authority.localeVariants,authority.markets,authority.timezone,lineage.model,lineage.model_version,
        lineage.prompt.digest,lineage.pricing.version,JSON.stringify(lineage),lineage.lineage_digest,draftDigest,op,args.actor_user_id]);
      await completeOperation(client,op,{generation_key:generationKey,generation_version:version,status:'draft'});
      state = 'awaiting_authorization';
    }
    await client.query('UPDATE signal_brand_context_source_reconciliations SET generation_id=$2::uuid WHERE id=$1::uuid', [begun.reconciliation_id,generationId]);
    if (state === 'awaiting_authorization') {
      const input = {contract_version:'brand-context-preparation-input-v1',generation_id:generationId,generation_key:generationKey,
        primary_locale:authority.primaryLocale,source_authority_digest:authority.sourceAuthorityDigest,
        admission:null,source_reconciliation_id:begun.reconciliation_id};
      const op = await beginOperation(client,args,`${begun.reconciliation_id}:preparation`,'prepare-brand-context',input,input);
      await completeOperation(client,op,{contract_version:'brand-context-preparation-v1',operation_id:op,workspace_id:ws.id,
        generation_id:generationId,generation_key:generationKey,state:'awaiting_authorization',semantic_run_id:null,
        prototype_run_id:null,active_elements:0,exceptions:0,error_code:null,replayed:false});
    }
    const result: SignalBrandContextSourceReconciliationV1 = {contract_version:'brand-context-source-reconciliation-v1',
      reconciliation_id:begun.reconciliation_id,workspace_id:ws.id,generation_id:generationId,generation_key:generationKey,state,replayed:false};
    await client.query(`UPDATE signal_brand_context_source_reconciliations SET status='completed',result=$2::jsonb WHERE id=$1::uuid`,
      [begun.reconciliation_id,JSON.stringify(result)]);
    await client.query('COMMIT'); return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    if(error instanceof SignalSemanticContextProposalExecutionError) throw error;
    if(error instanceof Error && /^(brand_context|processing)_[a-z_]+$/u.test(error.message))
      return fail(error.message,error.message.endsWith('_forbidden')?403:409);
    throw error;
  } finally {client.release();}
}

async function beginOperation(client:PoolClient,args:SignalBrandContextSourceReconciliationArgsV1,key:string,action:string,input:unknown,preparation?:unknown){
  return (await client.query<{id:string}>(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,
    action,request_digest,idempotency_key,brand_context_preparation,created_at)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,clock_timestamp()) RETURNING id`,
  [args.workspace_id,args.actor_user_id,action,digest({contract_version:'signal-product-operation-v1',workspace_id:args.workspace_id,action,input}),
    digest(key),preparation?JSON.stringify(preparation):null])).rows[0]!.id;
}
async function completeOperation(client:PoolClient,id:string,result:unknown){
  await client.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid AND status='in_progress'`,[id,JSON.stringify(result)]);
}

async function refreshAutomaticKnowledge(client:PoolClient,ws:BrandContextWorkspaceV1){
  const state=await readSignalBrandOsCanonicalSnapshotV1({queryable:client,brand_id:ws.subject.id,organization_id:ws.organizationId});
  if(!state)return fail('brand_context_reconciliation_source_missing');
  const sources=(await client.query<{id:string;raw_text:string;extracted_payload:Record<string,unknown>}>(`
    SELECT id,raw_text,extracted_payload FROM brand_knowledge_sources WHERE brand_id=$1::uuid AND organization_id=$2::uuid
      AND study_corpus_id IS NULL AND source_kind='brand_os_context' AND extracted_payload->>'source'='automatic_brand_os'
    ORDER BY id FOR UPDATE`,[ws.subject.id,ws.organizationId])).rows;
  for(const source of sources){
    const notes=typeof source.extracted_payload.confirmed_additional_context==='string'?source.extracted_payload.confirmed_additional_context:null;
    const rawText=[`Marca: ${state.name}`,state.description?.trim()?`Descripción: ${state.description.trim()}`:null,
      state.industry?.trim()?`Industria: ${state.industry.trim()}`:null,state.industry_sub?.trim()?`Subindustria: ${state.industry_sub.trim()}`:null,
      `Mercados: ${state.countries.join(', ')}`,state.aliases.length?`Alias y handles: ${state.aliases.join(', ')}`:null,
      state.competitors.length?`Competidores: ${state.competitors.map(row=>row.name).join(', ')}`:null,
      notes?.trim()?`Contexto adicional confirmado por el usuario:\n${notes.trim()}`:null].filter(Boolean).join('\n\n');
    if(rawText.length>200_000)return fail('brand_context_knowledge_source_too_large',422);
    if(rawText===source.raw_text)continue;
    await client.query(`UPDATE brand_knowledge_sources SET raw_text=$2,extracted_payload=extracted_payload||jsonb_build_object(
      'summary',left($2,1200),'source','automatic_brand_os','confirmed_additional_context',$3::text),
      status='processed',error_message=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[source.id,rawText,notes]);
  }
}

async function reconcileProfile(client:PoolClient,ws:BrandContextWorkspaceV1,actor:string,key:string){
  const state=await readSignalBrandOsCanonicalSnapshotV1({queryable:client,brand_id:ws.subject.id,organization_id:ws.organizationId});
  if(!state)return fail('brand_context_reconciliation_source_missing');
  const hash=signalBrandOsCanonicalSnapshotHashV1(state);
  const current=(await client.query<{id:string;hash:string}>(`SELECT id,metadata->>'snapshot_hash' hash FROM brand_os_profiles
    WHERE brand_id=$1::uuid AND organization_id=$2::uuid AND status='active' ORDER BY version DESC LIMIT 1 FOR UPDATE`,[ws.subject.id,ws.organizationId])).rows[0];
  if(current?.hash===hash)return;
  if(current)await client.query("UPDATE brand_os_profiles SET status='retired',updated_at=clock_timestamp() WHERE id=$1::uuid",[current.id]);
  const profile=(await client.query<{id:string}>(`INSERT INTO brand_os_profiles(organization_id,brand_id,name,status,version,metadata)
    SELECT $1::uuid,$2::uuid,$3||' Brand OS','active',COALESCE(max(version),0)+1,$4::jsonb FROM brand_os_profiles
    WHERE brand_id=$2::uuid RETURNING id`,[ws.organizationId,ws.subject.id,state.name,JSON.stringify({source:'governance-control-v1',
      snapshot_hash:hash,reconciled_by_user_id:actor,reconciliation_key_hash:digest(key),display_name:state.name,description:state.description,
      industry:state.industry,industry_sub:state.industry_sub,countries:state.countries,aliases:state.aliases,knowledge_source_count:state.knowledge_count})])).rows[0]!;
  await client.query(`INSERT INTO brand_os_competitors(brand_os_profile_id,competitor_name,competitor_brand_seed_id,role,priority,metadata)
    SELECT $1::uuid,seed.canonical_name,seed.id,'governed_competitor',row_number() OVER(ORDER BY lower(seed.canonical_name),seed.id),
      '{"source":"governance-control-v1"}'::jsonb FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
    WHERE competitor.brand_id=$2::uuid AND competitor.status='current' AND seed.active ON CONFLICT DO NOTHING`,[profile.id,ws.subject.id]);
  const seed=(await client.query<{id:string}>(`INSERT INTO brand_os_seed_sets(brand_os_profile_id,name,seed_set_type,status,metadata)
    VALUES($1::uuid,'Governed identity seeds','workspace_identity','active','{"source":"governance-control-v1"}') RETURNING id`,[profile.id])).rows[0]!;
  await client.query(`INSERT INTO brand_os_seed_terms(seed_set_id,term,term_type,brand_seed_id,metadata)
    SELECT $1::uuid,term,'keyword',NULL,'{"scope":"primary_brand"}'::jsonb FROM unnest($2::text[]) term WHERE NULLIF(btrim(term),'') IS NOT NULL
    UNION ALL SELECT $1::uuid,seed.canonical_name,'brand_seed',seed.id,'{"scope":"competitor"}'::jsonb
    FROM competitors competitor JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id
    WHERE competitor.brand_id=$3::uuid AND competitor.status='current' AND seed.active ON CONFLICT DO NOTHING`,[seed.id,state.aliases,ws.subject.id]);
}
