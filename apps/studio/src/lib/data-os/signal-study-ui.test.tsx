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
import type {StudyOverviewV1} from './signal-study-api';
import {signalListeningDateBoundaryV1} from './signal-listening-date';
const browser=new Window({url:'https://studio.invalid'});
Object.assign(globalThis,{window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
const en=JSON.parse(readFileSync(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
const es=JSON.parse(readFileSync(new URL('../../../messages/es-MX.json',import.meta.url),'utf8'));
const out:Record<string,unknown>={},pushes:string[]=[];
const source=readFileSync(new URL('../../components/brands/StudioStudy.tsx',import.meta.url),'utf8');
new Function('require','exports',ts.transpileModule(source+'\nexport {StudyReport};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)((name:string)=>{
 if(name==='@/lib/data-os/signal-listening-date')return{signalListeningDateBoundaryV1};
 if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='next-intl')return intl;
 if(name==='next/navigation')return{useRouter:()=>({push:(path:string)=>pushes.push(path)})};if(name==='next/link')return{default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>};throw Error(name);
},out);
const Detail=out.StudioStudyDetail as React.ComponentType<{workspaceId:string;studyId:string}>;
const Report=out.StudyReport as React.ComponentType<{workspaceUrl:string;value:StudyOverviewV1;currentRevision:number|null;onPromote:(keys:string[])=>void;locked:boolean}>;
const List=out.StudioStudyList as React.ComponentType<{workspaceId:string;brandId:string;brandName:string;timezone:string}>;
const zero={trigger:0,barrier:0,mixed:0,none:0};
function detail(status:string|null='completed'){
 return{configuration:{study_id:'study',configuration_id:'config',revision:1,study:{subject:{name:'Brazil beer'},business_question:'Why beer?',methodology:{key:'triggers_barriers',version:'r16-v1'},cut:{start_at:'2026-10-01T00:00:00-03:00',end_at:'2026-11-01T00:00:00-03:00',timezone:'America/Sao_Paulo'},corpus_id:'corpus'}},configuration_is_latest:true,
  execution:status?{id:'execution',status,source_roots:240,steps_committed:2,steps_total:3,exposure_micro_usd:'12345'}:null,
  overview:status==='completed'?{execution_id:'execution',section_counts:{motives:1,topics:1,channels:1,series:1,evidence:1},overview:{summary:{denominator:240,figurative_or_ironic:3,other_use:1,subject_direction:{...zero,trigger:2},competitor_direction:zero,alternative_direction:zero,resolved_axes:240,unresolved_axes:0,layers:[{key:'social',mentions:2,share_of_cut:2/240,direction:{...zero,trigger:2}}],limitations:['Directional only']},query_bias:{status:'unknown_query_metadata'},stability:{estimation_status:'not_estimable',kappa:null}}}:null,
  processing_ready:true,can_edit:true,can_execute:true,current_listening_revision:7};
}
function page(section:string){const rows=section==='motives'?[{key:'social_time',name:'Time together',layer:'social',permission:'partial',mentions:2,share_of_cut:2/240,subject:{...zero,trigger:2},competitor:zero,alternative:zero,mixed:0}]:section==='topics'?[{motive_key:'social_time',aggregate:'subject',topic_key:'topic-marker',mentions:2}]:section==='channels'?[{motive_key:'social_time',aggregate:'subject',channel:'channel-marker',mentions:2}]:section==='series'?[{motive_key:'social_time',aggregate:'subject',date:'2026-10-15',direction:{...zero,trigger:2}}]:section==='evidence'?[{display_text:'Beer with [person]',channel:'instagram',occurred_at:'2026-10-12',redacted:true,source_url:'https://example.test/post',root_id:'private-root',literal_sha256:'sha256:sealed'}]:[];return{section,offset:0,rows,total:rows.length,next_offset:null};}
function mount(element:React.ReactElement,messages=en,locale='en-US'){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 return{host,render:(next=element)=>act(async()=>{root.render(<intl.NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">{next}</intl.NextIntlClientProvider>);}),close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
function button(host:HTMLElement,text:string){const result=[...host.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(result,text);return result;}
async function completePromotion(host:HTMLElement){
 const field=(label:string)=>{const row=[...host.querySelectorAll('label')].find(row=>row.querySelector('span')?.textContent===label);assert.ok(row,`localization field ${label}`);return row.querySelector('input,textarea')as HTMLInputElement;};
 const name=(language:string)=>en.Listening.nameLanguage.replace('{language}',language),definition=(language:string)=>en.Listening.definitionLanguage.replace('{language}',language);
 assert.equal(field(name('original')).value,'Time together');assert.equal(field(definition('original')).value,'Sharing time with others');
 assert.equal(field(name('original')).readOnly,true);assert.equal(field(definition('original')).readOnly,true);
 assert.equal(button(host,en.StudioStudy.promote).disabled,true,'translations must be completed before promotion');
 for(const language of ['en','es'])for(const [key,label]of [['name',name(language)],['definition',definition(language)]]){
  const input=field(label!);assert.equal(input.value,'','translations are never invented');
  await act(async()=>{input.value=`${language} ${key}`;Simulate.change(input);});
 }
 assert.equal(button(host,en.StudioStudy.promote).disabled,false);
}
test('native report mounts in both languages, loads bounded sections and shows only verified display evidence',async()=>{
 const original=fetch;
 try{for(const [locale,messages]of [['en-US',en],['es-MX',es]]as const){
  const calls:Array<{url:string;method:string}>=[];globalThis.fetch=async(input,options)=>{const url=String(input);calls.push({url,method:options?.method??'GET'});const section=new URL(url,'https://studio.invalid').searchParams.get('section');return Response.json(section?page(section):detail());};
  const m=mount(<Detail workspaceId="workspace" studyId="study"/>,messages,locale);try{await m.render();assert.ok(m.host.textContent?.includes(messages.StudioStudy.notEstimable));assert.ok(m.host.textContent?.includes(messages.StudioStudy.biasValue.unknown_query_metadata));
   assert.equal(calls.length,2);assert.ok(calls[1]!.url.includes('section=motives&offset=0&limit=30'));
   const evidence=[...m.host.querySelectorAll('button')].find(b=>b.textContent?.startsWith(messages.StudioStudy.section.evidence))!;
   await act(async()=>{evidence.click();});assert.ok(m.host.textContent?.includes('Beer with [person]'));assert.ok(!m.host.textContent?.includes('private-root'));assert.ok(!m.host.textContent?.includes('sha256:sealed'));
   assert.ok(m.host.textContent?.includes(messages.StudioStudy.evidenceAssociationUnavailable));assert.equal(m.host.querySelector('a')?.href,'https://example.test/post');assert.ok(calls.every(c=>c.method==='GET'));
  }finally{await m.close();}
 }}finally{globalThis.fetch=original;}
});
test('human promotion keeps exact selected motive ids, current CAS and same body/key after unknown acknowledgement',async()=>{
 const original=fetch;const posts:Array<{body:string;key:string}>=[];
 globalThis.fetch=async(input,options)=>{if(options?.method==='POST'){posts.push({body:String(options.body),key:new Headers(options.headers).get('Idempotency-Key')!});return posts.length===1?Response.json({error:'unknown'},{status:503}):Response.json({configuration_id:'published'});}
  const query=new URL(String(input),'https://studio.invalid').searchParams;if(query.has('promotion_context'))return Response.json({execution_id:'execution',motives:[{key:'social_time',name:'Time together',definition:'Sharing time with others',original_language:'und'}]});const section=query.get('section');return Response.json(section?page(section):detail());};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{await m.render();assert.equal(posts.length,0);await act(async()=>{m.host.querySelector('input[type="checkbox"]')!.dispatchEvent(new browser.MouseEvent('click',{bubbles:true})as unknown as Event);});
  await completePromotion(m.host);
  await act(async()=>{button(m.host,en.StudioStudy.promote).click();});assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0]!.body),{operation:'promote',execution_id:'execution',motive_keys:['social_time'],expected_listening_revision:7,localizations:{social_time:{original_language:'und',original:{name:'Time together',definition:'Sharing time with others'},en:{name:'en name',definition:'en definition'},es:{name:'es name',definition:'es definition'}}}});
  await act(async()=>{button(m.host,en.StudioStudy.retrySame).click();});assert.equal(posts.length,2);assert.deepEqual(posts[0]!,posts[1]!);
 }finally{await m.close();globalThis.fetch=original;}
});
test('promotion context is lazy, fails visibly and discards a late response after deselection',async()=>{
 const original=fetch,requests:Array<{url:string;signal:AbortSignal|null|undefined}>=[];let reply!:(response:Response)=>void,attempt=0,posts=0;
 globalThis.fetch=async(input,options)=>{
  const url=String(input),query=new URL(url,'https://studio.invalid').searchParams;
  if(options?.method==='POST'){posts++;return Response.json({});}
  if(query.has('promotion_context')){requests.push({url,signal:options?.signal});attempt++;return attempt===1?Response.json({error:'unavailable'},{status:503}):new Promise<Response>(resolve=>{reply=resolve;});}
  return Response.json(query.has('section')?page(query.get('section')!):detail());
 };
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);
 try{
  await m.render();assert.equal(requests.length,0,'reading a report never derives promotion context');
  const checkbox=m.host.querySelector('input[type="checkbox"]')!;
  await act(async()=>checkbox.dispatchEvent(new browser.MouseEvent('click',{bubbles:true})as unknown as Event));
  assert.equal(requests.length,1);assert.equal(new URL(requests[0]!.url,'https://studio.invalid').searchParams.get('motive_keys'),'social_time');
  assert.ok(m.host.querySelector('[role="alert"]')?.textContent?.includes(en.StudioStudy.loadFailed));assert.equal(button(m.host,en.StudioStudy.promote).disabled,true);
  await act(async()=>button(m.host,en.StudioStudy.refresh).click());assert.equal(requests.length,2);
  await act(async()=>checkbox.dispatchEvent(new browser.MouseEvent('click',{bubbles:true})as unknown as Event));assert.equal(requests[1]!.signal?.aborted,true);
  await act(async()=>reply(Response.json({execution_id:'execution',motives:[{key:'social_time',name:'late-original',definition:'late-definition',original_language:'und'}]})));
  assert.ok(!m.host.textContent?.includes('late-original'));assert.equal(button(m.host,en.StudioStudy.promote).disabled,true);assert.equal(posts,0);
 }finally{await m.close();globalThis.fetch=original;}
});
test('read-only native capability disables human promotion and creating configurations',async()=>{
 const original=fetch;let posts=0;globalThis.fetch=async(input,options)=>{if(options?.method==='POST')posts++;const url=String(input),section=new URL(url,'https://studio.invalid').searchParams.get('section');if(section)return Response.json(page(section));if(url.includes('context=true'))return Response.json({source:{binding_kind:'serving',snapshot_id:'snap',configuration_id:'cfg',configuration_digest:'sha',revision:1,configuration_is_latest:true},can_edit:false});if(url.endsWith('/studies'))return Response.json({studies:[],next_after_study_id:null});return Response.json({...detail(),can_edit:false,can_execute:false});};
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
const sections=['motives','topics','channels','series','evidence']as const;
const sectionMarker={motives:'Time together',topics:'topic-marker',channels:'channel-marker',series:'2026-10-15',evidence:'Beer with [person]'};
function reportValue(execution='execution',configuration='config',study='study'){
 return{...detail().overview!,study_id:study,configuration_id:configuration,execution_id:execution,source_digest:`source-${execution}`,output_digest:`output-${execution}`}as unknown as StudyOverviewV1;
}
function reportElement(value=reportValue(),workspaceUrl='/native/studies/study'){
 return <Report workspaceUrl={workspaceUrl} value={value} currentRevision={7} onPromote={()=>{}} locked={false}/>;
}
function sectionButton(host:HTMLElement,section:typeof sections[number]){
 const target=[...host.querySelectorAll('button')].find(b=>b.textContent?.startsWith(en.StudioStudy.section[section]));assert.ok(target);return target;
}
test('all heterogeneous Study report section transitions hide old rows before effects and defer the new format safely',async()=>{
 const original=fetch;
 try{for(const from of sections){for(const to of sections){if(from===to)continue;
  let deferredSection:string|null=null,resolve!:(r:Response)=>void;
  globalThis.fetch=async(input)=>{const section=new URL(String(input),'https://studio.invalid').searchParams.get('section')!;
   return section===deferredSection?new Promise<Response>(r=>{resolve=r;}):Response.json(page(section));};
  const m=mount(reportElement());try{await m.render();if(from!=='motives')await act(async()=>{sectionButton(m.host,from).click();});assert.ok(m.host.textContent?.includes(sectionMarker[from]),from);
   deferredSection=to;await act(async()=>{sectionButton(m.host,to).click();});assert.ok(!m.host.textContent?.includes(sectionMarker[from]),`${from} rows must not render as ${to}`);assert.ok(m.host.textContent?.includes(en.StudioStudy.loading));
   await act(async()=>resolve(Response.json(page(to))));assert.ok(m.host.textContent?.includes(sectionMarker[to]),`${from} → ${to}`);
  }finally{await m.close();}
 }}}finally{globalThis.fetch=original;}
});
test('late section responses, including an ABA return to the same section, cannot replace newer rows',async()=>{
 const original=fetch;const pending:Array<{section:string;signal:AbortSignal|null|undefined;resolve:(r:Response)=>void}>=[];
 globalThis.fetch=async(input,options)=>{const section=new URL(String(input),'https://studio.invalid').searchParams.get('section')!;
  return new Promise<Response>(resolve=>pending.push({section,signal:options?.signal,resolve}));};
 const m=mount(reportElement());try{await m.render();assert.equal(pending.length,1);
  await act(async()=>{sectionButton(m.host,'series').click();});await act(async()=>{sectionButton(m.host,'motives').click();});assert.equal(pending.length,3);assert.equal(pending[0]!.signal?.aborted,true);assert.equal(pending[1]!.signal?.aborted,true);
  const current={...page('motives'),rows:[{...page('motives').rows[0],name:'Newest motive'}]};await act(async()=>pending[2]!.resolve(Response.json(current)));assert.ok(m.host.textContent?.includes('Newest motive'));
  await act(async()=>{pending[1]!.resolve(Response.json(page('series')));pending[0]!.resolve(Response.json(page('motives')));});assert.ok(m.host.textContent?.includes('Newest motive'));assert.ok(!m.host.textContent?.includes('Time together'));assert.ok(!m.host.textContent?.includes('2026-10-15'));
 }finally{await m.close();globalThis.fetch=original;}
});
test('execution, Study, configuration and pagination identities reject stale pages without changing historical metadata',async()=>{
 const original=fetch;const pending:Array<{url:URL;resolve:(r:Response)=>void;signal:AbortSignal|null|undefined}>=[];
 globalThis.fetch=async(input,options)=>new Promise<Response>(resolve=>pending.push({url:new URL(String(input),'https://studio.invalid'),resolve,signal:options?.signal}));
 const m=mount(reportElement());try{await m.render();const initial={...page('motives'),total:61,next_offset:30};await act(async()=>pending[0]!.resolve(Response.json(initial)));
  await act(async()=>{button(m.host,en.StudioStudy.next).click();});assert.equal(pending[1]!.url.searchParams.get('offset'),'30');assert.ok(!m.host.textContent?.includes('Time together'));
  const newer=reportValue('new-execution','historical-config','other-study');await m.render(reportElement(newer,'/native/studies/other-study'));assert.equal(pending[1]!.signal?.aborted,true);assert.equal(pending[2]!.url.searchParams.get('execution_id'),'new-execution');assert.ok(!m.host.textContent?.includes('Time together'));
  const newPage={...page('motives'),offset:30,total:61,next_offset:60,rows:[{...page('motives').rows[0],name:'New execution page'}]};await act(async()=>pending[2]!.resolve(Response.json(newPage)));assert.ok(m.host.textContent?.includes('New execution page'));
  const stale={...page('motives'),offset:30,total:61,next_offset:60,rows:[{...page('motives').rows[0],name:'Stale old execution'}]};await act(async()=>pending[1]!.resolve(Response.json(stale)));assert.ok(!m.host.textContent?.includes('Stale old execution'));
  await act(async()=>{button(m.host,en.StudioStudy.previous).click();});assert.equal(pending[3]!.url.searchParams.get('offset'),'0');assert.ok(!m.host.textContent?.includes('New execution page'));
  const mismatch={...page('motives'),offset:30};await act(async()=>pending[3]!.resolve(Response.json(mismatch)));assert.ok(m.host.querySelector('[role="alert"]'));assert.ok(!m.host.textContent?.includes('Time together'),'mismatched native page offset is rejected');
 }finally{await m.close();globalThis.fetch=original;}
});
test('report tab changes preserve the historical Study subject, template version and cut labels',async()=>{
 const original=fetch;const saved=detail();saved.configuration_is_latest=false;saved.configuration.study.subject.name='Historical category';saved.configuration.study.business_question='Historical business question';saved.configuration.study.methodology.version='human-revised-v3';
 globalThis.fetch=async(input)=>{const section=new URL(String(input),'https://studio.invalid').searchParams.get('section');return Response.json(section?page(section):saved);};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);try{await m.render();const metadata=m.host.querySelector('dl')!.textContent;
  for(const section of ['series','evidence','motives','channels','topics']as const){await act(async()=>sectionButton(m.host,section).click());assert.ok(m.host.textContent?.includes('Historical category'));assert.ok(m.host.textContent?.includes('Historical business question'));assert.ok(m.host.textContent?.includes('human-revised-v3'));assert.ok(m.host.textContent?.includes(en.StudioStudy.historicalSource));assert.equal(m.host.querySelector('dl')!.textContent,metadata);}
 }finally{await m.close();globalThis.fetch=original;}
});
test('edit-only accounts cannot submit paid processing while configuration creation and promotion remain available',async()=>{
 const original=fetch;let completed=false;const posts:Record<string,unknown>[]=[];
 globalThis.fetch=async(input,options)=>{if(options?.method==='POST'){posts.push(JSON.parse(String(options.body)));return posts.length===1?Response.json({error:'unknown'},{status:503}):Response.json({configuration_id:'human-publication'});}
  const url=String(input),query=new URL(url,'https://studio.invalid').searchParams,section=query.get('section');if(query.has('promotion_context'))return Response.json({execution_id:'execution',motives:[{key:'social_time',name:'Time together',definition:'Sharing time with others',original_language:'und'}]});if(section)return Response.json(page(section));
  if(url.includes('context=true'))return Response.json({source:{binding_kind:'serving',snapshot_id:'snapshot',configuration_id:'config',configuration_digest:'digest',category:'beer',revision:1,configuration_is_latest:true},can_edit:true,can_execute:false,processing_ready:true});
  if(url.endsWith('/studies'))return Response.json({studies:[],next_after_study_id:null});return Response.json({...detail(completed?'completed':null),can_edit:true,can_execute:false,processing_ready:true});};
 const a=mount(<Detail workspaceId="workspace" studyId="study"/>),b=mount(<List workspaceId="workspace" brandId="brand" brandName="Beer" timezone="UTC"/>);
 try{await a.render();assert.equal(button(a.host,en.StudioStudy.run).disabled,true);assert.ok(a.host.textContent?.includes(en.StudioStudy.processingNotAllowed));const input=a.host.querySelector('input[type="number"]')!as HTMLInputElement;
  await act(async()=>{input.value='2';Simulate.change(input);});await act(async()=>{a.host.querySelector('form')!.dispatchEvent(new browser.Event('submit',{bubbles:true,cancelable:true})as unknown as Event);});assert.equal(posts.length,0,'even form submission cannot start a paid request without native processing capability');
  await b.render();assert.equal(b.host.querySelector('fieldset')!.disabled,false);assert.equal(button(b.host,en.StudioStudy.save).disabled,false);
  completed=true;await a.render(<Detail workspaceId="workspace" studyId="completed-study"/>);const checkbox=a.host.querySelector('input[type="checkbox"]')!as HTMLInputElement;assert.equal(checkbox.disabled,false);
  await act(async()=>checkbox.dispatchEvent(new browser.MouseEvent('click',{bubbles:true})as unknown as Event));await completePromotion(a.host);await act(async()=>button(a.host,en.StudioStudy.promote).click());assert.equal(posts.length,1);assert.equal(posts[0]!.operation,'promote');assert.equal(button(a.host,en.StudioStudy.retrySame).disabled,false);await act(async()=>button(a.host,en.StudioStudy.retrySame).click());assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(posts.some(p=>p.operation==='execute'),false);
 }finally{await a.close();await b.close();globalThis.fetch=original;}
});
test('read-only accounts keep both edit and paid controls disabled even when the provider is ready',async()=>{
 const original=fetch;let posts=0;globalThis.fetch=async(_input,options)=>{if(options?.method==='POST')posts++;return Response.json({...detail(null),can_edit:false,can_execute:false,processing_ready:true});};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);try{await m.render();assert.equal(button(m.host,en.StudioStudy.run).disabled,true);assert.ok(m.host.textContent?.includes(en.StudioStudy.readOnly));assert.ok(m.host.textContent?.includes(en.StudioStudy.processingNotAllowed));assert.equal(posts,0);}finally{await m.close();globalThis.fetch=original;}
});
test('paid capability is independent of human editing rather than inferred from it',async()=>{
 const original=fetch;let posts=0;globalThis.fetch=async(_input,options)=>{if(options?.method==='POST')posts++;return Response.json({...detail(null),can_edit:false,can_execute:true,processing_ready:true});};
 const m=mount(<Detail workspaceId="workspace" studyId="study"/>);try{await m.render();assert.equal(button(m.host,en.StudioStudy.run).disabled,false);assert.ok(m.host.textContent?.includes(en.StudioStudy.readOnly));assert.ok(!m.host.textContent?.includes(en.StudioStudy.processingNotAllowed));assert.equal(posts,0);}finally{await m.close();globalThis.fetch=original;}
});


test('report shows assessment partition, layer, role and pass for identical quotes in both locales',async()=>{
 const original=fetch;
 try{for(const [locale,messages]of [['en-US',en],['es-MX',es]]as const){
  globalThis.fetch=async(input)=>{const section=new URL(String(input),'https://studio.invalid').searchParams.get('section');
   if(section!=='evidence')return Response.json(section?page(section):detail());
   const base=page('evidence').rows[0];return Response.json({section,offset:0,total:2,next_offset:null,rows:(['layer','normative']as const).map((role,index)=>({...base,association:{motive_key:'force',partition_key:'partition_'+index,partition_name:index?'Only B Private Person @private_b':'Assignment 0',assessed_layer:'cultural',role,pass:index?'b':'a',recode_attempt:1,request_digest:'sha256:private-request',study_digest:'sha256:private-study'}}))});};
  const m=mount(<Detail workspaceId="workspace" studyId="study"/>,messages,locale);
  try{await m.render();const button=[...m.host.querySelectorAll('button')].find(b=>b.textContent?.startsWith(messages.StudioStudy.section.evidence))!;await act(async()=>button.click());
   for(const label of ['partition_0','partition_1',messages.StudioStudy.layer.cultural,messages.StudioStudy.evidenceRole.layer,messages.StudioStudy.evidenceRole.normative])assert.ok(m.host.textContent?.includes(label));
   assert.ok(!m.host.textContent?.includes('Only B Private Person'));assert.ok(!m.host.textContent?.includes('@private_b'));assert.ok(!m.host.textContent?.includes('Assignment 0'));
   assert.equal(m.host.querySelectorAll('blockquote').length,2);assert.ok(!m.host.textContent?.includes(messages.StudioStudy.evidenceAssociationUnavailable));assert.ok(!m.host.textContent?.includes('sha256:private'));
  }finally{await m.close();}
 }}finally{globalThis.fetch=original;}
});
