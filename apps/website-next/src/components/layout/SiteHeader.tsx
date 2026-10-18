"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Menu, Xmark } from "iconoir-react";
import { useParams } from "next/navigation";
import { Link, getPathname, usePathname } from "@/i18n/navigation";
import { useAlternateHref } from "./alternate";
import { mainNav } from "./nav";
import styles from "./SiteHeader.module.css";
import { Logo } from "@/components/brand/Logo";

export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const alternate = useAlternateHref();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const other = locale === "en" ? "es" : "en";
  // The switch must be right before hydration too. Pages with translated slugs register their
  // exact twin (SetAlternate); until then a translated-slug page points to its section index.
  const switchHref = (() => {
    if (alternate) return alternate;
    let href: string;
    try {
      if (pathname.includes("[slug]") && !pathname.startsWith("/insights/")) {
        // @ts-expect-error the stripped template is a valid static route
        href = getPathname({ locale: other, href: pathname.replace("/[slug]", "") });
      } else {
        // @ts-expect-error pathname and params come from the current route
        href = getPathname({ locale: other, href: { pathname, params } });
      }
    } catch {
      href = other === "en" ? "/en" : "/";
    }
    return href.replace(/^\/es(?=\/|$)/, "") || "/";
  })();

  return (
    <header className={styles.header} data-scrolled={scrolled || open}>
      <a href="#main" className="visually-hidden">
        {t("skip")}
      </a>
      <div className={styles.bar}>
        <Link href="/" className={styles.logo}>
          <Logo height={24} />
        </Link>
        <nav className={styles.desktopNav} aria-label={t("mainNav")}>
          {mainNav.map((item) => (
            <Link key={item.key} href={item.href} className={styles.navLink} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className={styles.end}>
          <a href={switchHref} className={styles.lang} hrefLang={other} lang={other}>
            {other.toUpperCase()}
          </a>
          <Link href="/taller" className={styles.cta}>
            {t("cta")}
          </Link>
          <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
            {open ? <Xmark aria-hidden /> : <Menu aria-hidden />}
            <span className="visually-hidden">{open ? t("close") : t("menu")}</span>
          </button>
        </div>
      </div>
      <div id="mobile-menu" className={styles.mobileMenu} data-open={open} hidden={!open}>
        <nav aria-label={t("mainNav")}>
          {mainNav.map((item, i) => (
            <Link key={item.key} href={item.href} className={styles.mobileLink} style={{ animationDelay: `${i * 40}ms` }}>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <Link href="/taller" className={styles.mobileCta}>
          {t("cta")}
        </Link>
      </div>
    </header>
  );
}
