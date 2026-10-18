import type { MetadataRoute } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing, type AppPathname } from "@/i18n/routing";
import { getStories } from "@/content/stories";
import { methodEntries } from "@/content/pages/methods";
import { solutionEntries } from "@/content/pages/solutions";
import { compareEntries } from "@/content/pages/compare";
import { SITE_URL } from "@/lib/site";

const staticPaths: AppPathname[] = [
  "/",
  "/insights",
  "/soluciones",
  "/como-funciona",
  "/metodos",
  "/nosotros",
  "/taller",
  "/inteligencia-social",
  "/comparar",
  "/privacidad"
];

function entry(href: Parameters<typeof getPathname>[0]["href"]): MetadataRoute.Sitemap[number] {
  const languages = Object.fromEntries(routing.locales.map((locale) => [locale, SITE_URL + getPathname({ locale, href })]));
  return { url: SITE_URL + getPathname({ locale: "es", href }), alternates: { languages } };
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...staticPaths.map((pathname) => entry(pathname as never)),
    ...getStories().filter((story) => story.kind === "editorial").map((story) => entry({ pathname: "/insights/[slug]", params: { slug: story.id } })),
    ...solutionEntries.map((e) => ({ url: `${SITE_URL}/soluciones/${e.slug.es}`, alternates: { languages: { es: `${SITE_URL}/soluciones/${e.slug.es}`, en: `${SITE_URL}/en/solutions/${e.slug.en}` } } })),
    ...methodEntries.map((e) => ({ url: `${SITE_URL}/metodos/${e.slug.es}`, alternates: { languages: { es: `${SITE_URL}/metodos/${e.slug.es}`, en: `${SITE_URL}/en/methods/${e.slug.en}` } } })),
    ...compareEntries.map((e) => ({ url: `${SITE_URL}/comparar/${e.slug.es}`, alternates: { languages: { es: `${SITE_URL}/comparar/${e.slug.es}`, en: `${SITE_URL}/en/compare/${e.slug.en}` } } }))
  ];
}
