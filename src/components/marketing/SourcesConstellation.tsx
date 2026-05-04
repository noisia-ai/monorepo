// Proportional bubble layout for source types.
// Circle diameter scales with relative signal volume / coverage weight.
// Server component — no JS needed.

type SourceBubble = {
  name: string;
  size: "xl" | "lg" | "md" | "sm" | "xs";
  note?: string;
};

const SOURCES: SourceBubble[] = [
  { name: "Redes sociales abiertas", size: "xl", note: "mayor volumen" },
  { name: "Reviews de ecommerce y apps", size: "lg", note: "señal de decisión" },
  { name: "Foros nicho", size: "lg", note: "alta intención" },
  { name: "Q&A de marketplaces", size: "md", note: "momento de compra" },
  { name: "Comunidades accesibles", size: "md" },
  { name: "News y editoriales", size: "md" },
  { name: "Podcasts transcritos", size: "sm" },
  { name: "Video transcrito", size: "sm" },
  { name: "Blogs y newsletters", size: "xs" },
  { name: "Marketplaces especializados", size: "xs" },
];

export function SourcesConstellation() {
  return (
    <div className="sources-constellation" aria-label="Tipos de fuentes por cobertura">
      {SOURCES.map((source) => (
        <div
          key={source.name}
          className={`constellation-bubble constellation-bubble--${source.size}`}
          title={source.note}
        >
          <span className="constellation-bubble__name">{source.name}</span>
          {source.note && (
            <span className="constellation-bubble__note">{source.note}</span>
          )}
        </div>
      ))}
    </div>
  );
}
