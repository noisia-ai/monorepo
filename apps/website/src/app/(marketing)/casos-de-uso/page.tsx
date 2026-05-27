import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CasosFilter } from "@/components/marketing/CasosFilter";
import { useCases } from "@/content/site";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Casos de uso",
  description: "Casos ficticios para entender en qué decisiones puede ayudarte Noisia.",
  path: "/casos-de-uso"
});

const featuredStories = [
  {
    slug: "lanzamiento-de-campana",
    label: "Campaña",
    title: "Antes de producir una campaña, prueba si la historia tiene permiso.",
    dek:
      "Una marca de consumo llegó con tres territorios creativos. La conversación no eligió el más bonito; eligió el que convertía una frustración cotidiana en lenguaje local.",
    stack: ["TikTok", "YouTube", "Reddit", "Meta Ads"],
    insight: "El territorio ganador era menos aspiracional y más propio de la categoría.",
    signal: "67% de respaldo narrativo"
  },
  {
    slug: "defensa-competitiva",
    label: "Competencia",
    title: "Cuando la gente se va, casi nunca te dice toda la razón en el churn.",
    dek:
      "El competidor parecía ganar por precio. Al leer reseñas, tickets y foros, la fuga apuntaba a una promesa más incómoda: soporte transparente y menos incertidumbre.",
    stack: ["Zendesk", "Salesforce", "Reddit", "Google Reviews"],
    insight: "La defensa no era descuento. Era credibilidad operativa.",
    signal: "Soporte y transparencia dominaban la migración"
  },
  {
    slug: "desarrollo-de-producto",
    label: "Producto",
    title: "La oportunidad de producto suele esconderse en quejas demasiado repetidas.",
    dek:
      "Reviews, Q&A y tickets separaron deseos superficiales de un problema real: la gente no pedía otra feature, pedía reducir el riesgo de probar.",
    stack: ["Amazon", "App Store", "Intercom", "Shopify"],
    insight: "El roadmap necesitaba prueba, no otra promesa.",
    signal: "Riesgo percibido como barrera central"
  }
];

const sourceCards = [
  {
    kicker: "Stack del cliente",
    title: "El síntoma ya estaba en sus herramientas",
    text: "Ventas, pauta, tickets y CRM mostraban dónde dolía. Faltaba entender por qué pasaba.",
    logos: [
      { mark: "SF", name: "Salesforce" },
      { mark: "HS", name: "HubSpot" },
      { mark: "KL", name: "Klaviyo" },
      { mark: "LK", name: "Looker" }
    ]
  },
  {
    kicker: "Fuentes externas",
    title: "La razón aparecía fuera del tablero",
    text: "Comentarios largos, reseñas, foros y preguntas de marketplace explicaban lo que el funnel solo insinuaba.",
    logos: [
      { mark: "TT", name: "TikTok" },
      { mark: "RD", name: "Reddit" },
      { mark: "YT", name: "YouTube" },
      { mark: "AM", name: "Amazon" }
    ]
  },
  {
    kicker: "Salida para decidir",
    title: "El equipo recibió una historia defendible",
    text: "No fue un reporte de volumen. Fue una recomendación con citas, pesos, tensión principal y siguiente movimiento.",
    logos: [
      { mark: "BR", name: "Brief" },
      { mark: "QT", name: "Citas" },
      { mark: "MP", name: "Mapa" },
      { mark: "DK", name: "Deck" }
    ]
  }
];

const valueSignals = [
  { label: "Duda antes de compra", value: "38.4%", width: 72, tone: "tension" },
  { label: "Menciones con prueba social", value: "24.9%", width: 48, tone: "signal" },
  { label: "Confianza atribuida a soporte", value: "31.7%", width: 62, tone: "signal" }
];

const sampleMentions = [
  {
    source: "TikTok · comentario",
    text: "Me gusta la idea, pero no entiendo si esto es para alguien como yo.",
    tag: "duda de entrada"
  },
  {
    source: "Review retail",
    text: "Lo compraría si me explicaran mejor qué pasa si no me funciona.",
    tag: "riesgo de prueba"
  }
];

