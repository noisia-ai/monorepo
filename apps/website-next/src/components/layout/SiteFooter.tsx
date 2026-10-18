import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mainNav } from "./nav";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.logo}>noisia</span>
          <p className={styles.tagline}>{t("tagline")}</p>
          <Link href="/taller" className={styles.cta}>
            {tNav("cta")}
          </Link>
        </div>
        <nav className={styles.col} aria-label={t("explore")}>
          <p className={styles.colTitle}>{t("explore")}</p>
          {mainNav.map((item) => (
            <Link key={item.key} href={item.href}>
              {tNav(item.key)}
            </Link>
          ))}
        </nav>
        <nav className={styles.col} aria-label={t("learn")}>
          <p className={styles.colTitle}>{t("learn")}</p>
          <Link href="/inteligencia-social">{t("socialIntelligence")}</Link>
          <Link href="/comparar">{t("compare")}</Link>
          <Link href="/privacidad">{t("privacy")}</Link>
        </nav>
        <div className={styles.col}>
          <p className={styles.colTitle}>{t("company")}</p>
          <a href="mailto:hola@noisia.ai">hola@noisia.ai</a>
          <a href="https://www.linkedin.com/company/29118513/" rel="noopener" target="_blank">
            LinkedIn
          </a>
        </div>
      </div>
      <p className={styles.signature}>{t("signature")}</p>
    </footer>
  );
}
