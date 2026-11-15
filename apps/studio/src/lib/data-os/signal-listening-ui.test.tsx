import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Window} from 'happy-dom';
import {NextIntlClientProvider} from 'next-intl';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {SignalListeningConfiguration} from '../../components/brands/SignalListeningConfiguration';
import {ListeningLexiconSuggestions} from '../../components/brands/ListeningLexiconSuggestions';
import {SignalListeningMetricTables,SignalListeningMetrics} from '../../components/signal-v2/SignalListeningMetrics';
import {signalListeningDateBoundaryV1} from './signal-listening-date';
import {renderToStaticMarkup} from 'react-dom/server';
import {ListeningMentionActions,ListeningMentionLabels,PublishedListeningTopics} from '../../components/brands/ListeningHumanActions';
import {SignalV2Mentions,type SignalMentionsViewData} from '../../components/signal-v2/SignalV2Mentions';
import type {SignalListeningHumanEditContextV1,SignalMentionListeningLabelsV1} from './signal-listening-human-contract';
const browser=new Window({url:'https://studio.invalid'});
Object.assign(globalThis,{window:browser,self:browser,document:browser.document,navigator:browser.navigator,HTMLElement:browser.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
// Existing Listening fixtures have no native completed discovery snapshot.
const withoutHumanContext=(fetcher:typeof fetch):typeof fetch=>(input,options)=>String(input).endsWith('/listening/human-edits')
  ?Promise.resolve(Response.json({error:'listening_human_snapshot_unavailable'},{status:404})):fetcher(input,options);
test('late lexical evidence never appears after changing workspace or configuration',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const original=globalThis.fetch;let resolve!:(response:Response)=>void,signal:AbortSignal|undefined;
  globalThis.fetch=withoutHumanContext(async(_input,options)=>{signal=options?.signal??undefined;return new Promise<Response>(done=>{resolve=done;});});
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  const render=(workspace:string,configuration:string)=><NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
    <ListeningLexiconSuggestions workspaceId={workspace} configurationId={configuration} disabled={false} onAccept={()=>{}}/>
  </NextIntlClientProvider>;
  try{
    await act(async()=>{root.render(render('old','old-config'));});
    await act(async()=>{host.querySelector('button')!.click();});assert.equal(signal?.aborted,false);
    await act(async()=>{root.render(render('new','new-config'));});assert.equal(signal?.aborted,true);
    await act(async()=>{resolve(Response.json({contract_version:'signal-listening-lexicon-suggestions-v1',workspace_id:'old',configuration_id:'old-config',
      available:true,foreground_size:3,background_size:3,items:[{term:'stale-private-evidence',language:'en',foreground_roots:3,background_roots:3,lift:1}]}));});
    assert.ok(!host.textContent?.includes('stale-private-evidence'));assert.equal(host.querySelector('button')!.disabled,false);
  }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('lexicon evidence is requested explicitly and accepting a term only changes the human draft',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),original=globalThis.fetch;
  const calls:Array<{url:string;method:string}>=[];
  globalThis.fetch=withoutHumanContext(async(input,options)=>{
    const url=String(input);calls.push({url,method:options?.method??'GET'});
    if(url.includes('/lexicon?'))return Response.json({contract_version:'signal-listening-lexicon-suggestions-v1',workspace_id:'workspace',configuration_id:'config',
      available:true,foreground_size:4,background_size:20,items:[{term:'chai',language:'en',foreground_roots:4,background_roots:5,lift:3.1}]});
    return Response.json({configuration:{id:'config',revision:1,configuration},map:{id:'map',root_count:20},run:null,
      capabilities:{can_edit_topics:true,can_request_processing:true}});
  });
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    assert.equal(calls.length,1,'render does not scan the corpus or invoke any model');
    const load=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.lexiconEvidenceLoad)!;
    await act(async()=>{load.click();});
    assert.ok(calls[1]!.url.endsWith('/lexicon?configuration_id=config'));
    const add=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.lexiconEvidenceAdd)!;
    await act(async()=>{add.click();});
    assert.ok([...host.querySelectorAll('textarea')].some(field=>field.value==='tea\nchai'));
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='GET'));
    assert.equal(load.disabled,true,'the edited draft must be saved before requesting evidence for another configuration');
  }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('Listening mounts in both locales without paid calls and adding a question requires saving first',async()=>{
  const oldFetch=globalThis.fetch;
  try{for(const locale of ['es-MX','en-US']as const){
    const messages=JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),'utf8'));
    const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),calls:Array<{url:string;method:string}>=[];
    globalThis.fetch=withoutHumanContext(async(url,options)=>{calls.push({url:String(url),method:options?.method??'GET'});return Response.json({configuration:{id:'config',revision:1,configuration},map:{id:'map',root_count:12},run:null,capabilities:{can_edit_topics:true,can_request_processing:true}});});
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

