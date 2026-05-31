"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon } from "@/components/ui/Icon";

export type SignalShellSection = {
  key: string;
  label: string;
  icon?: "platform" | "layers" | "message" | "info" | "wave";
};

export type SignalShellGroup = {
  label?: string;
  sections: SignalShellSection[];
};

type SignalReportShellProps = {
  children: ReactNode;
  defaultUiLanguage?: SignalUiLanguage;
  defaultSection: string;
  groups: SignalShellGroup[];
};

export type SignalUiLanguage = "en" | "es";

type SignalCopyKey =
  | "asideLogo"
  | "navAria"
  | "footerAria"
  | "previous"
  | "next"
  | "start"
  | "endOfReport"
  | "settingsEyebrow"
  | "settingsTitle"
  | "settingsSub"
  | "settingsLanguageTab"
  | "settingsLanguageTitle"
  | "settingsLanguageSub"
  | "settingsEnglish"
  | "settingsEnglishSub"
  | "settingsSpanish"
  | "settingsSpanishSub"
  | "settingsActive";

const SIGNAL_UI_COPY: Record<SignalUiLanguage, Record<SignalCopyKey, string>> = {
  en: {
    asideLogo: "Back to Signal",
    navAria: "Report sections",
    footerAria: "Section navigation",
    previous: "Previous",
    next: "Next",
    start: "Start",
    endOfReport: "End of report",
    settingsEyebrow: "Settings",
    settingsTitle: "Report settings",
    settingsSub: "Control how the published Signal dashboard is displayed. This does not change the analysis payload.",
    settingsLanguageTab: "Language UI",
    settingsLanguageTitle: "Dashboard language",
    settingsLanguageSub: "Choose the interface language for navigation, labels and section copy.",
    settingsEnglish: "English",
    settingsEnglishSub: "Use English UI copy for this dashboard.",
    settingsSpanish: "Español",
    settingsSpanishSub: "Usar textos de interfaz en español.",
    settingsActive: "Active",
  },
  es: {
    asideLogo: "Volver a Signal",
    navAria: "Secciones del reporte",
    footerAria: "Navegación entre secciones",
    previous: "Anterior",
    next: "Siguiente",
    start: "Inicio",
    endOfReport: "Fin del reporte",
    settingsEyebrow: "Configuración",
    settingsTitle: "Configuración del reporte",
    settingsSub: "Controla cómo se muestra el dashboard publicado. Esto no cambia el payload del análisis.",
    settingsLanguageTab: "Idioma UI",
    settingsLanguageTitle: "Idioma del dashboard",
    settingsLanguageSub: "Elige el idioma de la interfaz para navegación, etiquetas y copy de secciones.",
    settingsEnglish: "English",
    settingsEnglishSub: "Usar textos de interfaz en inglés para este dashboard.",
    settingsSpanish: "Español",
    settingsSpanishSub: "Usar textos de interfaz en español.",
    settingsActive: "Activo",
  },
};

const SIGNAL_LABELS_ES: Record<string, string> = {
  Overview: "Overview",
  "Triggers & Barriers": "Triggers & Barriers",
  "Decision Field": "Decision Field",
  Opportunities: "Oportunidades",
  "Competitive Intelligence": "Inteligencia Competitiva",
  "Action Studio": "Action Studio",
  Evidence: "Evidencia",
  "Emerging Patterns": "Emerging Patterns",
  "Source Patterns": "Source Patterns",
  Corpus: "Corpus",
  "Corpus View": "Corpus View",
  "Corpus Chat": "Corpus Chat",
  Quality: "Calidad",
  Boundaries: "Límites",
  Settings: "Configuración",
};

type SignalUiLanguageContextValue = {
  setUiLanguage: (language: SignalUiLanguage) => void;
  t: (key: SignalCopyKey) => string;
  uiLanguage: SignalUiLanguage;
};

const SignalUiLanguageContext = createContext<SignalUiLanguageContextValue | null>(null);

export function useSignalUiLanguage() {
  const context = useContext(SignalUiLanguageContext);
  if (!context) {
    throw new Error("useSignalUiLanguage must be used inside SignalReportShell");
  }
  return context;
}

