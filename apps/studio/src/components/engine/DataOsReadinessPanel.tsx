import type {
  DataOsCorpusReadiness,
  DataOsReadinessStatus
} from "@/lib/data-os/readiness";
import { Icon, type IconName } from "@/components/ui/Icon";

const STATUS_LABELS: Record<DataOsReadinessStatus, string> = {
  ready: "Listo",
  building: "En preparación",
  attention: "Requiere atención",
  empty: "Pendiente",
  unavailable: "No disponible"
};

export function DataOsReadinessPanel({ readiness }: { readiness: DataOsCorpusReadiness }) {
  const primaryIssue = readiness.blockers[0] ?? readiness.warnings[0] ?? null;

  return (
    <section className={`engine-data-os engine-data-os--${readiness.overall}`} aria-labelledby="engine-data-os-title">
      <header className="engine-data-os__header">
        <div>
          <p className="vitals-eyebrow">Data OS</p>
          <h2 id="engine-data-os-title">Trazabilidad de Sources a Signal</h2>
        </div>
        <span className={`engine-data-os__overall engine-data-os__overall--${readiness.overall}`}>
          <StatusIcon status={readiness.overall} />
          {STATUS_LABELS[readiness.overall]}
        </span>
      </header>

      <ol className="engine-data-os__pipeline">
        {readiness.stages.map((stage, index) => (
          <li className={`engine-data-os__stage engine-data-os__stage--${stage.status}`} key={stage.key}>
            <div className="engine-data-os__stage-topline">
              <span className="engine-data-os__step">{String(index + 1).padStart(2, "0")}</span>
              <StatusIcon status={stage.status} />
            </div>
            <strong>{stage.label}</strong>
            <span>{stage.summary}</span>
            <small>{stage.detail}</small>
          </li>
        ))}
      </ol>

      <footer className="engine-data-os__footer">
        <div className="engine-data-os__coverage">
          <span><strong>{formatCount(readiness.coverage.metricFamilies)}</strong> familias de métricas</span>
          <span><strong>{formatCount(readiness.coverage.overlappingMonths)}</strong> meses cruzables</span>
          <span><strong>{formatCount(readiness.counts.dashboardRefs)}</strong> refs de Signal</span>
        </div>
        <p className={primaryIssue ? "engine-data-os__issue" : "engine-data-os__next"}>
          <Icon name={primaryIssue ? "alert" : "arrow-right"} size={14} />
          {primaryIssue ?? readiness.nextAction}
        </p>
      </footer>
    </section>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function StatusIcon({ status }: { status: DataOsReadinessStatus }) {
  const name: IconName = status === "ready"
    ? "check"
    : status === "building"
      ? "refresh"
      : status === "attention"
        ? "alert"
        : status === "unavailable"
          ? "x"
          : "clock";
  return <Icon name={name} size={14} />;
}
