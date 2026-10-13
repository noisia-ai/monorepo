import assert from 'node:assert/strict';
import test from 'node:test';
import {sanitizeHybridProviderErrorV1} from './hybrid-h1-provider-error';

test('capture stores allowlisted error metadata and never free messages, request IDs or echoed text',()=>{
 const raw=JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'requests.17.params.output_config.format.schema: secret user text and sk-ant-private',param:'requests.17.params.output_config.format.schema'},request_id:'private_request_id'});
 const out=sanitizeHybridProviderErrorV1(raw);
 assert.deepEqual(out,{type:'error',error_type:'invalid_request_error',code:null,param:'requests.17.params.output_config.format.schema',index:17});
 assert.equal(JSON.stringify(out).includes('secret'),false);assert.equal(JSON.stringify(out).includes('sk-ant'),false);
 assert.deepEqual(sanitizeHybridProviderErrorV1('{malformed private text'),{type:null,error_type:null,code:null,param:null,index:null});
});

test('only known billing signature and validated field paths become derived diagnostic codes',()=>{
 assert.equal(sanitizeHybridProviderErrorV1(JSON.stringify({error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.'}})).code,'credit_balance_insufficient');
 assert.equal(sanitizeHybridProviderErrorV1(JSON.stringify({error:{message:'echoed user says credit balance is too low',param:'arbitrary.private.secret'}})).code,null);
 assert.equal(sanitizeHybridProviderErrorV1(JSON.stringify({error:{message:'requests.3.params.max_tokens: invalid',param:'untrusted'}})).param,'requests.3.params.max_tokens');
});
