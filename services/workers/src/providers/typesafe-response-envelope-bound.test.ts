import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,maxHeaderSize} from 'node:http';
import type {Socket} from 'node:net';

// Diagnostic only. This fixture measures native Fetch in its actual Node20
// process. It neither configures a dispatcher nor grants a future production
// provider a bound. In particular http.maxHeaderSize is NOT a Fetch setting.
test('R16 native Node20 Fetch records its actual bounded response-header frontier', {timeout:30_000}, async()=>{
  assert.equal(process.versions.node.split('.')[0],'20','the registered probe requires the actual Node20 CI runtime');
  const hardHeaderBytes=256*1024,maxAttempts=40,deadline=performance.now()+20_000;
  const body='{"probe":true}',bodyBytes=Buffer.byteLength(body),sockets=new Set<Socket>();
  const attempts:Array<{retry_after_characters:number;status:'accepted'|'headers_overflow';observed_header_characters?:number;observed_header_utf8_bytes?:number}>=[];
  let currentValue='',knownPrimary=false,primary:unknown,result:Record<string,unknown>|undefined;
  const server=createServer((_request,response)=>{
    response.statusCode=200;
    response.setHeader('content-type','application/json');
    response.setHeader('content-length',bodyBytes);
    response.setHeader('retry-after',currentValue);
    response.setHeader('connection','close');
    response.end(Buffer.from(body,'utf8'));
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try{
    await new Promise<void>((resolve,reject)=>{
      const failed=(error:Error)=>{server.off('listening',ready);reject(error);};
      const ready=()=>{server.off('error',failed);resolve();};
      server.once('error',failed);server.once('listening',ready);server.listen(0,'127.0.0.1');
    });
    const address=server.address();assert.ok(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/owned-envelope-probe`;
    async function request(value:string){
      assert.ok(attempts.length<maxAttempts,'bounded probe attempt count');
      const remaining=Math.floor(deadline-performance.now());assert.ok(remaining>0,'bounded probe wall');
      currentValue=value;
      let response:Response;
      try{response=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(Math.min(3000,remaining))});}
      catch(error){
        // A generic fetch/timeout/connection failure is NOT evidence of a
        // header bound. Only the real Undici overflow cause qualifies.
        if((error as {cause?:{code?:unknown}})?.cause?.code!=='UND_ERR_HEADERS_OVERFLOW')throw error;
        const row={retry_after_characters:value.length,status:'headers_overflow' as const};
        attempts.push(row);return row;
      }
      assert.equal(response.status,200);
      const observed=response.headers.get('retry-after');assert.equal(observed,value);
      const received=await response.text();assert.equal(received,body);
      const row={retry_after_characters:value.length,status:'accepted' as const,observed_header_characters:observed!.length,observed_header_utf8_bytes:Buffer.byteLength(observed!)};
      attempts.push(row);return row;
    }
    assert.equal((await request('')).status,'accepted','positive transport control');
    let accepted=0,rejected:number|undefined;
    for(const size of [1024,4096,8192,16384,32768,65536,131072,hardHeaderBytes]){
      const observed=await request('7'.repeat(size));
      if(observed.status==='headers_overflow'){rejected=size;break;}
      accepted=size;
    }
    assert.ok(rejected!==undefined,'no finite header frontier was observed within the registered cap');
    while(rejected-accepted>1){
      const midpoint=Math.floor((accepted+rejected)/2),observed=await request('7'.repeat(midpoint));
      if(observed.status==='accepted')accepted=midpoint;else rejected=midpoint;
    }
    // Repeat the adjacent boundary to distinguish a real deterministic parser
    // frontier from a failed request. The exact envelope includes generated
    // HTTP headers; its value frontier is not an aggregate-limit assertion.
    assert.equal((await request('7'.repeat(accepted))).status,'accepted');
    assert.equal((await request('7'.repeat(rejected))).status,'headers_overflow');
    const latin1=await request('é'.repeat(Math.min(1024,accepted)));
    assert.ok(latin1.status==='accepted');
    assert.equal(latin1.observed_header_utf8_bytes,latin1.retry_after_characters*2,'Latin1 header bytes can expand in UTF8 wrapper encoding');
    const tab=await request('7\t7');assert.equal(tab.status,'accepted');
    result={contract:'r16-native-fetch-envelope-bound-observation-v1',node:process.versions.node,
      undici:process.versions.undici??null,node_http_module_max_header_bytes:maxHeaderSize,
      http_module_value_is_NOT_attested_fetch_configuration:true,
      config:{node_options_sha256:createHash('sha256').update(process.env.NODE_OPTIONS??'').digest('hex'),
        exec_argv_sha256:createHash('sha256').update(JSON.stringify(process.execArgv)).digest('hex'),
        fixture_sets_dispatcher:false,fixture_uses_injected_fetch:false,transport:'native global Fetch to owned HTTP loopback; TLS and UAT not attested'},
      body_bytes:bodyBytes,header_value_frontier:{accepted_characters:accepted,rejected_characters:rejected,adjacent_and_repeated:true},
      attempts,limits:{maximum_tested_header_characters:hardHeaderBytes,maximum_recorded_attempts:maxAttempts,overall_deadline_ms:20_000},
      production_response_bound:null,logical_memory_model_accepted:false};
  }catch(error){knownPrimary=true;primary=error;}
  let cleanupError:unknown,cleanupFailed=false;
  try{
    const closedSockets=[...sockets].map(socket=>new Promise<void>(resolve=>{
      if(socket.closed){resolve();return;}socket.once('close',()=>resolve());socket.destroy();
    }));
    const closedServer=server.listening?new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())):Promise.resolve();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([Promise.all([...closedSockets,closedServer]),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('owned_probe_cleanup_timeout')),2000);})]);}
    finally{if(timer)clearTimeout(timer);}
    assert.equal(server.listening,false);assert.equal(sockets.size,0);
  }catch(error){cleanupFailed=true;cleanupError=error;}
  if(cleanupFailed)throw knownPrimary?new AggregateError([primary,cleanupError],'response_envelope_probe_and_cleanup_failed',{cause:primary}):cleanupError;
  if(knownPrimary)throw primary;
  assert.ok(result);result.owned_server_and_socket_cleanup_acknowledged=true;
  console.log('r16-response-envelope-node20-v1 '+JSON.stringify(result));
});
