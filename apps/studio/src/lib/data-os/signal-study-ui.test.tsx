import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React,{act} from 'react';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {Window} from 'happy-dom';
import * as intl from 'next-intl';
import {signalListeningDateBoundaryV1} from './signal-listening-date';
const browser=new Window({url:'https://studio.invalid'});
Object.assign(globalThis,{window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
const en=JSON.parse(readFileSync(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
const es=JSON.parse(readFileSync(new URL('../../../messages/es-MX.json',import.meta.url),'utf8'));
const out:Record<string,unknown>={},pushes:string[]=[];
const source=readFileSync(new URL('../../components/brands/StudioStudy.tsx',import.meta.url),'utf8');
new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)((name:string)=>{
 if(name==='@/lib/data-os/signal-listening-date')return{signalListeningDateBoundaryV1};
 if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='next-intl')return intl;
 if(name==='next/navigation')return{useRouter:()=>({push:(path:string)=>pushes.push(path)})};if(name==='next/link')return{default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>};throw Error(name);
},out);
const Detail=out.StudioStudyDetail as React.ComponentType<{workspaceId:string;studyId:string}>;
const List=out.StudioStudyList as React.ComponentType<{workspaceId:string;brandId:string;brandName:string;timezone:string}>;
const zero={trigger:0,barrier:0,mixed:0,none:0};
function detail(status:string|null='completed'){
 return{configuration:{study_id:'study',configuration_id:'config',revision:1,study:{subject:{name:'Brazil beer'},business_question:'Why beer?',methodology:{key:'triggers_barriers',version:'r16-v1'},cut:{start_at:'2026-10-01T00:00:00-03:00',end_at:'2026-11-01T00:00:00-03:00',timezone:'America/Sao_Paulo'},corpus_id:'corpus'}},configuration_is_latest:true,
  execution:status?{id:'execution',status,source_roots:240,steps_committed:2,steps_total:3,exposure_micro_usd:'12345'}:null,
  overview:status==='completed'?{execution_id:'execution',section_counts:{motives:1,topics:1,channels:1,series:1,evidence:1},overview:{summary:{denominator:240,figurative_or_ironic:3,other_use:1,subject_direction:{...zero,trigger:2},competitor_direction:zero,alternative_direction:zero,resolved_axes:240,unresolved_axes:0,layers:[{key:'social',mentions:2,share_of_cut:2/240,direction:{...zero,trigger:2}}],limitations:['Directional only']},query_bias:{status:'unknown_query_metadata'},stability:{estimation_status:'not_estimable',kappa:null}}}:null,
  processing_ready:true,can_edit:true,current_listening_revision:7};
}
function page(section:string){const rows=section==='motives'?[{key:'social_time',name:'Time together',layer:'social',permission:'partial',mentions:2,share_of_cut:2/240,subject:{...zero,trigger:2},competitor:zero,alternative:zero,mixed:0}]:section==='evidence'?[{display_text:'Beer with [person]',channel:'instagram',occurred_at:'2026-10-12',redacted:true,source_url:'https://example.test/post',root_id:'private-root',literal_sha256:'sha256:sealed'}]:[];return{section,offset:0,rows,total:rows.length,next_offset:null};}
function mount(element:React.ReactElement,messages=en,locale='en-US'){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 return{host,render:()=>act(async()=>{root.render(<intl.NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">{element}</intl.NextIntlClientProvider>);}),close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
function button(host:HTMLElement,text:string){const result=[...host.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(result,text);return result;}
test('native report mounts in both languages, loads bounded sections and shows only verified display evidence',async()=>{
 const original=fetch;
 try{for(const [locale,messages]of [['en-US',en],['es-MX',es]]as const){
  const calls:Array<{url:string;method:string}>=[];globalThis.fetch=async(input,options)=>{const url=String(input);calls.push({url,method:options?.method??'GET'});const section=new URL(url,'https://studio.invalid').searchParams.get('section');return Response.json(section?page(section):detail());};
  const m=mount(<Detail workspaceId="workspace" studyId="study"/>,messages,locale);try{await m.render();assert.ok(m.host.textContent?.includes(messages.StudioStudy.notEstimable));assert.ok(m.host.textContent?.includes(messages.StudioStudy.biasValue.unknown_query_metadata));
   assert.equal(calls.length,2);assert.ok(calls[1]!.url.includes('section=motives&offset=0&limit=30'));
   const evidence=[...m.host.querySelectorAll('button')].find(b=>b.textContent?.startsWith(messages.StudioStudy.section.evidence))!;
   await act(async()=>{evidence.click();});assert.ok(m.host.textContent?.includes('Beer with [person]'));assert.ok(!m.host.textContent?.includes('private-root'));assert.ok(!m.host.textContent?.includes('sha256:sealed'));
   assert.equal(m.host.querySelector('a')?.href,'https://example.test/post');assert.ok(calls.every(c=>c.method==='GET'));
  }finally{await m.close();}
 }}finally{globalThis.fetch=original;}
});
test('human promotion keeps exact selected motive ids, current CAS and same body/key after unknown acknowledgement',async()=>{
 const original=fetch;const posts:Array<{body:string;key:string}>=[];
 globalThis.fetch=async(input,options)=>{if(options?.method==='POST'){posts.push({body:String(options.body),key:new Headers(options.headers).get('Idempotency-Key')!});return posts.length===1?Response.json({error:'unknown'},{status:503}):Response.json({configuration_id:'published'});}
  const section=new URL(String(input),'https://studio.invalid').searchParams.get('section');return Response.json(section?page(section):detail());};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{await m.render();assert.equal(posts.length,0);await act(async()=>{m.host.querySelector('input[type="checkbox"]')!.dispatchEvent(new browser.MouseEvent('click',{bubbles:true})as unknown as Event);});
  await act(async()=>{button(m.host,en.StudioStudy.promote).click();});assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0]!.body),{operation:'promote',execution_id:'execution',motive_keys:['social_time'],expected_listening_revision:7});
  await act(async()=>{button(m.host,en.StudioStudy.retrySame).click();});assert.equal(posts.length,2);assert.deepEqual(posts[0]!,posts[1]!);
 }finally{await m.close();globalThis.fetch=original;}
});
test('read-only native capability disables human promotion and creating configurations',async()=>{
 const original=fetch;let posts=0;globalThis.fetch=async(input,options)=>{if(options?.method==='POST')posts++;const url=String(input),section=new URL(url,'https://studio.invalid').searchParams.get('section');if(section)return Response.json(page(section));if(url.includes('context=true'))return Response.json({source:{binding_kind:'serving',snapshot_id:'snap',configuration_id:'cfg',configuration_digest:'sha',revision:1,configuration_is_latest:true},can_edit:false});if(url.endsWith('/studies'))return Response.json({studies:[],next_after_study_id:null});return Response.json({...detail(),can_edit:false});};
 const a=mount(<Detail workspaceId="workspace" studyId="study"/>),b=mount(<List workspaceId="workspace" brandId="brand" brandName="Beer" timezone="UTC"/>);
 try{await a.render();assert.ok(a.host.textContent?.includes(en.StudioStudy.readOnly));assert.equal(button(a.host,en.StudioStudy.promote).disabled,true);assert.equal(a.host.querySelector('input[type="checkbox"]')?.hasAttribute('disabled'),true);await b.render();assert.equal(b.host.querySelector('fieldset')?.disabled,true);assert.equal(posts,0);}finally{await a.close();await b.close();globalThis.fetch=original;}
});
test('execution is never automatic and an explicit budget is preserved across unknown retry',async()=>{
 const original=fetch,posts:Array<string>=[];globalThis.fetch=async(_input,options)=>{if(options?.method==='POST'){posts.push(String(options.body));return Response.json({error:'unknown'},{status:503});}return Response.json(detail(null));};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{await m.render();assert.equal(posts.length,0);const input=m.host.querySelector('input[type="number"]')!as HTMLInputElement;
  await act(async()=>{input.value='2.50';Simulate.change(input);});
  await act(async()=>{m.host.querySelector('form')!.dispatchEvent(new browser.Event('submit',{bubbles:true,cancelable:true})as unknown as Event);});
  assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0]!),{operation:'execute',configuration_id:'config',cap_micro_usd:2500000});
  await act(async()=>{button(m.host,en.StudioStudy.retrySame).click();});assert.deepEqual(posts,[posts[0]!,posts[0]!]);
 }finally{await m.close();globalThis.fetch=original;}
});
test('active polling is serialized, cancels on unmount and completed state loads report without reload',async()=>{
 const original=fetch,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let callback:(()=>void)|undefined,reads=0,resolve!:(r:Response)=>void,signal:AbortSignal|undefined;const posts:string[]=[];
 globalThis.setTimeout=((fn:()=>void,ms:number,...args:unknown[])=>{if(ms===3000){callback=fn;return 444;}return oldSet(fn,ms,...args);})as typeof setTimeout;
 globalThis.clearTimeout=((id:ReturnType<typeof setTimeout>)=>{if(Number(id)!==444)oldClear(id);else callback=undefined;})as typeof clearTimeout;
 globalThis.fetch=async(input,options)=>{if(options?.method==='POST')posts.push(String(input));const section=new URL(String(input),'https://studio.invalid').searchParams.get('section');if(section)return Response.json(page(section));reads++;if(reads===1)return Response.json(detail('running'));signal=options?.signal??undefined;return new Promise<Response>(r=>{resolve=r;});};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{await m.render();assert.ok(callback);const poll=callback;callback=undefined;await act(async()=>{poll();});assert.equal(reads,2);assert.equal(callback,undefined,'no next poll before the current read returns');
  await act(async()=>resolve(Response.json(detail())));assert.ok(m.host.textContent?.includes('Time together'));assert.equal(posts.length,0);
 }finally{await m.close();assert.equal(signal?.aborted,true);globalThis.fetch=original;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});

test('a failed bounded report read can recover without reload and never keeps old section rows',async()=>{
 const original=fetch;let sectionReads=0,posts=0;globalThis.fetch=async(input,options)=>{if(options?.method==='POST')posts++;const section=new URL(String(input),'https://studio.invalid').searchParams.get('section');
  if(section){sectionReads++;return sectionReads===1?Response.json({error:'study_output_unavailable'},{status:409}):Response.json(page(section));}return Response.json(detail());};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{await m.render();assert.equal(m.host.textContent?.includes('Time together'),false);assert.ok(m.host.querySelector('[role="alert"]'));await act(async()=>{button(m.host,en.StudioStudy.refresh).click();});assert.equal(sectionReads,2);assert.ok(m.host.textContent?.includes('Time together'));assert.equal(posts,0);}finally{await m.close();globalThis.fetch=original;}
});
test('creating a Study uses calendar dates in workspace timezone and the exact human-corrected source category',async()=>{
 const original=fetch;let posted:Record<string,unknown>|undefined;const before=pushes.length;
 globalThis.fetch=async(input,options)=>{if(options?.method==='POST'){posted=JSON.parse(String(options.body));return Response.json({study_id:'created-study'});}
  if(String(input).includes('context=true'))return Response.json({source:{binding_kind:'human_edit',snapshot_id:'effective-human-snapshot',configuration_id:'exact-config',configuration_digest:'digest',category:'beer',revision:7,configuration_is_latest:true},can_edit:true});return Response.json({studies:[],next_after_study_id:null});};
 const m=mount(<List workspaceId="workspace" brandId="brand" brandName="Brand" timezone="America/Sao_Paulo"/>);
 try{await m.render();const inputs=m.host.querySelectorAll('input');assert.equal(inputs[1]!.readOnly,true);assert.equal(inputs[1]!.value,'beer');assert.ok(m.host.textContent?.includes(en.StudioStudy.sourceHuman));
  await act(async()=>{inputs[5]!.value='2026-10-01';Simulate.change(inputs[5]!);inputs[6]!.value='2026-10-31';Simulate.change(inputs[6]!);const question=m.host.querySelector('textarea')!;question.value='Why beer?';Simulate.change(question);});
  await act(async()=>{m.host.querySelector('form')!.dispatchEvent(new browser.Event('submit',{bubbles:true,cancelable:true})as unknown as Event);});
  assert.ok(posted);assert.deepEqual(posted.cut,{start_at:'2026-10-01T03:00:00.000Z',end_at:'2026-11-01T03:00:00.000Z',timezone:'America/Sao_Paulo'});
  assert.deepEqual(posted.source,{binding_kind:'human_edit',snapshot_id:'effective-human-snapshot',configuration_id:'exact-config',configuration_digest:'digest'});assert.equal((posted.subject as {category:string}).category,'beer');assert.equal(pushes[before],'/studio/brands/brand/studies/created-study');
 }finally{await m.close();globalThis.fetch=original;}
});
