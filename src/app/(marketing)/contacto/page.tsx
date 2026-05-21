import { ArrowUpRight, Linkedin, Mail, MessageCircle } from "lucide-react";
import { ContactForm } from "@/components/forms/ContactForm";
import { HomeInsights } from "@/components/marketing/HomeInsights";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Contacto",
  description: "Convierte la voz del cliente en un engine de insights con Noisia.",
  path: "/contacto"
});

const contactCards = [
  {
    label: "LinkedIn",
    value: "Noisia",
    description: "Ve lecturas, casos y señales que estamos siguiendo.",
    href: "https://www.linkedin.com/company/29118513/",
    action: "Ver LinkedIn",
    icon: Linkedin
  },
  {
    label: "Correo",
    value: "hola@noisia.ai",
    description: "Para briefs, alianzas o una primera pregunta de negocio.",
    href: "mailto:hola@noisia.ai",
    action: "Escribir correo",
    icon: Mail
  },
  {
    label: "WhatsApp",
    value: "+49 176 62485504",
    description: "Si prefieres abrir conversación directa con el equipo.",
    href: "https://wa.me/4917662485504",
    action: "Abrir WhatsApp",
    icon: MessageCircle
  }
];

export default function ContactPage() {
  return (
    <>
      <section className="contact-hero">
        <div className="contact-hero__inner">
          <div className="contact-hero__copy">
            <span className="eyebrow">Contacto</span>
            <h1>Convierte la voz del cliente en un engine de insights.</h1>
            <p>
              Gracias por tu interés. Cuéntanos qué decisión quieres tomar, qué mercado estás mirando y qué tan rápido necesitas una lectura. Con eso podemos ubicar el mejor punto de partida.
            </p>
          </div>
          <aside className="contact-hero__signal glass" aria-label="Señales que revisamos antes de una conversación">
            <span>Para llegar con contexto</span>
            <strong>Pregunta de negocio + mercado + urgencia</strong>
            <p>Si ya tienes data, research, tickets, reviews o social listening activo, lo revisamos como parte de la primera lectura.</p>
          </aside>
        </div>
      </section>

      <section className="section contact-options-section">
        <div className="section__inner">
          <div className="contact-options-grid">
            {contactCards.map((card) => {
              const Icon = card.icon;
              const isExternal = card.href.startsWith("http");

              return (
                <article className="contact-option-card glass" key={card.label}>
                  <div className="contact-option-card__icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={1.8} />
                  </div>
                  <div>
                    <span>{card.label}</span>
                    <h2>{card.value}</h2>
                    <p>{card.description}</p>
                  </div>
                  <a
                    className="contact-option-card__link"
                    href={card.href}
                    rel={isExternal ? "noreferrer" : undefined}
                    target={isExternal ? "_blank" : undefined}
                  >
                    {card.action}
                    <ArrowUpRight size={16} strokeWidth={1.9} />
                  </a>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section contact-form-section">
        <div className="section__inner contact-form-layout">
          <div className="contact-form-section__copy">
            <span className="eyebrow">Empezar conversación</span>
            <h2>Deja el contexto mínimo. Nosotros ordenamos la señal.</h2>
            <p>
              No necesitas traer un brief perfecto. Una hipótesis, una tensión del cliente o una decisión pendiente basta para abrir la conversación.
            </p>
          </div>
          <ContactForm />
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <SectionHeader
            eyebrow="Lecturas recientes"
            title="Antes de escribirnos, mira cómo convertimos ruido en criterio."
            lead="Estos insights muestran el tipo de evidencia, lectura cultural y salida accionable que usamos para sostener decisiones de negocio."
          />
          <HomeInsights />
        </div>
      </section>
    </>
  );
}
