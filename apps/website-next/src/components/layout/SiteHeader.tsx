"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Menu, Xmark } from "iconoir-react";
import { Link, usePathname } from "@/i18n/navigation";
import { mainNav } from "./nav";
import styles from "./SiteHeader.module.css";

export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
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
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const other = locale === "en" ? "es" : "en";

  return (
    <header className={styles.header} data-scrolled={scrolled || open}>
      <a href="#main" className="visually-hidden">
        {t("skip")}
      </a>
      <div className={styles.bar}>
        <Link href="/" className={styles.logo} aria-label="Noisia">
          noisia
        </Link>
        <nav className={styles.desktopNav} aria-label="Principal">
          {mainNav.map((item) => (
            <Link key={item.key} href={item.href} className={styles.navLink} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className={styles.end}>
          {/* @ts-expect-error pathname is a valid localized route string at runtime */}
          <Link href={pathname} locale={other} className={styles.lang} hrefLang={other}>
            {other.toUpperCase()}
          </Link>
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
        <nav aria-label="Principal">
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
