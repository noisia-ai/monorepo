import { HomeInsights } from "@/components/marketing/HomeInsights";
import { LandingHero } from "@/components/marketing/LandingHero";
import { LandingMobileCta } from "@/components/marketing/LandingMobileCta";
import { LandingScheduler } from "@/components/marketing/LandingScheduler";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Meeting | Noisia",
  description: "Agenda una conversación con Noisia para ordenar señales y tomar mejores decisiones.",
  path: "/meeting"
});

export default function MeetingPage() {
  return (
    <>
      <LandingHero />

      <section className="section landing-contact-section" id="landing-contact">
        <div className="section__inner landing-contact-layout">
          <div className="landing-contact-copy">
            <h2>Agenda una conversación con Noisia.</h2>
            <p>
              No necesitas traer un brief perfecto. Elige un horario y cuéntanos qué decisión quieres tomar; con eso
              ubicamos si podemos ayudarte a ordenar la señal.
            </p>
          </div>
          <LandingScheduler />
        </div>
      </section>

      <section className="section landing-insights-section" id="landing-insights">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Lecturas recientes"
            title="Dos ejemplos de cómo convertimos ruido en criterio."
            lead="Antes de escribirnos, mira cómo se ve una salida Noisia: evidencia trazable, lectura cultural y una recomendación lista para conversación de negocio."
          />
          <HomeInsights />
        </div>
      </section>

      <LandingMobileCta />
    </>
  );
}
