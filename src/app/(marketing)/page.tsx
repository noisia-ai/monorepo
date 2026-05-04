import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { HeroScrollytelling } from "@/components/home/HeroScrollytelling";
import { ArchitectureFlow } from "@/components/marketing/ArchitectureFlow";
import { EvidenceStrip } from "@/components/marketing/EvidenceStrip";
import { MethodologyPreviewGrid } from "@/components/marketing/MethodologyPreviewGrid";
import { SourcesConstellation } from "@/components/marketing/SourcesConstellation";
import { UseCaseSelector } from "@/components/marketing/UseCaseSelector";
import { ProductConsoleShowcase } from "@/components/product-scenes/ProductConsoleShowcase";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { serviceTiers } from "@/content/site";

export default function HomePage() {
  return (
    <>
      <HeroScrollytelling />

      <section className="section product-preview-section" data-reveal>
        <div className="section__inner product-preview-section__inner">
          <SectionHeader
            eyebrow="DEL DATO A LA DECISIÓN"
            title="Así se ve cuando la conversación deja de ser ruido."
            lead="Noisia no entrega listening crudo. Entrega lecturas defendibles, trazables y listas para decisión. Estas son cinco escenas del sistema en acción."
            align="center"
          />
          <Suspense fallback={<div className="glass loading-panel">Cargando dashboards...</div>}>
            <ProductConsoleShowcase />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="LA PREGUNTA QUE TIENES ENFRENTE"
            title="Si reconoces tu pregunta acá, ya sabemos por dónde empezar."
            lead="Cada situación activa un protocolo distinto — fuentes, método, entregables. Estas son siete preguntas que hemos resuelto antes y donde el camino ya está calibrado."
          />
          <Suspense fallback={<div className="glass loading-panel">Cargando preguntas...</div>}>
            <UseCaseSelector />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="METODOLOGÍAS PROPIETARIAS"
            title="Seis metodologías. Cada una entra cuando la incertidumbre lo exige."
            lead="Se aplican solas, en combinación o como sistema, según la profundidad de la decisión. La estructura del problema define cuáles y en qué orden."
          />
          <MethodologyPreviewGrid />
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <SectionHeader
            eyebrow="EVIDENCIA"
            title="Esto es lo que parece la conversación cuando se analiza bien."
            lead="Fragmentos representativos del corpus. Cada cita lleva metodología, tag y fuente original."
          />
        </div>
        <EvidenceStrip />
      </section>

      <section className="section">
        <div className="section__inner data-architecture-home">
          <div>
            <SectionHeader
              eyebrow="INFRAESTRUCTURA"
              title="La inteligencia empieza antes del modelo."
              lead="Noisia arma un corpus comparable, lo enriquece con contexto y conserva trazabilidad hasta el output. La metodología corre sobre evidencia normalizada, con fuente, tag y razón de inclusión."
            />
            <Button href="/arquitectura-de-datos" variant="secondary" icon={<ArrowRight size={17} strokeWidth={1.8} />}>
              Conocer arquitectura
            </Button>
          </div>
          <ArchitectureFlow />
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="COBERTURA"
            title="La conversación que importa rara vez vive en una sola plataforma."
            lead="El corpus se arma por pregunta, no por default. Combinamos fuentes sociales, reviews, foros, noticias, audio, video y marketplaces cuando la decisión lo exige — y dejamos fuera lo que no aporta señal."
            align="center"
          />
          <SourcesConstellation />
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="SERVICIOS"
            title="Tres formas de trabajar juntos. Una sola lógica: la pregunta manda."
            lead="Foundation, Intelligence y Strategy no son paquetes cerrados. Son niveles de profundidad para construir una respuesta proporcional al riesgo de la decisión que tienes enfrente."
          />
          <div className="tier-grid">
            {serviceTiers.map((tier) => (
              <article className="tier-card glass" key={tier.name}>
                <span className="chip">{tier.name}</span>
                <h3>{tier.description}</h3>
                <ul>
                  {tier.scope.map((item) => (
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
            <span className="eyebrow">HONESTIDAD METODOLÓGICA</span>
            <h2 className="display-lg">Tu pregunta no es “qué dicen sobre mi marca”. Es “qué hago con lo que dicen”.</h2>
            <p className="body-lg">
              Lo que la conversación pública dice de tu marca es materia prima, no producto final.
              Nuestro trabajo es encontrar la respuesta que sostiene tu pregunta de negocio,
              defenderla con evidencia trazable y traducirla a algo que tu equipo pueda accionar el lunes.
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
