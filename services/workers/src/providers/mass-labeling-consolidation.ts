import { Agent } from "undici";
import {
  buildMassLabelingConsolidationRequestV1,
  assertAnthropicProviderAccessV1,
  type MassLabelingConsolidationBatchV1,
} from "@noisia/query-engine";
import {
  readWorkspaceInterpretationReceiptV1,
  WorkspaceInterpretationTransportErrorV1,
  type WorkspaceInterpretationRawReceiptV1,
} from "./workspace-interpretation";

const denied = () =>
  new WorkspaceInterpretationTransportErrorV1(
    "workspace_engine_mass_consolidation_not_sent",
    "definitely_not_sent",
  );

const consolidationTimeoutMs = 1_200_000;

/** Read-only credential preflight. The operator runs this before admitting an
 * editorial execution, with the credential present only in process memory. */
export async function assertMassLabelingEditorialAccessV1(args: {
  api_key: string;
  enabled: boolean;
  fetch_impl?: typeof fetch;
}) {
  try {
    await assertAnthropicProviderAccessV1(args);
  } catch {
    throw denied();
  }
}

/** Exactly one provider attempt. Paid response bytes reach durable storage
 * before a parser or downstream catalog validation can reject their format. */
export async function sendMassLabelingConsolidationV1(args: {
  batch: MassLabelingConsolidationBatchV1;
  api_key: string;
  enabled: boolean;
  authorize_send: () => Promise<boolean>;
  persist_receipt: (
    receipt: WorkspaceInterpretationRawReceiptV1,
  ) => Promise<void>;
  fetch_impl?: typeof fetch;
  timeout_ms?: number;
  create_dispatcher?: (options: Agent.Options) => Agent;
}): Promise<WorkspaceInterpretationRawReceiptV1> {
  if (!args.enabled || !args.api_key.trim()) throw denied();
  const timeout = args.timeout_ms ?? consolidationTimeoutMs;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > consolidationTimeoutMs) throw denied();
  const rebuilt = buildMassLabelingConsolidationRequestV1({
    workspace_id: args.batch.workspace_id,
    source_engine_execution_id: args.batch.source_engine_execution_id,
    source_groups: args.batch.source_groups,
  });
  if (
    rebuilt.request_digest !== args.batch.request_digest ||
    rebuilt.request_body !== args.batch.request_body
  )
    throw denied();
  if (!(await args.authorize_send()))
    throw new WorkspaceInterpretationTransportErrorV1(
      "workspace_engine_mass_consolidation_send_not_authorized",
      "outcome_unknown",
    );
  const dispatcher = (args.create_dispatcher ?? (options => new Agent(options)))({
    headersTimeout: timeout, bodyTimeout: timeout, connectTimeout: Math.min(10_000, timeout),
    connections: 1, pipelining: 0, maxRedirections: 0,
  });
  try {
    let response: Response;
    try {
      const request: RequestInit & { dispatcher: Agent } = {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout), dispatcher,
        headers: {
          "x-api-key": args.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        },
        body: args.batch.request_body,
      };
      response = await (args.fetch_impl ?? fetch)("https://api.anthropic.com/v1/messages", request);
    } catch {
      throw new WorkspaceInterpretationTransportErrorV1("workspace_engine_mass_consolidation_transport_failed", "outcome_unknown");
    }
    const receipt = await readWorkspaceInterpretationReceiptV1(response);
    await args.persist_receipt(receipt);
    return receipt;
  } finally {
    // This Agent owns one request. Finish durable receipt handling before closing
    // its sockets, including a partial response or an uncertain transport.
    await dispatcher.destroy().catch(() => undefined);
  }
}
