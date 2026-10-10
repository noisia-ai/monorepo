import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {mfpQuoteParts,mfpSafeUrl,mfpMoney,mfpErrorKey} from "./mfp-ui";

test("citations highlight only literal original text and merge overlaps",()=>{
  const text="Antes. Compra con prueba de voz. Después.";
  const parts=mfpQuoteParts(text,["Compra con prueba","prueba de voz","inventada"]);
  assert.equal(parts.map(p=>p.text).join(""),text);
  assert.deepEqual(parts.filter(p=>p.highlight).map(p=>p.text),["Compra con prueba de voz"]);
  assert.deepEqual(mfpQuoteParts("Una voz","voz inexistente".split(";")),[{text:"Una voz",highlight:false}]);
});
test("unicode citation text is preserved without interpreting chunk offsets",()=>{
  const text="😀 Café y té. <script>alert(1)</script>";
  const parts=mfpQuoteParts(text,["Café y té"]);
  assert.equal(parts.map(p=>p.text).join(""),text);
  assert.equal(parts[1]?.text,"Café y té");
});
test("cost formatting preserves unavailable, zero and actual microdollars",()=>{
  assert.equal(mfpMoney(null,"en-US"),"—");assert.equal(mfpMoney(undefined,"en-US"),"—");
  assert.equal(mfpMoney(0,"en-US"),"$0.00");assert.equal(mfpMoney("118404","en-US"),"$0.1184");
});
test("original links accept only web schemes",()=>{
  assert.equal(mfpSafeUrl("javascript:alert(1)"),null);assert.equal(mfpSafeUrl("//example.com"),null);
  assert.equal(mfpSafeUrl("https://example.com/a"),"https://example.com/a");
});
test("technical errors remain actionable without becoming semantic decisions",()=>{
  assert.equal(mfpErrorKey("labeling_preparation_required"),"preparation");
  assert.equal(mfpErrorKey("labeling_provider_unavailable"),"provider");
  assert.equal(mfpErrorKey("unknown_transport_failure"),"request");
  assert.equal(mfpErrorKey("hybrid_route_upgrade_required"),"routeUpgrade");
  assert.equal(mfpErrorKey("facets_override_invalid"),"invalid");
  assert.equal(mfpErrorKey("labeling_unresolvable_after_window"),"unresolvable");
  assert.equal(mfpErrorKey("labeling_provider_usage_invalid"),"usageInvalid");
});
test("both locales cover the complete MFP vocabulary",()=>{
  const es=JSON.parse(readFileSync(new URL("../../../messages/es-MX.json",import.meta.url),"utf8")).Mfp;
  const en=JSON.parse(readFileSync(new URL("../../../messages/en-US.json",import.meta.url),"utf8")).Mfp;
  const keys=(o:Record<string,unknown>,prefix=""):string[]=>Object.entries(o).flatMap(([k,v])=>typeof v==="string"?[prefix+k]:keys(v as Record<string,unknown>,`${prefix}${k}.`));
  assert.deepEqual(keys(es).sort(),keys(en).sort());assert.notEqual(es.verdicts.refused,es.verdicts.not_belongs);assert.notEqual(en.verdicts.error,en.verdicts.not_belongs);
});
