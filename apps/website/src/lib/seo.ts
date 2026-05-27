import type { Metadata } from "next";
import { site } from "@/content/site";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://noisia.ai"
).replace(/\/$/, "");

export const DEFAULT_OG_IMAGE = "/assets/insights/cultural-foresight-editorial.png";

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  noIndex?: boolean;
};

export function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function createPageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  imageAlt = `${site.name} social intelligence`,
  type = "website",
  noIndex = false
}: PageMetadataOptions): Metadata {
  const url = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);

  return {
    title,
    description,
    alternates: {
      canonical: url
    },
    robots: noIndex
      ? {
          index: false,
          follow: false
        }
      : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: site.name,
      locale: "es_MX",
      type,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: imageAlt
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl]
    }
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: SITE_URL,
    logo: absoluteUrl("/assets/logos/logo_black@2x.png"),
    description: site.description,
    sameAs: ["https://www.linkedin.com/company/29118513/"],
    contactPoint: [
      {
        "@type": "ContactPoint",
        email: "hola@noisia.ai",
        contactType: "business inquiries",
        areaServed: ["MX", "LATAM"],
        availableLanguage: ["es", "en"]
      }
    ],
    knowsAbout: [
      "social intelligence",
      "consumer insights",
      "brand strategy",
      "cultural analysis",
      "voice of customer",
      "market research"
    ]
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: SITE_URL,
    inLanguage: "es-MX",
    description: site.description,
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: SITE_URL
    }
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path)
    }))
  };
}

