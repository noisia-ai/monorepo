import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {NextIntlClientProvider} from "next-intl";
import {MfpEvidence} from "./MfpEvidence";
import {MfpRunReceipt} from "./MfpMembershipControls";
Object.assign(globalThis,{React});
for (const locale of ["es-MX","en-US"]) {
  const messages=JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`,import.meta.url),"utf8"));
  const render=(element:React.ReactElement)=>renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">{element}</NextIntlClientProvider>);
  test(`${locale}: evidence preserves source context and marks the exact citation`,()=>{
    const html=render(<MfpEvidence mentionHref="#mention-root" item={{root_id:"root",concept_key:"sample",definition_digest:"x",verdict:"insufficient",source:"model",
      citations:[{quote:"cita literal",quote_start:99,quote_end:110,chunk_index:2,chunk_sha256:"x"}],
      rationale:null,text:"Antes cita literal después <script>bad</script>",title:null,url:"javascript:alert(1)",platform:null}}/>);
    assert.match(html,/Antes/);assert.match(html,/<mark>cita literal<\/mark>/);assert.match(html,/después/);
    assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/href="javascript:/);
    assert.match(html,new RegExp(messages.Mfp.verdicts.insufficient));
  });
  test(`${locale}: withheld refusals retain their state without fabricated evidence`,()=>{
    const html=render(<MfpEvidence mentionHref="#mention-root" item={{root_id:"root",concept_key:"sample",definition_digest:"x",verdict:"refused",source:"model",
      citations:[],rationale:null,text:null,title:null,url:null,platform:null,evidence_withheld:true}}/>);
    assert.match(html,new RegExp(messages.Mfp.verdicts.refused));assert.match(html,new RegExp(messages.Mfp.withheld));assert.doesNotMatch(html,/<mark>/);
  });
  test(`${locale}: an absent strict maximum is distinct from a zero maximum`,()=>{
    const run={id:"run",status:"completed",estimated_micro_usd:100,settled_micro_usd:0,reserved_micro_usd:0,budget_micro_usd:null,cap_micro_usd:null,error_code:null};
    assert.match(render(<MfpRunReceipt run={run}/>),new RegExp(messages.Mfp.noMaximum));
    assert.doesNotMatch(render(<MfpRunReceipt run={{...run,cap_micro_usd:0}}/>),new RegExp(messages.Mfp.noMaximum));
  });
}