test('completed discovery polling adopts a clean configuration and its CAS without a reload',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
  const savedFetch=globalThis.fetch,savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  let poll:(()=>void)|undefined,reads=0,body:{expected_revision:number;configuration:{category:string}}|undefined;
  globalThis.setInterval=((callback:()=>void)=>{poll=callback;return 1;})as unknown as typeof setInterval;
  globalThis.clearInterval=(()=>undefined)as typeof clearInterval;
  globalThis.fetch=withoutHumanContext(async(_url,options)=>{
    if(options?.method==='PUT'){body=JSON.parse(String(options.body));return Response.json({error:'synthetic_save_unavailable'},{status:503});}
    reads++;
    return Response.json({configuration:{id:reads===1?'old':'new',revision:reads===1?1:2,configuration:reads===1?configuration:{...configuration,category:'updated tea'}},
      map:{id:'map',root_count:12},run:{id:'run',status:'completed'},
      discovery:{intent_id:'intent',status:'started',execution_status:reads===1?'active':'completed'},
      capabilities:{can_edit_topics:true,can_request_processing:true}});
  });
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    assert.ok(poll);assert.equal(host.querySelector('input')!.value,'tea');
    await act(async()=>{poll!();await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(host.querySelector('input')!.value,'updated tea');assert.equal(host.querySelector('[role="alert"]'),null);
    const save=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.save)!;
    assert.equal(save.disabled,false);
    await act(async()=>{save.click();await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(body?.expected_revision,2);assert.equal(body?.configuration.category,'updated tea');assert.equal(reads,2,'polling replaces the need to reload');
  }finally{
    await act(async()=>root.unmount());host.remove();globalThis.fetch=savedFetch;globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;
  }
});

test('overlapping polls and stale later snapshots cannot roll back the configuration, status or CAS',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
  const savedFetch=globalThis.fetch,savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  try{for(const mode of ['out_of_order','stale_later_request','same_revision_status','dirty_later_stale']as const){
    let poll:(()=>void)|undefined,initial=true,body:{expected_revision:number;configuration:{category:string}}|undefined;
    const pending:Array<(response:Response)=>void>=[],dirty=mode==='dirty_later_stale';
    const snapshot=(revision:number,canEdit=true,active=true)=>Response.json({
      configuration:{id:revision===1?'old':'new',revision,configuration:revision===1?configuration:{...configuration,category:'updated tea'}},
      map:{id:'map',root_count:12},run:{id:'run',status:'completed'},
      discovery:{intent_id:'intent',status:'started',execution_status:active?'active':'completed'},
      capabilities:{can_edit_topics:canEdit,can_request_processing:canEdit}});
    globalThis.setInterval=((callback:()=>void)=>{poll=callback;return 1;})as unknown as typeof setInterval;
    globalThis.clearInterval=(()=>undefined)as typeof clearInterval;
    globalThis.fetch=withoutHumanContext(async(_url,options)=>{
      if(options?.method==='PUT'){body=JSON.parse(String(options.body));return Response.json({error:'synthetic_save_unavailable'},{status:503});}
      if(initial){initial=false;return snapshot(1);}
      return new Promise<Response>(resolve=>pending.push(resolve));
    });
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    try{
      await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
      assert.ok(poll);
      if(dirty){const add=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.addQuestion)!;await act(async()=>add.click());}
      await act(async()=>{poll!();poll!();});assert.equal(pending.length,2);
      const latestIndex=mode==='stale_later_request'||dirty?0:1;
      await act(async()=>{pending[latestIndex]!(snapshot(2));});
      await act(async()=>{pending[1-latestIndex]!(snapshot(mode==='same_revision_status'?2:1,false));});
      assert.equal(host.querySelector('input')!.value,dirty?'tea':'updated tea',mode);
      const activeSave=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.save);
      assert.ok(activeSave,'a stale status cannot remove the current edit controls');assert.equal(activeSave.disabled,true);
      if(dirty){assert.ok(host.textContent?.includes(messages.LabelingStudySettings.conflict));assert.equal(host.querySelectorAll('fieldset').length,3);}
      else assert.equal(host.querySelector('[role="alert"]'),null);
      await act(async()=>{poll!();pending[2]!(snapshot(2,true,false));});
      const save=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.save)!;
      await act(async()=>{save.click();});
      assert.equal(body?.expected_revision,dirty?1:2);assert.equal(body?.configuration.category,dirty?'tea':'updated tea');
    }finally{await act(async()=>root.unmount());host.remove();}
  }}finally{globalThis.fetch=savedFetch;globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;}
});

