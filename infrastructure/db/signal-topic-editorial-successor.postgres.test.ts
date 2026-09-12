import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const container=process.env.NOISIA_ACTIVATION_PG_DOCKER;
const baseDatabase='noisia_topic_consolidation_smoke_0912';
const migrationNames:{[key:number]:string}={
  176:'signal_topic_consolidation_editorial',177:'signal_topic_consolidation_numeric_guard',
  178:'signal_topic_editorial_catalog_contract',179:'signal_topic_editorial_materialization',
  180:'signal_topic_editorial_role_hardening',181:'signal_topic_consolidation_activation',
  182:'signal_topic_editorial_plan_successor',
};
const migrations=[176,177,178,179,180,181,182].map(n=>readFileSync(
  new URL(`./migrations/0${n}_${migrationNames[n]}.sql`,import.meta.url),'utf8')).join('\n');
const source=readFileSync(new URL('./signal-topic-consolidation-editorial.ts',import.meta.url),'utf8');
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha=(c:string)=>`sha256:${c.repeat(64)}`;

function dockerPsql(database:string,input:string){
  return spawnSync('docker',['exec','-i',container!,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],
    {input,encoding:'utf8',maxBuffer:3_000_000});
}

function concurrentPsql(database:string,input:string):Promise<{code:number|null;stdout:string;stderr:string}>{
  return new Promise(resolve=>{
    const child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1']);
    let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
  });
}

test('status reader deterministically returns the latest editorial execution',()=>{
  assert.match(source,/WHERE e\.workspace_id=\$1 AND e\.numeric_run_id=\$2[\s\S]*ORDER BY e\.created_at DESC,e\.id DESC LIMIT 1/u);
});

