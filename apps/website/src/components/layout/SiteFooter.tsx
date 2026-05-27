import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

const footerRoutes = [
  {
    href: "/insights",
    label: "Insights",
    text: "Ideas y señales culturales."
  },
  {
    href: "/metodologias",
    label: "Metodologías",
    text: "El marco de trabajo."
  },
  {
    href: "/servicios",
    label: "Servicios",
    text: "Formas de colaborar."
  },
  {
    href: "/arquitectura-de-datos",
    label: "Arquitectura",
    text: "Fuentes, evidencia y trazabilidad."
  }
];

export function SiteFooter() {
  return (
    <footer className="site-footer section section--compact">
      <div className="site-footer__panel glass">
        <div className="site-footer__brand">
          <div>
            <Image
              src="/assets/logos/logo_black.svg"
              alt="Noisia"
              width={104}
              height={36}
              suppressHydrationWarning
            />
            <p>
              Conversación pública convertida en decisiones defendibles para equipos de marca, producto y estrategia.
            </p>
          </div>
        </div>

        <div className="site-footer__content">
          <div className="site-footer__routes" aria-label="Rutas principales">
            {footerRoutes.map((route) => (
              <Link className="site-footer__route" href={route.href} key={route.href}>
                <strong>{route.label}</strong>
                <p>{route.text}</p>
                <small>
                  Abrir <ArrowUpRight size={13} strokeWidth={1.9} />
                </small>
              </Link>
            ))}
          </div>

          <div className="site-footer__bottom">
            <p>¿Tienes una decisión concreta? Podemos empezar con poco contexto.</p>
            <div className="site-footer__actions">
              <Link className="site-footer__contact-button" href="/contacto">
                Contacto
              </Link>
              <Link className="site-footer__cta" href="/diagnostico">
                Iniciar diagnóstico <ArrowRight size={16} strokeWidth={1.9} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
