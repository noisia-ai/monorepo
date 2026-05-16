"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { productConsoleScenes } from "@/content/site";
import { ProductConsole } from "@/components/product-scenes/ProductConsole";

const AUTO_ADVANCE_MS = 12000;
const USER_FOCUS_HOLD_MS = 18000;

export function ProductConsoleShowcase() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const lastInteractionRef = useRef(0);

  const alignActiveTab = useCallback(
    (useSmoothScroll = lastInteractionRef.current > 0) => {
      const activeTab = tabRefs.current[selectedIndex];
      const tabs = tabsRef.current;
      if (activeTab && tabs) {
        const centeredLeft = activeTab.offsetLeft - (tabs.clientWidth - activeTab.clientWidth) / 2;
        const maxLeft = tabs.scrollWidth - tabs.clientWidth;
        const targetLeft = Math.max(0, Math.min(centeredLeft, maxLeft));
        if (useSmoothScroll) {
          tabs.scrollTo({ left: targetLeft, behavior: "smooth" });
        } else {
          tabs.scrollLeft = targetLeft;
        }
      }
    },
    [selectedIndex]
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !isVisible) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      if (Date.now() - lastInteractionRef.current < USER_FOCUS_HOLD_MS) {
        return;
      }
      setSelectedIndex((current) => (current + 1) % productConsoleScenes.length);
    }, AUTO_ADVANCE_MS);

    return () => window.clearInterval(interval);
  }, [isVisible]);

  useEffect(() => {
    const fastTimer = window.setTimeout(() => alignActiveTab(false), 20);
    const settledTimer = window.setTimeout(() => alignActiveTab(false), 220);

    return () => {
      window.clearTimeout(fastTimer);
      window.clearTimeout(settledTimer);
    };
  }, [alignActiveTab]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const handleResize = () => alignActiveTab(false);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [alignActiveTab, isVisible]);

  const markInteracted = () => {
    lastInteractionRef.current = Date.now();
  };

  const selectScene = (index: number) => {
    markInteracted();
    setSelectedIndex(index);
  };

  const getSceneState = (index: number) => {
    const previousIndex = (selectedIndex - 1 + productConsoleScenes.length) % productConsoleScenes.length;
    const nextIndex = (selectedIndex + 1) % productConsoleScenes.length;

    if (index === selectedIndex) {
      return "is-active";
    }
    if (index === previousIndex) {
      return "is-prev";
    }
    if (index === nextIndex) {
      return "is-next";
    }
    return "is-hidden";
  };

  return (
    <div className="product-console-showcase" ref={rootRef}>
      <div className="product-console-showcase__tabs-viewport" ref={tabsRef} role="tablist" aria-label="Ejemplos de reportes Noisia">
        <div className="product-console-showcase__tabs-track">
          {productConsoleScenes.map((scene, index) => (
            <button
              aria-selected={selectedIndex === index}
              className={`glass ${selectedIndex === index ? "is-active" : ""}`}
              key={scene.slug}
              onClick={() => selectScene(index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              type="button"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {scene.tab}
            </button>
          ))}
        </div>
      </div>

      <div
        className="product-console-showcase__viewport"
        onPointerDown={markInteracted}
        onWheel={markInteracted}
        role="tabpanel"
        aria-live="polite"
      >
        <div className="product-console-showcase__track">
          {productConsoleScenes.map((scene, index) => (
            <div
              aria-hidden={selectedIndex !== index}
              className={getSceneState(index)}
              key={scene.slug}
            >
              <ProductConsole scene={scene} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
