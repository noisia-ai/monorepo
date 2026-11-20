import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import pg from 'pg';

const accreditedPools=new WeakSet<pg.Pool>();
export function assertR16LocalPostgresPoolV1(pool:pg.Pool):void{
  assert.ok(accreditedPools.has(pool),'the exact pool must be accredited by the owned Docker lab entrypoint');
}

/** Explicit local-only fixture entrypoint. The ordinary remote/CI guard is not
 * changed: local tests prove Docker ownership, loopback binding and server ID. */
export async function openR16LocalPostgresV1():Promise<pg.Pool>{
  assert.notEqual(process.env.GITHUB_ACTIONS,'true','local fixture is not a CI target override');
  return openOwnedR16PostgresV1(false);
}
export async function openR16CiPostgresV1():Promise<pg.Pool>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','dedicated R16 CI entrypoint requires real CI');
  return openOwnedR16PostgresV1(true);
}
async function openOwnedR16PostgresV1(ci:boolean):Promise<pg.Pool>{
  const name=process.env.NOISIA_R16_LOCAL_PG_LAB;
  assert.ok(name&&/^r16-(durable-pages|benchmark)-pg17$/u.test(name),'owned R16 lab required');
  if(ci)assert.equal(name,'r16-benchmark-pg17','CI must own the dedicated benchmark container');
  const url=new URL(process.env.DATABASE_URL??'');
  assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.pathname,'/noisia_mfp_ci');assert.equal(url.username,'postgres');
  assert.equal(url.search,'');assert.equal(url.hash,'');assert.ok(/^\d+$/u.test(url.port));
  const [container]=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}));
  assert.equal(container.Name,'/'+name);assert.equal(container.State.Running,true);
  assert.equal(container.Config.Image,'pgvector/pgvector:pg17');
  assert.ok(container.Config.Env.includes('POSTGRES_DB=noisia_mfp_ci'));
  const bindings=container.NetworkSettings.Ports['5432/tcp'];
  assert.deepEqual(bindings,[{HostIp:'127.0.0.1',HostPort:url.port}]);
  const expected=execFileSync('docker',['exec',name,'psql','-U','postgres','-d','noisia_mfp_ci','-Atc',
    'SELECT system_identifier::text FROM pg_control_system()'],{encoding:'utf8'}).trim();
  const pool=new pg.Pool({connectionString:url.href,ssl:false,max:4,connectionTimeoutMillis:10000});
  try{
    const {rows:[row]}=await pool.query(`SELECT current_database() database,current_setting('server_version_num')::int version,
      system_identifier::text system_identifier,EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') pgvector
      FROM pg_control_system()`);
    assert.equal(row.database,'noisia_mfp_ci');assert.ok(row.version>=170000&&row.version<180000);
    assert.equal(row.system_identifier,expected);assert.equal(row.pgvector,true);
    const g=globalThis as typeof globalThis&{noisiaStudioPgPool?:pg.Pool;noisiaWorkerPgPool?:pg.Pool;noisiaWorkerNumericPgPool?:pg.Pool};
    g.noisiaStudioPgPool=pool;g.noisiaWorkerPgPool=pool;g.noisiaWorkerNumericPgPool=pool;
    accreditedPools.add(pool);return pool;
  }catch(error){await pool.end();throw error;}
}
