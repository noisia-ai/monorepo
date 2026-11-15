import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Window} from 'happy-dom';
import {NextIntlClientProvider} from 'next-intl';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {SignalListeningConfiguration} from '../../components/brands/SignalListeningConfiguration';
import {SignalListeningMetricTables,SignalListeningMetrics} from '../../components/signal-v2/SignalListeningMetrics';
import {signalListeningDateBoundaryV1} from './signal-listening-date';
import {renderToStaticMarkup} from 'react-dom/server';
const browser=new Window({url:'https://studio.invalid'});
Object.assign(globalThis,{window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
test('Listening mounts in both locales without paid calls and adding a question requires saving first',async()=>{
  const oldFetch=globalThis.fetch;
  try{for(const locale of ['es-MX','en-US']as const){
    const messages=JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),'utf8'));
    const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),calls:Array<{url:string;method:string}>=[];
    globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options?.method??'GET'});return Response.json({configuration:{id:'config',revision:1,configuration},map:{id:'map',root_count:12},run:null,capabilities:{can_edit_topics:true,can_request_processing:true}});};
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>{root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);await new Promise(resolve=>setTimeout(resolve,0));});
    assert.ok(host.textContent?.includes(messages.Listening.title));
    const add=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.addQuestion)!;
    await act(async()=>{add.click();});
    assert.ok(host.querySelectorAll('fieldset').length===3);
    assert.ok([...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.run)?.disabled);
    assert.deepEqual(calls.map(call=>call.method),['GET']);
    await act(async()=>root.unmount());host.remove();
  }}finally{globalThis.fetch=oldFetch;}
});
test('generic question tables show pending separately and retain no negative placeholder',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const metrics={contract_version:'signal-listening-question-metrics-v1',configuration_id:'config',question_key:'occasion',question_digest:'digest',scope:'all',coverage:0,
    counts:{corpus_eligible:10,candidate:10,eligible:10,asked:0,pending:10,awaiting_base:0,excluded_scope:0,not_candidate:0},distribution:[],trend:[],topic_cross:[],limitations:[]};
  const html=renderToStaticMarkup(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningMetricTables metrics={metrics as never}/></NextIntlClientProvider>);
  assert.ok(html.includes(messages.Listening.unasked));assert.ok(html.includes(messages.Listening.empty));assert.ok(!html.includes('trigger_barrier'));
});
test('Listening uses calendar boundaries in the selected timezone and an exclusive next-day end',()=>{
  assert.equal(signalListeningDateBoundaryV1('2026-01-01','America/Sao_Paulo'),'2026-01-01T03:00:00.000Z');
  assert.equal(signalListeningDateBoundaryV1('2026-01-01','America/Sao_Paulo',true),'2026-01-02T03:00:00.000Z');
  assert.throws(()=>signalListeningDateBoundaryV1('2026-02-31','UTC'),/invalid/);
});

test('polling a newer configuration never advances the CAS revision of an unsaved draft',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
  const savedFetch=globalThis.fetch,savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  let poll:(()=>void)|undefined,reads=0,revision:unknown;
  globalThis.setInterval=((callback:()=>void)=>{poll=callback;return 1;})as unknown as typeof setInterval;
  globalThis.clearInterval=(()=>undefined)as typeof clearInterval;
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='PUT'){revision=JSON.parse(String(options.body)).expected_revision;return Response.json({error:'listening_configuration_conflict'},{status:409});}
    reads++;
    return Response.json({configuration:{id:reads===1?'old':'new',revision:reads===1?1:2,configuration},map:{id:'map',root_count:12},
      run:{id:'run',status:reads===1?'running':'completed'},capabilities:{can_edit_topics:true,can_request_processing:true}});
  };
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    const add=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.addQuestion)!;
    await act(async()=>add.click());
    assert.ok(poll);
    await act(async()=>{poll!();await new Promise(resolve=>setTimeout(resolve,0));});
    const save=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.save)!;
    assert.equal(save.disabled,false);
    await act(async()=>{save.click();await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(revision,1,'the human draft retains the revision it was loaded from');
  }finally{
    await act(async()=>root.unmount());host.remove();globalThis.fetch=savedFetch;globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;
  }
});