test('polling a newer configuration never advances the CAS revision of an unsaved draft',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']});
  const savedFetch=globalThis.fetch,savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  let poll:(()=>void)|undefined,reads=0,revision:unknown;
  globalThis.setInterval=((callback:()=>void)=>{poll=callback;return 1;})as unknown as typeof setInterval;
  globalThis.clearInterval=(()=>undefined)as typeof clearInterval;
  globalThis.fetch=withoutHumanContext(async(_url,options)=>{
    if(options?.method==='PUT'){revision=JSON.parse(String(options.body)).expected_revision;return Response.json({error:'listening_configuration_conflict'},{status:409});}
    reads++;
    return Response.json({configuration:{id:reads===1?'old':'new',revision:reads===1?1:2,configuration},map:{id:'map',root_count:12},
      run:{id:'run',status:reads===1?'running':'completed'},capabilities:{can_edit_topics:true,can_request_processing:true}});
  });
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  try{
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    const add=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.addQuestion)!;
    await act(async()=>add.click());
    assert.ok(poll);
    await act(async()=>{poll!();await new Promise(resolve=>setTimeout(resolve,0));});
    const save=[...host.querySelectorAll('button')].find(button=>button.textContent===messages.Listening.save)!;
    assert.equal(save.disabled,false);
    assert.equal(host.querySelectorAll('fieldset').length,3,'the local question remains in the draft');
    assert.ok(host.textContent?.includes(messages.LabelingStudySettings.conflict));
    await act(async()=>{save.click();await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(revision,1,'the human draft retains the revision it was loaded from');
  }finally{
    await act(async()=>root.unmount());host.remove();globalThis.fetch=savedFetch;globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;
  }
});

test('automatic prototype preparation and unresolved prior exposure keep the run action closed',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),oldFetch=globalThis.fetch;
  try{for(const mode of ['preparation','unknown','discovery','discovery_unknown']as const){
    globalThis.fetch=withoutHumanContext(async()=>Response.json({configuration:{id:'config',revision:1,configuration},map:{id:'map',root_count:12},
      run:mode==='unknown'?{id:'run',status:'failed',unknown_micro_usd:'10'}:null,
      preparation:mode==='preparation'?{id:'prep',status:'waiting_prototypes'}:null,
      discovery:mode.startsWith('discovery')?{intent_id:'initial',status:'started',execution_status:mode==='discovery'?'active':'outcome_unknown'}:null,
      capabilities:{can_edit_topics:true,can_request_processing:true}}));
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>{root.render(<NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC"><SignalListeningConfiguration workspaceId="workspace"/></NextIntlClientProvider>);});
    const label=mode==='preparation'||mode==='discovery'?messages.Listening.running:messages.Listening.run;
    const run=[...host.querySelectorAll('button')].find(button=>button.textContent===label)!;
    assert.equal(run.disabled,true);
    if(mode==='unknown'||mode==='discovery_unknown')assert.ok(host.textContent?.includes(messages.Listening.unresolved));
    await act(async()=>root.unmount());host.remove();
  }}finally{globalThis.fetch=oldFetch;}
});


