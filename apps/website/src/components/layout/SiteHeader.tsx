"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { site } from "@/content/site";

const menuCards: Record<string, { deck: string }> = {
  Insights: {
    deck: "Ideas, señales culturales y formas de pensar mejor la categoría."
  },
  Metodologías: {
    deck: "Seis formas de ordenar preguntas difíciles sin ahogarte en datos."
  },
  Arquitectura: {
    deck: "Cómo se limpian, conectan y conservan las fuentes que sostienen cada respuesta."
  },
  Casos: {
    deck: "Situaciones concretas donde Noisia ayuda a elegir, defender o corregir una decisión."
  },
  Servicios: {
    deck: "Diagnósticos, proyectos y acompañamiento para equipos de marca, producto y estrategia."
  }
};

export function SiteHeader() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isMeetingPage = pathname === "/meeting";
  const headerCtaHref = isMeetingPage ? "https://calendar.app.google/Zhpsy2vNq7jWdHgs8" : "/diagnostico";
  const headerCtaLabel = isMeetingPage ? "Hablar con Noisia" : "Iniciar diagnóstico";

  useEffect(() => {
    document.body.classList.remove("menu-open");
  }, []);

  useEffect(() => {
    setIsOpen(false);
    document.body.classList.remove("menu-open");
  }, [pathname]);

  useEffect(() => {
    const updateScrolled = () => {
      setIsScrolled(window.scrollY > 10);
    };

    let ticking = false;
    const handleScroll = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        updateScrolled();
        ticking = false;
      });
    };

    updateScrolled();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      document.body.classList.remove("menu-open");
      return undefined;
    }

    document.body.classList.add("menu-open");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("menu-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const closeMenu = () => setIsOpen(false);

  return (
    <header className={`site-header ${isOpen ? "is-open" : ""} ${isScrolled ? "is-scrolled" : ""}`}>
      <div className="site-header__inner glass">
        <Link className="brand-link" href="/" aria-label="Noisia home" onClick={closeMenu}>
          <Image
            src="/assets/logos/logo_black.svg"
            alt="Noisia"
            width={100}
            height={35}
            priority
            suppressHydrationWarning
          />
          <span>Social Intelligence Architects</span>
        </Link>

        <div className="site-header__spacer" aria-hidden="true" />

        <div className="site-header__actions">
          <Link
            className="site-header__cta"
            href={headerCtaHref}
            rel={isMeetingPage ? "noreferrer" : undefined}
            target={isMeetingPage ? "_blank" : undefined}
          >
            {headerCtaLabel}
          </Link>

          <button
            className="site-header__menu"
            type="button"
            aria-label={isOpen ? "Cerrar menu" : "Abrir menu"}
            aria-expanded={isOpen}
            aria-controls="site-fullscreen-menu"
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? <X size={19} strokeWidth={1.8} /> : <Menu size={19} strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      <div className="site-header__overlay" aria-hidden={!isOpen}>
        <button className="site-header__overlay-backdrop" type="button" onClick={closeMenu} aria-label="Cerrar menu" />

        <div
          className="site-header__overlay-panel"
          id="site-fullscreen-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Navegacion principal"
        >
          <div className="site-header__overlay-surface">
            <div className="site-header__overlay-top">
              <Link className="brand-link brand-link--overlay" href="/" aria-label="Noisia home" onClick={closeMenu}>
                <Image
                  src="/assets/logos/logo_black.svg"
                  alt="Noisia"
                  width={100}
                  height={35}
                  priority
                  suppressHydrationWarning
                />
                <span>Social Intelligence Architects</span>
              </Link>

              <nav className="site-header__overlay-tabs" aria-label="Secciones">
                {site.nav.map((item) => (
                  <Link
                    className={pathname === item.href ? "is-active" : ""}
                    href={item.href}
                    key={item.href}
                    onClick={closeMenu}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>

              <div className="site-header__overlay-actions">
                <Link className="site-header__overlay-login" href="/diagnostico" onClick={closeMenu}>
                  Diagnóstico
                </Link>
                <button
                  className="site-header__overlay-close"
                  type="button"
                  aria-label="Cerrar menu"
                  onClick={closeMenu}
                >
                  <X size={20} strokeWidth={1.9} />
                </button>
              </div>
            </div>

            <nav className="site-header__overlay-grid" aria-label="Navegacion principal">
              {site.nav.map((item, index) => {
                const card = menuCards[item.label] ?? {
                  deck: "Explorar sección."
                };
                const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

                return (
                <Link
                  className={`site-header__overlay-card ${isActive ? "is-active" : ""}`}
                  href={item.href}
                  key={item.href}
                  onClick={closeMenu}
                  style={{ ["--menu-delay" as string]: `${index * 48}ms` }}
                >
                  <strong>{item.label}</strong>
                  <p>{card.deck}</p>
                  <span className="site-header__overlay-card-cta">
                    Abrir <ArrowRight size={15} strokeWidth={1.9} />
                  </span>
                </Link>
                );
              })}
            </nav>

            <div className="site-header__overlay-footer">
              <p>¿No sabes por dónde entrar? Describe la decisión y armamos la ruta.</p>
              <Link className="site-header__overlay-cta" href="/diagnostico" onClick={closeMenu}>
                Iniciar diagnóstico <ArrowRight size={16} strokeWidth={1.9} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
