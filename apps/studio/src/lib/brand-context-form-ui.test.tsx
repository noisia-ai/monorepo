import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { BrandOsForm } from "../components/brands/BrandOsForm";
import { BrandEditForm } from "../components/brands/BrandEditForm";
import { CompetitorManager } from "../components/brands/CompetitorManager";
import { KnowledgeBaseManager } from "../components/brands/KnowledgeBaseManager";
import { WorkspaceTimezoneField } from "../components/admin/WorkspaceTimezoneField";
import { BrandContextPreparationNotice, brandContextPreparationIntent, parseBrandContextPreparationQuote, refreshedBrandContextPreparationIntent } from "../components/brands/BrandContextPreparationNotice";
import { SemanticContextReviewWorkbench, ElementReviewDetail } from "../components/brands/SemanticContextReviewWorkbench";
import { useTranslations } from "next-intl";
import { WorkspaceSelect } from "../components/admin/WorkspaceSelect";
import { browserWorkspaceTimezone, isIanaTimezone, workspaceTimezoneOptions } from "./timezone-catalog";
import { brandCreationRequestDigestV1, storedBrandCreationRequestDigestV1 } from "./data-os/brand-creation-idempotency";
import { BrandContextDomainMutationError, requireBrandContextDomainMutationKeyV1 } from "./data-os/brand-context-domain-mutation";
import { BRAND_KNOWLEDGE_NOTES_MAX_CHARS, BRAND_KNOWLEDGE_SOURCE_MAX_CHARS, buildAutomaticBrandContextText } from "./data-os/brand-automatic-knowledge";
Object.assign(globalThis, { React });
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

test("timezone default uses the browser and falls back to UTC without accepting arbitrary strings", () => {
  assert.equal(browserWorkspaceTimezone(() => "America/Mexico_City"), "America/Mexico_City");
  assert.equal(browserWorkspaceTimezone(() => "Australia/Sydney"), "Australia/Sydney");
  for (const value of ["not-a-zone", "", "+05:00", "America/Mexico City"]) {
    assert.equal(isIanaTimezone(value), false);
    assert.equal(browserWorkspaceTimezone(() => value), "UTC");
  }
  assert.equal(browserWorkspaceTimezone(() => { throw new Error("Intl unavailable"); }), "UTC");
});

test("catalog contains only supported IANA choices and preserves valid stored aliases", () => {
  const options = workspaceTimezoneOptions("US/Eastern", () => ["Europe/Paris", "Not/AZone", "Europe/Paris"]);
  assert.deepEqual(options.map(({ value }) => value), ["UTC", "Europe/Paris", "US/Eastern"]);
  assert.ok(workspaceTimezoneOptions().length > 300);
  assert.deepEqual(workspaceTimezoneOptions("Asia/Tokyo", () => { throw new Error(); }).map(x => x.value), ["UTC", "Asia/Tokyo"]);
  assert.deepEqual(workspaceTimezoneOptions("invalid", () => []).map(x => x.value), ["UTC"]);
});


const quote = {contract_version:"brand-context-preparation-quote-v1" as const, quote_digest:`sha256:${"a".repeat(64)}`, available:true,
  semantic_cap_micro_usd:"120000",prototype_cap_micro_usd:"30000",admission_not_after:"2026-09-11T12:00:00Z",quote_expires_at:"2026-09-10T12:30:00Z",
  model:"claude-sonnet-4-6" as const,embedding_model:"voyage-4",blocked_reason:null};
