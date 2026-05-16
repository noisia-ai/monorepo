"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { productConsoleScenes } from "@/content/site";
import { ProductConsole } from "@/components/product-scenes/ProductConsole";

export function ProductConsoleShowcase() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const hasInteractedRef = useRef(false);
  const scrollSyncRef = useRef<number | null>(null);

  const alignActiveScene = useCallback(
    (useSmoothScroll = hasInteractedRef.current) => {
      const activeCard = cardRefs.current[selectedIndex];
      const viewport = viewportRef.current;
      if (activeCard && viewport) {
        const maxLeft = viewport.scrollWidth - viewport.clientWidth;
        const targetLeft = Math.max(0, Math.min(activeCard.offsetLeft, maxLeft));
        if (useSmoothScroll) {
          viewport.scrollTo({ left: targetLeft, behavior: "smooth" });
        } else {
          viewport.scrollLeft = targetLeft;
        }
      }

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
    if (reducedMotion || hasInteracted || !isVisible) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setSelectedIndex((current) => (current + 1) % productConsoleScenes.length);
    }, 6200);

    return () => window.clearInterval(interval);
  }, [hasInteracted, isVisible]);

  useLayoutEffect(() => {
    const fastTimer = window.setTimeout(() => alignActiveScene(false), 20);
    const settledTimer = window.setTimeout(() => alignActiveScene(false), 220);

    return () => {
      window.clearTimeout(fastTimer);
      window.clearTimeout(settledTimer);
    };
  }, [alignActiveScene]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const handleResize = () => alignActiveScene(false);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [alignActiveScene, isVisible]);

  useEffect(() => {
    return () => {
      if (scrollSyncRef.current) {
        window.clearTimeout(scrollSyncRef.current);
      }
    };
  }, []);

  const markInteracted = () => {
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true;
      setHasInteracted(true);
    }
  };

  const selectScene = (index: number) => {
    markInteracted();
    setSelectedIndex(index);
  };

  const syncSelectedFromScroll = () => {
    if (!hasInteractedRef.current) {
      return;
    }

    if (scrollSyncRef.current) {
      window.clearTimeout(scrollSyncRef.current);
    }

    scrollSyncRef.current = window.setTimeout(() => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      cardRefs.current.forEach((card, index) => {
        if (!card) {
          return;
        }

        const viewportCenter = viewport.scrollLeft + viewport.clientWidth / 2;
        const cardCenter = card.offsetLeft + card.clientWidth / 2;
        const distance = Math.abs(cardCenter - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setSelectedIndex(closestIndex);
    }, 90);
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
        onScroll={syncSelectedFromScroll}
        onWheel={markInteracted}
        ref={viewportRef}
        role="tabpanel"
        aria-live="polite"
      >
        <div className="product-console-showcase__track">
          {productConsoleScenes.map((scene, index) => (
            <div
              className={selectedIndex === index ? "is-active" : ""}
              key={scene.slug}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
            >
              <ProductConsole scene={scene} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
