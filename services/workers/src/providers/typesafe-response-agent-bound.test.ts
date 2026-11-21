import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {Agent} from 'undici';

// A separate diagnostic for an EXPLICIT transport contract. Its deliberately
// small limits belong only to this owned fixture, never to the real provider.
test('R16 explicit Agent observes header/body byte bounds without losing legal raw controls', {timeout:20_000}, async()=>{
  assert.equal(process.versions.node.split('.')[0],'20');
  const headerLimit=8192,bodyLimit=16,sockets=new Set<Socket>();
  let header='7',body='x',knownPrimary=false,primary:unknown,receipt:Record<string,unknown>|undefined;
  const observations:Array<{name:string;header_characters:number;body_utf8_bytes:number;accepted:boolean;error_code:string|null}>=[];
  const agent=new Agent({maxHeaderSize:headerLimit,maxResponseSize:bodyLimit});
  const server=createServer((_request,response)=>{
    response.setHeader('retry-after',header);response.setHeader('content-length',Buffer.byteLength(body));
    response.setHeader('connection','close');response.end(body);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try{
    await new Promise<void>((resolve,reject)=>{
      const failed=(error:Error)=>{server.off('listening',ready);reject(error);};
      const ready=()=>{server.off('error',failed);resolve();};
      server.once('error',failed);server.once('listening',ready);server.listen(0,'127.0.0.1');
    });
    const address=server.address();assert.ok(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/owned-agent-probe`,deadline=performance.now()+12_000;
    async function exchange(name:string,nextHeader:string,nextBody:string,expectedError?:string){
      assert.ok(observations.length<10);const remaining=Math.floor(deadline-performance.now());assert.ok(remaining>0);
      header=nextHeader;body=nextBody;let failed=false,error:unknown,received:string|undefined,actualHeader:string|null|undefined;
      try{
        const init:RequestInit&{dispatcher:Agent}={method:'GET',redirect:'error',dispatcher:agent,signal:AbortSignal.timeout(Math.min(2000,remaining))};
        const response=await fetch(url,init);assert.equal(response.status,200);
        actualHeader=response.headers.get('retry-after');received=await response.text();
      }catch(caught){failed=true;error=caught;}
      if(expectedError){
        assert.equal(failed,true,'an ignored transport limit must fail this probe');
        // Only the exact native transport cause qualifies. Preserve every
        // unexpected original value, including null/undefined, unchanged.
        if((error as {cause?:{code?:unknown}})?.cause?.code!==expectedError)throw error;
      }else{
        if(failed)throw error;
        assert.equal(actualHeader,nextHeader);assert.equal(received,nextBody);
      }
      observations.push({name,header_characters:nextHeader.length,body_utf8_bytes:Buffer.byteLength(nextBody),accepted:!failed,error_code:expectedError??null});
    }
    await exchange('positive_exact_body','7'.repeat(1024),'x'.repeat(bodyLimit));
    await exchange('positive_below_explicit_header_cap','7'.repeat(headerLimit-512),'x');
    await exchange('explicit_header_overflow','7'.repeat(headerLimit),'x','UND_ERR_HEADERS_OVERFLOW');
    await exchange('positive_after_header_failure','7','x');
    await exchange('explicit_body_overflow','7','x'.repeat(bodyLimit+1),'UND_ERR_RES_EXCEEDED_MAX_SIZE');
    await exchange('positive_UTF8_exact','7','é'.repeat(bodyLimit/2));
    await exchange('UTF8_bytes_not_characters','7','é'.repeat(bodyLimit/2)+'x','UND_ERR_RES_EXCEEDED_MAX_SIZE');
    await exchange('legal_non_JSON_control_body','7','\u0000'.repeat(bodyLimit));
    const escaped=JSON.stringify({body:'\u0000'.repeat(bodyLimit)});
    assert.ok(Buffer.byteLength(escaped)>bodyLimit,'RAW wrapper expansion is separate from transport body size');
    receipt={contract:'r16-explicit-agent-bound-observation-v1',node:process.versions.node,native_undici:process.versions.undici??null,
      dependency:'undici6.24.1 from frozen pnpm lock',transport:'native global Fetch with owned explicit Agent to HTTP loopback only',
      configured_header_bytes:headerLimit,configured_body_bytes:bodyLimit,observations,
      limits:{maximum_exchanges:10,work_deadline_ms:12_000,fetch_deadline_ms:2000,cleanup_deadline_ms:2000,test_timeout_ms:20_000},
      original_provider_envelope_unchanged:true,real_provider_header_limit:null,real_provider_body_limit:null,
      logical_memory_model_accepted:false,TLS_or_UAT_runtime_attested:false};
  }catch(error){knownPrimary=true;primary=error;}
  let cleanupFailed=false,cleanupError:unknown;
  try{
    const closedSockets=[...sockets].map(socket=>new Promise<void>(resolve=>{
      if(socket.closed){resolve();return;}socket.once('close',()=>resolve());socket.destroy();
    }));
    const closedServer=server.listening?new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())):Promise.resolve();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([Promise.all([...closedSockets,closedServer,agent.close()]),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('owned_agent_probe_cleanup_timeout')),2000);})]);}
    finally{if(timer)clearTimeout(timer);}
    assert.equal(server.listening,false);assert.equal(sockets.size,0);assert.equal(agent.closed,true);
  }catch(error){cleanupFailed=true;cleanupError=error;}
  if(cleanupFailed)throw knownPrimary?new AggregateError([primary,cleanupError],'response_agent_probe_and_cleanup_failed',{cause:primary}):cleanupError;
  if(knownPrimary)throw primary;
  assert.ok(receipt);receipt.owned_agent_server_and_socket_cleanup_acknowledged=true;
  console.log('r16-response-agent-node20-v1 '+JSON.stringify(receipt));
});
