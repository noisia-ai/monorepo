"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MethodologyChip } from "@/components/ui/MethodologyIcon";
import { homeUseCases } from "@/content/site";

export function UseCaseSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const paramIndex = Math.min(Math.max(Number(params.get("caso") ?? 1) - 1, 0), homeUseCases.length - 1);
  const [selectedIndex, setSelectedIndex] = useState(paramIndex);
  const selected = homeUseCases[selectedIndex];
  const mobileCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileViewportRef = useRef<HTMLDivElement | null>(null);
  const mobileTabsRef = useRef<HTMLDivElement | null>(null);
  const hasInteractedRef = useRef(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const tabs = useMemo(() => homeUseCases.map((item, index) => ({ ...item, index })), []);

  const markInteracted = () => {
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true;
      setHasInteracted(true);
    }
  };

  const setCase = (index: number) => {
    markInteracted();
    setSelectedIndex(index);
    const next = new URLSearchParams(params.toString());
    next.set("caso", String(index + 1));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    setSelectedIndex(paramIndex);
  }, [paramIndex]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    if (!mobileQuery.matches || hasInteracted) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setSelectedIndex((current) => (current + 1) % homeUseCases.length);
    }, 5200);

    return () => window.clearInterval(interval);
  }, [hasInteracted]);

  useEffect(() => {
    const activeCard = mobileCardRefs.current[selectedIndex];
    const mobileViewport = mobileViewportRef.current;
    if (activeCard && mobileViewport) {
      const centeredLeft = activeCard.offsetLeft - mobileViewport.clientWidth / 2 + activeCard.clientWidth / 2;
      mobileViewport.scrollTo({ left: Math.max(0, centeredLeft), behavior: "smooth" });
    }

    const activeTab = mobileTabRefs.current[selectedIndex];
    const mobileTabs = mobileTabsRef.current;
    if (activeTab && mobileTabs) {
      const centeredLeft = activeTab.offsetLeft - mobileTabs.clientWidth / 2 + activeTab.clientWidth / 2;
      mobileTabs.scrollTo({ left: Math.max(0, centeredLeft), behavior: "smooth" });
    }
  }, [selectedIndex]);

  return (
    <>
      <div className="use-case-selector use-case-selector--desktop glass">
        <div className="use-case-selector__tabs" role="tablist" aria-label="Preguntas de negocio">
          {tabs.map((item) => (
            <button
              aria-selected={selectedIndex === item.index}
              className={selectedIndex === item.index ? "is-active" : ""}
              key={item.slug}
              onClick={() => setCase(item.index)}
              role="tab"
              type="button"
            >
              <span>{String(item.index + 1).padStart(2, "0")}</span>
              {item.shortTitle}
            </button>
          ))}
        </div>
        <div key={selectedIndex} className="use-case-selector__panel solid-panel" role="tabpanel">
          <span className="eyebrow">Lectura activa</span>
          <h3>{selected.title}</h3>
          <p>{selected.reading}</p>
          <div className="tag-list">
            {selected.methodologies.map((methodology) => (
              <MethodologyChip identifier={methodology} key={methodology} compact />
            ))}
          </div>
          <div className="mini-output">
            <strong>Entregables</strong>
            <span>{selected.deliverables.join(" · ")}</span>
          </div>
        </div>
      </div>

      <div className="use-case-carousel use-case-selector--mobile">
        <div className="use-case-carousel__meta glass">
          <span>Protocolo activo</span>
          <strong>{selected.timing}</strong>
        </div>
        <div className="use-case-carousel__tabs" ref={mobileTabsRef} role="tablist" aria-label="Preguntas de negocio">
          {tabs.map((item) => (
            <button
              aria-selected={selectedIndex === item.index}
              className={`glass ${selectedIndex === item.index ? "is-active" : ""}`}
              key={item.slug}
              onClick={() => setCase(item.index)}
              ref={(node) => {
                mobileTabRefs.current[item.index] = node;
              }}
              role="tab"
              type="button"
            >
              <span>{String(item.index + 1).padStart(2, "0")}</span>
              {item.shortTitle}
            </button>
          ))}
        </div>
        <div className="use-case-carousel__viewport" ref={mobileViewportRef} role="tabpanel" aria-live="polite">
          <div className="use-case-carousel__track">
            {tabs.map((item) => (
              <button
                className={`use-case-card glass ${selectedIndex === item.index ? "is-active" : ""}`}
                key={item.slug}
                onClick={() => setCase(item.index)}
                ref={(node) => {
                  mobileCardRefs.current[item.index] = node;
                }}
                type="button"
              >
                <span className="eyebrow">Pregunta {String(item.index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.reading}</p>
                <div className="tag-list">
                  {item.methodologies.map((methodology) => (
                    <MethodologyChip identifier={methodology} key={methodology} compact />
                  ))}
                </div>
                <div className="mini-output">
                  <strong>Entregables</strong>
                  <span>{item.deliverables.join(" · ")}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
