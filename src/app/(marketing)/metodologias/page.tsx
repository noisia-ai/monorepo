import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { MethodologySignature } from "@/components/marketing/MethodologySignature";
import { MethodologyWizard } from "@/components/marketing/MethodologyWizard";
import { methodologies } from "@/content/site";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Metodologías",
  description: "Los métodos de Noisia para convertir conversación social en decisiones claras.",
  path: "/metodologias"
});

export default function MethodologiesPage() {
  return (
    <>
      <section className="hero-experience page-hero page-hero--methodologies">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">METODOLOGÍAS PROPIETARIAS</span>
            <h1 className="display-lg">
              La pregunta manda. El método solo entra cuando ayuda a decidir.
            </h1>
            <p className="body-lg">
              Cada lectura parte de una duda concreta: qué activa compra, qué frena confianza, dónde hay valor,
              qué voces importan o qué mensaje vuelve creíble una idea.
            </p>
            <div className="method-stats-strip">
              <div className="method-stat glass">
                <strong>6</strong>
                <span>métodos propios</span>
              </div>
              <div className="method-stat glass">
                <strong>2–3</strong>
                <span>suelen combinarse por lectura</span>
              </div>
              <div className="method-stat glass">
                <strong>150+</strong>
                <span>fuentes posibles según la pregunta</span>
              </div>
            </div>
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Cómo opera el sistema</span>
            <h2>No necesitas memorizar nombres técnicos. Necesitas reconocer la decisión.</h2>
            <ul className="page-hero-list">
              <li>
                <b>Empieza por la decisión</b>
                <span>Traducimos el problema a una pregunta que sí se pueda responder.</span>
              </li>
              <li>
                <b>Puede combinarse</b>
                <span>Unimos métodos cuando la decisión necesita más de un ángulo.</span>
              </li>
              <li>
                <b>Termina en acción</b>
                <span>La salida debe dejar evidencia, recomendación y siguiente movimiento.</span>
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
                    <b className="link-arrow">Ver cómo se aplica <span>→</span></b>
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
                No tienes que escoger método. Cuéntanos la decisión y armamos la lectura que la sostiene.
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
