// Visual storyboard replacing the "Vignette anonimizada" prose block in case detail pages.

export type StoryboardVisual =
  | { type: "pills"; items: Array<{ label: string; highlighted?: boolean }> }
  | { type: "number"; value: string; subtext?: string }
  | { type: "score"; items: Array<{ label: string; score: number }> }
  | { type: "quote"; text: string };

export type StoryboardStep = {
  num: string;
  label: string;
  text: string;
  visual: StoryboardVisual;
};

function StepVisual({ visual }: { visual: StoryboardVisual }) {
  if (visual.type === "pills") {
    return (
      <div className="vsb-pills">
        {visual.items.map((pill) => (
          <span
            key={pill.label}
            className={`chip ${pill.highlighted ? "chip--signal" : ""}`}
          >
            {pill.label}
          </span>
        ))}
      </div>
    );
  }

  if (visual.type === "number") {
    return (
      <div className="vsb-number">
        <span className="vsb-number__value">{visual.value}</span>
        {visual.subtext && (
          <span className="vsb-number__sub">{visual.subtext}</span>
        )}
      </div>
    );
  }

  if (visual.type === "score") {
    return (
      <div className="vsb-scores">
        {visual.items.map((item) => (
          <div className="vsb-score-row" key={item.label}>
            <span className="vsb-score-label">{item.label}</span>
            <div className="vsb-score-bar" role="progressbar" aria-valuenow={item.score} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="vsb-score-bar__fill"
                style={{ width: `${item.score}%` } as React.CSSProperties}
              />
            </div>
            <span className="vsb-score-pct">{item.score}%</span>
          </div>
        ))}
      </div>
    );
  }

  if (visual.type === "quote") {
    return (
      <blockquote className="vsb-quote">
        &ldquo;{visual.text}&rdquo;
      </blockquote>
    );
  }

  return null;
}

export function VignetteStoryboard({ steps }: { steps: StoryboardStep[] }) {
  return (
    <div className="vignette-storyboard" role="list">
      {steps.map((step, i) => (
        <div className="vignette-step glass" key={step.num} role="listitem">
          <div className="vignette-step__meta">
            <span className="vignette-step__num">{step.num}</span>
            <h3 className="vignette-step__label">{step.label}</h3>
          </div>
          <p className="vignette-step__text">{step.text}</p>
          <div className="vignette-step__visual">
            <StepVisual visual={step.visual} />
          </div>
          {i < steps.length - 1 && (
            <span className="vignette-step__arrow" aria-hidden="true">→</span>
          )}
        </div>
      ))}
    </div>
  );
}
