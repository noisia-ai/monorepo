"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

export function LandingMobileCta() {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const contactSection = document.querySelector("#landing-contact");
    if (!contactSection) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHidden(entry.isIntersecting);
      },
      { threshold: 0.01 }
    );

    observer.observe(contactSection);
    return () => observer.disconnect();
  }, []);

  return (
    <a className={`landing-mobile-cta ${isHidden ? "is-hidden" : ""}`} href="#landing-contact">
      Hablar con Noisia <ArrowRight size={16} strokeWidth={1.9} />
    </a>
  );
}
