import { defineRouting } from "next-intl/routing";

// Spanish is the default and lives at the root; English lives under /en.
// Internal keys are the Spanish paths; each locale gets its own slug so URLs read
// naturally in both languages (and rank for searches in both).
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
  // Links are shared by the team in Spanish; never bounce a reader to another language on their own.
  localeDetection: false,
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
    "/privacidad": { es: "/privacidad", en: "/privacy" }
  }
});

export type Locale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
