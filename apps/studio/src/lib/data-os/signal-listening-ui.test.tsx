import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Window} from 'happy-dom';
import {NextIntlClientProvider} from 'next-intl';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {SignalListeningConfiguration} from '../../components/brands/SignalListeningConfiguration';
import {SignalListeningMetricTables} from '../../components/signal-v2/SignalListeningMetrics';
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