test("preparation accepts server quote only and seals confirmation without client caps", () => {
  assert.deepEqual(parseBrandContextPreparationQuote(quote),quote);
  for(const value of [null,{}, {...quote,model:"opus"},{...quote,semantic_cap_micro_usd:"NaN"},{...quote,admission_not_after:"invalid"}]) assert.equal(parseBrandContextPreparationQuote(value),null);
  assert.deepEqual(brandContextPreparationIntent(quote,"request-one"),{idempotency_key:"request-one",quote_digest:quote.quote_digest,confirmation:"prepare_brand_context_within_shown_cap"});
  assert.deepEqual(brandContextPreparationIntent({...quote,available:false},"request-two"),{idempotency_key:"request-two"});
  assert.deepEqual(brandContextPreparationIntent(null,"request-three"),{idempotency_key:"request-three"});
});

test("quote refresh preserves a committed request intent and explicit reauthorization rotates it", () => {
  const current = { signature: "saved-body", value: brandContextPreparationIntent(quote, "request-one") };
  assert.equal(refreshedBrandContextPreparationIntent(current), current);
  assert.equal(refreshedBrandContextPreparationIntent(current, true), undefined);
});

test("a committed brand mutation does not ask the user to submit it again when preparation is pending", async () => {
  const components = await Promise.all([
    "BrandOsForm.tsx", "BrandEditForm.tsx", "KnowledgeBaseManager.tsx", "CompetitorManager.tsx", "SemanticContextPackManager.tsx"
  ].map(name => readFile(new URL(`../components/brands/${name}`, import.meta.url), "utf8")));
  for (const source of components) {
    assert.doesNotMatch(source, /brand_context_preparation\?\.error_code[\s\S]{0,220}throw new Error\(t\("contextPending"\)\)/u);
    assert.match(source, /preparation(?:Intent)?\.accepted\(/u);
    assert.match(source, /useBrandContextPreparation\(false\)/u);
    assert.match(source, /preparation(?:Intent)?\.forUnfundedRequest\(/u);
    assert.doesNotMatch(source, /<BrandContextPreparationNotice|preparation(?:Intent)?\.forRequest\(/u);
  }
  assert.match(components[0]!, /`\/studio\/brands\/\$\{json\.data\.id\}\/brand-os`/u);
  assert.match(components[0]!, /knowledge_notes:\s*rawKnowledgeNotes/u);
  assert.doesNotMatch(components[0]!, /withRawContext/u);
  assert.match(components[0]!, /className="new-study-error" role="alert"/u);
  for (const source of [components[2]!, components[3]!]) {
    assert.match(source, /className="workspace-form__error" role="alert"/u);
  }
});

test("Admin Brand OS owns the single governed processing authorization while Admin Topics stays editorial", async () => {
  const [page, semantic, topics, analysis] = await Promise.all([
    readFile(new URL("../app/studio/brands/[id]/brand-os/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/brands/SemanticContextPackManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/brands/TopicsManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/brands/WorkspaceAnalysisControls.tsx", import.meta.url), "utf8")
  ]);
  assert.match(page, /allowProcessingAuthorization=\{\["noisia_admin", "founder", "admin"\]\.includes/u);
  assert.match(semantic, /preparation\?\.state === "awaiting_authorization" && allowProcessingAuthorization/u);
  assert.match(semantic, /<ClientBrandContextProcessingQuote[\s\S]{0,240}allowCompactAuthorization[\s\S]{0,120}authorizeFromEndpoint/u);
  assert.doesNotMatch(semantic, /variant="compact" prototypeOnly/u);
  assert.match(topics, /navigation \? <ClientProcessingJourney/u);
  assert.doesNotMatch(analysis, /TopicPreparationControls|\/topics\/preparation/u);
  assert.match(analysis, /preflight\?\.state === "missing_context"[\s\S]{0,260}<ClientBrandContextProcessingQuote/u);
  assert.match(analysis, /prototypeOnly authorizeFromEndpoint/u);
  assert.match(analysis, /onProcessingCompleted=\{\(\) => void analysis\.read\(\)\}/u);
});

test("the deprecated direct prototype write fails before creating an unclaimable run", async()=>{
  const source=await readFile(new URL("./data-os/workspace-topic-prototypes.ts",import.meta.url),"utf8");
  const start=source.indexOf("export async function requestWorkspaceTopicPrototypesForActorV1");
  const end=source.indexOf("export function validateWorkspaceTopicPrototypeRequestV1",start);
  const request=source.slice(start,end);
  assert.match(request,/processing_admission_required/u);
  assert.doesNotMatch(request,/requestSignalWorkspaceTopicPrototypesV1\(/u);
});

test("domain and preparation idempotency identities cannot diverge on compound writes", async () => {
  const routes = await Promise.all([
    "../app/api/brands/[id]/knowledge/route.ts",
    "../app/api/brands/[id]/competitors/route.ts",
    "../app/api/brands/[id]/competitors/[competitorId]/route.ts"
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of routes) {
    assert.match(source, /parsedPreparation\.data\.idempotency_key\s*!==\s*(?:mutationId|idempotencyKey)/u);
    assert.match(source, /idempotency_key_mismatch/u);
  }
});

test("brand and knowledge edits seal the domain body to the same preparation identity", async () => {
  const key = "domain-mutation-key";
  assert.equal(requireBrandContextDomainMutationKeyV1(new Request("https://example.test", {
    headers: { "Idempotency-Key": key }
  }), { idempotency_key: key }), key);
  for (const [request, preparation, code] of [
    [new Request("https://example.test"), { idempotency_key: key }, "idempotency_key_required"],
    [new Request("https://example.test", { headers: { "Idempotency-Key": key } }),
      { idempotency_key: "different-key" }, "idempotency_conflict"]
  ] as const) {
    assert.throws(() => requireBrandContextDomainMutationKeyV1(request, preparation),
      (error: unknown) => error instanceof BrandContextDomainMutationError && error.code === code);
  }
  const [brandRoute, knowledgeRoute, brandForm, knowledgeManager] = await Promise.all([
    "../app/api/brands/[id]/route.ts",
    "../app/api/brands/[id]/knowledge/[sourceId]/route.ts",
    "../components/brands/BrandEditForm.tsx",
    "../components/brands/KnowledgeBaseManager.tsx"
  ].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  assert.ok(brandRoute && knowledgeRoute && brandForm && knowledgeManager);
  for (const source of [brandRoute, knowledgeRoute]) {
    const required = source.indexOf("requireBrandContextDomainMutationKeyV1");
    const transaction = source.indexOf("db.transaction", required);
    assert.ok(required >= 0 && transaction > required, "identity is checked before the domain transaction");
    assert.match(source, /beginBrandContextDomainMutationV1/u);
    assert.match(source, /completeBrandContextDomainMutationV1/u);
  }
  assert.match(brandRoute, /action: "update-brand-context"/u);
  assert.match(knowledgeRoute, /action: "update-brand-knowledge"/u);
  assert.match(knowledgeRoute, /action: "delete-brand-knowledge"/u);
  for (const source of [brandForm, knowledgeManager]) {
    assert.match(source, /"Idempotency-Key": intent\.idempotency_key/u);
  }
});

test("competitor writes recover automatic knowledge through reconciliation without resubmitting the domain mutation", async () => {
  const [manager, route] = await Promise.all([
    readFile(new URL("../components/brands/CompetitorManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/data-os/signal/[workspaceId]/semantic-context/reconcile/route.ts", import.meta.url), "utf8")
  ]);
  assert.match(manager, /errorCode !== "brand_context_knowledge_refresh_unavailable"/u);
  assert.match(manager, /\/semantic-context\/reconcile/u);
  const recoveryStart = manager.indexOf("async function recoverAutomaticKnowledge");
  const recoveryEnd = manager.indexOf("async function addCompetitors", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recoveryBody = manager.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBody, /\/api\/data-os\/signal\/\$\{workspaceId\}\/semantic-context\/reconcile/u);
  assert.doesNotMatch(recoveryBody, /\/api\/brands\//u);
  const post = route.indexOf("export async function POST");
  const refresh = route.indexOf("await refreshAutomaticBrandContextKnowledgeV1", post);
  const reconcile = route.indexOf("await reconcileSignalBrandOsForBrandMutationV1", post);
  assert.ok(post >= 0 && refresh > post && reconcile > refresh);
});

test("pre-save Claude assistance remains available, reviewable, and bounded to Sonnet", async () => {
  const [route, form] = await Promise.all([
    readFile(new URL("../app/api/brands/intake-suggestions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/brands/BrandOsForm.tsx", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(route, /brand_intake_suggestions_disabled/u);
  assert.match(route, /BRAND_INTAKE_SUGGESTION_MODEL = "claude-sonnet-4-6"/u);
  assert.match(route, /BRAND_INTAKE_SUGGESTION_MAX_OUTPUT_TOKENS = 4096/u);
  assert.match(route, /BRAND_INTAKE_SUGGESTION_MAX_WEB_SEARCHES = 2/u);
  assert.match(route, /clientBrandCreationDecisionV1/u);
  assert.match(route, /"Cache-Control": "no-store"/u);
  assert.match(form, /fetch\("\/api\/brands\/intake-suggestions"/u);
  assert.match(form, /t\("aiStart"\)/u);
  assert.match(form, /t\("aiRegenerate"\)/u);
  assert.match(form, /onAcceptSuggestion/u);
  assert.match(form, /onDiscardSuggestion/u);
});

test("brand creation replay seals competitors and knowledge that create durable child rows", () => {
  const input = { slug: "client-brand", name: "Client brand", display_name: null, industry: "Retail",
    industry_sub: null, countries: ["MX"], description: "Context", brand_seed_handles: ["client"],
    competitors: ["Competitor A"], knowledge_notes: "Confirmed note A", timezone: "America/Mexico_City",
    status: "active", primary_brand_manager_user_id: null };
  const original = brandCreationRequestDigestV1("organization-one", input);
  assert.equal(storedBrandCreationRequestDigestV1({ creation_request_digest: original }), original);
  assert.notEqual(brandCreationRequestDigestV1("organization-one", { ...input, competitors: ["Competitor B"] }), original);
  assert.notEqual(brandCreationRequestDigestV1("organization-one", { ...input, knowledge_notes: "Confirmed note B" }), original);
  assert.equal(storedBrandCreationRequestDigestV1({}), null);
});

test("brand creation API requires the same UUID for the durable write and its preparation", async () => {
  const source = await readFile(new URL("../app/api/brands/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!mutationId\)[\s\S]{0,220}idempotency_key_required/u);
  assert.match(source, /if \(!UUID_PATTERN\.test\(mutationId\)\)[\s\S]{0,220}idempotency_key_invalid/u);
  assert.match(source, /parsed\.data\.preparation\?\.idempotency_key !== mutationId/u);
  assert.match(source, /id:\s*mutationId/u);
});

test("client brand creation derives its hidden URL slug from the brand name", async () => {
  const source = await readFile(new URL("../components/brands/BrandOsForm.tsx", import.meta.url), "utf8");
  assert.match(source, /const slug = slugify\(String\(form\.get\("slug"\)[\s\S]{0,40}\|\| name\)/u);
});

test("automatic and editable knowledge share an explicit source limit without tail truncation", () => {
  const aliases = Array.from({ length: 100 }, (_, index) => `alias-${index}-${"a".repeat(220)}`);
  const competitors = Array.from({ length: 100 }, (_, index) => `competitor-${index}-${"b".repeat(215)}`);
  const text = buildAutomaticBrandContextText({
    name: "Large brand",
    description: "d".repeat(12_000),
    industry: "Retail",
    industrySub: "Commerce",
    countries: ["MX"],
    aliases,
    competitors,
    notes: "n".repeat(BRAND_KNOWLEDGE_NOTES_MAX_CHARS)
  });
  assert.ok(text.length > 150_000 && text.length <= BRAND_KNOWLEDGE_SOURCE_MAX_CHARS);
  assert.ok(text.endsWith("n".repeat(100)), "the confirmed tail remains intact");
  assert.throws(() => buildAutomaticBrandContextText({
    name: "Oversize",
    countries: ["MX"],
    aliases: [],
    competitors: [],
    notes: "x".repeat(BRAND_KNOWLEDGE_SOURCE_MAX_CHARS)
  }), /brand_context_knowledge_source_too_large/u);
});
const detail: React.ComponentProps<typeof ElementReviewDetail>["detail"] = {
  element:{element_key:"alias-one",element_version:1,state_token:"one",lifecycle_state:"active",undo_target_version:null,
    element_kind:"alias",canonical_key:"ambiguous",display_text:"Ambiguous alias",scope:null,entity_type:null,locale:null,
    relation_kind:null,relation_target_key:null,disposition:"pending",review_state:"exception",automatic_policy:{contract_version:"semantic-policy-v1",outcome:"exception",reasons:[],authority:"server_owned",provider_prose_used_as_evidence:false},origin:"provider",
    provenance:{proposed_at:"2026-09-10T12:00:00Z",decided_at:null},applicability:{contract_version:"signal-semantic-context-effective-applicability-v1",effective_state:"workspace_inherited",locale_state:"workspace_inherited",locale:null,market_state:"sealed",generation_locales:["es-MX"],generation_markets:["MX"],source:null},
    locale_authority:{state:"workspace_inherited",locale:null,lifecycle:"not_decided",basis:null},evidence_summary:{count:0,distinct_sources:0,relations:{supports:0,limits:0,contradicts:0}},attention:{authoritative:false,needs_locale_review:false,locale_reasons:[],needs_evidence_review:false,evidence_reasons:[],duplicates:{authoritative:false,exact:false,exact_count:0,display:false,display_count:0}}},
  evidence:[],review_annotations:[],merge_lineage:[],decision_basis:{state:"not_applicable",contract_version:null,reason:null,rationale:null,decided_at:null,reviewer:null},lineage:{element_version:1,origin:"provider",append_only:true}
};
function Detail({automaticMode}:{automaticMode:boolean}) {const t=useTranslations("AdminWorkspace.brandOs.semanticContext");return <ElementReviewDetail automaticMode={automaticMode} activeFormRef={{current:null}} annotationResolutionDraft={null} busy={null} detail={detail} locale="en-US" mode="view" onAnnotate={()=>{}} onApprove={()=>{}} onBeginResolution={()=>{}} onCancelResolution={()=>{}} onCorrect={()=>{}} onLocaleAuthority={()=>{}} onMode={()=>{}} onReject={()=>{}} onResolve={()=>{}} reviewWritable t={t}/>;}

for (const locale of ["es-MX", "en-US"]) {
  const messages = JSON.parse(await readFile(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (children: React.ReactNode) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} timeZone="UTC"
    messages={messages} onError={error => { throw error; }}><AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider></NextIntlClientProvider>);
  test(`${locale}: preparation shows exact server caps and UTC expiry, unavailable preserves save-only meaning`, () => {
    const html=render(<BrandContextPreparationNotice quote={quote} loading={false}/>);
    assert.match(html,/USD 0\.15/u);assert.match(html,/UTC/u);assert.match(html,/Claude Sonnet 4.6/u);
    const absent=render(<BrandContextPreparationNotice quote={null} loading={false}/>);
    assert.ok(absent.includes(messages.BrandContextPreparation.pendingBody));assert.doesNotMatch(absent,/USD 0/u);
  });
  test(`${locale}: automatic exceptions allow edit/delete without approval; legacy decisions remain`,()=>{
    const a=messages.AdminWorkspace.brandOs.semanticContext.actions;
    const html=render(<Detail automaticMode/>);assert.ok(html.includes(a.edit));assert.ok(html.includes(a.archive));
    assert.ok(!html.includes(`>${a.approve}</button>`));assert.ok(!html.includes(`>${a.reject}</button>`));
    const legacy=render(<Detail automaticMode={false}/>);assert.ok(legacy.includes(a.approve));
    const workbench=render(<SemanticContextReviewWorkbench automaticMode workspaceId="workspace" generationKey="generation" reviewWritable onMutation={async()=>{}}/>);
    assert.doesNotMatch(workbench,/semantic-context-review__publication/u);
  });
  test(`${locale}: timezone is a searchable catalog choice with a single submitted value`, () => {
    const html = render(<WorkspaceTimezoneField value="America/Mexico_City" onChange={() => { throw new Error("must not select on render"); }} />);
    assert.match(html, /name="timezone" type="hidden" value="America\/Mexico_City"/u);
    assert.match(html, /role="combobox"/u);
    assert.ok(html.includes(messages.BrandOs.form.timezoneHelp));
    assert.match(html, /America\/Mexico City/u);
    assert.equal((html.match(/name="timezone"/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /listbox"[^>]*>.*role="option"/u, "catalog starts closed");
  });
  test(`${locale}: creation has deterministic UTC SSR while edit preserves saved timezone`, () => {
    const created = render(<BrandOsForm />);
    assert.match(created, /name="timezone" type="hidden" value="UTC"/u);
    assert.match(created, /name="slug"/u);
    assert.ok(created.includes(messages.BrandOs.form.create));
    assert.ok(created.includes(messages.BrandOs.form.competitorsPlaceholder));
    assert.ok(created.includes(messages.BrandOs.form.expandField));
    assert.ok(created.includes(messages.BrandOs.form.openCatalog.replace("{label}", messages.BrandOs.form.industry)));
    assert.match(created, /brand-ai-start/u);
    assert.match(created, /brand-ai-refine/u);
    assert.ok(created.includes(messages.BrandOs.form.aiStart));
    assert.ok(created.includes(messages.BrandOs.form.aiBudgetHint));
    assert.doesNotMatch(created, /field-ai-suggestion/u, "suggestions appear only after Claude returns a draft");
    assert.match(created, /maxLength="100000" name="knowledge_notes"/u);
    for (const key of ["brand", "aliases", "competitors", "description", "notes"] as const) {
      assert.ok(created.includes(messages.BrandOs.form[key]));
    }
    assert.doesNotMatch(created, /brand-context-preparation-notice|USD 101/u);
    const edited = render(<BrandEditForm brand={{ id: "brand-one", organizationId: "org-one", slug: "brand-one", name: "Client brand", displayName: null,
      industry: null, industrySub: null, countries: ["MX"], description: null, brandSeedHandles: null, status: "active", timezone: "Asia/Tokyo" }}
      organizations={[{ id: "org-one", name: "Client organization" }]} />);
    assert.match(edited, /name="timezone" type="hidden" value="Asia\/Tokyo"/u);
    assert.doesNotMatch(edited, /name="timezone"[^>]*maxLength/u);
    assert.doesNotMatch(edited, /brand-context-preparation-notice|USD 101/u);
    const invalid = render(<BrandEditForm brand={{ id: "brand-one", organizationId: "org-one", slug: "brand-one", name: "Client brand", displayName: null,
      industry: null, industrySub: null, countries: ["MX"], description: null, brandSeedHandles: null, status: "active", timezone: "invalid/legacy" }}
      organizations={[{ id: "org-one", name: "Client organization" }]} />);
    assert.match(invalid, /name="timezone" type="hidden" value="UTC"/u);assert.ok(!invalid.includes("invalid/legacy"));
  });
  test(`${locale}: client admin Brand OS is organization-scoped and never renders paid preparation`, () => {
    const created = render(<BrandOsForm clientContext={{ organizationId: "org-one", organizationName: "Client organization" }} />);
    assert.ok(created.includes("Client organization"));
    assert.ok(created.includes(messages.BrandOs.form.createClient));
    assert.ok(created.includes(messages.BrandOs.form.aiStart));
    assert.doesNotMatch(created, /name="organization_name"|name="slug"|brand-context-preparation-notice|\/studio/u);
    const edited = render(<BrandEditForm brand={{ id: "brand-one", organizationId: "org-one", slug: "brand-one", name: "Client brand", displayName: null,
      industry: "Retail", industrySub: null, countries: ["MX"], description: "Context", brandSeedHandles: [], status: "active", timezone: "UTC" }}
      organizations={[]} clientContext={{ workspaceSlug: "brand-one", organizationName: "Client organization" }} />);
    assert.ok(edited.includes("Client organization"));
    assert.doesNotMatch(edited, /name="organization_id"|name="slug"|name="status"|brand-context-preparation-notice|\/studio/u);
    const knowledge = render(<KnowledgeBaseManager brandId="brand-one" sources={[]} unfunded />);
    assert.doesNotMatch(knowledge, /brand-context-preparation-notice/u);
  });
  test(`${locale}: adding knowledge is visible and preserves all existing sources independently`, () => {
    const html = render(<KnowledgeBaseManager brandId="brand-one" sources={[
      { id: "automatic-source", sourceKind: "brand_os_context", title: "Generated Brand OS context", rawText: "Existing automatic knowledge", status: "ready" },
      { id: "research-source", sourceKind: "market_notes", title: "Market research", rawText: "Separate research evidence", status: "ready" }
    ]} />);
    assert.ok(html.includes(messages.KnowledgeBaseManager.addNew));
    assert.ok(html.includes(messages.KnowledgeBaseManager.multipleHelp));
    for (const value of ["Generated Brand OS context", "Existing automatic knowledge", "Market research", "Separate research evidence"]) assert.ok(html.includes(value));
    assert.equal((html.match(/<form\b/gu) ?? []).length, 3, "one new-source form plus both preserved editing forms");
    assert.ok(html.includes(messages.KnowledgeBaseManager.types.brand_os_context));
    assert.match(html, /name="raw_text"[^>]*maxLength="200000"/u);
    assert.match(html,/type="hidden" name="source_kind" value="brand_os_context"/u);
    assert.match(html,/<select[^>]*name="source_kind"/u);
    assert.doesNotMatch(html,/<input class="workspace-control" name="source_kind"/u);
    assert.doesNotMatch(html, /<details[^>]* open/u, "adding is explicit; no form opens or submits on mount");
    assert.doesNotMatch(html, /brand-context-preparation-notice|USD 101/u);
  });
  test(`${locale}: empty knowledge state still offers the same add action`, () => {
    const html = render(<KnowledgeBaseManager brandId="brand-one" sources={[]} />);
    assert.ok(html.includes(messages.KnowledgeBaseManager.addNew));
    assert.ok(html.includes(messages.KnowledgeBaseManager.empty));
    assert.doesNotMatch(html, /brand-context-preparation-notice|USD 101/u);
  });
  test(`${locale}: competitor editing remains available without a legacy price notice`, () => {
    const html = render(<CompetitorManager brandId="brand-one" workspaceId={null} competitors={[]} />);
    assert.ok(html.includes(messages.CompetitorManager.add));
    assert.doesNotMatch(html, /brand-context-preparation-notice|USD 101/u);
  });
}

test("existing non-searchable select remains closed with its original submitted value", () => {
  const html = renderToStaticMarkup(<WorkspaceSelect ariaLabel="Status" name="status" value="active" onChange={() => { throw new Error(); }}
    options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />);
  assert.match(html, /name="status" type="hidden" value="active"/u);
  assert.doesNotMatch(html, /workspace-select__search|role="listbox"/u);
});
