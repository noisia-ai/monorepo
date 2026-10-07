/** Explicit private-runner experiment. Never imported by a web route or a test suite. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
import { verifyMfpEvalRights } from "./rights-check";
import { validateGold, validateSelection, type Gold, type Selection } from "./contract";
import { measureHybridH1V1, type HybridMeasuredRootV1 } from "./hybrid-h1-measure";
import {
  anthropicUsageV1, buildHybridClaudeRequestV1, buildHybridJevQuestionV1, decideHybridMembershipV1,
  conceptForJudgeSchemaV1, llmCostMicroUsdV1, llmPriceV1, mapHybridJevAnswerV1, parseAnthropicResponseV1,
  parseHybridClaudeAnswerV1, signalWorkspaceEmbeddingDigestV1,
  type ConceptForJudgeV1, type HybridClaudeDecisionV1, type HybridJevDecisionV1,
  type MembershipInputV1,
} from "../../packages/query-engine/src/index";
import { inspectFacetContextChangeV1 } from "../../infrastructure/db/signal-mention-facets";
import { loadSignalTopicCatalogStoreV1 } from "../../infrastructure/db/signal-topic-catalog";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../../infrastructure/db/signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1 } from "../../infrastructure/db/signal-workspace-features";
import { createTypesafeJevClientV1, validateJevResponseV1, jevProviderErrorV1 } from "../../services/workers/src/providers/typesafe-jev";
import { createHybridAnthropicMessagesClientV1, HybridAnthropicTransportError } from "../../services/workers/src/providers/anthropic-hybrid-messages";

const base = ".data/dev-corpus/voyage-real/hybrid-h1-r4";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const readMaybe = async (path: string): Promise<any | null> => readFile(path, "utf8").then(JSON.parse).catch(error => {
  if (error?.code === "ENOENT") return null; throw error;
});
const writeOnce = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { flag: "wx", mode: 0o600 });
type Settled<T> = { decision: T; settled_micro_usd: number; unknown: boolean };
const jevError = (): HybridJevDecisionV1 => ({ verdict: "error", probability: null, citation: null });
const claudeError = (): HybridClaudeDecisionV1 => ({ verdict: "error", citation: null });
const hybridCommonLedgerReadyV1 = (): boolean => false;

void main(async () => {
  // The private transport is still being moved onto signal_labeling_calls.
  // Keep paid execution impossible until both stages use shared admissions and receipts.
  if (!hybridCommonLedgerReadyV1())
    throw new Error("mfp_hybrid_common_ledger_not_wired");
  if (!process.argv.includes("--real") || process.env.NOISIA_MFP_HYBRID_ENABLED !== "true" ||
      process.env.NOISIA_JEV_PROVIDER_ENABLED !== "true" ||
      process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED !== "true") throw new Error("mfp_hybrid_disabled");
  const priceText = process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;
  const jevPrice = Number(priceText);
  if (priceText === undefined || !Number.isFinite(jevPrice) || jevPrice <= 0)
    throw new Error("mfp_hybrid_jev_price_required");
  const capArg = process.argv.find(arg => arg.startsWith("--strict-cap-micro-usd="));
  const strictCap = capArg ? Number(capArg.slice("--strict-cap-micro-usd=".length)) : null;
  if (strictCap !== null && (!Number.isSafeInteger(strictCap) || strictCap < 0)) throw new Error("mfp_hybrid_cap_invalid");
  await verifyMfpEvalRights();
  const identity = await loadMfpEvalIdentity();
  const selection = JSON.parse(await readFile(".data/dev-corpus/voyage-real/gold-selection.json", "utf8")) as Selection;
  validateSelection(selection);
  const gold = (await readFile(".data/dev-corpus/gold.jsonl", "utf8")).trim().split("\n").map(line => JSON.parse(line)) as Gold[];
  validateGold(gold, selection);
  const pool = await openDatabase();
  try {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool, workspace_id: identity.workspace_id,
      actor_user_id: identity.actor_user_id });
    if (!caps.can_request_processing || !await signalWorkspaceFeatureEnabledV1({ queryable:pool,workspace_id:identity.workspace_id,feature:"mention_facets" }) ||
        !await signalWorkspaceFeatureEnabledV1({ queryable:pool,workspace_id:identity.workspace_id,feature:"concept_membership" }))
      throw new Error("mfp_hybrid_authority_or_opt_in_missing");
    const context = await inspectFacetContextChangeV1(pool, identity.workspace_id);
    if (context.changed) throw new Error("mfp_hybrid_entity_context_stale");
    const catalog = await loadSignalTopicCatalogStoreV1({ queryable:pool,workspace_id:identity.workspace_id });
    const concepts = selection.concepts.map(({ concept_key }) => catalog.topics.find(topic => topic.term_key === concept_key));
    if (concepts.some(concept => !concept || concept.scope !== "all_conversations"))
      throw new Error("mfp_hybrid_eval_concepts_changed");
    const frozen: ConceptForJudgeV1[] = concepts.map(concept => conceptForJudgeSchemaV1.parse({
      concept_key:concept!.term_key,label:concept!.label,scope:concept!.scope,
      definition:concept!.definition,inclusion:concept!.inclusion,exclusion:concept!.exclusion,
      positive_examples:concept!.positive_examples,negative_examples:concept!.negative_examples,
      definition_digest:concept!.definition_digest,
    }));
    const rows = (await pool.query(`WITH jev_labels AS MATERIALIZED (
      SELECT DISTINCT ON(label.root_id) label.root_id,label.input_digest,label.facets,label.relevance,label.status,
        label.entity_context_digest,label.effective_entities_digest
      FROM signal_mention_facet_labels label JOIN signal_labeler_versions version ON version.labeler_digest=label.labeler_digest
      WHERE label.workspace_id=$1 AND version.kind='facets' AND version.provider='typesafe' AND version.model='jev-1.13.0'
      ORDER BY label.root_id,label.created_at DESC)
      SELECT f.root_id,f.input_digest,f.full_text text,f.title,f.platform,f.content_type,f.author,f.published_at::text,f.language,
        f.requires_context_review,jev.facets,jev.relevance,jev.status,jev.entity_context_digest,jev.effective_entities_digest
      FROM signal_mention_facets_current_v1 f JOIN jev_labels jev ON jev.root_id=f.root_id AND jev.input_digest=f.input_digest
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=f.workspace_id AND rights.root_id=f.root_id
        AND rights.metrics AND rights.evidence
      WHERE f.workspace_id=$1 ORDER BY f.root_id`, [identity.workspace_id])).rows as Array<Record<string, any>>;
    if (rows.length !== 1086 || rows.some(row => row.requires_context_review || row.entity_context_digest !== context.digest))
      throw new Error("mfp_hybrid_full_corpus_or_context_missing");
    const facetCost = (await pool.query<{micro:string;unknown:number}>(`SELECT COALESCE(sum(call.settled_micro_usd) FILTER(WHERE call.status='settled'),0)::text micro,
      count(*) FILTER(WHERE call.status IN('submitting','submitted','unknown'))::int unknown
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      JOIN signal_labeler_versions version ON version.id=run.labeler_version_id
      WHERE call.workspace_id=$1 AND run.kind='facets' AND version.provider='typesafe'`, [identity.workspace_id])).rows[0]!;
    if (facetCost.unknown) throw new Error("mfp_hybrid_facet_billing_unsettled");
    await mkdir(base, { recursive: true, mode: 0o700 });
    const jev = createTypesafeJevClientV1({ concurrency: 2 });
    const claude = createHybridAnthropicMessagesClientV1();
    let jevMicro = 0, claudeMicro = 0, unknown = 0, newCalls = 0;
    const checkCap = (reserve: number) => {
      if (strictCap !== null && Number(facetCost.micro) + jevMicro + claudeMicro + reserve > strictCap)
        throw new Error("mfp_hybrid_strict_cap_exhausted");
    };
    const runJev = async (input: MembershipInputV1, concept: ConceptForJudgeV1): Promise<Settled<HybridJevDecisionV1>> => {
      const request = buildHybridJevQuestionV1(input, concept);
      const key = sha(JSON.stringify({ stage:"jev", root:input.root_id, input:input.input_digest,
        ce:input.entity_context_digest, concept:concept.concept_key, definition:concept.definition_digest, request }));
      const path = `${base}/jev-${key}`;
      const saved = await readMaybe(`${path}-result.json`);
      if (saved) return saved;
      const attempt = await readMaybe(`${path}-attempt.json`);
      if (attempt && attempt.request_sha256 !== sha(JSON.stringify(request))) throw new Error("mfp_hybrid_jev_replay_mismatch");
      let raw = await readMaybe(`${path}-raw.json`);
      if (attempt && !raw) return { decision: jevError(), settled_micro_usd: 0, unknown: true };
      if (!attempt) {
        const reserve = Math.ceil(JSON.stringify(request).length / 3.5 * jevPrice);
        checkCap(reserve);
        await writeOnce(`${path}-request.json`, request);
        await writeOnce(`${path}-attempt.json`, { status:"submitting", request_sha256:sha(JSON.stringify(request)), reserved_micro_usd:reserve });
        newCalls++;
      }
      try {
        raw ??= await jev.evaluate(request);
        if (!await readMaybe(`${path}-raw.json`)) await writeOnce(`${path}-raw.json`, raw);
        const parsed = validateJevResponseV1(request, raw);
        const cost = llmCostMicroUsdV1({ ...parsed.usage, cache_read_input_tokens:0,
          cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0} },
          llmPriceV1("typesafe", request.model, "sync", jevPrice));
        const result = { decision: mapHybridJevAnswerV1(input, parsed), settled_micro_usd:cost, unknown:false };
        await writeOnce(`${path}-result.json`, result); return result;
      } catch (error) {
        const failure = jevProviderErrorV1(error);
        const cost = failure.evidence.usage ? llmCostMicroUsdV1({ ...failure.evidence.usage, cache_read_input_tokens:0,
          cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0} },
          llmPriceV1("typesafe", request.model, "sync", jevPrice)) : 0;
        const result = { decision:jevError(),settled_micro_usd:cost,unknown:failure.outcome==='outcome_unknown' };
        await writeOnce(`${path}-result.json`, result); return result;
      }
    };
    const runClaude = async (input: MembershipInputV1, concept: ConceptForJudgeV1): Promise<Settled<HybridClaudeDecisionV1>> => {
      const request = buildHybridClaudeRequestV1(input, concept, context.context);
      const key = sha(JSON.stringify({ stage:"claude", root:input.root_id, input:input.input_digest,
        ce:input.entity_context_digest, concept:concept.concept_key, definition:concept.definition_digest, request }));
      const path = `${base}/claude-${key}`;
      const saved = await readMaybe(`${path}-result.json`);
      if (saved) return saved;
      const attempt = await readMaybe(`${path}-attempt.json`);
      if (attempt && attempt.request_sha256 !== sha(JSON.stringify(request))) throw new Error("mfp_hybrid_claude_replay_mismatch");
      let raw = await readMaybe(`${path}-raw.json`);
      if (attempt && !raw) return { decision:claudeError(),settled_micro_usd:0,unknown:true };
      if (!attempt) {
        const reserve = llmCostMicroUsdV1({input_tokens:Math.ceil(JSON.stringify(request).length/3.5),output_tokens:4096,
          cache_read_input_tokens:0,cache_creation_input_tokens:0,
          cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0}},
          llmPriceV1("anthropic","claude-sonnet-5-5","sync"));
        checkCap(reserve);
        await writeOnce(`${path}-request.json`, request);
        await writeOnce(`${path}-attempt.json`, {status:"submitting",request_sha256:sha(JSON.stringify(request)),reserved_micro_usd:reserve});
        newCalls++;
      }
      try {
        raw ??= await claude.evaluate(request);
        if (!await readMaybe(`${path}-raw.json`)) await writeOnce(`${path}-raw.json`, raw);
        if (raw.http_status !== 200) {
          const result = { decision:claudeError(),settled_micro_usd:0,
            unknown:![400,401,402,403,404,413,422,429].includes(raw.http_status) };
          await writeOnce(`${path}-result.json`, result); return result;
        }
        const message = JSON.parse(raw.body);
        const usage = anthropicUsageV1(message);
        const cost = llmCostMicroUsdV1(usage,llmPriceV1("anthropic","claude-sonnet-5-5","sync"));
        let decision: HybridClaudeDecisionV1;
        try {
          const parsed = parseAnthropicResponseV1(message);
          decision = parsed.status === "ok" ? parseHybridClaudeAnswerV1(input,parsed.text!)
            : parsed.status === "refused" ? { verdict:"refused",citation:null } : claudeError();
        } catch { decision = claudeError(); }
        const result = {decision,settled_micro_usd:cost,unknown:false};
        await writeOnce(`${path}-result.json`, result); return result;
      } catch (error) {
        const unknownOutcome = error instanceof HybridAnthropicTransportError ? error.outcome === "outcome_unknown" : true;
        const result = {decision:claudeError(),settled_micro_usd:0,unknown:unknownOutcome};
        await writeOnce(`${path}-result.json`, result); return result;
      }
    };
    const output: HybridMeasuredRootV1[] = [];
    for (const [index,row] of rows.entries()) {
      if (index % 25 === 0) await verifyMfpEvalRights();
      const facets = row.facets as Record<string, any>;
      const gate_passed = row.status === "labeled" && row.relevance === "relevant" &&
        facets?.spam_or_bot?.abstained === false && facets.spam_or_bot.value === false &&
        facets?.entities?.abstained === false && facets.entities.value.length > 0;
      const input:MembershipInputV1 = { root_id:row.root_id,input_digest:row.input_digest,
        root_fingerprint:signalWorkspaceEmbeddingDigestV1({root_id:row.root_id,input_digest:row.input_digest}),
        entity_context_digest:row.entity_context_digest,effective_entities_digest:row.effective_entities_digest,
        text:row.text,title:row.title,platform:row.platform,content_type:row.content_type,author:row.author,
        published_at:row.published_at,language:row.language,entities:facets?.entities?.value ?? [],
        voice:facets?.voice?.abstained ? null : facets?.voice?.value ?? null,
        act:facets?.act?.abstained ? null : facets?.act?.value ?? null,evaluated_concepts:frozen };
      const decisions: HybridMeasuredRootV1["decisions"] = {};
      if (gate_passed) for (const concept of frozen) {
        const j = await runJev(input, concept); jevMicro += j.settled_micro_usd; unknown += Number(j.unknown);
        const c = j.decision.verdict === "belongs" ? await runClaude(input, concept) : null;
        if (c) { claudeMicro += c.settled_micro_usd; unknown += Number(c.unknown); }
        decisions[concept.concept_key] = decideHybridMembershipV1(input.text,j.decision,c?.decision ?? null);
      }
      output.push({root_id:row.root_id,input_digest:row.input_digest,text:row.text,gate_passed,decisions});
      if ((index + 1) % 100 === 0) console.log(JSON.stringify({stage:"hybrid_progress",roots:index+1,new_calls:newCalls,
        known_settled_micro_usd:Number(facetCost.micro)+jevMicro+claudeMicro,unknown_calls:unknown}));
    }
    const ledger = {facets_settled_usd:Number(facetCost.micro)/1e6,jev_settled_usd:jevMicro/1e6,
      claude_settled_usd:claudeMicro/1e6,unknown_calls:unknown};
    const report = measureHybridH1V1(gold,output,frozen.map(concept=>concept.concept_key),ledger);
    await writeFile(`${base}/roots.jsonl`,output.map(row=>JSON.stringify(row)).join("\n")+"\n",{flag:"wx",mode:0o600});
    await writeOnce(`${base}/ledger.json`,ledger);
    await writeOnce(`${base}/report.json`,report);
    console.log(JSON.stringify({stage:"hybrid_complete",roots:output.length,new_calls:newCalls,
      observed_usd_per_1000:report.cost.observed_usd_per_1000,review_required:report.full_corpus.review_required,
      claude_citation_valid_rate:report.full_corpus.claude_citation_valid_rate,unknown_calls:unknown,
      source_reference:"jev_noul_entire_root_not_localized"}));
  } finally { await pool.end(); }
});
