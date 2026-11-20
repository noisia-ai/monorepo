import assert from 'node:assert/strict';
import test from 'node:test';
import {runR16ListeningFaultMatrixV1} from './run-listening-fault-matrix';
test('fault runner refuses unowned lab or remote Redis before fixture creation or artifact writes',async()=>{
 const previous={lab:process.env.NOISIA_R16_LOCAL_PG_LAB,native:process.env.NOISIA_R16_NATIVE_FIXTURE_PG};let writes=0;
 const args={object_directory:'/not-created-by-this-test',redis_url:'redis://127.0.0.1:6379',writeArtifact:async()=>{writes++;}};
 try{
  delete process.env.NOISIA_R16_LOCAL_PG_LAB;delete process.env.NOISIA_R16_NATIVE_FIXTURE_PG;
  await assert.rejects(runR16ListeningFaultMatrixV1(args),/owned_native_lab_required/);
  process.env.NOISIA_R16_LOCAL_PG_LAB='r16-benchmark-pg17';process.env.NOISIA_R16_NATIVE_FIXTURE_PG='true';
  await assert.rejects(runR16ListeningFaultMatrixV1({...args,redis_url:'redis://remote.example.test:6379'}),/local_redis_required/);
  await assert.rejects(runR16ListeningFaultMatrixV1({...args,cases:[]}));assert.equal(writes,0);
 }finally{
  for(const [key,value]of[['NOISIA_R16_LOCAL_PG_LAB',previous.lab],['NOISIA_R16_NATIVE_FIXTURE_PG',previous.native]]as const)
   if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
