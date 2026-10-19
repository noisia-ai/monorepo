import { defineRouting } from "next-intl/routing";

// Spanish is the default and lives at the root; English lives under /en.
// Internal keys are the Spanish paths; each locale gets its own slug so URLs read
// naturally in both languages (and rank for searches in both).
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
  // Device language is detected only on the home page (see middleware): next-intl's own detection
  // redirects deep links to untranslated slugs (/soluciones/planear -> /en/solutions/planear, a 404).
  localeDetection: false,
  // next-intl's automatic hreflang header can't translate slugs (it would point /soluciones/anticipar
  // to /en/solutions/anticipar); every page declares its real alternates in its metadata instead.
  alternateLinks: false,
  pathnames: {
    "/": "/",
    "/insights": "/insights",
    "/insights/[slug]": "/insights/[slug]",
    "/insights/reportes/[slug]": { es: "/insights/reportes/[slug]", en: "/insights/reports/[slug]" },
    "/como-funciona": { es: "/como-funciona", en: "/how-it-works" },
    "/metodos": { es: "/metodos", en: "/methods" },
    "/soluciones": { es: "/soluciones", en: "/solutions" },
    "/soluciones/[slug]": { es: "/soluciones/[slug]", en: "/solutions/[slug]" },
    "/nosotros": { es: "/nosotros", en: "/about" },
    "/taller": { es: "/taller", en: "/workshop" },
    "/inteligencia-social": { es: "/inteligencia-social", en: "/social-intelligence" },
    "/comparar": { es: "/comparar", en: "/compare" },
    "/comparar/[slug]": { es: "/comparar/[slug]", en: "/compare/[slug]" },
    "/privacidad": { es: "/privacidad", en: "/privacy" },
    "/industrias": { es: "/industrias", en: "/industries" },
    "/industrias/[slug]": { es: "/industrias/[slug]", en: "/industries/[slug]" }
  }
});

export type Locale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
