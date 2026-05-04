"use client";

import { useEffect, useRef, useState } from "react";

const counters = [
  { value: 150, suffix: "+", label: "fuentes" },
  { value: 10000, suffix: "+", label: "scrapers" },
  { value: 45, suffix: "+", label: "mercados" },
  { value: 8, suffix: "+", label: "categorías" }
];

function useCountUp(target: number, active: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    const steps = 48;
    const increment = target / steps;
    let current = 0;
    let frame = 0;

    function tick() {
      current = Math.min(current + increment, target);
      setCount(Math.floor(current));
      if (current < target) {
        frame = requestAnimationFrame(tick);
      }
    }

    const delay = setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, 80);

    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(frame);
    };
  }, [active, target]);

  return count;
}

function CounterItem({ value, suffix, label }: (typeof counters)[0]) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = useCountUp(value, active);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="arch-counter-item" ref={ref}>
      <strong>
        {count.toLocaleString()}
        {suffix}
      </strong>
      <span>{label}</span>
    </div>
  );
}

export function ArchitectureCounters() {
  return (
    <div className="arch-counter-strip" aria-label="Métricas de arquitectura">
      {counters.map((c) => (
        <CounterItem key={c.label} {...c} />
      ))}
    </div>
  );
}
