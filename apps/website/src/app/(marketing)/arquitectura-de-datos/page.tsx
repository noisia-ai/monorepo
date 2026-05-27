import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ArchitectureCounters } from "@/components/marketing/ArchitectureCounters";
import { ArchitectureFlow } from "@/components/marketing/ArchitectureFlow";
import { QueryEvidenceTrace } from "@/components/marketing/QueryEvidenceTrace";
import { SourcesConstellation } from "@/components/marketing/SourcesConstellation";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Arquitectura de datos",
  description: "Cómo Noisia construye evidencia confiable antes de recomendar una decisión.",
  path: "/arquitectura-de-datos"
});

const runtimeNotes = [
  {
    title: "La señal entra con contexto",
    detail: "Cada mención conserva fuente, fecha, mercado y razón por la que importa."
  },
  {
    title: "Todo se puede comparar",
    detail: "Convertimos formatos distintos en una base común para no mezclar ruido con señal."
  },
  {
    title: "La salida conserva la cita",
    detail: "Cada hallazgo puede volver a la frase original que lo sostiene."
  },
  {
    title: "La muestra responde a la pregunta",
    detail: "No escuchamos todo por default. Elegimos las fuentes que ayudan a decidir."
  }
];

const traceProof = [
  {
    label: "Base comparable",
    detail: "Reviews, redes, audio, texto largo o comunidades terminan bajo el mismo criterio."
  },
  {
    label: "Evidencia conectada",
    detail: "La recomendación no se despega de las citas, tags y fuentes que la explican."
  },
  {
    label: "Salida verificable",
    detail: "Reporte, source drawer y export comparten el mismo rastro de evidencia."
  }
];

const sourceFamilies = [
  {
    title: "Volumen abierto",
    detail: "Redes, comunidades y foros donde aparece fricción temprana, códigos emergentes o adopción real."
  },
  {
    title: "Decisión explícita",
    detail: "Reviews, Q&A y marketplaces donde el usuario ya está comparando, dudando o defendiendo una elección."
  },
  {
    title: "Contexto largo",
    detail: "Podcasts, video, newsletters y documentos donde la conversación explica motivos y no solo reacciona."
  }
];

const principios = [
  {
    title: "No hackeamos plataformas cerradas",
    detail: "Operamos solo sobre fuentes accesibles bajo sus términos de servicio."
  },
  {
    title: "No forzamos accesos",
    detail: "Si una plataforma cierra el acceso, buscamos el mismo tipo de señal en otro lugar."
  },
  {
    title: "No comprometemos privacidad personal",
    detail: "Trabajamos con conversación pública, no con datos personales identificables."
  },
  {
    title: "No procesamos datos sensibles sin base clara",
    detail: "Si un proyecto requiere otro tipo de dato, se revisa legalmente antes de avanzar."
  }
];

