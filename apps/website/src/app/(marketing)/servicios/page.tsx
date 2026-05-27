import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FAQAccordion, type FAQItem } from "@/components/marketing/FAQAccordion";
import { OutOfScope, type OutOfScopeItem } from "@/components/marketing/OutOfScope";
import { ProcessTrace, type ProcessStep } from "@/components/marketing/ProcessTrace";
import { StructuredData } from "@/components/seo/StructuredData";
import { SITE_URL, absoluteUrl, breadcrumbJsonLd, createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Servicios",
  description: "Foundation, Intelligence y Strategy: tres formas de convertir conversación en decisiones claras.",
  path: "/servicios"
});

type Tier = {
  number: string;
  name: string;
  tagline: string;
  trigger: string;
  features: string[];
  featured?: boolean;
};

const tiers: Tier[] = [
  {
    number: "01",
    name: "Foundation",
    tagline: "Validar antes de invertir",
    trigger: "Para validar o descartar una hipótesis antes de comprometer presupuesto.",
    features: [
      "Una pregunta de negocio",
      "Lectura rápida con evidencia",
      "Recomendación de siguiente paso",
      "Ideal para briefs, hipótesis o go/no-go",
    ],
  },
  {
    number: "02",
    name: "Intelligence",
    tagline: "Decidir con más profundidad",
    trigger: "Para decisiones que ya vienen encima y necesitan recomendaciones, no solo validación.",
    features: [
      "Lectura profunda por pregunta",
      "Fuentes combinadas según el caso",
      "Recomendaciones priorizadas",
      "Evidencia lista para comité",
      "Ideal para lanzamientos o defensa competitiva",
    ],
    featured: true,
  },
  {
    number: "03",
    name: "Strategy",
    tagline: "Instalar la capacidad",
    trigger: "Para equipos que toman decisiones recurrentes en categorías que se mueven rápido.",
    features: [
      "Sistema vivo de señales",
      "Lecturas recurrentes",
      "Acompañamiento estratégico",
      "Alertas cuando cambia la conversación",
      "Ideal para portafolios o varios mercados",
    ],
  },
];

const specRows = [
  { attribute: "Pregunta de negocio", foundation: "Una", intelligence: "Una principal + derivadas", strategy: "Múltiples, recurrentes" },
  { attribute: "Métodos", foundation: "1–2", intelligence: "3–4", strategy: "Sistema completo" },
  { attribute: "Salida", foundation: "Lectura clara", intelligence: "Recomendaciones priorizadas", strategy: "Capacidad continua" },
  { attribute: "Evidencia", foundation: "Trazable", intelligence: "Trazable + actualizable", strategy: "Trazable + alertas" },
  { attribute: "Modalidad", foundation: "Proyecto", intelligence: "Proyecto", strategy: "Retainer" },
  { attribute: "Acompañamiento", foundation: "Puntual", intelligence: "Por proyecto", strategy: "Continuo" },
];

const proposalSteps: ProcessStep[] = [
  { name: "Pregunta real", description: "Aterrizamos qué decisión necesita tomar tu equipo y qué evidencia la haría defendible." },
  { name: "Tipo de lectura", description: "Elegimos el método o combinación de métodos que responde esa pregunta." },
  { name: "Fuentes útiles", description: "Definimos dónde escuchar: redes, reviews, foros, búsquedas, marketplaces u otras fuentes relevantes." },
  { name: "Alcance claro", description: "Con eso definimos profundidad, equipo, salida y forma de acompañamiento." },
];

const noList: OutOfScopeItem[] = [
  { headline: "Licencias de software revendidas.", body: "No somos integradores de herramientas de listening. Entregamos lectura y decisión." },
  { headline: "Dashboards sin pregunta.", body: "Un panel sin decisión detrás solo agrega ruido. Cada salida vive amarrada a una pregunta." },
  { headline: "Bolsas de horas sueltas.", body: "Strategy no es disponibilidad genérica. Es acompañamiento sobre decisiones recurrentes." },
  { headline: "Reportes de volumen como respuesta final.", body: "El volumen da contexto. La decisión necesita explicación, evidencia y recomendación." },
];

