import { data } from "../data";
import { toplineMeta } from "../copy";
import cheafLogoUrl from "../../assets/logo_norm.svg";

export const renderHero = () => `
  <header class="hero">
    <div class="hero__inner">
      <div class="hero__topline">Noisia · Social Intelligence Snapshot · Abril 2026</div>
      <div class="hero__copy">
        <h1 class="hero__title hero__title--brand">
          <img class="hero__cheaf-logo" src="${cheafLogoUrl}" alt="Cheaf" />
          <span>Perception Gap</span>
        </h1>
        <div class="hero__finding">
          <div class="hero__ratio-row" aria-label="${data.hero_finding.ratio_calculation}">
            <span class="hero__ratio" data-countup="${data.hero_finding.ratio_value}">0.0</span>
            <span class="hero__ratio-label">críticas por cada recomendación en LATAM</span>
          </div>
          <p class="hero__subline">${data.hero_finding.subline}</p>
          <p class="hero__closer">${data.hero_finding.closer}</p>
          <p class="hero__teaser">Pero ese 2.8 es un promedio. Uno de los mercados tiene un ratio 7 veces peor. Llegamos ahí en tres scrolls.</p>
        </div>
      </div>
      <div class="hero__signature">${toplineMeta}</div>
    </div>
  </header>
`;