test('changing a question and receiving an error never shows the prior question distribution',async()=>{
  const messages=JSON.parse(await readFile(new URL('../../../messages/en-US.json',import.meta.url),'utf8'));
  const configuration=signalListeningBaseTemplateV1({category:'tea',lexicon_terms:['tea']}),oldFetch=globalThis.fetch;let reads=0;
  globalThis.fetch=withoutHumanContext(async input=>{
    const url=String(input);
    if(!url.includes('/metrics?'))return Response.json({configuration:{id:'config',configuration},map:{id:'map'}});
    if(++reads>1)return Response.json({error:'unavailable'},{status:503});
    return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'config',question_key:new URL(url,'https://studio.invalid').searchParams.get('question_key'),
      counts:{asked:7,eligible:10,pending:3},distribution:[{option_key:'unique_old_question_label',count:7}],trend:[],topic_cross:[]});
  });
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
 globalThis.fetch=withoutHumanContext(async input=>{const url=String(input);if(!url.includes('/metrics?'))return Response.json({configuration:{id:'cfg',configuration},map:{id:'map'}});
  const q=new URL(url,'https://studio.invalid').searchParams.get('question_key')!;questions.push(q);
  return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'cfg',question_key:q,counts:{asked:0,eligible:3,pending:3},distribution:[],trend:[],topic_cross:[]});});
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
  globalThis.fetch=withoutHumanContext(async input=>{const url=String(input);
   if(!url.includes('/metrics?')){statuses++;return Response.json({configuration:{id:statuses===1?'old':'new',configuration},map:{id:'map'}});}
   metrics++;if(mode!=='changed')return Response.json({error:mode},{status:mode==='forbidden'?403:503});
   return Response.json({contract_version:'signal-listening-question-metrics-v1',configuration_id:'new',question_key:'voice',counts:{asked:3,eligible:3,pending:0},distribution:[{option_key:'new_configuration_distribution',count:3}],trend:[],topic_cross:[]});
  });
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

