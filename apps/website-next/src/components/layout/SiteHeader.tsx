"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Book, Compass, Group, MediaVideo, Menu, Network, Xmark } from "iconoir-react";
import { useParams } from "next/navigation";
import { Link, getPathname, usePathname } from "@/i18n/navigation";
import { useAlternateHref } from "./alternate";
import { LangToggle } from "./LangToggle";
import { mainNav } from "./nav";
import styles from "./SiteHeader.module.css";
import { Logo } from "@/components/brand/Logo";

const MENU_ICONS = { solutions: Compass, howItWorks: Network, methods: Book, insights: MediaVideo, about: Group } as const; // methods/about live in the footer

export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const alternate = useAlternateHref();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  // Like Apple's bar: a little shorter while scrolling down, back to full height on the way up.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      if (Math.abs(y - last) > 6) {
        setCompact(y > 120 && y > last);
        last = y;
      }
    };
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
  // Lock the page behind the open menu. iOS ignores overflow:hidden on body, so pin it in place.
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const body = document.body.style;
    Object.assign(body, { position: "fixed", top: `-${y}px`, left: "0", right: "0", overflow: "hidden" });
    document.documentElement.dataset.menu = "open";
    return () => {
      delete document.documentElement.dataset.menu;
      Object.assign(body, { position: "", top: "", left: "", right: "", overflow: "" });
      window.scrollTo(0, y);
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
    <header className={styles.header} data-scrolled={scrolled} data-open={open} data-compact={compact && !open}>
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
          <div className={styles.langDesktop}>
            <LangToggle locale={locale} otherHref={switchHref} label={t("languageLabel")} />
          </div>
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
        <nav aria-label={t("mainNav")} className={styles.menuList}>
          {mainNav.map((item, i) => {
            const Icon = MENU_ICONS[item.key];
            return (
              <Link key={item.key} href={item.href} className={styles.menuItem} style={{ animationDelay: `${60 + i * 45}ms` }}>
                <span className={styles.menuIcon} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.menuText}>
                  <span className={styles.menuName}>{t(item.key)}</span>
                  <span className={styles.menuDesc}>{t(`${item.key}Desc`)}</span>
                </span>
                <ArrowRight className={styles.menuArrow} aria-hidden />
              </Link>
            );
          })}
        </nav>
        <div className={styles.menuFoot} style={{ animationDelay: `${60 + mainNav.length * 45}ms` }}>
          <Link href="/taller" className={styles.mobileCta}>
            {t("menuCta")}
          </Link>
          <p className={styles.menuNote}>{t("menuNote")}</p>
          <div className={styles.menuLang}>
            <span>{t("languageLabel")}</span>
            <LangToggle locale={locale} otherHref={switchHref} label={t("languageLabel")} />
          </div>
        </div>
      </div>
    </header>
  );
}
