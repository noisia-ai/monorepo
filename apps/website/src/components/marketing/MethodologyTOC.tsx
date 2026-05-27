"use client";

import { useEffect, useState } from "react";

type TocSection = { id: string; label: string };

const ALL_SECTIONS: TocSection[] = [
  { id: "fundamentos", label: "Fundamentos científicos" },
  { id: "problema", label: "El problema" },
  { id: "como-opera", label: "Cómo opera" },
  { id: "cuando-aplica", label: "Cuándo aplica" },
  { id: "que-se-entrega", label: "Qué se entrega" },
  { id: "casos", label: "Casos relacionados" },
  { id: "lectura", label: "Lectura recomendada" },
];

type Props = {
  hasCuando?: boolean;
  hasCasos?: boolean;
};

export function MethodologyTOC({ hasCuando = true, hasCasos = true }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const sections = ALL_SECTIONS.filter((s) => {
    if (s.id === "cuando-aplica" && !hasCuando) return false;
    if (s.id === "casos" && !hasCasos) return false;
    return true;
  });

  useEffect(() => {
    const handleScroll = () => {
      const mainEl = document.querySelector<HTMLElement>(".detail-main");
      if (!mainEl) return;
      const rect = mainEl.getBoundingClientRect();
      const scrolled = Math.max(0, -rect.top);
      const total = mainEl.offsetHeight - window.innerHeight;
      setProgress(total > 0 ? Math.min(100, (scrolled / total) * 100) : 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { threshold: 0.15, rootMargin: "-12% 0px -62% 0px" }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCuando, hasCasos]);

  return (
    <nav className="toc-panel glass" aria-label="Tabla de contenidos">
      <div className="toc-header">
        <span className="eyebrow">EN ESTA PÁGINA</span>
        <div className="toc-progress-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="toc-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <ul className="toc-list">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={`toc-link${active === section.id ? " is-active" : ""}`}
            >
              <span className="toc-link__dot" aria-hidden="true" />
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
