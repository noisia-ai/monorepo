import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ArchitectureCounters } from "@/components/marketing/ArchitectureCounters";
import { ArchitectureFlow } from "@/components/marketing/ArchitectureFlow";
import { QueryEvidenceTrace } from "@/components/marketing/QueryEvidenceTrace";
import { SourcesConstellation } from "@/components/marketing/SourcesConstellation";

export const metadata = {
  title: "Arquitectura de datos",
  description: "La infraestructura de Noisia: corpus comparable, evidence graph y salida trazable."
};

const runtimeNotes = [
  {
    title: "La señal entra con contexto",
    detail: "Fuente, fecha, mercado, formato y criterio de inclusión acompañan cada unidad desde el ingreso."
  },
  {
    title: "El método corre sobre corpus",
    detail: "Las seis metodologías operan sobre evidencia comparable. No sobre screenshots, dashboards ni ruido agregado."
  },
  {
    title: "La salida conserva la cita",
    detail: "Cada insight puede volver a la fuente que lo sostiene y conservar criterio, etiqueta y trazabilidad."
  },
  {
    title: "La infraestructura se adapta a la pregunta",
    detail: "No usamos una cobertura por default. Armamos el corpus que la decisión necesita y descartamos lo que distrae."
  }
];

const traceProof = [
  {
    label: "Corpus comparable",
    detail: "Lo que entra desde marketplaces, audio, texto largo o comunidades termina respondiendo al mismo esquema."
  },
  {
    label: "Evidence graph",
    detail: "La narrativa no se despega de la cita. El método deja relaciones, no solo hallazgos sueltos."
  },
  {
    label: "Output verificable",
    detail: "Dashboard, source drawer, chat con data y export comparten el mismo rastro de evidencia."
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
    icon: "✗",
    title: "No hackeamos plataformas cerradas",
    detail: "Operamos solo sobre fuentes accesibles bajo sus términos de servicio."
  },
  {
    icon: "✗",
    title: "No scrapeamos contra ToS",
    detail: "Si una plataforma cierra el acceso, buscamos el mismo tipo de señal en otro lugar."
  },
  {
    icon: "✗",
    title: "No comprometemos privacidad personal",
    detail: "El corpus es conversación pública, no datos personales identificables."
  },
  {
    icon: "✗",
    title: "No operamos sobre datos identificables sin justificación legal",
    detail: "Ningún proyecto procesa PII sin base legal explícita."
  }
];

export default function DataArchitecturePage() {
  return (
    <>
      <section className="hero-experience page-hero page-hero--architecture">
        <div className="hero-experience__inner page-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">INFRAESTRUCTURA</span>
            <h1 className="display-lg">La inteligencia empieza antes del modelo.</h1>
            <p className="body-lg">
              Noisia arma un corpus comparable, lo enriquece con contexto y conserva trazabilidad hasta el output. La
              metodología corre sobre evidencia normalizada, con fuente, tag y razón de inclusión.
            </p>
            <div className="hero-actions">
              <Button href="/diagnostico" variant="primary">
                Diseñar protocolo
              </Button>
              <Button href="#architecture-runtime" variant="secondary">
                Ver runtime
              </Button>
            </div>
            <ArchitectureCounters />
          </div>

          <aside className="page-hero-panel glass">
            <span className="chip">Qué hace el sistema</span>
            <h2>El moat no es una fuente. Es un corpus que sigue siendo defendible al final del recorrido.</h2>
            <ul className="page-hero-list">
              <li>
                <b>Cada señal entra con contexto</b>
                <span>Fuente, fecha, mercado, formato y criterio de inclusión no se pierden a mitad del pipeline.</span>
              </li>
              <li>
                <b>Todo pasa por el mismo esquema</b>
                <span>Normalizamos para comparar plataformas, idiomas y formatos sin mezclar señales incompatibles.</span>
              </li>
              <li>
                <b>La salida vuelve a la evidencia</b>
                <span>Dashboard, source drawer y export comparten el mismo rastro verificable.</span>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          <div className="section-heading">
            <span className="eyebrow">RUNTIME</span>
            <h2 className="display-md">Lo que normalmente queda oculto es justo lo que sostiene la decisión.</h2>
            <p className="body-lg">
              El pipeline no existe para verse sofisticado. Existe para que una lectura narrativa, un source drawer y
              un export compartan el mismo corpus vivo y no tres versiones distintas de la realidad.
            </p>
          </div>

          <div className="data-architecture-home" id="architecture-runtime">
            <div className="detail-block accent-panel architecture-runtime-copy">
              <span className="chip">Pipeline operativo</span>
              <h2>Primero compactamos señal. Luego corremos método sobre evidencia comparable.</h2>
              <p>
                Si cambias el orden, la inteligencia se contamina: comparas formatos incompatibles, tomas sentimiento
                plano por explicación y terminas con dashboards bonitos pero decisiones débiles.
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
              <h2 className="display-md">Una respuesta defendible puede volver a la fuente que la sostiene.</h2>
              <p className="body-lg">
                Noisia no separa la narrativa de la evidencia. La pregunta entra al sistema, se transforma en corpus,
                se enriquece, corre por método y vuelve a salir como cita, patrón y decisión explicable.
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
              <h2 className="display-md">La conversación que decide una categoría nunca vive en un solo lugar.</h2>
              <p className="body-lg">
                Noisia orquesta plataformas cuando sirven, las complementa cuando faltan y descarta las que solo meten
                volumen sin explicación. La mezcla cambia por pregunta, no por costumbre.
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
                  sostenibilidad ni trazabilidad.
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
                <h2>La infraestructura también se define por sus límites.</h2>
              </div>
            </div>
            <p className="architecture-guardrails__intro">
              La calidad del corpus depende de cómo se construye. La sostenibilidad depende de cómo se accede. Ambas
              cosas son parte de la arquitectura, no una nota legal al pie.
            </p>
            <div className="architecture-guardrails__grid">
              {principios.map((p) => (
                <div className="architecture-guardrail-card" key={p.title}>
                  <span className="architecture-guardrail-card__icon" aria-hidden="true">{p.icon}</span>
                  <div>
                    <strong>{p.title}</strong>
                    <p>{p.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="architecture-guardrails__footer">
              <p>
                Si la pregunta requiere una mezcla distinta de fuentes, el protocolo se rediseña. Lo que no cambia es
                el estándar: corpus comparable, acceso sostenible y salida trazable.
              </p>
              <Button href="/diagnostico" variant="secondary">
                Diseñar un protocolo
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
