import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React,{createElement,type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NextIntlClientProvider} from 'next-intl';
import {MfpMembershipConfigurationView} from '../../components/brands/MfpMembershipConfiguration';
import {MfpEvidence} from '../../components/brands/MfpEvidence';
import {parseMembershipConfiguration,membershipRouteNeedsConfirmation,type MembershipConfiguration} from './mfp-membership-configuration-ui';
Object.assign(globalThis,{React});
const value:MembershipConfiguration={route:'hybrid_h1',route_digest:'current',can_configure:true,unknown_calls:2,reserved_exposure_micro_usd:'124000'};
test('uncertain exposure requires confirmation only when returning from H1 to standard',()=>{
 assert.equal(membershipRouteNeedsConfirmation(value,'standard'),true);
 assert.equal(membershipRouteNeedsConfirmation(value,'hybrid_h1'),false);
 assert.equal(membershipRouteNeedsConfirmation({...value,unknown_calls:0},'standard'),false);
 assert.equal(parseMembershipConfiguration({...value,unknown_calls:-1}),null);
 assert.equal(parseMembershipConfiguration({...value,reserved_exposure_micro_usd:'unknown'}),null);
 assert.deepEqual(parseMembershipConfiguration(value),value);
});
for(const locale of ['es-MX','en-US'] as const)test(`${locale}: save is disabled without permission or acknowledgement; assisted correction is clearly attributed`,async()=>{
 const messages=JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),'utf8'));
 const wrapper=(child:React.ReactNode)=>renderToStaticMarkup(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Mexico_City'} as ComponentProps<typeof NextIntlClientProvider>,child));
 const render=(current=value,confirmed=false)=>wrapper(createElement(MfpMembershipConfigurationView,{value:current,route:'standard',busy:false,confirmed,error:null,onRoute:()=>{},onConfirm:()=>{},onSave:()=>{},onRefresh:()=>{}}));
 assert.match(render(),/disabled=""[^>]*>[^<]*(?:Guardar método|Save method)/);
 assert.doesNotMatch(render(value,true),/disabled=""[^>]*>[^<]*(?:Guardar método|Save method)/);
 assert.match(render({...value,can_configure:false},true),/disabled=""[^>]*>[^<]*(?:Guardar método|Save method)/);
 const evidence=wrapper(createElement(MfpEvidence,{mentionHref:'/mentions',item:{root_id:'r',concept_key:'c',definition_digest:'d',verdict:'belongs',citations:[],rationale:'original rationale',source:'human',decided_via:'agent_assisted',text:'Original',title:null,url:null,platform:null}}));
 assert.ok(evidence.includes(messages.Mfp.decisionOrigin.agent_assisted));assert.ok(evidence.includes('original rationale'));
 assert.ok(!evidence.includes(messages.Mfp.decisionOrigin.human_ui));
 const reviewed=wrapper(createElement(MfpEvidence,{mentionHref:'/mentions',item:{root_id:'r',concept_key:'c',definition_digest:'d',verdict:'review_required',citations:[],rationale:'A disagreement',source:'model',text:'Original',title:null,url:null,platform:null,
  hybrid_review:{jev:{verdict:'not_belongs',probability:0.2,citation:null},claude:{verdict:'belongs',citation:{quote:'Original',start:0,end:8}}}}}));
 assert.ok(reviewed.includes(messages.Mfp.hybridReview.first));assert.ok(reviewed.includes(messages.Mfp.hybridReview.verification));
 assert.match(reviewed,/<blockquote>Original<\/blockquote>/u);assert.ok(reviewed.includes('A disagreement'));

});
