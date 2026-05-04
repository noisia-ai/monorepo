import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { MethodologySignature } from "@/components/marketing/MethodologySignature";
import { MethodologyWizard } from "@/components/marketing/MethodologyWizard";
import { methodologies } from "@/content/site";

export const metadata = {
  title: "Metodologías",
  description: "Las seis metodologías propietarias de Noisia para convertir conversación social en decisión de negocio."
};

export default function MethodologiesPage() {
  return (
    <>
      <section className="hero-experience page-hero page-hero--methodologies">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">METODOLOGÍAS PROPIETARIAS</span>
            <h1 className="display-lg">
              Seis metodologías.<br />Una por tipo de incertidumbre.
            </h1>
            <p className="body-lg">
              No empezamos por la herramienta favorita. Empezamos por el tipo de incertidumbre:
              qué hay que explicar, qué fricción hay que aislar, qué valor hay que defender,
              qué código cultural hay que decodificar o qué nodo mueve la conversación.
            </p>
            <div className="method-stats-strip">
              <div className="method-stat glass">
                <strong>6</strong>
                <span>metodologías propietarias</span>
              </div>
              <div className="method-stat glass">
                <strong>2–3</strong>
                <span>suelen convivir por proyecto</span>
              </div>
              <div className="method-stat glass">
                <strong>150+</strong>
                <span>fuentes potenciales según la pregunta</span>
              </div>
            </div>
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Cómo opera el sistema</span>
            <h2>No son herramientas sueltas. Son protocolos que se activan cuando la pregunta lo exige.</h2>
            <ul className="page-hero-list">
              <li>
                <b>Se elige por tipo de decisión</b>
                <span>No por moda metodológica ni por formato de entregable.</span>
              </li>
              <li>
                <b>Entran solas o en combinación</b>
                <span>Cuando una sola lectura no basta para sostener la decisión, se combinan.</span>
              </li>
              <li>
                <b>Siempre terminan en output defendible</b>
                <span>La metodología solo vale si deja evidencia, narrativa y acción trazable.</span>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="section section--compact method-wizard-section">
        <div className="section__inner">
          <MethodologyWizard />
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <div className="methodology-catalog-grid">
            {methodologies.map((methodology) => (
              <Link
                className="methodology-catalog-card glass"
                href={`/metodologias/${methodology.slug}`}
                id={`methodology-${methodology.slug}`}
                key={methodology.slug}
              >
                <div className="methodology-catalog-card__art" aria-hidden="true">
                  <span className="methodology-catalog-card__number">{methodology.number}</span>
                  <MethodologySignature slug={methodology.slug} />
                </div>
                <div className="methodology-catalog-card__body">
                  <span className="eyebrow">Metodología {methodology.number}</span>
                  <h3>{methodology.name}</h3>
                  <p>{methodology.lead}</p>
                  <blockquote>{methodology.question}</blockquote>
                  <div className="methodology-catalog-card__footer">
                    <div className="tag-list">
                      {methodology.outputs.slice(0, 2).map((output) => (
                        <span className="chip" key={output}>{output}</span>
                      ))}
                    </div>
                    <b className="link-arrow">Estudiar metodología <span>→</span></b>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="no-method-cta glass">
            <div className="no-method-cta__copy">
              <h2>¿No sabes por dónde empezar?</h2>
              <p>
                Las metodologías rara vez vienen solas. La mayoría de proyectos combinan dos o tres. El diagnóstico
                define cuáles, en qué orden y sobre qué corpus.
              </p>
            </div>
            <Button href="/diagnostico" variant="primary">
              Iniciar diagnóstico
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
