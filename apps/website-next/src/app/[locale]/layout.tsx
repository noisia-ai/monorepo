import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Analytics } from "@/components/layout/Analytics";
import { googleSans } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";
import "@/styles/base.css";

const LANG_FADE_IN = `try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("js-reveal")}catch(e){}try{if(sessionStorage.getItem("noisia-lang-switch")){sessionStorage.removeItem("noisia-lang-switch");document.documentElement.dataset.lang="in";setTimeout(function(){delete document.documentElement.dataset.lang},700)}}catch(e){}`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("defaultTitle"), template: `%s · Noisia` },
    description: t("description"),
    icons: { icon: "/favicon.svg" },
    openGraph: { siteName: "Noisia", locale: locale === "en" ? "en_US" : "es_MX", type: "website" },
    // Staging must never be indexed.
    robots: process.env.NOISIA_UAT === "1" ? { index: false, follow: false } : undefined
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