test('0182 permits one concurrent zero-exposure successor and preserves every prior ledger row',
 {skip:!container,timeout:90000},async()=>{
  const database=`noisia_successor_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gu,'_');
  const create=spawnSync('docker',['exec',container!,'createdb','-U','postgres','-T',baseDatabase,database],{encoding:'utf8'});
  assert.equal(create.status,0,create.stderr);
  try {
    const body=JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'synthetic complete rejection'},request_id:'req_successor_400'});
    const setup=`SET statement_timeout='20s';\n${migrations}
      ALTER TABLE signal_topic_editorial_executions DISABLE TRIGGER ALL;
      ALTER TABLE signal_topic_editorial_requests DISABLE TRIGGER ALL;
      ALTER TABLE signal_topic_editorial_calls DISABLE TRIGGER ALL;
      ALTER TABLE signal_topic_editorial_outbox DISABLE TRIGGER ALL;
      ALTER TABLE signal_topic_editorial_executions ENABLE TRIGGER topic_editorial_successor_guard;
      INSERT INTO organizations(id,slug,legal_name,status) VALUES
       ('${id(1)}','successor-zero','Successor zero','active'),
       ('${id(2)}','successor-unknown','Successor unknown','active'),
       ('${id(3)}','successor-positive','Successor positive','active'),
       ('${id(4)}','successor-checkpoint','Successor checkpoint','active'),
       ('${id(5)}','successor-outbox','Successor outbox','active');
      SET session_replication_role=replica;
      INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
       source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,
       quote_reference,status,state_body,state_digest,error_code,created_at,supersedes_execution_id) VALUES
       ('${id(10)}','${id(20)}','${id(1)}','${id(30)}','${id(40)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(60)}',30000000,'failed-old-0001','${sha('c')}','old','failed','{"contract_version":"signal-topic-editorial-runner-v1","execution_key":"${id(10)}","plan_digest":"${sha('b')}","phase":"screening","screening_outputs":[],"global":null}','${sha('d')}','old_plan',clock_timestamp()-interval '2 minute',NULL),
       ('${id(11)}','${id(20)}','${id(1)}','${id(30)}','${id(40)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(61)}',30000000,'failed-latest-01','${sha('c')}','latest','failed','{"contract_version":"signal-topic-editorial-runner-v1","execution_key":"${id(11)}","plan_digest":"${sha('b')}","phase":"screening","screening_outputs":[],"global":null}','${sha('d')}','provider_rejected',clock_timestamp()-interval '1 minute','${id(10)}'),
       ('${id(12)}','${id(21)}','${id(2)}','${id(30)}','${id(41)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(62)}',30000000,'failed-unknown-1','${sha('c')}','unknown','failed','{"phase":"screening","screening_outputs":[]}','${sha('d')}','unknown',clock_timestamp(),NULL),
       ('${id(13)}','${id(22)}','${id(3)}','${id(30)}','${id(42)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(63)}',30000000,'failed-positive1','${sha('c')}','positive','failed','{"phase":"screening","screening_outputs":[]}','${sha('d')}','positive',clock_timestamp(),NULL),
       ('${id(14)}','${id(23)}','${id(4)}','${id(30)}','${id(43)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(64)}',30000000,'failed-checkpt-1','${sha('c')}','checkpoint','failed','{"phase":"screening","screening_outputs":[{"batch_index":0}]}','${sha('d')}','checkpoint',clock_timestamp(),NULL),
       ('${id(15)}','${id(24)}','${id(5)}','${id(30)}','${id(44)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(65)}',30000000,'failed-outbox-01','${sha('c')}','outbox','failed','{"phase":"screening","screening_outputs":[]}','${sha('d')}','outbox',clock_timestamp(),NULL);
      INSERT INTO signal_topic_editorial_requests(id,workspace_id,execution_id,phase,batch_index,request_digest,request_body,configuration,receipts,reserved_micro_usd) VALUES
       ('${id(70)}','${id(20)}','${id(11)}','screening',0,'${sha('e')}','request 400','{}','[]',500000),
       ('${id(71)}','${id(20)}','${id(11)}','screening',1,'${sha('f')}','request dns','{}','[]',500000),
       ('${id(72)}','${id(21)}','${id(12)}','screening',0,'${sha('1')}','request unknown','{}','[]',500000),
       ('${id(73)}','${id(22)}','${id(13)}','screening',0,'${sha('2')}','request positive','{}','[]',500000);
      INSERT INTO signal_topic_editorial_calls(id,workspace_id,organization_id,execution_id,request_id,status,reserved_micro_usd,
       settled_micro_usd,observed_micro_usd,budget_date,budget_timezone,response_body_private,response_sha256,response_storage_key,
       response_output,error_code,sent_at,response_at,settled_at,response_http_status,response_complete) VALUES
       ('${id(80)}','${id(20)}','${id(1)}','${id(11)}','${id(70)}','settled',500000,0,0,current_date,'UTC',$b$${body}$b$,'${sha('3')}','synthetic/400.json','{}','topic_editorial_provider_rejected',clock_timestamp(),clock_timestamp(),clock_timestamp(),400,true),
       ('${id(81)}','${id(20)}','${id(1)}','${id(11)}','${id(71)}','definitely_not_sent',500000,NULL,NULL,current_date,'UTC',NULL,NULL,NULL,NULL,'topic_editorial_definitely_not_sent',NULL,NULL,NULL,NULL,NULL),
       ('${id(82)}','${id(21)}','${id(2)}','${id(12)}','${id(72)}','outcome_unknown',500000,NULL,NULL,current_date,'UTC',NULL,NULL,NULL,NULL,'topic_editorial_outcome_unknown',clock_timestamp(),NULL,NULL,NULL,NULL),
       ('${id(83)}','${id(22)}','${id(3)}','${id(13)}','${id(73)}','settled',500000,123,123,current_date,'UTC','{}','${sha('4')}','synthetic/200.json','{}',NULL,clock_timestamp(),clock_timestamp(),clock_timestamp(),200,true);
      INSERT INTO signal_topic_editorial_outbox(workspace_id,execution_id,dispatch_generation,worker_job_id,status) VALUES
       ('${id(20)}','${id(11)}',1,'topic-editorial-${id(11)}-1','completed'),
       ('${id(24)}','${id(15)}',1,'topic-editorial-${id(15)}-1','queued');
      SET session_replication_role=origin;
      DO $$DECLARE d text;replay_pos integer;owner_pos integer;quote_pos integer;exposure record;BEGIN
       IF NOT signal_topic_editorial_execution_replaceable_v1('${id(11)}') THEN RAISE EXCEPTION 'zero-exposure predecessor not replaceable';END IF;
       IF signal_topic_editorial_execution_replaceable_v1('${id(12)}') OR signal_topic_editorial_execution_replaceable_v1('${id(13)}')
        OR signal_topic_editorial_execution_replaceable_v1('${id(14)}') OR signal_topic_editorial_execution_replaceable_v1('${id(15)}') THEN
        RAISE EXCEPTION 'unsafe predecessor accepted';END IF;
       SELECT * INTO exposure FROM signal_processing_org_exposure_v1('${id(1)}',current_date,'UTC');
       IF ROW(exposure.confirmed_micro_usd,exposure.reserved_micro_usd,exposure.ambiguous_micro_usd,exposure.total_micro_usd)
        IS DISTINCT FROM ROW(0::bigint,0::bigint,0::bigint,0::bigint) THEN RAISE EXCEPTION 'terminal 400 retained org exposure';END IF;
       SELECT * INTO exposure FROM signal_processing_org_exposure_v1('${id(2)}',current_date,'UTC');
       IF exposure.ambiguous_micro_usd<>500000 OR exposure.total_micro_usd<>500000 THEN RAISE EXCEPTION 'unknown exposure omitted';END IF;
       SELECT * INTO exposure FROM signal_processing_org_exposure_v1('${id(3)}',current_date,'UTC');
       IF exposure.confirmed_micro_usd<>123 OR exposure.total_micro_usd<>123 THEN RAISE EXCEPTION 'settled exposure omitted';END IF;
       d:=pg_get_functiondef('request_signal_topic_editorial_v1(uuid,uuid,uuid,jsonb,text,text)'::regprocedure);
       replay_pos:=strpos(d,'SELECT * INTO prior FROM signal_topic_editorial_request_keys');
       owner_pos:=strpos(d,'SELECT * INTO existing FROM signal_topic_editorial_executions');quote_pos:=strpos(d,'q:=signal_topic_editorial_quote_v1');
       IF replay_pos=0 OR owner_pos<=replay_pos OR quote_pos<=owner_pos THEN RAISE EXCEPTION 'replay occurs after quote/source drift';END IF;
       IF has_function_privilege('public','signal_topic_editorial_execution_replaceable_v1(uuid)','EXECUTE')
        OR has_function_privilege('public','request_signal_topic_editorial_v1(uuid,uuid,uuid,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'public successor authority';END IF;
       IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='signal_topic_editorial_executions'::regclass) THEN RAISE EXCEPTION 'execution RLS lost';END IF;
      END;$$;`;
    const prepared=dockerPsql(database,setup);
    assert.equal(prepared.status,0,prepared.stderr);

    const successor=(n:number)=>`BEGIN; SET LOCAL statement_timeout='15s';
      INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
       source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,status,supersedes_execution_id)
      VALUES('${id(n)}','${id(20)}','${id(1)}','${id(30)}','${id(40)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}',
       '${id(n+20)}',30000000,'successor-${n}-key','${sha('c')}','successor','queued','${id(11)}');COMMIT;`;
    const attempts=await Promise.all([concurrentPsql(database,successor(100)),concurrentPsql(database,successor(101))]);
    assert.equal(attempts.filter(result=>result.code===0).length,1,attempts.map(result=>result.stderr).join('\n'));
    assert.equal(attempts.filter(result=>result.code!==0).length,1,'concurrent successor fence did not reject exactly one writer');
    assert.match(attempts.find(result=>result.code!==0)!.stderr,/duplicate key value|unique constraint|topic_editorial_successor_invalid/u);

    const verify=dockerPsql(database,`DO $$BEGIN
      IF (SELECT count(*) FROM signal_topic_editorial_executions WHERE numeric_run_id='${id(40)}')<>3
       OR (SELECT count(*) FROM signal_topic_editorial_executions WHERE numeric_run_id='${id(40)}' AND status<>'failed')<>1
       OR (SELECT count(*) FROM signal_topic_editorial_executions WHERE supersedes_execution_id='${id(11)}')<>1 THEN
       RAISE EXCEPTION 'current execution cardinality invalid';END IF;
      IF (SELECT count(*) FROM signal_topic_editorial_requests WHERE execution_id='${id(11)}')<>2
       OR (SELECT count(*) FROM signal_topic_editorial_calls WHERE execution_id='${id(11)}')<>2
       OR (SELECT count(*) FROM signal_topic_editorial_outbox WHERE execution_id='${id(11)}')<>1 THEN
       RAISE EXCEPTION 'predecessor history changed';END IF;
      IF (SELECT ROW(status,settled_micro_usd,observed_micro_usd,error_code,response_http_status,response_complete)
          FROM signal_topic_editorial_calls WHERE id='${id(80)}')
       IS DISTINCT FROM ROW('settled'::text,0::bigint,0::bigint,'topic_editorial_provider_rejected'::text,400::smallint,true)
       OR (SELECT status FROM signal_topic_editorial_calls WHERE id='${id(81)}')<>'definitely_not_sent' THEN
       RAISE EXCEPTION 'HTTP400/DNS accounting history changed';END IF;
      BEGIN
       INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
        source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,status,supersedes_execution_id)
       VALUES('${id(110)}','${id(23)}','${id(4)}','${id(30)}','${id(43)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(130)}',30000000,
        'checkpoint-child','${sha('c')}','bad','queued','${id(14)}');RAISE EXCEPTION 'checkpoint successor accepted';
      EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_editorial_successor_invalid' THEN RAISE;END IF;END;
      BEGIN
       INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
        source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,status,supersedes_execution_id)
       VALUES('${id(111)}','${id(21)}','${id(2)}','${id(30)}','${id(41)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(131)}',30000000,
        'unknown-child-01','${sha('c')}','bad','queued','${id(12)}');RAISE EXCEPTION 'unknown successor accepted';
      EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_editorial_successor_invalid' THEN RAISE;END IF;END;
      BEGIN
       INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
        source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,status,supersedes_execution_id)
       VALUES('${id(112)}','${id(22)}','${id(3)}','${id(30)}','${id(42)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(132)}',30000000,
        'positive-child-1','${sha('c')}','bad','queued','${id(13)}');RAISE EXCEPTION 'positive-cost successor accepted';
      EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_editorial_successor_invalid' THEN RAISE;END IF;END;
      BEGIN
       INSERT INTO signal_topic_editorial_executions(id,workspace_id,organization_id,actor_user_id,numeric_run_id,source_engine_execution_id,
        source_binding,source_digest,plan,plan_digest,processing_admission_id,hard_cap_micro_usd,idempotency_key,request_digest,quote_reference,status,supersedes_execution_id)
       VALUES('${id(113)}','${id(24)}','${id(5)}','${id(30)}','${id(44)}','${id(50)}','{}','${sha('a')}','{}','${sha('b')}','${id(133)}',30000000,
        'outbox-child-001','${sha('c')}','bad','queued','${id(15)}');RAISE EXCEPTION 'queued-outbox successor accepted';
      EXCEPTION WHEN check_violation THEN IF SQLERRM<>'topic_editorial_successor_invalid' THEN RAISE;END IF;END;
    END;$$;`);
    assert.equal(verify.status,0,verify.stderr);
  } finally {
    spawnSync('docker',['exec',container!,'dropdb','-U','postgres','--force','--if-exists',database],{encoding:'utf8'});
  }
});
