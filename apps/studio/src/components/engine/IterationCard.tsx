import { CopyQueryButton } from "@/components/engine/CopyQueryButton";
import { IterationActionButtons } from "@/components/engine/IterationActionButtons";
import { IterationEvaluateButton } from "@/components/engine/IterationEvaluateButton";

type EvalNotes = {
  notes?: string;
  proposed_adjustments?: string[];
  language_mx_pct?: number;
  geo_mx_pct?: number;
} | null;

type IterationCardProps = {
  corpusId: string;
  iteration: {
    id: string;
    iterationNumber: number;
    queryText: string;
    competitorQueryText: string | null | undefined;
    industryQueryText: string | null | undefined;
    qualityScore: string | null;
    densityScore: string | null;
    noiseScore: string | null;
    aiEvaluationNotes: unknown;
    insightsManagerDecision: string | null;
  };
};

export function IterationCard({ corpusId, iteration }: IterationCardProps) {
  const evaluated = iteration.qualityScore !== null;

  const notes: EvalNotes = iteration.aiEvaluationNotes
    ? (typeof iteration.aiEvaluationNotes === "string"
        ? (JSON.parse(iteration.aiEvaluationNotes) as EvalNotes)
        : (iteration.aiEvaluationNotes as EvalNotes))
    : null;

  const adjs: string[] = notes?.proposed_adjustments ?? [];

  return (
    <article className="iteration-card">
      {/* Header */}
      <header className="iteration-card-header">
        <span className="iteration-card-num">#{iteration.iterationNumber}</span>
        <span
          className={`iteration-card-status ${
            evaluated
              ? "iteration-card-status--evaluated"
              : "iteration-card-status--pending"
          }`}
        >
          {evaluated ? "Evaluada" : "Pendiente"}
        </span>
        {evaluated && (
          <div className="iteration-card-scores">
            <span className="score-chip">
              <span className="score-chip-label">Cal</span>
              {Number(iteration.qualityScore).toFixed(1)}
            </span>
            <span className="score-chip">
              <span className="score-chip-label">Den</span>
              {Number(iteration.densityScore).toFixed(1)}
            </span>
            <span className="score-chip">
              <span className="score-chip-label">Rui</span>
              {Number(iteration.noiseScore).toFixed(1)}
            </span>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="iteration-card-body">
        {/* Brand query */}
        <section className="iteration-card-section">
          <p className="iteration-section-label">Query de marca</p>
          <CopyQueryButton queryText={iteration.queryText} />
        </section>

        {/* Competitor query — only when present */}
        {iteration.competitorQueryText && (
          <section className="iteration-card-section">
            <p className="iteration-section-label iteration-section-label--muted">
              Query de competencia
            </p>
            <CopyQueryButton queryText={iteration.competitorQueryText} />
          </section>
        )}

        {/* Industry query — only when present */}
        {iteration.industryQueryText && (
          <section className="iteration-card-section">
            <p className="iteration-section-label iteration-section-label--muted">
              Query de industria
            </p>
            <CopyQueryButton queryText={iteration.industryQueryText} />
          </section>
        )}

        {/* Evaluator notes — only when evaluated */}
        {evaluated && notes && (
          <section className="iteration-card-section">
            <p className="iteration-section-label">Diagnóstico del evaluador</p>
            {notes.notes && <p>{notes.notes}</p>}
            {(notes.language_mx_pct !== undefined || notes.geo_mx_pct !== undefined) && (
              <p className="eval-running" style={{ marginTop: 6 }}>
                Español MX: {notes.language_mx_pct ?? "—"}% · Geo MX:{" "}
                {notes.geo_mx_pct ?? "—"}%
              </p>
            )}
            {adjs.length > 0 && (
              <>
                <p
                  className="iteration-section-label"
                  style={{ marginTop: 12 }}
                >
                  Ajustes propuestos
                </p>
                <ul className="eval-notes-list">
                  {adjs.map((adj, i) => (
                    <li key={i}>{adj}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      {/* Footer — client interactive islands */}
      <footer className="iteration-card-footer">
        <IterationEvaluateButton
          alreadyEvaluated={evaluated}
          corpusId={corpusId}
          iterationId={iteration.id}
        />
        {evaluated && (
          <IterationActionButtons
            corpusId={corpusId}
            iterationId={iteration.id}
            hasAdjustments={adjs.length > 0}
            decision={iteration.insightsManagerDecision}
          />
        )}
      </footer>
    </article>
  );
}
