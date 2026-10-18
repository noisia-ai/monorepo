import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { industryEntries } from "@/content/pages/industries";
import styles from "@/components/industry/industry.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "industryPage" });
  return {
    title: t("indexTitle"),
    description: t("indexLead"),
    alternates: { canonical: locale === "en" ? "/en/industries" : "/industrias", languages: { es: "/industrias", en: "/en/industries" } }
  };
}

export default async function IndustriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("industryPage");
  const lang = locale === "en" ? "en" : "es";
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>{t("indexTitle")}</h1>
        <p className={styles.lead}>{t("indexLead")}</p>
      </header>
      <ul className={styles.index}>
        {industryEntries.map((entry) => (
          <li key={entry.slug.es}>
            <a className={styles.indexLink} href={`${lang === "en" ? "/en/industries" : "/industrias"}/${entry.slug[lang]}`}>
              <span className={styles.indexName}>{entry[lang].name}</span>
              <span className={styles.indexText}>{entry[lang].questions[0]?.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
