import { CTA_URL, sectionMarkers } from "../copy";

export const renderClosing = () => `
  <section class="section" id="closing" data-reveal>
    <div class="section__inner">
      <span class="section__marker">${sectionMarkers[7]}</span>
      <div class="closing-block">
        <h2>lo que no te mostramos</h2>
        <p>
          Este análisis cubre 1,131 señales en 90 días con datos de Sprinklr. Un engagement completo con Noisia combina tres capas: orquestación de data multi-fuente — reviews de App Store en los cuatro mercados, foros latinoamericanos donde la conversación es más honesta, Instagram y TikTok de usuarias reales — que aquí no aparecieron; decodificación trimestral con shifts de sentiment medibles por mercado; y playbooks accionables por arquetipo de influencia.
        </p>
        <p class="closing-block__personal">Si algo de esto te sirve aunque sea en parte, me doy por pagado. Si te resonó, hablemos.</p>
        <a class="cta-link" href="${CTA_URL}">Agendar 20 minutos →</a>
        <p class="signature">
          Noisia<br />
          Social Intelligence Architects
        </p>
      </div>
    </div>
  </section>
`;