const faqItems: FAQItem[] = [
  {
    question: "¿Cuánto cuesta un proyecto?",
    answer:
      "Depende de la pregunta, las fuentes necesarias y la profundidad de lectura. El diagnóstico inicial define el alcance y de ahí sale la propuesta.",
  },
  {
    question: "¿En qué mercados pueden operar?",
    answer:
      "Cubrimos Latinoamérica con especial profundidad en México, Colombia, Argentina, Chile y Perú. También operamos en España y en contextos US-Hispanic. Si tu mercado no está en esta lista, podemos evaluar cobertura en el diagnóstico.",
  },
  {
    question: "¿Necesitamos tener nuestras propias herramientas?",
    answer:
      "No. Noisia opera con infraestructura propia. No vendemos licencias ni dependemos de que el cliente tenga una herramienta específica.",
  },
  {
    question: "¿Pueden integrarse a nuestro equipo de research?",
    answer:
      "Sí. Muchos proyectos Intelligence y Strategy operan como extensión del equipo interno. Nos adaptamos a herramientas de colaboración, NDA estándar, calendarios de entrega y formatos del cliente.",
  },
  {
    question: "¿Es un retainer o un proyecto?",
    answer:
      "Foundation e Intelligence son proyectos puntuales con inicio, entregables y cierre. Strategy es acompañamiento continuo para decisiones recurrentes.",
  },
  {
    question: "¿Qué pasa con la evidencia después del proyecto?",
    answer:
      "La evidencia se entrega con la lectura. No te quedas solo con conclusiones: también recibes las fuentes y señales que sostienen la recomendación.",
  },
  {
    question: "¿Pueden firmar NDA estándar?",
    answer:
      "Sí. Firmamos NDA antes de cualquier diagnóstico cuando la pregunta o el contexto lo requieren.",
  },
];

const servicesJsonLd = [
  breadcrumbJsonLd([
    { name: "Noisia", path: "/" },
    { name: "Servicios", path: "/servicios" }
  ]),
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Social intelligence para decisiones de marca, producto y estrategia",
    serviceType: "Social intelligence and consumer insights",
    provider: {
      "@type": "Organization",
      name: "Noisia",
      url: SITE_URL
    },
    areaServed: ["México", "Latinoamérica"],
    url: absoluteUrl("/servicios"),
    description:
      "Lecturas de conversación pública y voz del cliente para convertir señales sociales en decisiones claras.",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Profundidades de servicio Noisia",
      itemListElement: tiers.map((tier) => ({
        "@type": "Offer",
        name: tier.name,
        description: `${tier.tagline}. ${tier.trigger}`,
        itemOffered: {
          "@type": "Service",
          name: tier.name,
          description: tier.features.join(". ")
        }
      }))
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  }
];

