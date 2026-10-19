import { useTranslations } from "next-intl";
import { ArrowRight, Linkedin, Mail } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/brand/Logo";
import { mainNav } from "./nav";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.grid}>
          <div className={styles.brand}>
            <Logo height={30} className={styles.logo} />
            <p className={styles.tagline}>{t("tagline")}</p>
            <Link href="/taller" className={styles.cta}>
              {tNav("cta")} <ArrowRight aria-hidden />
            </Link>
            <div className={styles.social}>
              <a href="mailto:hola@noisia.ai" aria-label={t("email")} title="hola@noisia.ai">
                <Mail aria-hidden />
              </a>
              <a href="https://www.linkedin.com/company/29118513/" rel="noopener" target="_blank" aria-label={t("linkedin")}>
                <Linkedin aria-hidden />
              </a>
            </div>
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
            <Link href="/industrias">{t("industries")}</Link>
            <Link href="/inteligencia-social">{t("socialIntelligence")}</Link>
            <Link href="/comparar">{t("compare")}</Link>
            <Link href="/privacidad">{t("privacy")}</Link>
          </nav>
        </div>

        <div className={styles.bottom}>
          <span>{t("signature")}</span>
          <span>
            © {new Date().getFullYear()} {t("rights")}
          </span>
        </div>
      </div>
    </footer>
  );
}
