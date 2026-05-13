import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import { siFacebook, siInstagram, siReddit, siTiktok, siX, siYoutube } from "simple-icons";
import { Button } from "@/components/ui/Button";
import { MethodologyChip } from "@/components/ui/MethodologyIcon";
import type { InsightReport, InsightSignal } from "@/content/insights/reports";
import { insightsReports } from "@/content/insights/reports";
import {
  DownloadPrintButton,
  MaturityDistributionChart,
  SignalEvidenceScatter,
  SignalScaleChart
} from "./InsightCharts";
import styles from "./Insights.module.css";

const maturityCopy: Record<InsightSignal["maturity"], { title: string; note: string }> = {
  emergente: {
    title: "Emergente",
    note: "La tensión existe; el vocabulario público apenas se está formando."
  },
  acelerando: {
    title: "Acelerando",
    note: "Vocabulario consolidado y frecuencia creciente."
  },
  mainstreaming: {
    title: "Mainstreaming",
    note: "Ya atraviesa múltiples plataformas y conversaciones."
  }
};

const sectionLinks = [
  { id: "cover", label: "Cover" },
  { id: "opening", label: "Contexto" },
  { id: "looked-for", label: "Señales" },
  { id: "radar", label: "Radar" },
  { id: "signal-1", label: "01" },
  { id: "signal-2", label: "02" },
  { id: "signal-3", label: "03" },
  { id: "signal-4", label: "04" },
  { id: "signal-5", label: "05" },
  { id: "signal-6", label: "06" },
  { id: "signal-7", label: "07" },
  { id: "signal-8", label: "08" },
  { id: "brands", label: "Marcas" },
  { id: "methodology", label: "Método" },
  { id: "cta", label: "Contacto" }
];

const heroNumberOrder = ["corpus_scope", "period", "sources", "signals", "keywords", "evidence"];
const heroMetaStatOrder = ["period", "sources", "signals", "evidence"];
const maturityOrder: InsightSignal["maturity"][] = ["emergente", "acelerando", "mainstreaming"];
const printTotalPages = "18";
const linkedInIcon = {
  path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.554V9h3.565v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"
};

const platformIcons = {
  facebook: siFacebook,
  instagram: siInstagram,
  linkedin: linkedInIcon,
  reddit: siReddit,
  tiktok: siTiktok,
  x: siX,
  youtube: siYoutube
};

function padOrder(order: number) {
  return String(order).padStart(2, "0");
}

function stripEmoji(input: string) {
  return input.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "");
}

