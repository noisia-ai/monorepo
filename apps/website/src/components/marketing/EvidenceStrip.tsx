// Horizontal scrollable strip of anonymized evidence quotes.
// Each card surfaces a real-data pattern from one of the 6 methodologies.

type EvidenceCard = {
  quote: string;
  method: string;
  tag: string;
  source: string;
  segment: string;
};

const EVIDENCE: EvidenceCard[] = [
  {
    quote:
      "Antes compraba por precio. Ahora ya sé que lo barato sale caro en esta categoría. El nombre me da confianza.",
    method: "Triggers & Barriers",
    tag: "trigger: precio→calidad",
    source: "Foro especializado · MX",
    segment: "Consumo masivo",
  },
  {
    quote:
      "Mis amigos se burlarían si me vieran usando eso. No es que sea malo, es que no encaja con lo que somos.",
    method: "Cultural Codes",
    tag: "código: identidad grupal",
    source: "Reddit · r/mexico",
    segment: "Lifestyle · 18–28",
  },
  {
    quote:
      "Llevo tres meses queriendo comprar pero siempre encuentro algo que me frena. No es que no quiera.",
    method: "Decision Velocity",
    tag: "fricción: velocidad baja",
    source: "Twitter/X · comentarios",
    segment: "CPG · decisión alta",
  },
  {
    quote:
      "No es que sea caro. Es que no entiendo por qué cuesta lo que cuesta. Si me lo explicaran, lo compraría.",
    method: "Value Perception",
    tag: "valor: justificación ausente",
    source: "App Store · reseñas",
    segment: "Fintech · usuario nuevo",
  },
  {
    quote:
      "Llegué al checkout tres veces. Nunca terminé de pagar. Algo siempre me detiene en ese momento.",
    method: "Journey Friction",
    tag: "fricción: checkout",
    source: "Play Store · reseñas",
    segment: "Ecommerce · mobile",
  },
  {
    quote:
      "Lo vi en el canal del creador que sigo y como él lo usa con convicción, me animé a probarlo.",
    method: "Influence Architecture",
    tag: "influencia: referencia confiable",
    source: "YouTube · comentarios",
    segment: "DTC · 25–35",
  },
];

export function EvidenceStrip() {
  return (
    <div className="evidence-strip" aria-label="Evidencia representativa del corpus">
      <div className="evidence-strip__track">
        {EVIDENCE.map((card, i) => (
          <article className="evidence-card glass" key={i}>
            <blockquote className="evidence-card__quote">
              &ldquo;{card.quote}&rdquo;
            </blockquote>
            <footer className="evidence-card__meta">
              <div className="evidence-card__tags">
                <span className="chip chip--signal">{card.method}</span>
                <span className="chip">{card.tag}</span>
              </div>
              <div className="evidence-card__source">
                <span>{card.source}</span>
                <span className="evidence-card__segment">{card.segment}</span>
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
