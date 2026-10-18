import { defineRouting } from "next-intl/routing";

// Spanish is the default and lives at the root; English lives under /en.
// Internal keys are the Spanish paths; each locale gets its own slug so URLs read
// naturally in both languages (and rank for searches in both).
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
  // First visit follows the device language (Accept-Language); after that the NEXT_LOCALE cookie,
  // which the ES/EN toggle sets, wins. Crawlers send no language and get Spanish.
  localeDetection: true,
  pathnames: {
    "/": "/",
    "/insights": "/insights",
    "/insights/[slug]": "/insights/[slug]",
    "/insights/reportes/[slug]": { es: "/insights/reportes/[slug]", en: "/insights/reports/[slug]" },
    "/como-funciona": { es: "/como-funciona", en: "/how-it-works" },
    "/metodos": { es: "/metodos", en: "/methods" },
    "/metodos/[slug]": { es: "/metodos/[slug]", en: "/methods/[slug]" },
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