export default function DataArchitecturePage() {
  return (
    <>
      <section className="hero-experience page-hero page-hero--architecture">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">ARQUITECTURA DE DATOS</span>
            <h1 className="display-lg">Una lectura defendible empieza antes del análisis.</h1>
            <p className="body-lg">
              La muestra, las fuentes y las citas se diseñan contra la pregunta. Así cada hallazgo puede explicar
              de dónde salió, por qué importa y qué decisión sostiene.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" variant="primary">
                Diseñar una lectura
              </Button>
              <Button href="#architecture-runtime" variant="secondary">
                Ver cómo funciona
              </Button>
            </div>
            <ArchitectureCounters />
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Qué hace el sistema</span>
            <h2>La confianza no nace del volumen. Nace de poder reconstruir la lectura.</h2>
            <ul className="page-hero-list">
              <li>
                <b>Cada señal conserva contexto</b>
                <span>Fuente, fecha, mercado y formato acompañan la evidencia.</span>
              </li>
              <li>
                <b>Todo se vuelve comparable</b>
                <span>Normalizamos plataformas y formatos bajo un criterio común.</span>
              </li>
              <li>
                <b>La recomendación vuelve a la fuente</b>
                <span>La lectura no queda separada de las citas que la sostienen.</span>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">CÓMO FUNCIONA</span>
            <h2 className="display-md">Lo importante no es solo escuchar. Es ordenar bien lo escuchado.</h2>
            <p className="body-lg">
              El sistema evita que el reporte, las citas y el export cuenten tres versiones distintas de la realidad.
            </p>
          </div>

          <div className="data-architecture-home" id="architecture-runtime">
            <div className="detail-block accent-panel architecture-runtime-copy">
              <span className="chip">Sistema operativo</span>
              <h2>Primero limpiamos la señal. Luego la convertimos en una base que se puede defender.</h2>
              <p>
                Si el orden falla, el análisis también falla: terminas comparando formatos incompatibles o tomando
                una métrica suelta como si fuera explicación.
              </p>
              <ul className="architecture-runtime-list">
                {runtimeNotes.map((note) => (
                  <li key={note.title}>
                    <strong>{note.title}</strong>
                    <span>{note.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            <ArchitectureFlow />
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="architecture-trace-layout">
            <div className="architecture-trace-copy">
              <span className="eyebrow">TRAZABILIDAD</span>
              <h2 className="display-md">Una respuesta seria puede volver a la fuente que la sostiene.</h2>
              <p className="body-lg">
                No separamos narrativa y evidencia. La lectura final conserva citas, patrones y razones para que el
                equipo pueda discutir la decisión con respaldo.
              </p>
              <div className="architecture-trace-proof">
                {traceProof.map((item) => (
                  <article className="glass architecture-proof-card" key={item.label}>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
            </div>

            <QueryEvidenceTrace />
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="architecture-source-layout">
            <div className="architecture-source-copy">
              <span className="eyebrow">COBERTURA ORQUESTADA</span>
              <h2 className="display-md">La conversación que importa rara vez vive en un solo lugar.</h2>
              <p className="body-lg">
                Combinamos fuentes cuando aportan señal y descartamos las que solo agregan volumen. La mezcla cambia
                por pregunta, no por costumbre.
              </p>
              <div className="architecture-source-families">
                {sourceFamilies.map((family) => (
                  <article className="glass architecture-source-family" key={family.title}>
                    <strong>{family.title}</strong>
                    <p>{family.detail}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="glass architecture-source-panel">
              <div className="architecture-source-panel__head">
                <span className="chip">Tipos de fuente</span>
                <p>
                  El set final depende de la pregunta. Esto es lo que podemos orquestar hoy sin comprometer
                  calidad ni acceso responsable.
                </p>
              </div>
              <SourcesConstellation />
              <div className="architecture-source-panel__footer">
                <span className="chip">Si un acceso cae</span>
                <p>Buscamos señal equivalente. No rellenamos el vacío con ruido para proteger una cobertura ficticia.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="section__inner">
          <div className="architecture-guardrails glass">
            <div className="architecture-guardrails__head">
              <ShieldCheck size={26} strokeWidth={1.6} />
              <div>
                <span className="eyebrow">GUARDRAILS OPERATIVOS</span>
                <h2>También importa lo que decidimos no hacer.</h2>
              </div>
            </div>
            <p className="architecture-guardrails__intro">
              La calidad de una lectura depende de cómo se construye la muestra y de cómo se accede a las fuentes.
            </p>
            <div className="architecture-guardrails__grid">
              {principios.map((p) => (
                <div className="architecture-guardrail-card" key={p.title}>
                  <span className="architecture-guardrail-card__icon" aria-hidden="true">No</span>
                  <div>
                    <strong>{p.title}</strong>
                    <p>{p.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="architecture-guardrails__footer">
              <p>
                Si la pregunta requiere otra mezcla de fuentes, la diseñamos. Lo que no cambia es el estándar:
                evidencia comparable, acceso responsable y salida verificable.
              </p>
              <Button href="/diagnostico" variant="secondary">
                Diseñar una lectura
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
