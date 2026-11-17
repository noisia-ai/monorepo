import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Lock, Xmark } from "iconoir-react";
import { StudyViewer } from "@/components/studies/StudyViewer";
import styles from "@/components/studies/viewer.module.css";
import { Button } from "@/components/ui/Button";
import { studiesPage } from "@/content/pages/studies";
import { getStudy, slidePaths } from "@/content/studies";
import { getPathname } from "@/i18n/navigation";
import { accessCookieName, canOpen, pendingCookieName, PREVIEW_SLIDES, READER_COOKIE, recordEvent, recordReaderOpen } from "@/lib/content/access";
import { SITE_URL } from "@/lib/site";

/**
 * The study viewer: the full study on a page of its own, outside the site's header and footer,
 * behind its access mode. Rendered per request (it reads the access cookie), so Next sends it
 * with `Cache-Control: private, no-store` and Cloudflare never keeps it.
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

export default async function StudyViewerPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ slide?: string; code?: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const study = await getStudy(slug);
  if (!study) notFound();
  const lang = locale === "en" ? "en" : "es";
  const c = studiesPage[lang];
  const title = study.summary[lang].title;
  const studyHref = getPathname({ locale, href: { pathname: "/insights/estudios/[slug]", params: { slug: study.id } } });

  const jar = await cookies();
  const token = jar.get(accessCookieName(study.id))?.value;
  const reader = jar.get(READER_COOKIE)?.value;
  const access = await canOpen(study, token, reader);
  const base = `/api/content/studies/${study.id}`;
  const slides = slidePaths(study).map((path) => `${base}/${path}?v=${study.version}`);
  const query = await searchParams;
  const requested = Number.parseInt(query.slide ?? "", 10);
  const initialSlide = Number.isFinite(requested) && requested >= 1 && requested <= slides.length ? requested - 1 : 0;
  const viewerProps = {
    title,
    studyHref,
    shareUrl: new URL(studyHref, SITE_URL).toString(),
    deckSrc: `${base}/deck/index.html?v=${study.version}`,
    slides,
    initialSlide,
    pdfHref: study.pdfPath ? `${base}/pdf?v=${study.version}` : null,
    labels: {
      close: c.close,
      slides: c.slides(slides.length),
      slideOf: slides.map((_, i) => c.slideOf(i + 1, slides.length)),
      slideAlt: slides.map((_, i) => c.slideAlt(i + 1, slides.length)),
      prev: c.prev,
      next: c.next,
      showThumbs: c.showThumbs,
      hideThumbs: c.hideThumbs,
      zoomIn: c.zoomIn,
      zoomOut: c.zoomOut,
      fit: c.fit,
      share: c.share,
      copied: c.copied,
      downloadPdf: c.downloadPdf,
      present: c.present,
      tapHint: c.tapHint
    }
  };

  // A `registro` study shows its first slides and opens the rest with name, email and company.
  if (!access.allowed && study.accessMode === "registro") {
    const preview = Math.min(PREVIEW_SLIDES, slides.length);
    const { text, ...unlockCopy } = c.unlock;
    return (
      <StudyViewer
        {...viewerProps}
        unlock={{
          endpoint: `${base}/unlock`,
          locale: lang,
          preview,
          privacyHref: getPathname({ locale, href: "/privacidad" }),
          pending: Boolean(jar.get(pendingCookieName(study.id))?.value),
          code: typeof query.code === "string" && /^\d{4}$/.test(query.code) ? query.code : null,
          copy: { ...unlockCopy, text: text(slides.length - preview) }
        }}
      />
    );
  }

  if (!access.allowed) {
    const mode = study.accessMode === "abierto" ? "solo_link" : study.accessMode;
    return (
      <div className={styles.gatePage}>
        <header className={styles.bar}>
          <div className={styles.barStart}>
            <a href={studyHref} className={styles.iconButton} aria-label={c.close} title={c.close}>
              <Xmark aria-hidden />
            </a>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/noisia.svg" alt="Noisia" className={styles.logo} />
          </div>
        </header>
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

  if (access.viaReader && reader) await recordReaderOpen(study.id, reader);
  else await recordEvent(study.id, access.viaLink ? token : undefined, "open");

  return <StudyViewer {...viewerProps} />;
}
