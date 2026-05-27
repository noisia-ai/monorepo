import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { HeroScrollytelling } from "@/components/home/HeroScrollytelling";
import { EvidenceStrip } from "@/components/marketing/EvidenceStrip";
import { HomeInsights } from "@/components/marketing/HomeInsights";
import { MethodologyPreviewGrid } from "@/components/marketing/MethodologyPreviewGrid";
import { SourcesConstellation } from "@/components/marketing/SourcesConstellation";
import { UseCaseSelector } from "@/components/marketing/UseCaseSelector";
import { ProductConsoleShowcase } from "@/components/product-scenes/ProductConsoleShowcase";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { serviceTiers } from "@/content/site";

const timingPattern = /semana|trimestral|anual/i;

export default function HomePage() {
  return (
    <>
      <HeroScrollytelling />

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Mapa de fuentes"
            title="Escuchamos México donde vive la voz del cliente."
            lead="La señal puede vivir en TikTok, Instagram, X, Amazon, Klaviyo, Salesforce, Zendesk, reviews, tickets, foros, búsquedas, comunidades o marketplaces. La cobertura se define por tu pregunta, no por una lista fija de redes."
          />
          <SourcesConstellation />
        </div>
      </section>

      <section className="section product-preview-section" data-reveal>
        <div className="section__inner product-preview-section__inner">
          <SectionHeader
            eyebrow="Lecturas accionables"
            title="Casos de uso: cuando la lectura ya está lista para negocio."
            lead="Usamos preguntas reales de campaña, medios, producto, competencia y tendencias para mostrar cómo se ve una salida accionable, con evidencia y un botón para profundizar."
          />
          <Suspense fallback={<div className="glass loading-panel">Cargando lecturas...</div>}>
            <ProductConsoleShowcase />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Pregunta abierta"
            title="Encuentra la pregunta que hoy te está frenando."
            lead="Lanzamiento, medios, producto, entrada a México, competencia, tendencias o crisis. El punto de partida cambia, pero la salida siempre es una decisión defendible."
          />
          <Suspense fallback={<div className="glass loading-panel">Cargando preguntas...</div>}>
            <UseCaseSelector />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Lecturas recientes"
            title="Dos lecturas vivas sobre México para empezar la conversación."
            lead="Los insights editoriales muestran cómo se ve una lectura Noisia cuando junta escala, evidencia y criterio cultural: no solo social listening, sino señal lista para negocio."
          />
          <HomeInsights />
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Métodos de lectura"
            title="Métodos propios, explicados en lenguaje de negocio."
            lead="Cada método responde una duda concreta: qué activa compra, qué frena confianza, dónde hay valor, quién influye y qué mensaje acelera la decisión."
          />
          <MethodologyPreviewGrid />
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Citas trazables"
            title="La evidencia no queda escondida."
            lead="Cada hallazgo conserva la cita, la fuente y el tag que lo sostiene para que tu equipo pueda discutir la decisión, no adivinarla."
          />
        </div>
        <EvidenceStrip />
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Formas de trabajo"
            title="Elige la profundidad según el tamaño de la decisión."
            lead="Foundation, Intelligence y Strategy son tres formas de llegar a una respuesta útil en México: desde validar una hipótesis hasta sostener un sistema continuo de decisiones."
          />
          <div className="tier-grid">
            {serviceTiers.map((tier) => (
              <article className="tier-card glass" key={tier.name}>
                <h3>{tier.name}</h3>
                <ul>
                  {tier.scope.filter((item) => !timingPattern.test(item)).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>{tier.ideal}</p>
                <Button href="/diagnostico" variant="ghost">
                  Iniciar diagnóstico
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="closing-panel glass">
            <span className="eyebrow">Decidir con evidencia</span>
            <h2 className="display-lg">No necesitas más ruido. Necesitas una lectura que puedas defender.</h2>
            <p className="body-lg">
              Trabajamos con conversación pública y fuentes de voz del cliente en México para responder una pregunta de negocio, sostenerla con evidencia trazable y traducirla en acciones que tu equipo pueda poner sobre la mesa.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" icon={<ArrowRight size={17} strokeWidth={1.8} />}>
                Iniciar diagnóstico
              </Button>
              <Button href="/contacto" variant="secondary">
                Hablar con Noisia
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
