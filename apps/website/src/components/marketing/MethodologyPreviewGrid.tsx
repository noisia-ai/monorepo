import Link from "next/link";
import { MethodologyIcon } from "@/components/ui/MethodologyIcon";
import { methodologies } from "@/content/site";

export function MethodologyPreviewGrid() {
  return (
    <div className="methodology-grid">
      {methodologies.map((methodology, index) => (
        <Link
          className={`methodology-card glass methodology-card--${index + 1}`}
          href={`/metodologias/${methodology.slug}`}
          key={methodology.slug}
        >
          <div className="methodology-card__art" aria-hidden="true">
            <div className="methodology-card__art-icon">
              <MethodologyIcon identifier={methodology.slug} />
            </div>
            <span>{methodology.number}</span>
            <i />
            <i />
          </div>
          <div className="methodology-card__body">
            <span className="eyebrow">Metodología {methodology.number}</span>
            <h3>{methodology.name}</h3>
            <p>{methodology.lead}</p>
          </div>
          <blockquote>{methodology.question}</blockquote>
          <div className="tag-list">
            {methodology.outputs.slice(0, 2).map((output) => (
              <span className="chip" key={output}>
                {output}
              </span>
            ))}
          </div>
          <b>Ver cómo se aplica →</b>
        </Link>
      ))}
    </div>
  );
}
