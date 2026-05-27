import { ArrowRight } from "lucide-react";
import { siGoogle, siInstagram, siTiktok, siZendesk } from "simple-icons";
import { Button } from "@/components/ui/Button";

const rawSignals = [
  {
    source: "TikTok",
    icon: siTiktok,
    color: "#111111",
    text: "Prometen mucho. Cuando falla, nadie contesta."
  },
  {
    source: "Google Reviews",
    icon: siGoogle,
    color: "#4285f4",
    text: "Comprar fue fácil. Entender qué seguía, no."
  },
  {
    source: "Zendesk",
    icon: siZendesk,
    color: "#03363d",
    text: "El soporte tarda tanto que ya ni sé qué pedí."
  },
  {
    source: "Instagram",
    icon: siInstagram,
    color: "#e4405f",
    text: "Buen anuncio. Mala experiencia cuando lo intentas usar."
  }
];

export function LandingHero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-hero-title">
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          <span className="eyebrow">Ruido a criterio</span>
          <h1 id="landing-hero-title">La gente ya dijo dónde se rompe la experiencia.</h1>
          <p>
            El problema es que lo dijo en comentarios, reviews y tickets sueltos. Noisia ordena esas señales para que veas qué patrón importa y qué conviene mover primero.
          </p>
          <div className="landing-hero__actions">
            <Button href="#landing-contact" icon={<ArrowRight size={17} strokeWidth={1.8} />}>
              Hablar con Noisia
            </Button>
            <Button href="#landing-insights" variant="secondary">
              Ver lecturas
            </Button>
          </div>
        </div>

        <div className="landing-signal-board" aria-label="Ejemplo de ruido convertido en criterio">
          <div className="landing-signal-board__raw" aria-label="Señales sin ordenar">
            {rawSignals.map((signal) => (
              <article className="landing-signal-note" key={signal.source}>
                <span className="landing-signal-note__source" style={{ color: signal.color }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={signal.icon.path} />
                  </svg>
                  {signal.source}
                </span>
                <p>{signal.text}</p>
              </article>
            ))}
          </div>

          <div className="landing-signal-board__line" aria-hidden="true" />

          <article className="landing-signal-read">
            <span className="landing-insight-mark" data-text="insight">
              insight
            </span>
            <h2>No es falta de interés. La promesa se rompe después de la compra.</h2>
            <p>Antes de meter más pauta, arregla lo que pasa después del clic.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
