export type ProcessStep = {
  name: string;
  description: string;
  metric?: string;
  duration?: string;
};

type ProcessTraceProps = {
  steps: ProcessStep[];
  variant?: "pipeline" | "project" | "codification";
};

export function ProcessTrace({ steps, variant = "pipeline" }: ProcessTraceProps) {
  return (
    <div className={`process-trace process-trace--${variant}`} role="list">
      {steps.map((step, index) => (
        <div className="process-trace__step" key={step.name} role="listitem">
          <div className="process-trace__index" aria-hidden="true">
            <span className="process-trace__num">{String(index + 1).padStart(2, "0")}</span>
            {index < steps.length - 1 && <span className="process-trace__line" />}
          </div>
          <div className="process-trace__body">
            <h4>{step.name}</h4>
            <p>{step.description}</p>
            {(step.metric || step.duration) && (
              <div className="process-trace__tags">
                {step.duration && <span className="chip">{step.duration}</span>}
                {step.metric && <span className="chip process-trace__metric-chip">{step.metric}</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