const humanId=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function humanFixture(){
  const configuration=signalListeningBaseTemplateV1({category:'beer',lexicon_terms:['beer']});
  const topic=(key:string,name:string,scope:'all'|'consumer_category'='all',domain:'category'|'adjacent'|'outside'='category')=>({
    key,type:'noul' as const,text:name,positive:name+' definition',negative:'Other conversations',scope,domain,origin:'agent' as const,human_locked:false,
    topic_source:key==='festival'?'defined' as const:'discovered' as const,parent_theme_key:'occasions',
    localization:{original_language:'pt',original:{name:'Original '+name,definition:'Original '+name},
      en:{name,definition:name+' definition'},es:{name:'ES '+name,definition:'Definición '+name}}});
  configuration.themes=[{key:'occasions',name:'Ocasiões',origin:'agent',human_locked:false,
    localization:{original_language:'pt',original:{name:'Ocasiões'},en:{name:'Occasions'},es:{name:'Ocasiones'}}}];
  configuration.questions.push(topic('festival','Festivals'),topic('meal','Meals','all','adjacent'),topic('consumer','Consumer only','consumer_category'),topic('outside','Outside cars','all','outside'));
  const sha='sha256:'+'a'.repeat(64);
  const context:SignalListeningHumanEditContextV1={contract_version:'signal-listening-human-edit-context-v1',configuration,can_edit:true,human_snapshot_id:null,
    expected:{base_snapshot_id:humanId(1),configuration_id:humanId(2),configuration_digest:sha,source_generation_id:humanId(3),source_generation_digest:sha,
      map_id:humanId(4),source_digest:sha,policy_version_id:humanId(5),policy_digest:sha,human_revision_digest:sha,edit_revision:0,previous_edit_id:null}};
  const labels:SignalMentionListeningLabelsV1={binding:{snapshot_id:humanId(1),configuration_id:humanId(2),generation_id:humanId(3),map_id:humanId(4),snapshot_digest:sha,human_snapshot_id:null},
    labels:configuration.questions.filter(q=>q.topic_source).map(q=>({question_key:q.key,name:q.text,names:{original:q.localization!.original.name,en:q.localization!.en.name,es:q.localization!.es.name},
      domain:q.domain!,scope:q.scope,effective_belongs:q.key==='festival',probability:q.key==='festival'?.9:.1,human_belongs:null,human_decision_id:null,label_source:'jev'}))};
  const receipt={id:humanId(6),configuration_id:humanId(7),generation_id:humanId(8),revision:1,operation:'remove',replayed:false};
  const nextContext:SignalListeningHumanEditContextV1={...context,human_snapshot_id:receipt.id,
    expected:{...context.expected,configuration_id:receipt.configuration_id,source_generation_id:receipt.generation_id,edit_revision:1,previous_edit_id:receipt.id}};
  const nextLabels:SignalMentionListeningLabelsV1={binding:{...labels.binding,snapshot_id:receipt.id,configuration_id:receipt.configuration_id,generation_id:receipt.generation_id,human_snapshot_id:receipt.id},
    labels:labels.labels.map(label=>label.question_key==='festival'?{...label,effective_belongs:false,human_belongs:false,human_decision_id:receipt.id,label_source:'human'}:label)};
  return{context,labels,receipt,nextContext,nextLabels};
}
async function mountHuman(children:React.ReactNode,locale='en-US'){
  const messages=JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),'utf8'));
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  const render=async(next:React.ReactNode)=>{await act(async()=>root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">{next}</NextIntlClientProvider>));};
  await render(children);
  return{host,render,messages,async close(){await act(async()=>root.unmount());host.remove();}};
}
const humanButton=(host:ParentNode,text:string)=>[...host.querySelectorAll('button')].find(button=>button.textContent===text);

test('native Listening labels keep the original probability separate from a human negative in both locales',async()=>{
  const f=humanFixture();
  for(const locale of ['en-US','es-MX']){
    const messages=JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),'utf8'));
    const html=renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><ListeningMentionLabels labels={f.nextLabels}/></NextIntlClientProvider>);
    assert.ok(html.includes(messages.ListeningHuman.doesNotBelong));assert.ok(html.includes(messages.ListeningHuman.humanDecision));
    assert.ok(html.includes('90'));assert.ok(html.includes(locale==='es-MX'?'ES Festivals':'Festivals'));
    assert.equal(f.nextLabels.labels[0]?.probability,.9,'rendering does not rewrite the JEV result');
  }
});

test('membership controls require a completed editable native context with the exact displayed binding',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch;let posts=0;
  try{for(const mode of ['missing','forbidden','readonly','stale','malformed']as const){
    globalThis.fetch=async(_url,options)=>{
      if(options?.method==='POST'){posts++;throw Error('no writes permitted');}
      return mode==='missing'||mode==='forbidden'?Response.json({error:mode},{status:mode==='missing'?404:403})
        :Response.json(mode==='readonly'?{...f.context,can_edit:false}:mode==='malformed'?{...f.context,contract_version:'unsupported'}:f.nextContext);
    };
    const app=await mountHuman(<ListeningMentionActions workspaceId="workspace" rootId={humanId(20)} labels={f.labels} onSaved={async()=>true}/>);
    try{
      assert.equal(humanButton(app.host,app.messages.ListeningHuman.remove),undefined);
      assert.equal(humanButton(app.host,app.messages.ListeningHuman.move),undefined);
      if(mode==='stale')assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.staleLabels));
    }finally{await app.close();}
  }}finally{globalThis.fetch=savedFetch;}
  assert.equal(posts,0);
});

