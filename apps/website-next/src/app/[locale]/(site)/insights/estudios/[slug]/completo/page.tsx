import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Lock, NavArrowLeft } from "iconoir-react";
import styles from "@/components/studies/studies.module.css";
import { StudyViewer } from "@/components/studies/StudyViewer";
import { Button } from "@/components/ui/Button";
import { studiesPage } from "@/content/pages/studies";
import { getStudy, slidePaths } from "@/content/studies";
import { Link } from "@/i18n/navigation";
import { accessCookieName, canOpen, recordEvent } from "@/lib/content/access";

/**
 * The full study, behind its access mode. Rendered per request (it reads the access cookie), so
 * Next sends it with `Cache-Control: private, no-store` and Cloudflare never keeps it.
 */

export const dynamic = "force-dynamic";

type Params = { locale: string; slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const study = await getStudy(slug);
  if (!study) return {};
  const lang = locale === "en" ? "en" : "es";
  return {
    title: studiesPage[lang].fullMetaTitle(study.summary[lang].title),
    robots: { index: false, follow: false }
  };
}

export default async function FullStudyPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const study = await getStudy(slug);
  if (!study) notFound();
  const lang = locale === "en" ? "en" : "es";
  const c = studiesPage[lang];
  const title = study.summary[lang].title;

  const token = (await cookies()).get(accessCookieName(study.id))?.value;
  const access = await canOpen(study, token);

  const back = (
    <Link href={{ pathname: "/insights/estudios/[slug]", params: { slug: study.id } }} className={styles.back}>
      <NavArrowLeft aria-hidden /> {c.backToStudy}
    </Link>
  );

  if (!access.allowed) {
    const mode = study.accessMode === "abierto" ? "solo_link" : study.accessMode;
    return (
      <div className={styles.viewerPage}>
        {back}
        <section className={styles.gate}>
          <span className={styles.gateIcon} aria-hidden>
            <Lock />
          </span>
          <h1>{c.gateTitle[mode]}</h1>
          <p>{c.gateText[mode]}</p>
          <Button href="/taller" arrow>
            {c.gateCta}
          </Button>
          <p className={styles.gateSmall}>{c.gateHasLink}</p>
        </section>
      </div>
    );
  }

  await recordEvent(study.id, access.viaLink ? token : undefined, "open");
  const base = `/api/content/studies/${study.id}`;
  const slides = slidePaths(study).map((path) => `${base}/${path}?v=${study.version}`);

  return (
    <div className={styles.viewerPage}>
      <div className={styles.viewerBar}>
        <div className={styles.viewerTitle}>
          {back}
          <h1>{title}</h1>
        </div>
      </div>
      <StudyViewer
        deckSrc={`${base}/deck/index.html?v=${study.version}`}
        slides={slides}
        pdfHref={study.pdfPath ? `${base}/pdf?v=${study.version}` : null}
        labels={{
          downloadPdf: c.downloadPdf,
          fullscreen: c.fullscreen,
          tapHint: c.tapHint,
          slideAlt: slides.map((_, i) => c.slideAlt(i + 1, slides.length)),
          deckTitle: title
        }}
      />
    </div>
  );
}