function cleanText(input: string, maxLength = 260) {
  const compact = stripEmoji(input)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength).trimEnd().replace(/[.,;:!?-]+$/g, "")}...`;
}

function displayCopy(input: string) {
  return input
    .replaceAll("De la performance al resguardo", "Del tener que demostrar al poder respirar")
    .replaceAll("aspiración performativa", "presumir como obligación")
    .replaceAll("Aspiración performativa", "Presumir como obligación")
    .replaceAll("performance productiva", "presión por rendir")
    .replaceAll("performance social", "presión por mostrarse")
    .replaceAll("performance comunicacional", "presión por sonar perfecto");
}

function heroMetaLabel(label: string) {
  return label.toLowerCase().includes("menciones") ? "menciones" : label;
}

function platformName(input: string) {
  const map: Record<string, string> = {
    tiktok: "TikTok",
    youtube: "YouTube",
    instagram: "Instagram",
    facebook: "Facebook",
    reddit: "Reddit",
    x: "X",
    linkedin: "LinkedIn"
  };

  return map[input.toLowerCase()] ?? input;
}

function PlatformIcon({ platform }: { platform: string }) {
  const icon = platformIcons[platform.toLowerCase() as keyof typeof platformIcons];

  if (!icon) {
    return <span className={styles.platformFallback}>{platformName(platform).slice(0, 1)}</span>;
  }

  return (
    <svg className={styles.platformIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

function QuoteGlyph() {
  return (
    <svg className={styles.quoteGlyph} viewBox="0 0 96 72" aria-hidden="true">
      <path d="M12 62c13-8 19-18 19-31V10H8v24h11c0 7-4 13-12 18l5 10Z" />
      <path d="M58 62c13-8 19-18 19-31V10H54v24h11c0 7-4 13-12 18l5 10Z" />
    </svg>
  );
}

function MaturityGlyph({ maturity }: { maturity: InsightSignal["maturity"] }) {
  return <span className={`${styles.maturityIcon} ${styles[`maturityIcon-${maturity}`]}`} aria-hidden="true" />;
}

function signalPlatforms(signal: InsightSignal) {
  return Array.from(new Set(signal.evidence.map((item) => item.platform.toLowerCase())));
}

function SignalPlatformStrip({ signal }: { signal: InsightSignal }) {
  const platforms = signalPlatforms(signal);

  return (
    <span className={styles.platformStrip} aria-label="Plataformas con evidencia textual">
      {platforms.map((platform) => (
        <span key={platform} title={platformName(platform)}>
          <PlatformIcon platform={platform} />
        </span>
      ))}
    </span>
  );
}

function findSignal(report: InsightReport, id: string) {
  return report.signals.find((signal) => signal.id === id);
}

function SectionIntro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className={styles.sectionIntro}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}

function PrintChrome({ page, label = "cultural foresight" }: { page: string; label?: string }) {
  return (
    <>
      <div className={styles.printAtmos} aria-hidden="true" />
      <header className={styles.printHeader} aria-hidden="true">
        <div className={styles.printHeaderBrand}>
          <span className={styles.printLogo} />
          <span>· {label}</span>
        </div>
        <div className={styles.printPageNumber}>
          <strong>{page}</strong>
          <span>/ {printTotalPages}</span>
        </div>
      </header>
      <footer className={styles.printFooter} aria-hidden="true">
        noisia · social intelligence architects
      </footer>
    </>
  );
}

function MaturityBadge({
  signal,
  maturity
}: {
  signal?: InsightSignal;
  maturity?: InsightSignal["maturity"];
}) {
  const value = signal?.maturity ?? maturity;

  if (!value) {
    return null;
  }

  const label = signal?.maturity_label ?? maturityCopy[value].title;

  return (
    <span className={`${styles.maturityBadge} ${styles[`maturity-${value}`]}`}>
      <MaturityGlyph maturity={value} />
      {label}
    </span>
  );
}

const actionEmphasisCandidates = [
  "descanso",
  "contenido que da",
  "no-rendimiento",
  "hobby no monetizable",
  "baja exposición",
  "comunidades cerradas",
  "privacidad emocional",
  "reseñas reales",
  "UGC real",
  "transparencia de patrocinio",
  "curar y simplificar",
  "menos SKUs",
  "microinfluencia",
  "conversación distribuida",
  "mexicanidad contemporánea",
  "criterio sobre identidad",
  "catálogo infinito",
  "testimoniales con guión visible",
  "UGC público obligatorio",
  "cliché folclórico",
  "claim oficial",
  "comentarios negativos",
  "microcomunidades",
  "lenguaje propio",
  "detección pública"
];

function actionEmphasis(input: string) {
  const normalized = input.toLowerCase();
  const candidate = actionEmphasisCandidates.find((item) => normalized.includes(item.toLowerCase()));

  if (candidate) {
    const index = normalized.indexOf(candidate.toLowerCase());

    return {
      before: input.slice(0, index),
      match: input.slice(index, index + candidate.length),
      after: input.slice(index + candidate.length)
    };
  }

  const words = input.split(" ");

  return {
    before: "",
    match: words.slice(0, Math.min(2, words.length)).join(" "),
    after: words.length > 2 ? ` ${words.slice(2).join(" ")}` : ""
  };
}

function ActionItem({ item }: { item: string }) {
  const parts = actionEmphasis(item);

  return (
    <li>
      {parts.before}
      <strong>{parts.match}</strong>
      {parts.after}
    </li>
  );
}

function headlineDetailCopy(input: string) {
  if (input.includes("corpus original") || input.includes("cadencia mensual")) {
    return "La conversación aparece con más frecuencia mes a mes: entre 2025 y los primeros meses de 2026 el ritmo creció con claridad.";
  }

  return input;
}

function ChartFigure({
  label,
  title,
  subtitle,
  info,
  children,
  wide = false
}: {
  label: string;
  title: string;
  subtitle: string;
  info: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`${styles.chartSheet} ${wide ? styles.chartSheetWide : ""}`}>
      <header className={styles.chartFigureHeader}>
        <div>
          <span className={styles.chartLabel}>{label}</span>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <details className={styles.chartInfo}>
          <summary>
            <Info size={17} strokeWidth={2} />
            Leer gráfica
          </summary>
          <p>{info}</p>
        </details>
      </header>
      <div className={styles.chartCanvas}>{children}</div>
    </article>
  );
}

function SignalChip({ report, id }: { report: InsightReport; id: string }) {
  const signal = findSignal(report, id);

  if (!signal) {
    return null;
  }

  return (
    <a
      className={styles.signalChip}
      href={`#signal-${signal.order}`}
      style={{ ["--signal-color" as string]: signal.color }}
    >
      {padOrder(signal.order)} {signal.commercial_name}
    </a>
  );
}