test('automatic prototype preparation and unresolved prior exposure keep the run action closed',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),oldFetch=globalThis.fetch;
  try{for(const mode of ['preparation','unknown']as const){
    globalThis.fetch=async()=>Response.json({configuration:{id:'config',revision:1,configuration},map:{id:'map',root_count:12},
      run:mode==='unknown'?{id:'run',status:'failed',unknown_micro_usd:'10'}:null,
      preparation:mode==='preparation'?{id:'prep',status:'waiting_prototypes'}:null,capabilities:{can_edit_topics:true,can_request_processing:true}});
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    const label=mode==='preparation'?messages.Listening.running:messages.Listening.run;
    const run=[...host.querySelectorAll('button')].find(button=>button.textContent===label)!;
    assert.equal(run.disabled,true);
    if(mode==='unknown')assert.ok(host.textContent?.includes(messages.Listening.unresolved));
    await act(async()=>root.unmount());host.remove();
  }}finally{globalThis.fetch=oldFetch;}
});


test('changing a question and receiving an error never shows the prior question distribution',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),oldFetch=globalThis.fetch;let reads=0;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(!url.includes('/metrics?'))return Response.json({configuration:{id:'config',configuration},map:{id:'map'}});
    if(++reads>1)return Response.json({error:'unavailable'},{status:503});
    return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'config',question_key:new URL(url,'https://studio.invalid').searchParams.get('question_key'),
      counts:{asked:7,eligible:10,pending:3},distribution:[{option_key:'unique_old_question_label',count:7}],trend:[],topic_cross:[]});
  };
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningMetrics workspaceId="workspace" from="2026-01-01" to="2026-01-31" timezone="UTC"/></NextIntlClientProvider>);});
    assert.ok(host.textContent?.includes('unique_old_question_label'));
    const question=host.querySelector('select')!;
    await act(async()=>{question.value=question.value==='voice'?'promotion':'voice';question.dispatchEvent(new browser.Event('change',{bubbles:true}) as unknown as Event);});
    assert.ok(host.textContent?.includes(messages.Listening.error));assert.ok(!host.textContent?.includes('unique_old_question_label'));
  }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;}
});
test('metrics opens on a visible voice question when an outside topic is first',async()=>{
 const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
 const base=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
 const configuration={...base,questions:[{key:'autos',type:'noul',text:'Outside cars',positive:'Cars',negative:'Other',scope:'all',domain:'outside',origin:'brand_os',human_locked:true},...base.questions]};
 const original=globalThis.fetch,questions:string[]=[];
 globalThis.fetch=async input=>{const url=String(input);if(!url.includes('/metrics?'))return Response.json({configuration:{id:'cfg',configuration},map:{id:'map'}});
  const q=new URL(url,'https://studio.invalid').searchParams.get('question_key')!;questions.push(q);
  return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'cfg',question_key:q,counts:{asked:0,eligible:3,pending:3},distribution:[],trend:[],topic_cross:[]});};
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningMetrics workspaceId="workspace" from="2026-01-01" to="2026-01-31" timezone="UTC"/></NextIntlClientProvider>);});
  assert.deepEqual(questions,['voice']);assert.equal(host.querySelector('select')!.value,'voice');assert.ok(!host.querySelector('option[value="autos"]'));
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('retry refreshes changed configuration IDs but auth and transport errors retain their own request context',async()=>{
 const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
 const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),original=globalThis.fetch;
 try{for(const mode of ['changed','forbidden','transport']as const){
  let statuses=0,metrics=0;
  globalThis.fetch=async input=>{const url=String(input);
   if(!url.includes('/metrics?')){statuses++;return Response.json({configuration:{id:statuses===1?'old':'new',configuration},map:{id:'map'}});}
   metrics++;if(mode!=='changed')return Response.json({error:mode},{status:mode==='forbidden'?403:503});
   return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'new',question_key:'voice',counts:{asked:3,eligible:3,pending:0},distribution:[{option_key:'new_configuration_distribution',count:3}],trend:[],topic_cross:[]});
  };
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
   await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningMetrics workspaceId="workspace" from="2026-01-01" to="2026-01-31" timezone="UTC"/></NextIntlClientProvider>);});
   assert.equal(statuses,1);assert.equal(metrics,1);assert.ok(host.querySelector('[role="alert"]'));
   const retry=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.retry)!;
   await act(async()=>{retry.click();});
   assert.equal(statuses,mode==='changed'?2:1);assert.equal(metrics,2);
   if(mode==='changed'){assert.ok(host.textContent?.includes('new_configuration_distribution'));assert.equal(host.querySelector('[role="alert"]'),null);}
   else assert.ok(host.querySelector('[role="alert"]'));
  }finally{await act(async()=>root.unmount());host.remove();}
 }}finally{globalThis.fetch=original;}
});