test('moving a positive native membership sends the complete opaque CAS and no processing fields',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch,posts:Array<{body:string;key:string|null}>=[];let reads=0,saves=0;
  globalThis.fetch=async(url,options)=>{
    assert.ok(String(url).endsWith('/listening/human-edits'),'only the human endpoint participates');
    if(options?.method==='POST'){posts.push({body:String(options.body),key:new Headers(options.headers).get('Idempotency-Key')});return Response.json({...f.receipt,operation:'move'});}
    reads++;return Response.json(reads===1?f.context:f.nextContext);
  };
  const app=await mountHuman(<ListeningMentionActions workspaceId="workspace" rootId={humanId(20)} labels={f.labels} onSaved={async()=>{saves++;return true;}}/>);
  try{
    const target=app.host.querySelector('select')!;
    await act(async()=>{target.value='meal';target.dispatchEvent(new browser.Event('change',{bubbles:true}) as unknown as Event);});
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.move)!.click());
    assert.equal(posts.length,1);assert.ok(posts[0]!.key);
    assert.deepEqual(JSON.parse(posts[0]!.body),{operation:'membership',expected:f.context.expected,root_id:humanId(20),from_question_key:'festival',to_question_key:'meal'});
    assert.equal(reads,2);assert.equal(saves,1);assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.saved));
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('an uncertain human correction retries the identical frozen body and key before any other edit',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch,posts:Array<{body:string;key:string|null}>=[];let reads=0,saves=0;
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST'){
      posts.push({body:String(options.body),key:new Headers(options.headers).get('Idempotency-Key')});
      if(posts.length===1)throw Error('synthetic acknowledgement lost after commit');
      return Response.json({...f.receipt,replayed:true});
    }
    reads++;return Response.json(reads===1?f.context:f.nextContext);
  };
  const app=await mountHuman(<ListeningMentionActions workspaceId="workspace" rootId={humanId(20)} labels={f.labels} onSaved={async()=>{saves++;return true;}}/>);
  try{
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.remove)!.click());
    assert.equal(posts.length,1);assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.uncertain));
    assert.equal(app.host.querySelector('section')!.getAttribute('aria-busy'),'false','uncertain recovery remains announced and actionable');
    assert.equal(humanButton(app.host,app.messages.ListeningHuman.remove)!.disabled,true);assert.equal(app.host.querySelector('select')!.disabled,true);
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.retrySame)!.click());
    assert.equal(posts.length,2);assert.deepEqual(posts[1],posts[0]);assert.equal(reads,2);assert.equal(saves,1);
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('a native CAS rejection refreshes context without silently replaying a different correction',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch;let posts=0,reads=0,saves=0;
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST'){posts++;return Response.json({error:'listening_human_context_changed'},{status:409});}
    return Response.json(++reads===1?f.context:f.nextContext);
  };
  const app=await mountHuman(<ListeningMentionActions workspaceId="workspace" rootId={humanId(20)} labels={f.labels} onSaved={async()=>{saves++;return true;}}/>);
  try{
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.remove)!.click());
    assert.equal(posts,1);assert.equal(reads,2);assert.equal(saves,0);
    assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.conflict));
    assert.equal(humanButton(app.host,app.messages.ListeningHuman.remove),undefined);
    assert.equal(humanButton(app.host,app.messages.ListeningHuman.retrySame),undefined);
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('published Listening topics localize themes, distinguish origins and hide outside topics until requested',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({...f.context,can_edit:false});
  const app=await mountHuman(<PublishedListeningTopics workspaceId="workspace" allowMerge/>, 'es-MX');
  try{
    assert.ok(app.host.textContent?.includes('Ocasiones'));assert.ok(app.host.textContent?.includes('ES Festivals'));
    assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.defined));assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.discovered));
    assert.ok(!app.host.textContent?.includes('ES Outside cars'));assert.equal(humanButton(app.host,app.messages.ListeningHuman.merge),undefined);
    const outside=app.host.querySelector('input[type="checkbox"]')!;
    await act(async()=>outside.dispatchEvent(new browser.MouseEvent('click',{bubbles:true}) as unknown as Event));
    assert.ok(app.host.textContent?.includes('ES Outside cars'));
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('merging published topics requires compatible scopes and a selected destination in the native CAS',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch,posts:unknown[]=[];let reads=0,saves=0;
  const merged={...f.nextContext,configuration:{...f.context.configuration,questions:f.context.configuration.questions.filter(q=>q.key!=='festival')}};
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST'){posts.push(JSON.parse(String(options.body)));return Response.json({...f.receipt,operation:'merge'});}
    return Response.json(++reads===1?f.context:merged);
  };
  const app=await mountHuman(<PublishedListeningTopics workspaceId="workspace" allowMerge onSaved={async()=>{saves++;return true;}}/>);
  try{
    const checkbox=(name:string)=>app.host.querySelector(`input[aria-label="Select ${name} for merging"]`)as HTMLInputElement;
    await act(async()=>checkbox('Festivals').click());
    assert.equal(checkbox('Consumer only').disabled,true,'different scopes cannot be mixed');
    await act(async()=>checkbox('Meals').click());
    const merge=humanButton(app.host,app.messages.ListeningHuman.merge)!;assert.equal(merge.disabled,true);
    const target=app.host.querySelector('select')!;
    await act(async()=>{target.value='meal';target.dispatchEvent(new browser.Event('change',{bubbles:true}) as unknown as Event);});
    await act(async()=>merge.click());
    assert.deepEqual(posts,[{operation:'merge',expected:f.context.expected,source_question_keys:['festival','meal'],target_question_key:'meal'}]);
    assert.equal(saves,1);assert.equal(reads,2);assert.ok(!app.host.textContent?.includes('Festivals'));
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('a confirmed correction with a failed refresh retries only the saved reads, never the mutation',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch;let posts=0,reads=0,saves=0;
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST'){posts++;return Response.json(f.receipt);}
    reads++;return reads===2?Response.json({error:'synthetic_read_failure'},{status:503}):Response.json(reads===1?f.context:f.nextContext);
  };
  const app=await mountHuman(<ListeningMentionActions workspaceId="workspace" rootId={humanId(20)} labels={f.labels} onSaved={async()=>{saves++;return true;}}/>);
  try{
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.remove)!.click());
    assert.equal(posts,1);assert.equal(saves,0);assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.refresh_failed));
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.refresh)!.click());
    assert.equal(posts,1);assert.equal(reads,3);assert.equal(saves,1);
    assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.saved));
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('native mention removal refreshes the list and the open drawer through a focused read without a reload',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch,requests:Array<{url:string;method:string;body?:string}>=[];let saved=false;
  const record:SignalMentionsViewData['records'][number]={subject_id:humanId(20),occurred_at:'2026-09-01T12:00:00Z',text_snippet:'Synthetic listening evidence',title:null,
    url:'https://example.test/mention',platform:'web',language:'en',country:null,content_type:'post',conversation_role:'root_post',sentiment:null,sentiment_score:null,
    engagement:{},interaction_count:0,thread_key:'synthetic',tags:[{taxonomy_key:'legacy',taxonomy_name:'Legacy',term_key:'historical',label:'Historical tag must remain hidden',value:null,score:1}],
    entities:[],features:[],attribution:[],tb_classification:null,listening_labels:f.labels};
  const data:SignalMentionsViewData={contract_version:'signal-backend-v1',metric_key:'mention.volume',filters_hash:'sha256:synthetic',total_count:1,records:[record],
    page:{limit:50,offset:0,next_cursor:null,next_offset:null},filter:{contract_version:'signal-backend-v1',date_range:{start:'2026-09-01',end:'2026-09-30'},timezone:'UTC',granularity:'day',dimensions:{}},comparison:{mode:'none',date_range:null},
    native:{workspace_id:'workspace',generation_id:humanId(30),scope_digest:'sha256:synthetic',is_current:true,is_processing:false,available_dates:{date_from:null,date_to:null},
      filters:{date_from:null,date_to:null,search_query:null,platforms:[]},sort_direction:'desc',metric_denominator:1,evidence_visible_total:1,withheld_evidence_count:0,integrity_withheld_count:0}};
  globalThis.fetch=async(input,options)=>{
    const url=String(input),method=options?.method??'GET';requests.push({url,method,...(options?.body?{body:String(options.body)}:{})});
    if(url.endsWith('/listening/human-edits')){
      if(method==='POST'){saved=true;return Response.json(f.receipt);}
      return Response.json(saved?f.nextContext:f.context);
    }
    assert.ok(url.startsWith('/api/data-os/signal/workspace/mentions?'));
    const query=new URL(url,'https://studio.invalid').searchParams;assert.equal(query.get('mention'),record.subject_id);assert.equal(query.get('view'),'all_conversations');
    const updated={...record,listening_labels:f.nextLabels};return Response.json({...data,records:[updated],record:updated});
  };
  function Mentions(){const[current,setCurrent]=React.useState(data);return <SignalV2Mentions brandName="Synthetic" coverage={{date_from:null,date_through:null}} data={current}
    initialMention={record} loading={false} onApplyFilter={async()=>true} onDataChange={setCurrent} onOpenControls={()=>{}} workspaceId="workspace"/>;}
  const app=await mountHuman(<Mentions/>);
  try{
    assert.ok(document.body.textContent?.includes('Festivals'));assert.ok(!document.body.textContent?.includes('Historical tag must remain hidden'));
    const remove=humanButton(document,app.messages.ListeningHuman.remove);assert.ok(remove);
    await act(async()=>remove.click());
    assert.equal(requests.filter(request=>request.method==='POST').length,1);
    assert.equal(requests.filter(request=>request.url.includes('/mentions?')).length,1);
    assert.equal(humanButton(document,app.messages.ListeningHuman.remove),undefined);
    const corrected=[...document.querySelectorAll('li')].find(item=>item.querySelector('strong')?.textContent==='Festivals');assert.ok(corrected);
    assert.ok(corrected.textContent?.includes(app.messages.ListeningHuman.doesNotBelong));assert.ok(corrected.textContent?.includes('90'));
    assert.ok(corrected.textContent?.includes(app.messages.ListeningHuman.humanDecision));
    assert.equal(new URL(window.location.href).searchParams.get('mention'),record.subject_id,'the drawer remains open with its shareable focus');
  }finally{await app.close();globalThis.fetch=savedFetch;}
});