function WrappedSignalTitle({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, index) => (
        <span className={styles.titleWord} key={`${word}-${index}`}>
          {word}
        </span>
      ))}
    </>
  );
}

function PrintSignalEvidence({ signal }: { signal: InsightSignal }) {
  const supportingEvidence = signal.evidence.find(
    (item) =>
      item.platform.toLowerCase() !== signal.lead_quote.platform.toLowerCase() ||
      cleanText(item.text, 120) !== cleanText(signal.lead_quote.text, 120)
  ) ?? signal.evidence[0];
  const primaryHeadline = signal.cultural_headlines[0];

  return (
    <aside className={styles.printSignalEvidence} aria-hidden="true">
      {primaryHeadline ? (
        <div className={styles.printSignalEvidenceStat}>
          <strong>{primaryHeadline.value}</strong>
          <span>{primaryHeadline.label}</span>
          <p>{headlineDetailCopy(primaryHeadline.detail)}</p>
        </div>
      ) : null}
      {supportingEvidence ? (
        <blockquote>
          <div className={styles.leadQuoteMeta}>
            <span className={styles.platformMark}>
              <PlatformIcon platform={supportingEvidence.platform} />
              {platformName(supportingEvidence.platform)}
            </span>
            <span>{supportingEvidence.date}</span>
            {supportingEvidence.mx ? <b>MX</b> : null}
          </div>
          <p>&ldquo;{cleanText(supportingEvidence.text, 190)}&rdquo;</p>
        </blockquote>
      ) : null}
    </aside>
  );
}

