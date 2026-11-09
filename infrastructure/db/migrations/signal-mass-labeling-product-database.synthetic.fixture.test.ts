import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {massLabelingProductCiTargetV1,createMassLabelingProductDatabaseFixtureV1} from './signal-mass-labeling-product-database.synthetic.fixture';

const target='postgresql://postgres:synthetic@127.0.0.1:5432/noisia_mfp_ci';
const env={GITHUB_ACTIONS:'true',NOISIA_MFP_PG_CI:'true',DATABASE_URL:target};
const overrides=['?host=remote.invalid','?port=6432','?database=other','?user=other','?sslmode=require',
  '?host=%2Ftmp%2Fsocket','?hostaddr=192.0.2.1','?options=-csearch_path%3Dother','#host=remote.invalid'];

test('CI product database target is pinned independently of encoded password characters',()=>{
 const url=massLabelingProductCiTargetV1({...env,DATABASE_URL:target.replace('synthetic','p%40ss%3Fhost%3Dremote.invalid%23fragment')});
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');assert.equal(url.pathname,'/noisia_mfp_ci');
 assert.equal(url.username,'postgres');assert.equal(url.search,'');assert.equal(url.hash,'');
});
test('CI product database rejects endpoint, TLS and socket overrides in a pure validator',()=>{
 for(const suffix of overrides)assert.throws(()=>massLabelingProductCiTargetV1({...env,DATABASE_URL:target+suffix}));
 for(const value of [{...env,GITHUB_ACTIONS:'false'},{...env,NOISIA_MFP_PG_CI:'false'},
   {...env,DATABASE_URL:target.replace('127.0.0.1','remote.invalid')}])assert.throws(()=>massLabelingProductCiTargetV1(value));
});
test('invalid URL overrides acquire no pool connection and execute no CREATE or DROP',async t=>{
 let effects=0;
 t.mock.method(pg.Pool.prototype,'query',()=>{effects++;throw new Error('unexpected_database_query');});
 t.mock.method(pg.Pool.prototype,'connect',()=>{effects++;throw new Error('unexpected_database_connection');});
 const previous={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_MFP_PG_CI:process.env.NOISIA_MFP_PG_CI,DATABASE_URL:process.env.DATABASE_URL};
 try{
  Object.assign(process.env,env);
  for(const suffix of overrides){process.env.DATABASE_URL=target+suffix;await assert.rejects(createMassLabelingProductDatabaseFixtureV1());}
  assert.equal(effects,0);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
