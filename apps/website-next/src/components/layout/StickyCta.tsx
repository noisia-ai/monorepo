"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp } from "iconoir-react";
import { Link, usePathname } from "@/i18n/navigation";
import styles from "./StickyCta.module.css";

/**
 * Phones only: a small glass dock with the first step and a back-to-top button. It appears
 * after the hero and steps aside when the footer (which has the same button) comes into view.
 */
export function StickyCta() {
  const t = useTranslations("stickyCta");
  const pathname = usePathname();
  const [past, setPast] = useState(false);
  const [footer, setFooter] = useState(false);

  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const foot = document.querySelector("footer");
    const observer = foot ? new IntersectionObserver(([entry]) => setFooter(Boolean(entry?.isIntersecting)), { threshold: 0 }) : null;
    if (foot && observer) observer.observe(foot);
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [pathname]);

  if (pathname === "/taller") return null;
  const visible = past && !footer;
  return (
    <div className={styles.bar} data-visible={visible} aria-hidden={!visible}>
      <div className={styles.dock}>
        <Link href="/taller" className={styles.button} tabIndex={visible ? 0 : -1}>
          {t("label")}
        </Link>
        <button
          type="button"
          className={styles.top}
          aria-label={t("top")}
          tabIndex={visible ? 0 : -1}
          onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
        >
          <ArrowUp aria-hidden />
        </button>
      </div>
    </div>
  );
}
