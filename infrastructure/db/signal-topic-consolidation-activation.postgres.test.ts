import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const container=process.env.NOISIA_ACTIVATION_PG_DOCKER;
const migration=readFileSync(new URL('./migrations/0181_signal_topic_consolidation_activation.sql',import.meta.url),'utf8');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha=(c:string)=>`sha256:${c.repeat(64)}`;
function fn(name:string){const start=migration.indexOf(`CREATE FUNCTION ${name}(`),end=migration.indexOf('$$;',start)+3;
 return migration.slice(start,end).replace(`CREATE FUNCTION ${name}(`,`CREATE FUNCTION activation_contract_test.${name}(`)
  .replaceAll('SET search_path=public,extensions,pg_temp','SET search_path=activation_contract_test,public,extensions,pg_temp');}
test('PostgreSQL parses the complete migration; activation/selection/crash replay/rollback/CAS/roles preserve source and serving',
 {skip:!container,timeout:60000},()=>{
 const prerequisite=[176,177,178,179,180].map(n=>{
  const names:{[key:number]:string}={176:'signal_topic_consolidation_editorial',177:'signal_topic_consolidation_numeric_guard',178:'signal_topic_editorial_catalog_contract',179:'signal_topic_editorial_materialization',180:'signal_topic_editorial_role_hardening'};
  return readFileSync(new URL(`./migrations/0${n}_${names[n]}.sql`,import.meta.url),'utf8');}).join('\n');
 const catalog=[{concept_id:id(8),concept_key:'topic-real',term_key:`consolidated_${'a'.repeat(64)}`,kind:'topic',
  definition_digest:sha('a'),semantic_identity_digest:sha('a'),definition_revision:1}];
 const reader=readFileSync(new URL('./signal-workspace-topics-serving.ts',import.meta.url),'utf8');
 const population=reader.split('const populationSql = `')[1]!.split('`;')[0]!;
 const sql=`BEGIN; SET LOCAL statement_timeout='15s';
 ${prerequisite}\n${migration}
 PREPARE consolidation_serving_read(uuid,uuid,date,date,jsonb) AS ${population} SELECT * FROM population;
 CREATE SCHEMA activation_contract_test; SET LOCAL search_path=activation_contract_test,public,extensions;
 CREATE TABLE authority(allowed boolean);INSERT INTO authority VALUES(true);
 CREATE TABLE signal_workspaces(id uuid,topic_signal_selection jsonb);
 CREATE TABLE signal_classification_generations(id uuid,workspace_id uuid,status text);
 CREATE TABLE signal_topic_consolidation_revisions(id uuid,status text);
 CREATE TABLE signal_topic_consolidation_snapshots(id uuid,workspace_id uuid,revision_id uuid,revision_digest text,snapshot_digest text,source_engine_execution_id uuid,catalog jsonb,current boolean,consolidation_run_id uuid,preparation_run_id uuid);
 CREATE TABLE signal_topic_consolidation_bindings(workspace_id uuid PRIMARY KEY,snapshot_id uuid,legacy_generation_id uuid,binding_revision bigint,selection_revision bigint,selection jsonb,operation_id uuid,updated_at timestamptz);
 CREATE TABLE signal_topic_consolidation_activation_operations(id uuid,workspace_id uuid,actor_user_id uuid,idempotency_key text,request_digest text,action text,command jsonb,previous_binding jsonb,result_binding jsonb);
 CREATE FUNCTION signal_brand_context_processing_lock_actor_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN
  IF $1<>'${id(1)}'::uuid OR $2<>'${id(2)}'::uuid OR NOT(SELECT allowed FROM activation_contract_test.authority) THEN RAISE EXCEPTION 'processing_forbidden';END IF;END;$$;
 CREATE FUNCTION signal_workspace_selection_serving_generation_v1(uuid) RETURNS uuid LANGUAGE sql AS $$SELECT '${id(3)}'::uuid$$;
 CREATE FUNCTION signal_workspace_projection_source_current_v1(signal_classification_generations) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION signal_topic_consolidation_snapshot_current_v1(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT COALESCE((SELECT current FROM activation_contract_test.signal_topic_consolidation_snapshots WHERE id=$1),false)$$;
 ${fn('signal_topic_consolidation_binding_v1')}
 ${fn('mutate_signal_topic_consolidation_binding_v1')}
 ${fn('signal_topic_consolidation_binding_guard_v1')}
 CREATE TRIGGER binding_guard BEFORE INSERT OR UPDATE OR DELETE ON signal_topic_consolidation_bindings FOR EACH ROW EXECUTE FUNCTION signal_topic_consolidation_binding_guard_v1();
 INSERT INTO signal_workspaces VALUES('${id(1)}','{"revision":7,"items":{"legacy":{"selected":true,"definition_digest":"${sha('f')}"}}}');
 INSERT INTO signal_classification_generations VALUES('${id(3)}','${id(1)}','ready');
 INSERT INTO signal_topic_consolidation_revisions VALUES('${id(5)}','validated');
 INSERT INTO signal_topic_consolidation_snapshots VALUES('${id(4)}','${id(1)}','${id(5)}','${sha('b')}','${sha('c')}','${id(6)}','${JSON.stringify(catalog)}',true,'${id(9)}','${id(10)}');
 CREATE TABLE signal_corpus_preparation_items(workspace_id uuid,run_id uuid,root_id uuid,disposition text);
 CREATE TABLE signal_topic_atomic_group_roots(consolidation_run_id uuid,atomic_group_id uuid,canonical_root_id uuid);
 CREATE TABLE signal_topic_consolidation_decisions(revision_id uuid,atomic_group_id uuid,concept_id uuid,disposition text);
 INSERT INTO signal_corpus_preparation_items VALUES('${id(1)}','${id(10)}','${id(11)}','eligible'),('${id(1)}','${id(10)}','${id(12)}','eligible'),('${id(1)}','${id(10)}','${id(13)}','eligible');
 INSERT INTO signal_topic_atomic_group_roots VALUES('${id(9)}','${id(14)}','${id(11)}'),('${id(9)}','${id(15)}','${id(11)}'),('${id(9)}','${id(15)}','${id(12)}');
 INSERT INTO signal_topic_consolidation_decisions VALUES('${id(5)}','${id(14)}',NULL,'noise'),('${id(5)}','${id(15)}','${id(8)}','topic');
 ${migration.slice(migration.indexOf('CREATE VIEW signal_topic_consolidation_snapshot_roots_v1'),migration.indexOf('DO $$ DECLARE item record;role_name text; BEGIN'))}
 DO $$BEGIN
  IF (SELECT count(*) FROM signal_topic_consolidation_snapshot_roots_v1)<>3 OR (SELECT count(*) FROM signal_topic_consolidation_snapshot_memberships_v1)<>2 THEN RAISE EXCEPTION 'lineage/denominator invalid';END IF;
  IF (SELECT resolution_state FROM signal_topic_consolidation_snapshot_roots_v1 WHERE root_id='${id(11)}')<>'resolved' OR (SELECT resolution_state FROM signal_topic_consolidation_snapshot_roots_v1 WHERE root_id='${id(13)}')<>'abstained' THEN RAISE EXCEPTION 'noise incorrectly excludes root';END IF;
 END;$$;
 DO $$DECLARE initial jsonb;cmd jsonb;result jsonb;again jsonb;selected jsonb;rollback_result jsonb;activation uuid;BEGIN
 initial:=signal_topic_consolidation_binding_v1('${id(1)}');
 IF initial->>'legacy_generation_id'<>'${id(3)}' OR initial->>'binding_revision'<>'0' THEN RAISE EXCEPTION 'pending changed serving';END IF;
 cmd:=jsonb_build_object('action','activate','snapshot_id','${id(4)}','snapshot_digest','${sha('c')}','revision_digest','${sha('b')}',
 'expected_binding_revision',0,'expected_selection_revision',7,'expected_snapshot_id',NULL,'expected_legacy_generation_id','${id(3)}','selected_concept_keys',jsonb_build_array('topic-real'));
 result:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','activate-001',cmd);activation:=(result->>'operation_id')::uuid;
 again:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','activate-001',cmd);
 IF again->>'replayed'<>'true' OR again->>'operation_id'<>result->>'operation_id' OR (SELECT count(*) FROM signal_topic_consolidation_activation_operations)<>1 THEN RAISE EXCEPTION 'crash replay duplicated activation';END IF;
 IF result->'binding'->'selection' ? 'legacy' OR result->'binding'->'selection'->'${catalog[0]!.term_key}'->>'selected'<>'true' THEN RAISE EXCEPTION 'legacy auto-mapped or explicit selection missing';END IF;
 BEGIN PERFORM mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','stale-command',cmd);RAISE EXCEPTION 'missing CAS';EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_consolidation_activation_conflict' THEN RAISE;END IF;END;
 cmd:=jsonb_build_object('action','select','term_key','${catalog[0]!.term_key}','definition_digest','${sha('a')}','selected',false,
 'expected_binding_revision',1,'expected_selection_revision',8,'expected_snapshot_id','${id(4)}','expected_legacy_generation_id',NULL);
 selected:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','selection-001',cmd);
 again:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','selection-001',cmd);
 IF again->>'replayed'<>'true' OR again->>'operation_id'<>selected->>'operation_id' OR selected->'binding'->'selection'->'${catalog[0]!.term_key}'->>'selected'<>'false' THEN RAISE EXCEPTION 'selection replay invalid';END IF;
 UPDATE authority SET allowed=false;
 BEGIN PERFORM mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','selection-001',cmd);RAISE EXCEPTION 'missing revocation';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'processing_forbidden' THEN RAISE;END IF;END;
 UPDATE authority SET allowed=true;
 cmd:=jsonb_build_object('action','rollback','activation_operation_id',activation,'expected_binding_revision',2,'expected_selection_revision',9,'expected_snapshot_id','${id(4)}','expected_legacy_generation_id',NULL);
 rollback_result:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','rollback-001',cmd);
 IF rollback_result->'binding'->>'legacy_generation_id'<>'${id(3)}' OR rollback_result->'binding'->'selection' IS DISTINCT FROM initial->'selection' THEN RAISE EXCEPTION 'rollback lost old binding/selection';END IF;
 IF (SELECT topic_signal_selection FROM signal_workspaces)->>'revision'<>'7' THEN RAISE EXCEPTION 'legacy selection mutated';END IF;

 -- A successor keeps semantic identity for the client to prefill, while the
 -- explicit submitted selection remains authoritative for every concept.
 cmd:=jsonb_build_object('action','activate','snapshot_id','${id(4)}','snapshot_digest','${sha('c')}','revision_digest','${sha('b')}',
 'expected_binding_revision',3,'expected_selection_revision',7,'expected_snapshot_id',NULL,'expected_legacy_generation_id','${id(3)}','selected_concept_keys',jsonb_build_array('topic-real'));
 UPDATE signal_topic_consolidation_snapshots SET current=false;
 BEGIN PERFORM mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','stale-source',cmd);RAISE EXCEPTION 'missing source fence';EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_consolidation_activation_source_stale' THEN RAISE;END IF;END;
 UPDATE signal_topic_consolidation_snapshots SET current=true;
 result:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','activate-002',cmd);
 INSERT INTO signal_topic_consolidation_revisions VALUES('${id(21)}','validated');
 INSERT INTO signal_topic_consolidation_snapshots SELECT '${id(20)}',workspace_id,'${id(21)}',revision_digest,'${sha('d')}',source_engine_execution_id,
 catalog||jsonb_build_array((catalog->0)||jsonb_build_object('concept_key','changed','term_key','consolidated_${'e'.repeat(64)}','semantic_identity_digest','${sha('e')}','definition_digest','${sha('e')}')),true,consolidation_run_id,preparation_run_id FROM signal_topic_consolidation_snapshots WHERE id='${id(4)}';
 cmd:=jsonb_build_object('action','activate','snapshot_id','${id(20)}','snapshot_digest','${sha('d')}','revision_digest','${sha('b')}',
 'expected_binding_revision',4,'expected_selection_revision',8,'expected_snapshot_id','${id(4)}','expected_legacy_generation_id',NULL,'selected_concept_keys','[]'::jsonb);
 result:=mutate_signal_topic_consolidation_binding_v1('${id(1)}','${id(2)}','activate-003',cmd);
 IF result->'binding'->'selection'->'${catalog[0]!.term_key}'->>'selected'<>'false'
 OR result->'binding'->'selection'->'consolidated_${'e'.repeat(64)}'->>'selected'<>'false' THEN RAISE EXCEPTION 'explicit successor selection was overridden';END IF;
 BEGIN UPDATE signal_topic_consolidation_bindings SET snapshot_id='${id(4)}';RAISE EXCEPTION 'missing immutable binding proof';EXCEPTION WHEN check_violation THEN NULL;END;
 END;$$;
 ROLLBACK;`;
 const result=spawnSync('docker',['exec','-i',container!,'psql','-U','postgres','-d','noisia_topic_consolidation_smoke_0912','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:2_000_000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ROLLBACK/u);
});

test('a durable Anthropic 400 reconciles outcome_unknown to settled zero without duplicate send authority or exposure',
 {skip:!container,timeout:60000},()=>{
 const prerequisite=[176,177,178,179,180].map(n=>{
  const names:{[key:number]:string}={176:'signal_topic_consolidation_editorial',177:'signal_topic_consolidation_numeric_guard',178:'signal_topic_editorial_catalog_contract',179:'signal_topic_editorial_materialization',180:'signal_topic_editorial_role_hardening'};
  return readFileSync(new URL(`./migrations/0${n}_${names[n]}.sql`,import.meta.url),'utf8');}).join('\n');
 const body=JSON.stringify({type:'error',error:{type:'invalid_request_error',
  message:"output_config.format.schema: For 'array' type, property 'maxItems' is not supported"},request_id:'req_synthetic_400'});
 const bodySql=`$provider400$${body}$provider400$`;
 const sql=`BEGIN; SET LOCAL statement_timeout='15s';\n${prerequisite}\n${migration}
 -- Reproduce the durable state left by the pre-0181 runtime: the complete
 -- response is present, but its usage was classified as outcome_unknown.
 SET LOCAL session_replication_role=replica;
 INSERT INTO organizations(id,slug,legal_name,status)
 VALUES('${id(33)}','synthetic-editorial-400','Synthetic editorial 400','active');
 INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,
  source_engine_execution_id,source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,
  idempotency_key,request_digest,quote_reference,status,execution_token,execution_expires_at,attempt_count)
 VALUES('${id(31)}','${id(32)}','${id(33)}','${id(34)}','${id(35)}','${id(36)}','{}','${sha('1')}',
  '{}','${sha('2')}','${id(37)}',30000000,'synthetic-accounting-400','${sha('3')}','synthetic-quote','running',
  '${id(38)}',clock_timestamp()+interval '5 minutes',1);
 INSERT INTO signal_topic_editorial_requests(id,workspace_id,execution_id,phase,batch_index,request_digest,
  request_body,configuration,receipts,reserved_micro_usd)
 VALUES('${id(39)}','${id(32)}','${id(31)}','screening',0,'${sha('4')}','synthetic request','{}','[]',687372);
 INSERT INTO signal_topic_editorial_calls(id,workspace_id,organization_id,execution_id,request_id,attempt_token,status,
  reserved_micro_usd,budget_date,budget_timezone,response_body_private,response_sha256,response_storage_key,error_code,
  sent_at,response_at,response_http_status,response_complete,response_provider_request_id)
 VALUES('${id(40)}','${id(32)}','${id(33)}','${id(31)}','${id(39)}','${id(41)}','outcome_unknown',687372,
  current_date,'UTC',${bodySql},signal_semantic_context_digest_v1(${bodySql}),
  'synthetic/topic-editorial/complete-400.json','topic_editorial_usage_unresolved',clock_timestamp(),clock_timestamp(),400,true,NULL);
 SET LOCAL session_replication_role=origin;
 DO $$DECLARE before_row record;persisted jsonb;settled jsonb;replayed jsonb;after_row record;BEGIN
  SELECT * INTO before_row FROM signal_processing_org_exposure_v1('${id(33)}',current_date,'UTC');
  IF ROW(before_row.confirmed_micro_usd,before_row.reserved_micro_usd,before_row.ambiguous_micro_usd,before_row.total_micro_usd)
    IS DISTINCT FROM ROW(0::bigint,0::bigint,687372::bigint,687372::bigint) THEN
   RAISE EXCEPTION 'synthetic 400 did not begin as ambiguous exposure';END IF;
  persisted:=persist_signal_topic_editorial_receipt_v1('${id(40)}','${id(41)}','${sha('4')}',
   ${bodySql},'synthetic/topic-editorial/complete-400.json',400,true,NULL);
  IF persisted IS DISTINCT FROM '{"status":"response_persisted","replayed":true}'::jsonb THEN
   RAISE EXCEPTION 'durable 400 receipt was not recovered';END IF;
  settled:=settle_signal_topic_editorial_call_v1('${id(40)}','${id(41)}');
  IF settled->>'status'<>'settled' OR settled->>'settled_micro_usd'<>'0' OR settled->>'replayed'<>'false' THEN
   RAISE EXCEPTION 'durable 400 did not settle at zero';END IF;
  replayed:=persist_signal_topic_editorial_receipt_v1('${id(40)}','${id(41)}','${sha('4')}',
   ${bodySql},'synthetic/topic-editorial/complete-400.json',400,true,NULL);
  IF replayed->>'status'<>'settled' OR replayed->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'durable 400 receipt replay was not idempotent';END IF;
  replayed:=settle_signal_topic_editorial_call_v1('${id(40)}','${id(41)}');
  IF replayed->>'status'<>'settled' OR replayed->>'settled_micro_usd'<>'0' OR replayed->>'replayed'<>'true' THEN
   RAISE EXCEPTION 'zero settlement replay was not idempotent';END IF;
  SELECT * INTO after_row FROM signal_processing_org_exposure_v1('${id(33)}',current_date,'UTC');
  IF ROW(after_row.confirmed_micro_usd,after_row.reserved_micro_usd,after_row.ambiguous_micro_usd,after_row.total_micro_usd)
    IS DISTINCT FROM ROW(0::bigint,0::bigint,0::bigint,0::bigint) THEN
   RAISE EXCEPTION 'settled 400 retained budget exposure';END IF;
  IF (SELECT count(*) FROM signal_topic_editorial_calls WHERE request_id='${id(39)}')<>1
   OR (SELECT ROW(status,observed_micro_usd,settled_micro_usd,error_code,response_http_status,response_complete)
       FROM signal_topic_editorial_calls WHERE id='${id(40)}')
      IS DISTINCT FROM ROW('settled'::text,0::bigint,0::bigint,'topic_editorial_provider_rejected'::text,400::smallint,true) THEN
   RAISE EXCEPTION 'known rejection ledger state invalid';END IF;
 END;$$;
 -- Even with every trigger disabled, the live-call uniqueness fence prevents a
 -- second call for this request. Recovery therefore cannot become a resend.
 SET LOCAL session_replication_role=replica;SAVEPOINT duplicate_send;
 DO $$BEGIN
  BEGIN INSERT INTO signal_topic_editorial_calls(workspace_id,organization_id,execution_id,request_id,status,
   reserved_micro_usd,budget_date,budget_timezone) VALUES('${id(32)}','${id(33)}','${id(31)}','${id(39)}',
   'reserved',687372,current_date,'UTC');RAISE EXCEPTION 'duplicate call accepted';
  EXCEPTION WHEN unique_violation THEN NULL;END;
 END;$$;
 ROLLBACK TO SAVEPOINT duplicate_send;SET LOCAL session_replication_role=origin;
 ROLLBACK;`;
 const result=spawnSync('docker',['exec','-i',container!,'psql','-U','postgres','-d','noisia_topic_consolidation_smoke_0912','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:2_000_000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ROLLBACK/u);
});
