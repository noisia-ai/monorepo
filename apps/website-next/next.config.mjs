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
  "influencia-de-categoria": "/metodos/influence-architecture"
};

const legacyReports = ["cultural-foresight-mexico-2026", "mexico-esta-cansado-de-performar", "future-is-human", "the-mexican-home"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async redirects() {
    return [
      { source: "/metodologias", destination: "/metodos", permanent: true },
      { source: "/metodologias/:slug", destination: "/metodos/:slug", permanent: true },
      { source: "/casos-de-uso", destination: "/soluciones", permanent: true },
      ...Object.entries(legacyCases).map(([from, to]) => ({ source: `/casos-de-uso/${from}`, destination: to, permanent: true })),
      { source: "/servicios", destination: "/soluciones", permanent: true },
      { source: "/arquitectura-de-datos", destination: "/como-funciona", permanent: true },
      { source: "/diagnostico", destination: "/taller", permanent: true },
      { source: "/meeting", destination: "/taller", permanent: true },
      { source: "/contacto", destination: "/taller", permanent: true },
      ...legacyReports.map((slug) => ({ source: `/insights/${slug}`, destination: "/insights", permanent: false }))
    ];
  }
};

export default withNextIntl(nextConfig);
