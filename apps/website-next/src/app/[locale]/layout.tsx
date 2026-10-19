import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Analytics } from "@/components/layout/Analytics";
import { googleSans } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";
import { OG_LOCALE, toLang } from "@/lib/seo/config";
import { ogImageUrl, robotsFor } from "@/lib/seo/metadata";
import { seoPage } from "@/lib/seo/pages";
import "@/styles/base.css";

const LANG_FADE_IN = `try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("js-reveal")}catch(e){}try{if(sessionStorage.getItem("noisia-lang-switch")){sessionStorage.removeItem("noisia-lang-switch");document.documentElement.dataset.lang="in";setTimeout(function(){delete document.documentElement.dataset.lang},700)}}catch(e){}`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const lang = toLang(locale);
  const home = seoPage("/");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("defaultTitle"), template: `%s · Noisia` },
    description: t("description"),
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/favicon.svg", type: "image/svg+xml" }
      ],
      apple: { url: "/apple-touch-icon.png", sizes: "180x180" }
    },
    manifest: "/manifest.webmanifest",
    applicationName: "Noisia",
    // Defaults for any page that doesn't set its own (every registered page does, via pageMetadata).
    openGraph: {
      siteName: "Noisia",
      locale: OG_LOCALE[lang],
      type: "website",
      images: home ? [{ url: ogImageUrl(home, lang), width: 1200, height: 630 }] : undefined
    },
    twitter: { card: "summary_large_image", images: home ? [ogImageUrl(home, lang)] : undefined },
    // Staging must never be indexed.
    robots: robotsFor()
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff"
};

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale === "en" ? "en" : "es-MX"} className={googleSans.variable} suppressHydrationWarning>
      <head>
        {/* Arriving from the language toggle: fade the new language in instead of a hard cut. */}
        <script dangerouslySetInnerHTML={{ __html: LANG_FADE_IN }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