export default function ServicesPage() {
  return (
    <>
      <StructuredData data={servicesJsonLd} />
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero-experience page-hero">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">SERVICIOS</span>
            <h1 className="display-lg">
              Tres profundidades para una sola lógica: decidir con evidencia.
            </h1>
            <p className="body-lg">
              No vendemos paquetes cerrados. Primero entendemos qué necesitas decidir; después definimos si conviene
              validar una hipótesis, profundizar una lectura o instalar una capacidad continua.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" variant="primary">
                Iniciar diagnóstico
              </Button>
              <Button href="#planes" variant="secondary">
                Ver planes
              </Button>
            </div>
            <div className="hero-proof">
              <div className="glass">
                <strong>3</strong>
                <span>niveles de profundidad</span>
              </div>
              <div className="glass">
                <strong>1</strong>
                <span>pregunta estratégica de entrada</span>
              </div>
              <div className="glass">
                <strong>0</strong>
                <span>paquetes cerrados o rate card</span>
              </div>
            </div>
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Cómo elegimos el nivel</span>
            <h2>El nivel correcto no lo define el presupuesto. Lo define el riesgo de decidir mal.</h2>
            <ul className="page-hero-list">
              <li>
                <b>Foundation</b>
                <span>Una hipótesis importante, antes de comprometer presupuesto.</span>
              </li>
              <li>
                <b>Intelligence</b>
                <span>Una decisión cerca, con riesgo real y necesidad de recomendaciones.</span>
              </li>
              <li>
                <b>Strategy</b>
                <span>Capacidad continua cuando la categoría se mueve todo el tiempo.</span>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      {/* ─── 1. Pricing cards ──────────────────────────────────────────────── */}
      <section className="section" id="planes">
        <div className="section__inner">
          <header className="method-section-header">
            <span className="eyebrow">PLANES</span>
            <h2>Tres niveles para llegar a una respuesta útil.</h2>
            <p>
              El nivel correcto no lo define el presupuesto — lo define la complejidad de la
              pregunta. El diagnóstico inicial es siempre el primer paso, y es gratuito.
            </p>
          </header>

          <div className="services-pricing-grid">
            {tiers.map((tier) => (
              <div
                className={`services-pricing-card ${tier.featured ? "services-pricing-card--featured" : "glass"}`}
                key={tier.name}
              >
                {tier.featured && (
                  <span className="services-pricing-badge">Más solicitado</span>
                )}

                <div className="services-pricing-card__head">
                  <span className="services-pricing-index">{tier.number}</span>
                  <div className="services-pricing-card__title">
                    <p className="services-pricing-tagline">{tier.tagline}</p>
                    <h3 className="services-pricing-name">{tier.name}</h3>
                  </div>
                </div>

                <p className="services-pricing-trigger">{tier.trigger}</p>

                <ul className="services-pricing-features">
                  {tier.features.map((f) => (
                    <li key={f}>
                      <CheckCircle size={14} strokeWidth={2.2} aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  className={`services-pricing-cta ${tier.featured ? "services-pricing-cta--light" : "services-pricing-cta--dark"}`}
                  href="/diagnostico"
                >
                  Iniciar diagnóstico →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 2. Comparativa ────────────────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <header className="method-section-header">
            <span className="eyebrow">COMPARATIVA</span>
            <h2>Qué cambia entre cada nivel.</h2>
            <p>La diferencia está en profundidad, acompañamiento y frecuencia de decisión.</p>
          </header>
          <div className="services-spec">
            <div className="services-spec__head">
              <span className="services-spec__head-attr">Atributo</span>
              <span>Foundation</span>
              <span>Intelligence</span>
              <span>Strategy</span>
            </div>
            {specRows.map((row) => (
              <div className="services-spec__row" key={row.attribute}>
                <span className="services-spec__attr">{row.attribute}</span>
                <span>{row.foundation}</span>
                <span>{row.intelligence}</span>
                <span>{row.strategy}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 3. Cómo construimos la propuesta ──────────────────────────────── */}
      <section className="section">
        <div className="section__inner">
          <div className="method-protocol-grid">
            <aside className="method-protocol-intro">
              <span className="eyebrow">PROPUESTA</span>
              <h2>Cómo construimos el alcance.</h2>
              <p>
                La propuesta sale de la pregunta. Así evitamos venderte una solución más grande o más chica de lo que necesitas.
              </p>
              <div className="method-protocol-meta">
                <strong>ALCANCE A LA MEDIDA</strong>
                <span>
                  Primero entendemos la decisión. Luego definimos fuentes, profundidad y salida.
                </span>
              </div>
            </aside>
            <div className="method-protocol-trace glass">
              <ProcessTrace steps={proposalSteps} variant="codification" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── 4. Qué NO hacemos ─────────────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <article className="services-no-block">
            <header className="services-no-block__head">
              <span className="eyebrow">FUERA DEL ALCANCE</span>
              <h2>Lo que no hacemos, para que la lectura siga siendo útil.</h2>
            </header>
            <OutOfScope items={noList} />
          </article>
        </div>
      </section>

      {/* ─── 5. FAQ ──────────────────────────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <header className="method-section-header">
            <span className="eyebrow">PREGUNTAS FRECUENTES</span>
            <h2>Lo que nos preguntan antes de empezar.</h2>
          </header>
          <FAQAccordion items={faqItems} />
        </div>
      </section>

      {/* ─── 6. CTA final ────────────────────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <div className="no-method-cta glass">
            <div className="no-method-cta__copy">
              <h2>¿Sabes qué nivel necesita la decisión?</h2>
              <p>
                El diagnóstico dura 8–10 minutos y nos da suficiente contexto para recomendarte el nivel correcto.
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