test('a confirmed merge keeps its recovery control when the context read fails and retries no POST',async()=>{
  const f=humanFixture(),savedFetch=globalThis.fetch;let posts=0,reads=0,saves=0;
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST'){posts++;return Response.json({...f.receipt,operation:'merge'});}
    reads++;return reads===2?Response.json({error:'synthetic_read_failure'},{status:503}):Response.json(reads===1?f.context:f.nextContext);
  };
  const app=await mountHuman(<PublishedListeningTopics workspaceId="workspace" allowMerge onSaved={async()=>{saves++;return true;}}/>);
  try{
    await act(async()=>{(app.host.querySelector('input[aria-label="Select Festivals for merging"]')as HTMLInputElement).click();});
    await act(async()=>{(app.host.querySelector('input[aria-label="Select Meals for merging"]')as HTMLInputElement).click();});
    const select=app.host.querySelector('select')!;
    await act(async()=>{select.value='meal';select.dispatchEvent(new browser.Event('change',{bubbles:true}) as unknown as Event);});
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.merge)!.click());
    assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.refresh_failed));assert.equal(posts,1);assert.equal(saves,0);
    await act(async()=>humanButton(app.host,app.messages.ListeningHuman.refresh)!.click());
    assert.equal(posts,1);assert.equal(reads,3);assert.equal(saves,1);
    assert.ok(app.host.textContent?.includes(app.messages.ListeningHuman.saved));
  }finally{await app.close();globalThis.fetch=savedFetch;}
});
