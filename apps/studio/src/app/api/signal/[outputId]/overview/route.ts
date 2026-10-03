import { z } from "zod";

import { unauthorized, validationError } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { loadPublishedSignalOverview } from "@/lib/data-os/published-signal-overview";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness
} from "@/lib/data-os/signal-serving";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { isUndefinedTableError } from "@/lib/db/errors";
import {
  getSignalServingContractVersion,
  hasSignalServingContract,
  SIGNAL_SERVING_CONTRACT_VERSION
} from "@/lib/signal/semantics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateFilter = z.union([z.literal(""), z.string().date()]);
const querySchema = z.object({
  dateFrom: dateFilter.optional().default(""),
  dateTo: dateFilter.optional().default("")
});

export async function GET(request: Request, context: { params: Promise<{ outputId: string }> }) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!output) {
    return Response.json({ error: "not_found", message: "Signal output not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return validationError(parsed.error);

  if (!output.snapshotId || !output.tbAnalysisId) {
    return Response.json(
      {
        error: "signal_serving_contract_missing",
        message: "This Signal output has no governed snapshot or relational analysis. Republish it before serving data."
      },
      { status: 409 }
    );
  }

  try {
    const declaredContractVersion = getSignalServingContractVersion(output.manifest);
    if (declaredContractVersion && declaredContractVersion !== SIGNAL_SERVING_CONTRACT_VERSION) {
      return Response.json(
        {
          error: "signal_serving_contract_outdated",
          message: "This Signal output must be reconciled before relational serving can be enabled.",
          contract_version: declaredContractVersion,
          required_contract_version: SIGNAL_SERVING_CONTRACT_VERSION,
          fallback: "published_outputs.payload"
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    const requireGovernedRef = hasSignalServingContract(output.manifest);
    if (requireGovernedRef) {
      const readiness = await getSignalServingReadiness({
        analysisId: output.tbAnalysisId,
        snapshotId: output.snapshotId,
        outputId,
        requireDataRefs: true
      });
      const assessment = assessSignalServingReadiness(readiness);
      if (!assessment.ready) {
        return Response.json(
          {
            error: "signal_serving_not_ready",
            message: "The published Signal output does not satisfy its relational serving contract.",
            contract_version: SIGNAL_SERVING_CONTRACT_VERSION,
            hard_blocks: assessment.hardBlocks,
            warnings: assessment.warnings,
            readiness
          },
          { status: 409, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    const overview = await loadPublishedSignalOverview({
      snapshotId: output.snapshotId,
      analysisId: output.tbAnalysisId,
      corpusId: output.studyCorpusId,
      outputId,
      requireGovernedRef,
      dateFrom: parsed.data.dateFrom || undefined,
      dateTo: parsed.data.dateTo || undefined
    });

    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json({ ok: false, unavailable: true, reason: "signal_serving_schema_missing" }, { status: 503 });
  }
}
