import type { MetadataRoute } from "next";
import { insightsReports } from "@/content/insights/reports";
import { methodologies, useCases } from "@/content/site";
import { absoluteUrl } from "@/lib/seo";

const now = new Date();

const staticRoutes: Array<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/insights", priority: 0.9, changeFrequency: "weekly" },
  { path: "/metodologias", priority: 0.8, changeFrequency: "monthly" },
  { path: "/casos-de-uso", priority: 0.8, changeFrequency: "monthly" },
  { path: "/arquitectura-de-datos", priority: 0.7, changeFrequency: "monthly" },
  { path: "/servicios", priority: 0.9, changeFrequency: "monthly" },
  { path: "/contacto", priority: 0.6, changeFrequency: "monthly" },
  { path: "/diagnostico", priority: 0.7, changeFrequency: "monthly" },
  { path: "/meeting", priority: 0.5, changeFrequency: "monthly" }
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...staticRoutes.map((route) => ({
      url: absoluteUrl(route.path),
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority
    })),
    ...insightsReports.map((report) => ({
      url: absoluteUrl(`/insights/${report.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8
    })),
    ...methodologies.map((methodology) => ({
      url: absoluteUrl(`/metodologias/${methodology.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.65
    })),
    ...useCases.map((useCase) => ({
      url: absoluteUrl(`/casos-de-uso/${useCase.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.65
    }))
  ];
}

