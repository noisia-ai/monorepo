import { FluidBackground } from "@/components/layout/FluidBackground";
import { ScrollReveal } from "@/components/layout/ScrollReveal";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FluidBackground />
      <ScrollReveal />
      <div className="site-shell">
        <a className="skip-link" href="#main">
          Saltar al contenido
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </div>
    </>
  );
}
