/** Synthetic required-ordinal grammar: mixed ES/EN, ~60k chars, no corpus/gold reads. */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { main, openDatabase } from "./guard.mjs";
import {
  buildFacetRequestV1,
  facetInputDigestV1,
  facetLabelerIdentityV1,
  facetLabelerIdentityOrdinalV2,
  parseFacetGroupV1,
} from "../../packages/query-engine/src/signal-mention-facets-v1";
import {
  anthropicUsageV1,
  parseAnthropicResponseV1,
} from "../../packages/query-engine/src/anthropic-response-v1";
import {
  llmCostMicroUsdV1,
  llmPriceV1,
} from "../../packages/query-engine/src/llm-pricing-v1";
import {
  AnthropicBatchTransportError,
  anthropicBatchErrorReceipt,
  createAnthropicMessageBatchesClient,
  type AnthropicBatchItem,
} from "../../services/workers/src/providers/anthropic-message-batches";

const variant = "ordinal";
// Default pins the existing V2 journals; V3 must use a separate opt-in journal.
const version = Number(
  process.argv.find((arg) => arg.startsWith("--version="))?.slice(10) ?? "2",
);
if (![2, 3].includes(version))
  throw new Error("mfp_ordinal_probe_version_invalid");
const rootCount = Number(
  process.argv.find((arg) => arg.startsWith("--roots="))?.slice(8),
);
if (![8, 25].includes(rootCount))
  throw new Error("mfp_ordinal_probe_roots_required");
const sha = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const context = {
  entities: [
    {
      entity_id: "probe-primary",
      kind: "primary_brand" as const,
      name: "Sample Brand",
      aliases: ["sample brand", "sample service"],
      disambiguation: null,
    },
    {
      entity_id: "probe-rival-one",
      kind: "competitor" as const,
      name: "Example Rival",
      aliases: ["example rival"],
      disambiguation: null,
    },
    {
      entity_id: "probe-rival-two",
      kind: "competitor" as const,
      name: "Fictional Service",
      aliases: ["fictional service"],
      disambiguation: null,
    },
    {
      entity_id: "probe-category",
      kind: "category" as const,
      name: "Connected devices",
      aliases: ["connected devices"],
      disambiguation: null,
    },
  ],
};
const examples = [
  "La biblioteca municipal presentó un ciclo de lecturas de poesía.",
  "How can I change my Sample Brand delivery address?",
  "Sample Brand charged me twice for one order.",
  "Thanks to Sample Brand support for replacing the broken item.",
  "Sample Brand announced a new service this morning.",
  "The Sample Brand package arrived three days late.",
  "I cannot find the cancellation button in Sample Brand settings.",
  "Our neighborhood library extended its weekend opening hours.",
  "Sample Brand now ships this product in recyclable packaging.",
  "Is the Sample Brand membership available in another country?",
  "I used Sample Brand on a train and the connection remained stable.",
  "The Sample Brand screen is brighter than the previous edition.",
  "Sample Brand customer service never answered my message.",
  "Sample Brand offers free installation with today's order.",
  "A tutorial explains how to reset the Sample Brand password.",
  "Rain postponed our local football match until next week.",
  "Sample Brand refunded the delivery charge yesterday.",
  "Does Sample Brand support two separate household profiles?",
  "The new Sample Brand update removed my saved preferences.",
  "I would recommend Sample Brand for its clear instructions.",
  "Sample Brand published a quarterly business update.",
  "My Sample Brand receipt lists the wrong purchase date.",
  "We compared the battery life of two Sample Brand devices.",
  "A city museum opened an exhibition about early photography.",
  "Sample Brand restored service after this morning's outage.",
];
const inputs = examples.slice(0, rootCount).map((example, index) => {
  const paragraph =
    index === 0
      ? "El programa cultural reúne lecturas, talleres y visitas gratuitas a la biblioteca. Las personas asistentes pueden consultar horarios en el tablón de la entrada. La actividad trata exclusivamente de libros y espacios públicos. "
      : index % 2 === 0
        ? `La persona que cuenta esta experiencia distingue la instalación, el uso diario y la atención recibida. Describe lo que ocurrió en su hogar y las preguntas que todavía necesita resolver. El caso ficticio número ${index} incluye una observación independiente sobre la facilidad de uso. `
        : `This fictional report describes a separate household experience, including setup, daily use and support. The narrator distinguishes observed events from unanswered questions. Synthetic case ${index} includes its own observation about instructions and reliability. `;
  const target = Math.floor(60000 / rootCount);
  const text =
    `${example} ${paragraph.repeat(Math.ceil(target / paragraph.length))}`.slice(
      0,
      target,
    );
  return {
    root_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    input_digest: facetInputDigestV1({
      text_sha256: sha(text),
      title: null,
      platform: null,
      content_type: null,
      author: null,
    }),
    text,
    title: null,
    platform: null,
    content_type: null,
    author: null,
    published_at: "2026-10-04T00:00:00Z",
    language: index % 2 === 0 ? "es" : "en",
  };
});
const identity =
  version === 2 ? facetLabelerIdentityOrdinalV2() : facetLabelerIdentityV1();
