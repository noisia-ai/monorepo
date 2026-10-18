"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import styles from "./StickyCta.module.css";

/** Mobile-only bottom bar that keeps the first step one tap away, after the hero. */
export function StickyCta() {
  const t = useTranslations("stickyCta");
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (pathname === "/taller") return null;
  return (
    <div className={styles.bar} data-visible={visible}>
      <Link href="/taller" className={styles.button} tabIndex={visible ? 0 : -1}>
        {t("label")}
      </Link>
    </div>
  );
}
