import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Old URLs from the 2026-05 site, kept alive with permanent redirects so search engines
// and shared links land on their closest new page.
const legacyCases = {
  "lanzamiento-de-campana": "/soluciones/lanzar",
  "optimizacion-de-medios": "/soluciones/optimizar",
  "desarrollo-de-producto": "/soluciones/innovar",
  "entrada-a-nuevo-mercado": "/soluciones/entrar",
  reposicionamiento: "/soluciones/lanzar",
  "defensa-competitiva": "/soluciones/defender",
  "validacion-de-hipotesis": "/soluciones",
  "anticipacion-de-tendencias": "/soluciones/monitorear",
  "decodificacion-de-crisis": "/soluciones/monitorear",
  "influencia-de-categoria": "/metodos"
};

const legacyReports = {
  "cultural-foresight-mexico-2026": "cultural-foresight-mexico-2026",
  "mexico-esta-cansado-de-performar": "cultural-foresight-mexico-2026",
  "future-is-human": "future-is-human",
  "the-mexican-home": "the-mexican-home"
};

// Sent with every response. A full Content-Security-Policy would need 'unsafe-inline' for
// Next's inline bootstrap, the language fade script and GA (nonces would force every page
// to render dynamically), so only the directives that cannot break anything are set.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" }
];

// Files in /public keep their names between deploys, so they get a day of freshness and a
// week of background revalidation instead of `immutable` (hashed /_next/static already has it).
const publicAssetCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A separate build folder lets a production build run beside `next dev` (NEXT_DIST_DIR=.next-perf).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // Pages rendered on request stream their metadata after the body for most clients. Search and
  // answer-engine crawlers get it in <head>, where every one of them reads it.
  htmlLimitedBots: /Googlebot|Google-InspectionTool|Storebot-Google|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Applebot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|anthropic-ai|PerplexityBot|Perplexity-User|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot/i,
  compress: true,
  // The monorepo root (silences the multiple-lockfile guess and keeps file tracing in this repo).
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Import only the icons in use; without this the whole Iconoir and Simple Icons sets ship.
  experimental: { optimizePackageImports: ["iconoir-react", "simple-icons"] },
  devIndicators: false,
  // Stories and reports are read from disk at request time; ship them with the server bundle.
  outputFileTracingIncludes: { "/**": ["./src/content/stories/public/**", "./src/content/reports/**", "./public/brand/**"] },
  images: {
    // WebP only (the default): AVIF would re-encode the report art the founder approved.
    formats: ["image/webp"],
    minimumCacheTTL: 604800
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/brand/:path*", "/assets/:path*", "/fonts/:path*", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"].map((source) => ({ source, headers: publicAssetCache }))
    ];
  },
  async redirects() {
    return [
      { source: "/metodologias", destination: "/metodos", permanent: true },
      { source: "/metodologias/:slug", destination: "/metodos", permanent: true },
      // Methods no longer have a page each: every method lives inside the Methods page.
      { source: "/metodos/:slug", destination: "/metodos", permanent: true },
      { source: "/en/methods/:slug", destination: "/en/methods", permanent: true },
      { source: "/casos-de-uso", destination: "/soluciones", permanent: true },
      ...Object.entries(legacyCases).map(([from, to]) => ({ source: `/casos-de-uso/${from}`, destination: to, permanent: true })),
      { source: "/servicios", destination: "/soluciones", permanent: true },
      { source: "/arquitectura-de-datos", destination: "/como-funciona", permanent: true },
      { source: "/diagnostico", destination: "/taller", permanent: true },
      { source: "/meeting", destination: "/taller", permanent: true },
      { source: "/contacto", destination: "/taller", permanent: true },
      { source: "/landing", destination: "/", permanent: true },
      // Old asset URLs that may be cached by search engines (the old Organization logo) or embedded elsewhere.
      { source: "/assets/logos/:file*", destination: "/brand/noisia.svg", permanent: true },
      { source: "/assets/insights/cultural-foresight-hero-v2.png", destination: "/assets/insights/cultural-foresight-editorial.png", permanent: true },
      { source: "/assets/insights/future-is-human-hero-v2.png", destination: "/assets/insights/future-is-human-editorial.png", permanent: true },
      ...Object.entries(legacyReports).map(([from, to]) => ({ source: `/insights/${from}`, destination: `/insights/reportes/${to}`, permanent: true }))
    ];
  }
};

export default withNextIntl(nextConfig);