export function SignalReportShell({
  children,
  defaultUiLanguage = "en",
  defaultSection,
  groups,
}: SignalReportShellProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const flatSections = useMemo(() => groups.flatMap((group) => group.sections), [groups]);
  const sectionKeys = useMemo(() => new Set(flatSections.map((section) => section.key)), [flatSections]);
  const [activeSection, setActiveSection] = useState(defaultSection);
  const [uiLanguage, setUiLanguage] = useState<SignalUiLanguage>(defaultUiLanguage);

  useEffect(() => {
    const stored = window.localStorage.getItem("noisia.signal.uiLanguage");
    if (stored === "en" || stored === "es") {
      setUiLanguage(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("noisia.signal.uiLanguage", uiLanguage);
    document.documentElement.dataset.signalUiLanguage = uiLanguage;
    document.documentElement.lang = uiLanguage === "en" ? "en" : "es-MX";
  }, [uiLanguage]);

  useEffect(() => {
    const resolveHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      if (sectionKeys.has(raw)) return raw;
      if (raw.startsWith("finding-")) return sectionKeys.has("finding-detail") ? "finding-detail" : defaultSection;
      return defaultSection;
    };

    const sync = () => setActiveSection(resolveHash());
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [defaultSection, sectionKeys]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-signal-section]").forEach((section) => {
      const isActive = section.dataset.signalSection === activeSection;
      section.hidden = !isActive;
      section.setAttribute("aria-hidden", String(!isActive));
      section.classList.toggle("is-active", isActive);
    });
    if (activeSection === "finding-detail" && window.location.hash.startsWith("#finding-")) {
      const target = document.getElementById(window.location.hash.slice(1));
      window.requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [activeSection]);

  const navigate = (section: string) => {
    setActiveSection(section);
    if (window.location.hash !== `#${section}`) {
      window.history.pushState(null, "", `#${section}`);
    }
  };
  const activeIndex = Math.max(0, flatSections.findIndex((section) => section.key === activeSection));
  const previousSection = activeIndex > 0 ? flatSections[activeIndex - 1] : null;
  const nextSection = activeIndex >= 0 && activeIndex < flatSections.length - 1 ? flatSections[activeIndex + 1] : null;
  const t = useCallback((key: SignalCopyKey) => SIGNAL_UI_COPY[uiLanguage][key], [uiLanguage]);
  const labelFor = (label: string) => (uiLanguage === "es" ? SIGNAL_LABELS_ES[label] ?? label : label);
  const contextValue = useMemo(
    () => ({ setUiLanguage, t, uiLanguage }),
    [t, uiLanguage],
  );

  return (
    <SignalUiLanguageContext.Provider value={contextValue}>
      <div
        className="signal-report signal-report--sectioned"
        data-active-section={activeSection}
        data-ui-language={uiLanguage}
        ref={rootRef}
      >
        <aside className="signal-aside">
          <Link prefetch={false} href="/signal" className="signal-aside-logo" aria-label={t("asideLogo")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logos/logo_black.svg" alt="Noisia" width={92} height={32} />
            <span>Signal</span>
          </Link>
          <nav className="signal-aside-nav signal-aside-nav--grouped" aria-label={t("navAria")}>
            {groups.map((group, groupIndex) => (
              <div className="signal-aside-group" key={group.label ?? groupIndex}>
                {group.label ? <span>{labelFor(group.label)}</span> : null}
                {group.sections.map((section) => (
                  <button
                    aria-current={activeSection === section.key ? "page" : undefined}
                    className={activeSection === section.key ? "is-active" : undefined}
                    key={section.key}
                    onClick={() => navigate(section.key)}
                    type="button"
                  >
                    {section.icon ? <Icon name={section.icon} size={14} /> : null}
                    {labelFor(section.label)}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="signal-main">
          {children}
          <footer className="signal-section-footer" aria-label={t("footerAria")}>
            <button disabled={!previousSection} onClick={() => previousSection && navigate(previousSection.key)} type="button">
              <span>{t("previous")}</span>
              <strong>{previousSection ? labelFor(previousSection.label) : t("start")}</strong>
            </button>
            <button disabled={!nextSection} onClick={() => nextSection && navigate(nextSection.key)} type="button">
              <span>{t("next")}</span>
              <strong>{nextSection ? labelFor(nextSection.label) : t("endOfReport")}</strong>
            </button>
          </footer>
        </main>
      </div>
    </SignalUiLanguageContext.Provider>
  );
}

export function SignalSettingsPanel() {
  const { setUiLanguage, t, uiLanguage } = useSignalUiLanguage();
  const languages: Array<{
    code: SignalUiLanguage;
    title: SignalCopyKey;
    body: SignalCopyKey;
  }> = [
    { code: "en", title: "settingsEnglish", body: "settingsEnglishSub" },
    { code: "es", title: "settingsSpanish", body: "settingsSpanishSub" },
  ];

  return (
    <div className="signal-settings-panel">
      <header className="signal-sec-head">
        <p className="signal-eyebrow">{t("settingsEyebrow")}</p>
        <h2 className="signal-sec-title">{t("settingsTitle")}</h2>
        <p className="signal-sec-sub">{t("settingsSub")}</p>
      </header>
      <div className="signal-settings-tabs" role="tablist" aria-label={t("settingsTitle")}>
        <button aria-selected="true" role="tab" type="button">
          {t("settingsLanguageTab")}
        </button>
      </div>
      <section className="signal-settings-card" aria-labelledby="signal-language-title">
        <div>
          <p className="signal-eyebrow signal-eyebrow--quiet">{t("settingsLanguageTab")}</p>
          <h3 id="signal-language-title">{t("settingsLanguageTitle")}</h3>
          <p>{t("settingsLanguageSub")}</p>
        </div>
        <div className="signal-language-options">
          {languages.map((language) => {
            const active = uiLanguage === language.code;
            return (
              <button
                aria-pressed={active}
                className={active ? "is-active" : undefined}
                key={language.code}
                onClick={() => setUiLanguage(language.code)}
                type="button"
              >
                <span>
                  <strong>{t(language.title)}</strong>
                  <small>{t(language.body)}</small>
                </span>
                {active ? <b>{t("settingsActive")}</b> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function SignalLocalizedText({ en, es }: { en: ReactNode; es: ReactNode }) {
  const { uiLanguage } = useSignalUiLanguage();
  return <>{uiLanguage === "es" ? es : en}</>;
}
