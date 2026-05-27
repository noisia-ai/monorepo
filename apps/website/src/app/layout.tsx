import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { StructuredData } from "@/components/seo/StructuredData";
import { site } from "@/content/site";
import { DEFAULT_OG_IMAGE, SITE_URL, absoluteUrl, organizationJsonLd, websiteJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Noisia | Social Intelligence Architects",
    template: "%s | Noisia"
  },
  description: site.description,
  alternates: {
    canonical: SITE_URL
  },
  icons: {
    icon: "/favicon.svg"
  },
  openGraph: {
    title: "Noisia",
    description: site.description,
    url: SITE_URL,
    siteName: site.name,
    locale: "es_MX",
    type: "website",
    images: [
      {
        url: absoluteUrl(DEFAULT_OG_IMAGE),
        width: 1200,
        height: 630,
        alt: "Noisia social intelligence"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Noisia",
    description: site.description,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <StructuredData data={[organizationJsonLd(), websiteJsonLd()]} />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