const params = buildFacetRequestV1(inputs, context, identity);
const request = {
  custom_id: `mfp-sonnet-required-ordinals-${rootCount}-v${version}`,
  params,
};
const requestDigest = sha(JSON.stringify(request));
const price = llmPriceV1("anthropic", identity.model, "batch");
const estimatedInput = Math.ceil(JSON.stringify(request).length / 3.5);
const estimatedOutput = 350 * inputs.length;
const estimate = {
  estimated_input_tokens: estimatedInput,
  estimated_output_tokens: estimatedOutput,
  estimated_micro_usd: estimatedInput * 2 + estimatedOutput * 5,
  reserved_micro_usd: estimatedInput * 2 + request.params.max_tokens * 5,
  cap_micro_usd: null,
};
const directory = `.data/dev-corpus/sonnet-required-ordinals-probe-${rootCount}-v${version}`;
type Event = {
  state: string;
  at: string;
  request_digest: string;
  [key: string]: unknown;
};
async function durableFile(name: string, value: string) {
  const temp = `${directory}/${name}.tmp`;
  const file = await open(temp, "w", 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, `${directory}/${name}`);
  const folder = await open(directory, "r");
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}
async function append(state: string, data: Record<string, unknown> = {}) {
  const file = await open(`${directory}/journal.jsonl`, "a", 0o600);
  try {
    await file.writeFile(
      JSON.stringify({
        state,
        at: new Date().toISOString(),
        request_digest: requestDigest,
        ...data,
      }) + "\n",
    );
    await file.sync();
  } finally {
    await file.close();
  }
}
await main(async () => {
  console.log(
    JSON.stringify({
      stage: "sonnet_multiroot_estimate",
      model: identity.model,
      roots: inputs.length,
      text_characters: inputs.reduce(
        (sum, input) => sum + input.text.length,
        0,
      ),
      variant,
      ...estimate,
    }),
  );
  if (!process.argv.includes("--execute")) return;
  const database = await openDatabase();
  await database.end();
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("mfp_anthropic_key_missing");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await open(`${directory}/active.lock`, "wx", 0o600);
  try {
    let events: Event[] = [];
    try {
      events = (await readFile(`${directory}/journal.jsonl`, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (events.some((event) => event.request_digest !== requestDigest))
      throw new Error("mfp_probe_identity_changed");
    const done = [...events]
      .reverse()
      .find(
        (event) =>
          event.state === "complete" ||
          event.state === "provider_error" ||
          event.state === "parse_error" ||
          event.state === "usage_unknown",
      );
    if (done) {
      console.log(
        JSON.stringify({
          stage: "sonnet_multiroot_replay",
          state: done.state,
          new_submissions: 0,
          settled_micro_usd: done.settled_micro_usd ?? null,
        }),
      );
      return;
    }
    const submitted = [...events]
      .reverse()
      .find((event) => event.state === "submitted");
    if (
      !submitted &&
      events.some((event) =>
        ["submitting", "submission_unknown", "rejected"].includes(event.state),
      )
    ) {
      console.log(
        JSON.stringify({
          stage: "sonnet_multiroot_fenced",
          state: events.at(-1)?.state,
          new_submissions: 0,
        }),
      );
      return;
    }
    const provider = createAnthropicMessageBatchesClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    let batchId =
      typeof submitted?.batch_id === "string" ? submitted.batch_id : null;
    if (!batchId) {
      await durableFile(
        "request.json",
        JSON.stringify({ identity, request, price, estimate }, null, 2),
      );
      if (!events.some((event) => event.state === "reserved"))
        await append("reserved", { ...estimate, price });
      await append("submitting");
      try {
        const batch = await provider.create([request]);
        batchId = batch.id;
        await append("submitted", { batch_id: batchId, provider_state: batch });
      } catch (error) {
        const receipt =
          error instanceof AnthropicBatchTransportError
            ? anthropicBatchErrorReceipt(error)
            : null;
        if (receipt)
          await durableFile(
            "submission-response.json",
            JSON.stringify(receipt),
          );
        const rejected =
          error instanceof AnthropicBatchTransportError &&
          error.submission === "not_submitted";
        await append(rejected ? "rejected" : "submission_unknown", {
          http_status:
            error instanceof AnthropicBatchTransportError
              ? error.httpStatus
              : null,
        });
        throw error;
      }
    }
    const batch = await provider.get(batchId);
    await append("polled", { batch_id: batchId, provider_state: batch });
    if (batch.processing_status !== "ended") {
      console.log(
        JSON.stringify({
          stage: "sonnet_multiroot_pending",
          state: batch.processing_status,
          new_submissions: submitted ? 0 : 1,
        }),
      );
      return;
    }
    let item: AnthropicBatchItem | null = null;
    try {
      item = JSON.parse(await readFile(`${directory}/raw-result.json`, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!item) {
      for await (const result of provider.results(batch)) {
        if (item || result.item.custom_id !== request.custom_id)
          throw new Error("mfp_probe_result_identity_invalid");
        await durableFile("raw-result.json", result.rawText);
        await append("raw_persisted", { raw_sha256: sha(result.rawText) });
        item = result.item;
      }
    }
    if (!item) throw new Error("mfp_probe_result_missing");
    if (item.result.type !== "succeeded") {
      await append("provider_error", {
        result_type: item.result.type,
        settled_micro_usd: null,
      });
      console.log(
        JSON.stringify({
          stage: "sonnet_multiroot_provider_error",
          result_type: item.result.type,
          settled_micro_usd: null,
        }),
      );
      return;
    }
    let usage;
    try {
      usage = anthropicUsageV1(item.result.message);
    } catch {
      await append("usage_unknown", { settled_micro_usd: null });
      throw new Error("mfp_probe_usage_unknown");
    }
    const cost = llmCostMicroUsdV1(usage, price);
    const parsed = parseAnthropicResponseV1(item.result.message);
    const facets =
      parsed.status === "ok"
        ? parseFacetGroupV1(parsed.text!, inputs, context, identity)
        : null;
    const success =
      parsed.status === "ok" &&
      facets &&
      !facets.split &&
      facets.results.length === inputs.length &&
      facets.results.every(
        (result) =>
          result.status === "labeled" || result.status === "abstained",
      );
    let receivedRoots: number | null = null;
    let ordinals: number[] = [];
    if (parsed.status === "ok") {
      try {
        const body = JSON.parse(parsed.text!);
        if (
          body.roots &&
          typeof body.roots === "object" &&
          !Array.isArray(body.roots)
        ) {
          receivedRoots = Object.keys(body.roots).length;
          ordinals = Object.keys(body.roots)
            .map((key) => Number(key.slice(1)))
            .sort((a, b) => a - b);
        }
      } catch {
        /* Preserve parser failure and raw without reinterpretation. */
      }
    }
    const coverage = {
      variant,
      expected_roots: inputs.length,
      received_roots: receivedRoots,
      ordinals,
    };
    await durableFile(
      "parsed-result.json",
      JSON.stringify(
        { parsed, facets, usage, coverage, settled_micro_usd: cost },
        null,
        2,
      ),
    );
    await append(success ? "complete" : "parse_error", {
      ...coverage,
      usage,
      settled_micro_usd: cost,
      parser_status: parsed.status,
      facet_statuses: facets?.results.map((result) => result.status) ?? [],
    });
    console.log(
      JSON.stringify({
        stage: "sonnet_multiroot_result",
        ...coverage,
        state: success ? "complete" : "parse_error",
        usage,
        settled_micro_usd: cost,
        parser_status: parsed.status,
        facet_statuses: facets?.results.map((result) => result.status) ?? [],
        new_submissions: submitted ? 0 : 1,
      }),
    );
  } finally {
    await lock.close();
    await unlink(`${directory}/active.lock`);
  }
});