export default function UseCasesPage() {
  return (
    <>
      <section className="hero-experience page-hero cases-hero">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">CASOS DE USO</span>
            <h1 className="display-lg">Para qué puede servir Noisia, contado en decisiones reales.</h1>
            <p className="body-lg">
              Casos ficticios, pero situaciones familiares: una campaña que no sabe qué historia elegir, un producto
              que no encuentra su oportunidad o una marca que necesita defender su valor.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" variant="primary">
                Iniciar diagnóstico
              </Button>
              <Button href="#lecturas" variant="secondary">
                Ver casos
              </Button>
            </div>
            <div className="hero-proof">
              <div className="glass">
                <strong>10</strong>
                <span>situaciones de negocio</span>
              </div>
              <div className="glass">
                <strong>150+</strong>
                <span>fuentes posibles</span>
              </div>
              <div className="glass">
                <strong>6</strong>
                <span>métodos combinables</span>
              </div>
            </div>
          </div>

          <aside className="cases-hero-note glass">
            <span className="chip">Empieza por la pregunta</span>
            <h2>Si te reconoces en una situación, ya tienes un punto de partida.</h2>
            <p>
              No necesitas pedir un método. Necesitas ubicar la decisión y ver qué señales podrían cambiar el
              brief, el roadmap o la defensa de marca.
            </p>
            <a className="link-arrow" href="#lecturas">
              Explorar casos <span>→</span>
            </a>
          </aside>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="cases-feature-story">
            <div>
              <span className="eyebrow">CÓMO LEERLOS</span>
              <h2>El caso se entiende mejor cuando ves la pregunta, la evidencia y la decisión juntas.</h2>
            </div>
            <p>
              GWI y Synthesio ordenan sus casos por necesidades de negocio. Nosotros lo llevamos a situaciones
              concretas: qué estaba atorado, qué dijo la gente y qué cambió para el equipo.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">SITUACIONES COMUNES</span>
            <h2 className="display-md">Tres formas comunes de usar Noisia.</h2>
            <p className="body-lg">
              No son categorías cerradas. Son escenas de trabajo: campaña, competencia y producto, con señales que
              normalmente viven separadas en herramientas distintas.
            </p>
          </div>

          <div className="cases-story-grid">
            {featuredStories.map((story) => (
              <a className="case-story-card glass" href={`/casos-de-uso/${story.slug}`} key={story.slug}>
                <span className="chip">{story.label}</span>
                <h3>{story.title}</h3>
                <p>{story.dek}</p>
                <div className="case-story-card__logos" aria-label="Herramientas y fuentes usadas">
                  {story.stack.map((tool) => (
                    <span key={tool}>{tool}</span>
                  ))}
                </div>
                <div className="case-story-card__insight">
                  <small>Hallazgo</small>
                  <strong>{story.insight}</strong>
                  <b>{story.signal}</b>
                </div>
                <span className="case-story-card__cta">
                  Ver caso <ArrowRight size={16} strokeWidth={1.9} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="cases-source-system glass">
            <div className="cases-source-system__head">
              <span className="eyebrow">ASÍ SE VE POR DENTRO</span>
              <h2>Un caso conecta lo que tu equipo ya sabe con lo que la gente está diciendo afuera.</h2>
              <p>
                El valor no está en juntar más tableros. Está en encontrar la frase que explica el bloqueo y
                convertirla en una decisión que el equipo pueda defender.
              </p>
            </div>
            <div className="cases-source-board">
              <div className="cases-source-cards">
                {sourceCards.map((card) => (
                  <article className="cases-source-card" key={card.title}>
                    <span>{card.kicker}</span>
                    <h3>{card.title}</h3>
                    <p>{card.text}</p>
                    <div className="source-brand-grid">
                      {card.logos.map((logo) => (
                        <div className="source-brand" key={logo.name}>
                          <b>{logo.mark}</b>
                          <small>{logo.name}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <aside className="cases-source-lab">
                <div className="cases-source-lab__head">
                  <span>Ejemplo ficticio</span>
                  <strong>skincare · ecommerce</strong>
                </div>
                <div className="cases-source-chart">
                  {valueSignals.map((signal) => (
                    <div className="case-bar" key={signal.label}>
                      <div>
                        <span>{signal.label}</span>
                        <b>{signal.value}</b>
                      </div>
                      <i>
                        <em
                          className={signal.tone === "tension" ? "is-tension" : undefined}
                          style={{ width: `${signal.width}%` }}
                        />
                      </i>
                    </div>
                  ))}
                </div>
                <div className="cases-mention-stack">
                  {sampleMentions.map((mention) => (
                    <figure className="cases-mention" key={mention.text}>
                      <blockquote>“{mention.text}”</blockquote>
                      <figcaption>
                        <span>{mention.source}</span>
                        <b>{mention.tag}</b>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--compact" id="lecturas">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">ENCUENTRA TU CASO</span>
            <h2 className="display-md">Elige la decisión que más se parece a la tuya.</h2>
            <p className="body-lg">
              Cada caso muestra una situación, las señales que conviene mirar y el tipo de salida que ayuda a decidir.
            </p>
          </div>
          <CasosFilter useCases={useCases} />
        </div>
      </section>
    </>
  );
}
