import { setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StickyCta } from "@/components/layout/StickyCta";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  // Without this the footer reads the locale from the request and every page renders per request.
  setRequestLocale((await params).locale);
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <StickyCta />
      <ScrollReveal />
    </>
  );
}