function SignalCard({ signal }: { signal: InsightSignal }) {
  return (
    <article
      className={styles.signalCard}
      id={`signal-${signal.order}`}
      style={{ ["--signal-color" as string]: signal.color }}
    >
      <PrintChrome page={padOrder(signal.order + 7)} label={`señal ${padOrder(signal.order)}`} />
      <header className={styles.signalHeader}>
        <span className={styles.signalNumber}>{padOrder(signal.order)}</span>
        <div>
          <div className={styles.signalHeaderMeta}>
            <span>Señal {padOrder(signal.order)}</span>
            <MaturityBadge signal={signal} />
          </div>
          <h2>
            <WrappedSignalTitle text={displayCopy(signal.commercial_name)} />
          </h2>
          <p>{displayCopy(signal.one_liner)}</p>
        </div>
      </header>

      <section className={styles.signalTension} aria-label={`Tensión cultural de ${signal.commercial_name}`}>
        <span className="eyebrow">Tensión cultural</span>
        <div>
          <strong>{displayCopy(signal.tension.left === "Tensión real" ? "Lo que pesa pero no se dice" : signal.tension.left)}</strong>
          <span aria-hidden="true">vs</span>
          <strong>{displayCopy(signal.tension.right === "Tensión real" ? "Lo que pesa pero no se dice" : signal.tension.right)}</strong>
        </div>
      </section>

      <blockquote className={styles.leadQuote}>
        <div className={styles.leadQuoteMeta}>
          <span className={styles.platformMark}>
            <PlatformIcon platform={signal.lead_quote.platform} />
            {platformName(signal.lead_quote.platform)}
          </span>
          <span>{signal.lead_quote.attribution}</span>
        </div>
        <p>&ldquo;{cleanText(signal.lead_quote.text, 340)}&rdquo;</p>
        <QuoteGlyph />
      </blockquote>

      <section className={styles.signalReading}>
        <span className="eyebrow">Lectura cultural</span>
        <p>{displayCopy(signal.cultural_reading)}</p>
      </section>

      <section className={styles.headlineGrid} aria-label={`Tres observaciones de ${signal.commercial_name}`}>
        {signal.cultural_headlines.map((headline) => (
          <article className={styles.headlineCard} key={`${signal.id}-${headline.label}`}>
            <strong>{headline.value}</strong>
            <span>{headline.label}</span>
            <p>{headlineDetailCopy(headline.detail)}</p>
            <footer>
              <small>Origen</small>
              <SignalPlatformStrip signal={signal} />
            </footer>
          </article>
        ))}
      </section>
      <PrintSignalEvidence signal={signal} />

      <section className={styles.evidenceSection}>
        <div className={styles.evidenceHeader}>
          <span className="eyebrow">Evidencia textual</span>
          <div className={styles.evidenceSummary}>
            <strong>{signal.volume_indicator.records_analyzed.toLocaleString("es-MX")} menciones revisadas</strong>
            <SignalPlatformStrip signal={signal} />
            <span>{signalPlatforms(signal).length} plataformas con evidencia</span>
          </div>
        </div>
        <ul className={styles.evidenceList} data-reveal-group>
          {signal.evidence.map((item, index) => (
            <li
              className={index % 2 === 0 ? styles.evidenceLeft : styles.evidenceRight}
              key={`${signal.id}-${item.platform}-${item.date}-${index}`}
              style={{ ["--bubble-index" as string]: index }}
            >
              <div className={styles.evidenceMeta}>
                <span className={styles.platformMark}>
                  <PlatformIcon platform={item.platform} />
                  {platformName(item.platform)}
                </span>
                <span>{item.date}</span>
                {item.mx ? <b>MX</b> : null}
              </div>
              <blockquote>
                <span>&ldquo;{cleanText(item.text)}&rdquo;</span>
              </blockquote>
              <footer>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Fuente
                  </a>
                ) : null}
              </footer>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.implicationsGrid}>
        <div className={styles.doPanel}>
          <span className="eyebrow">Qué puedes hacer</span>
          <ul>
            {signal.brand_implications.do.map((item) => (
              <ActionItem item={item} key={item} />
            ))}
          </ul>
        </div>
        <div className={styles.avoidPanel}>
          <span className="eyebrow">Qué deberías evitar</span>
          <ul>
            {signal.brand_implications.avoid.map((item) => (
              <ActionItem item={item} key={item} />
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.categoryBlock}>
        <div>
          <span className="eyebrow">Categorías expuestas</span>
          <ul className={styles.chipList}>
            {signal.brand_implications.categories_exposed.map((item) => (
              <li className={styles.chipOutlined} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="eyebrow">Categorías con oportunidad</span>
          <ul className={styles.chipList}>
            {signal.brand_implications.categories_opportunity.map((item) => (
              <li className={styles.chipFilled} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.monitorBlock}>
        <span className="eyebrow">Qué monitorear después</span>
        <ul className={styles.chipList}>
          {signal.monitor_next.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export function InsightsIndexPage() {
  const [featured] = insightsReports;

  return (
    <>
      <section className={`hero-experience page-hero ${styles.indexHero}`}>
        <div className={`hero-experience__inner page-hero__inner ${styles.indexHeroInner}`}>
          <div className="hero-copy">
            <span className="eyebrow">INSIGHTS</span>
            <h1 className="display-lg">Reportes para leer conversación digital antes de que se vuelva briefing.</h1>
            <p className="body-lg">
              Una biblioteca de estudios editoriales, evidencia trazable y recomendaciones accionables para equipos de
              marketing, planning y marca.
            </p>
            <div className="hero-actions">
              <Button href={`/insights/${featured.slug}`} icon={<ArrowRight size={17} strokeWidth={1.8} />}>
                Leer reporte inaugural
              </Button>
              <Button href="/diagnostico" variant="secondary">
                Iniciar diagnóstico
              </Button>
            </div>
          </div>

          <aside className={styles.indexAside}>
            <span className={styles.chartLabel}>Disponible ahora</span>
            <h2>{featured.meta.study}</h2>
            <p>{featured.meta.subtitle}</p>
            <Link className={styles.reportLinkCard} href={`/insights/${featured.slug}`}>
              Abrir insight <ArrowRight size={16} strokeWidth={1.8} />
            </Link>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className={`section__inner ${styles.indexReportShelf}`}>
          <SectionIntro
            eyebrow="BIBLIOTECA"
            title="Un primer radar para marcas operando en México en 2026."
            lead="El formato combina lectura editorial, señales clasificadas por madurez, evidencia textual y movimientos accionables para equipos comerciales."
          />
          <article className={styles.indexFeatureCard}>
            <span className={styles.chartLabel}>{featured.indexLabel}</span>
            <h3>{featured.meta.study}</h3>
            <p>{featured.meta.subtitle}</p>
            <Button href={`/insights/${featured.slug}`} icon={<ArrowRight size={17} strokeWidth={1.8} />}>
              Leer reporte
            </Button>
          </article>
        </div>
      </section>
    </>
  );
}

export function InsightReportPage({ report }: { report: InsightReport }) {
  const heroNumbers = heroNumberOrder.map((key) => report.hero_numbers[key]).filter(Boolean);
  const heroMetaStats = heroMetaStatOrder.map((key) => report.hero_numbers[key]).filter(Boolean);
  const methodLimitations = report.methodology.limitations.map((item) =>
    item.includes("Mundial") ? "Los eventos de calendario masivo se trataron como contexto externo; no se analizaron como señal." : item
  );

  return (
    <div className="printScope">
      <section className={styles.reportHero} id="cover">
        <PrintChrome page="01" label="cultural foresight" />
        <div className={styles.reportHeroInner}>
          <div className={styles.heroText}>
            <span className="eyebrow">NOISIA · INTELIGENCIA SOCIAL</span>
            <h1>{report.meta.study}</h1>
            <p>{report.meta.subtitle}</p>
            <div className={styles.heroMeta}>
              <span>Mayo 2026</span>
              {heroMetaStats.map((item) => (
                <span className={styles.heroMetaStat} key={item.label}>
                  <strong>{item.value}</strong>
                  {heroMetaLabel(item.label)}
                </span>
              ))}
              <DownloadPrintButton />
            </div>
          </div>

          <aside className={styles.heroVisual} aria-label="Visual editorial del reporte">
            <span>México Foresight 2026</span>
            <strong>Del tener que demostrar al poder respirar</strong>
            <p>8 señales culturales leídas desde conversación digital pública.</p>
          </aside>
        </div>
      </section>

      <nav className={styles.stickyNav} aria-label="Navegación del reporte">
        <div className={styles.stickyNavTrack}>
          {sectionLinks.map((section) => (
            <a className={styles.stickyNavLink} href={`#${section.id}`} key={section.id}>
              {section.label}
            </a>
          ))}
        </div>
      </nav>

      <main className={styles.reportMain}>
        <section className={styles.openingSection} id="opening">
          <PrintChrome page="02" label="contexto" />
          <div className={styles.editorialColumn}>
            <p className={styles.openingLead}>Del Mundial 2026 ya hablarán todos.</p>
            <p>
              Pantallas, cerveza, jerseys, botanas. Este reporte mira lo que no está en el calendario.
            </p>
            <p>
              Los grandes movimientos culturales no son los que se anuncian con fecha. Son los que se construyen en lenguaje
              cotidiano: cómo la gente describe su descanso, su exposición, su confianza, su aspiración y su humor.
            </p>
            <p>
              Este es un radar de esos movimientos. 8 señales detectadas en conversación digital mexicana entre enero 2025 y
              mayo 2026. No son tendencias predichas; son tensiones presentes que ya están en curso.
            </p>
          </div>
        </section>

        <section className={styles.contractSection} id="looked-for">
          <PrintChrome page="03" label="contrato de lectura" />
          <SectionIntro
            eyebrow="Contrato de lectura"
            title="No buscamos tendencias. Buscamos señales."
            lead="Una tendencia se mide en volumen. Una señal se detecta en lenguaje, contradicciones y cambios de vocabulario."
          />
          <div className={styles.contractGrid}>
            <article>
              <h3>Buscamos</h3>
              <ul>
                <li>Frases que se repiten en distintas voces y plataformas.</li>
                <li>Tensiones que aparecen en la conversación cotidiana.</li>
                <li>Contradicciones entre lo que la gente dice y lo que las marcas asumen.</li>
                <li>Cambios de vocabulario que delatan cambios de creencia.</li>
                <li>Comportamientos visibles que aún no tienen nombre.</li>
              </ul>
            </article>
            <article>
              <h3>Lo que no podemos decir</h3>
              <ul>
                <li>No predice el futuro.</li>
                <li>No representa a toda la población mexicana.</li>
                <li>No equipara volumen de menciones con importancia cultural.</li>
              </ul>
            </article>
          </div>
          <div className={styles.maturityFramework}>
            <header className={styles.maturityFrameworkHeader}>
              <span className="eyebrow">Clasificación</span>
              <h3>¿Cómo categorizamos las señales culturales?</h3>
            </header>
            <div className={styles.maturityFrameworkCards}>
              {maturityOrder.map((maturity) => (
                <article key={maturity}>
                  <MaturityBadge maturity={maturity} />
                  <p>{report.methodology.maturity_framework[maturity]}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.radarSection} id="radar">
          <div className={styles.printDeckPage}>
            <PrintChrome page="04" label="radar cultural" />
            <SectionIntro
              eyebrow="Las 8 señales"
              title="Por madurez cultural."
              lead="El radar separa señales emergentes, señales acelerando y señales que ya operan como lenguaje dominante."
            />

            <div className={styles.radarColumns}>
              {maturityOrder.map((maturity) => (
                <article className={styles.radarColumn} key={maturity}>
                  <header>
                    <MaturityBadge maturity={maturity} />
                    <p>{maturityCopy[maturity].note}</p>
                  </header>
                  <ol>
                    {report.signals
                      .filter((signal) => signal.maturity === maturity)
                      .map((signal) => (
                        <li key={signal.id}>
                          <a href={`#signal-${signal.order}`} style={{ ["--signal-color" as string]: signal.color }}>
                            <span>{padOrder(signal.order)}</span>
                            <strong>{signal.commercial_name}</strong>
                            <small>{signal.one_liner}</small>
                          </a>
                        </li>
                      ))}
                  </ol>
                </article>
              ))}
            </div>
          </div>

          <div className={`${styles.chartGrid} ${styles.printDeckPage}`}>
            <PrintChrome page="05" label="lectura visual" />
            <ChartFigure
              label="Radar mix"
              title="La mayoría de las señales ya están acelerando."
              subtitle="Distribución del portafolio cultural por madurez."
              info="El gráfico muestra cuántas señales caen en cada nivel de madurez. La madurez orienta qué tan rápido debería reaccionar una marca."
            >
              <MaturityDistributionChart signals={report.signals} />
            </ChartFigure>
            <ChartFigure
              label="Signal scale"
              title="Dónde hay más conversación revisada."
              subtitle="Menciones revisadas por señal. El volumen orienta contexto; la lectura viene de la densidad cultural."
              info="Esta vista compara la escala de conversación revisada por señal usando el campo volume_indicator del JSON."
            >
              <SignalScaleChart signals={report.signals} />
            </ChartFigure>
          </div>

          <div className={`${styles.chartGrid} ${styles.chartGridSingle} ${styles.printDeckPage}`}>
            <PrintChrome page="06" label="evidencia comparada" />
            <ChartFigure
              label="Lifecycle view"
              title="Dónde está cada señal en su ciclo de vida."
              subtitle="La altura muestra escala de conversación revisada; la posición muestra madurez cultural. Los marcadores MX ayudan a leer el tipo de lenguaje que sostiene cada señal."
              info="Cada punto es una señal cultural. El eje horizontal usa la clasificación de madurez del estudio; el eje vertical usa menciones revisadas del JSON. El tamaño indica fuentes de captura."
              wide
            >
              <SignalEvidenceScatter signals={report.signals} />
            </ChartFigure>
          </div>

          <aside className={`${styles.umbrellaPanel} ${styles.printDeckPage}`}>
            <PrintChrome page="07" label="hipótesis paraguas" />
            <span className="eyebrow">Hipótesis paraguas</span>
            <h2>{displayCopy(report.narrative_umbrella.title)}</h2>
            <p>{displayCopy(report.narrative_umbrella.description)}</p>
            <div className={styles.umbrellaGrid}>
              {report.narrative_umbrella.umbrella_logic.map((tier) => (
                <article key={tier.tier}>
                  <h3>{tier.tier}</h3>
                  <p>{displayCopy(tier.theme)}</p>
                  <div>
                    {tier.signals.map((id) => (
                      <SignalChip report={report} id={id} key={id} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section className={styles.signalStack} aria-label="Señales culturales">
          {report.signals.map((signal) => (
            <SignalCard signal={signal} key={signal.id} />
          ))}
        </section>

        <section className={styles.brandSection} id="brands">
          <PrintChrome page="16" label="movimientos de marca" />
          <SectionIntro
            eyebrow="Qué significa para marcas"
            title="Cinco movimientos para pasar de lectura a decisión."
            lead="Las señales no piden una sola respuesta. Piden ajustar producto, tono, evidencia, participación e identidad."
          />
          <div className={styles.brandGrid}>
            {report.brand_action_map.map((action, index) => (
              <article className={styles.brandCard} key={action.pillar}>
                <span>{padOrder(index + 1)}</span>
                <h3>{action.pillar}</h3>
                <div>
                  <strong>Qué puedes hacer</strong>
                  <p>{displayCopy(action.do)}</p>
                </div>
                <div>
                  <strong>Qué deberías evitar</strong>
                  <p>{displayCopy(action.avoid)}</p>
                </div>
                <footer>
                  {action.signals_relevant.map((id) => (
                    <SignalChip report={report} id={id} key={id} />
                  ))}
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.methodSection} id="methodology">
          <PrintChrome page="17" label="método" />
          <SectionIntro
            eyebrow="Cómo se leyeron las señales"
            title="Método cualitativo, evidencia trazable."
            lead={report.methodology.opening_statement}
          />
          <div className={styles.methodGrid}>
            <article>
              <h3>Principios</h3>
              <ul>
                {report.methodology.principles.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <h3>Corpus</h3>
              <dl>
                <div>
                  <dt>Fuentes</dt>
                  <dd>{report.methodology.corpus.sources_used.join(" · ")}</dd>
                </div>
                <div>
                  <dt>Plataformas</dt>
                  <dd>{report.methodology.corpus.platforms.join(" · ")}</dd>
                </div>
                <div>
                  <dt>Periodo</dt>
                  <dd>{report.methodology.corpus.period}</dd>
                </div>
                <div>
                  <dt>Idioma</dt>
                  <dd>{report.methodology.corpus.language_focus}</dd>
                </div>
                <div>
                  <dt>Escala</dt>
                  <dd>{report.methodology.corpus.volume_scope}</dd>
                </div>
              </dl>
            </article>
          </div>
          <ul className={`${styles.heroStats} ${styles.methodStats}`} aria-label="Snapshot de escala metodológica">
            {heroNumbers.map((item) => (
              <li key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
          <div className={styles.methodChips}>
            {report.methodology.lenses_applied.map((lens) => (
              <MethodologyChip identifier={lens} key={lens} />
            ))}
          </div>
          <div className={styles.limitations}>
            <h3>Limitaciones</h3>
            <ul>
              {methodLimitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.ctaSection} id="cta">
          <PrintChrome page="18" label="siguiente paso" />
          <span className="eyebrow">Foundation Snapshot</span>
          <h2>¿Qué señal está creciendo en tu categoría?</h2>
          <p>
            Este es un radar exploratorio. El siguiente paso es preguntarse, para una categoría específica, cuál de las 8
            señales está cruzando su umbral en este momento y qué debería estar haciendo la marca para no llegar tarde.
          </p>
          <div className="hero-actions">
            <Button href={report.ctaHref} icon={<ArrowRight size={17} strokeWidth={1.8} />}>
              Agendar
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
