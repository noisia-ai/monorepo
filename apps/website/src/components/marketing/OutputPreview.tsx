export type OutputItem = {
  title: string;
  description: string;
  format: string;
  duration?: string;
  previewLines?: string[];
};

type OutputPreviewProps = {
  outputs: OutputItem[];
};

export function OutputPreview({ outputs }: OutputPreviewProps) {
  return (
    <div className="output-preview">
      {outputs.map((output) => (
        <div className="output-preview__card glass" key={output.title}>
          <div className="output-preview__mock" aria-hidden="true">
            {output.previewLines?.map((line, i) => (
              <span key={i} style={{ width: line } as React.CSSProperties} />
            ))}
          </div>
          <div className="output-preview__body">
            <h4>{output.title}</h4>
            <p>{output.description}</p>
            <div className="output-preview__tags">
              <span className="chip output-preview__format-chip">{output.format}</span>
              {output.duration && <span className="chip">{output.duration}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
