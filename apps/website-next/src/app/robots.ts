import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NOISIA_UAT === "1") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/render/", "/en/render/", "/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
