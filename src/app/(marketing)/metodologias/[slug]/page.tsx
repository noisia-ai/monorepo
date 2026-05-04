import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MethodologySignature } from "@/components/marketing/MethodologySignature";
import { ProcessTrace, type ProcessStep } from "@/components/marketing/ProcessTrace";
import { methodologies, useCases } from "@/content/site";

type MethodologyDetailProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return methodologies.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: MethodologyDetailProps) {
  const { slug } = await params;
  const methodology = methodologies.find((m) => m.slug === slug);
  return {
    title: methodology ? methodology.name : "Metodología",
    description: methodology?.lead
  };
}

// Hero stat chips — sin timing. Sólo dimensiones del método y rigor del corpus.
const heroStats: Record<string, Array<{ label: string; value: string }>> = {
  "triggers-y-barriers": [
    { value: "1K–15K", label: "señales codificadas" },
    { value: "100%", label: "supervisado" },
    { value: "12+", label: "industrias validadas" }
  ],
  "value-perception-matrix": [
    { value: "2K–20K", label: "señales codificadas" },
    { value: "4–6", label: "dimensiones de valor" },
    { value: "8+", label: "industrias validadas" }
  ],
  "cultural-codes-decoding": [
    { value: "3K–25K", label: "señales densas" },
    { value: "5–8", label: "fuentes culturales" },
    { value: "15+", label: "industrias validadas" }
  ],
  "decision-velocity": [
    { value: "1K–12K", label: "narrativas analizadas" },
    { value: "S1 / S2", label: "diagnóstico cognitivo" },
    { value: "10+", label: "industrias validadas" }
  ],
  "journey-friction-mapping": [
    { value: "2K–18K", label: "señales codificadas" },
    { value: "4", label: "tipos de fricción" },
    { value: "12+", label: "industrias validadas" }
  ],
  "influence-architecture": [
    { value: "5K–30K", label: "nodos mapeados" },
    { value: "4–8", label: "comunidades" },
    { value: "8+", label: "industrias validadas" }
  ]
};

// Step subtitles per methodology — descripciones por paso, sin durations.
const protocolSteps: Record<string, ProcessStep[]> = {
  "triggers-y-barriers": [
    { name: "Jobs landscape", description: "Mapeamos motivaciones funcionales, emocionales y sociales de la categoría — no las que aparecen en focus group, las que viven en conversación espontánea." },
    { name: "Queryficación", description: "Convertimos hipótesis en queries de escucha social. Combinación de intenciones, acciones y contexto de marca." },
    { name: "Codificación", description: "NLP supervisado. Cada expresión etiquetada como trigger o barrier y subclasificada por dimensión." },
    { name: "Cuantificación", description: "Frecuencia, intensidad lingüística y capacidad predictiva. La fuerza no es el conteo plano." },
    { name: "Traducción a acción", description: "Cada fuerza relevante se convierte en una acción posible en comunicación, producto o experiencia." }
  ],
  "value-perception-matrix": [
    { name: "Frame competitivo real", description: "Reconstruimos el conjunto competitivo desde la conversación, no desde el que define el cliente." },
    { name: "Dimensiones de valor", description: "Extraemos las dimensiones que el consumidor usa para evaluar — funcionales, emocionales y simbólicas." },
    { name: "Codificación por dimensión", description: "Cada mención codificada por dimensión y polaridad: positiva, negativa, mixta." },
    { name: "Matriz + gaps", description: "Construimos la matriz marca×dimensión y detectamos gaps, permisos desaprovechados y whitespaces." },
    { name: "Traducción defensiva", description: "Cada gap se convierte en argumento para defender margen o reposicionar narrativa." }
  ],
  "cultural-codes-decoding": [
    { name: "Fuentes densas", description: "Orquestamos foros, comunidades, comentarios largos y lenguaje vernáculo — donde el código vive." },
    { name: "Vocabulario emergente", description: "Identificamos palabras, metáforas y comparaciones recurrentes. El código aparece en el lenguaje antes que en la encuesta." },
    { name: "Oposiciones binarias", description: "Mapeamos qué se legitima vs qué se rechaza, qué es auténtico vs artificial." },
    { name: "Sistema de código", description: "Reconstruimos el código completo: qué permite, qué cancela, qué transgrede." },
    { name: "Posicionamiento", description: "Ubicamos marcas y competidores dentro del código, detectamos posiciones vacantes con permiso real." }
  ],
  "decision-velocity": [
    { name: "Narrativas de decisión", description: "Reconstruimos decisiones reales desde conversaciones espontáneas, no desde encuestas recordadas." },
    { name: "Codificación temporal", description: "Tiempos, actores consultados, información buscada y momento del click codificados por etapa." },
    { name: "Diagnóstico cognitivo", description: "Diagnosticamos si domina Sistema 1 o Sistema 2 por segmento de consumidor." },
    { name: "Velocity map", description: "Detectamos velocity blockers y velocity accelerators con frecuencia e impacto." },
    { name: "Choice architecture", description: "Recomendamos arquitectura de elección: opciones, mensajes, secuencias y CTAs." }
  ],
  "journey-friction-mapping": [
    { name: "Etapas reales", description: "Reconstruimos el journey tal como el consumidor lo vive, no como el equipo lo diseñó." },
    { name: "Codificación por fricción", description: "Inercia, esfuerzo, emoción y reactancia codificadas por etapa y touchpoint." },
    { name: "Break points", description: "Detectamos los puntos donde la fricción es más densa o más decisiva en el abandono." },
    { name: "Cruce con touchpoints", description: "Cruzamos fricciones detectadas con los touchpoints bajo control de la marca." },
    { name: "Priorización", description: "Por frecuencia, capacidad de abortar la decisión y costo de eliminación." }
  ],
  "influence-architecture": [
    { name: "Comunidades", description: "Mapeamos las comunidades de conversación relevantes alrededor de la categoría." },
    { name: "Centralidad", description: "Calculamos centralidad de grado, betweenness y eigenvector para cada nodo." },
    { name: "Tipificación", description: "Innovator, early adopter, validator, connector, dissenter y gatekeeper asignados por evidencia." },
    { name: "Propagación", description: "Reconstruimos cómo se propagan narrativas reales para entender qué nodos mueven significado." },
    { name: "Priorización estratégica", description: "Nodos a activar, monitorear o investigar según la pregunta del cliente." }
  ]
};

// Techy deliverables — el tier diferenciador. Igual para todas las metodologías.
const techDeliverables = [
  {
    name: "Dashboard interactivo",
    description: "Un panel propio de Noisia donde tu equipo navega el corpus, filtra por dimensión y ve el output vivo, no congelado en un PDF.",
    chip: "Web app"
  },
  {
    name: "Corpus tagueado en JSON",
    description: "Cada señal etiquetada por dimensión, polaridad, fuente y peso. Listo para que tus pipelines internas lo consuman.",
    chip: "JSON estructurado"
  },
  {
    name: "AI-Brief (.md)",
    description: "Briefing markdown denso, escrito para que las IAs de tu equipo lo carguen como contexto y respondan con criterio Noisia.",
    chip: ".md / context"
  },
  {
    name: "Webhooks de actualización",
    description: "Eventos en tiempo real cuando el corpus cambia o aparecen señales nuevas. Tu stack se entera, no tu equipo.",
    chip: "Webhook / API"
  }
];

const traditionalFormats = ["PDF dossier", "Deck presentable", "Notion playbook", "Figjam colaborable", "Sheet priorizado"];

const whenToUse: Record<string, { yes: string[]; no: string[] }> = {
  "triggers-y-barriers": {
    yes: [
      "Lanzamiento de producto donde la categoría ya existe",
      "Optimización de funnel cuando ya tienes tracción",
      "Comunicación que necesita activar comportamiento",
      "Defensa competitiva cuando estás perdiendo share",
      "Repositioning motivacional"
    ],
    no: [
      "Necesitas tamaño de mercado → encuesta cuanti",
      "Necesitas testear concepto específico → testing",
      "La categoría no existe aún → market entry + cultural codes",
      "Quieres entender el journey, no la decisión → Journey Friction Mapping"
    ]
  },
  "value-perception-matrix": {
    yes: [
      "Reposicionamiento de marca existente",
      "Defensa de margen contra competidor más barato",
      "Evaluación de propuesta de valor post-lanzamiento",
      "Expansión de portafolio en categoría conocida"
    ],
    no: [
      "Necesitas elasticidad de precio → conjoint o test cuanti",
      "Entrando a categoría nueva → Cultural Codes primero",
      "Necesitas share y tamaño de mercado → datos secundarios o cuanti"
    ]
  },
  "cultural-codes-decoding": {
    yes: [
      "Entrada a mercado donde la categoría opera con código local",
      "Repositioning profundo de marca con herencia cargada",
      "Transferibilidad de campañas globales a mercados locales",
      "Lanzamiento en categoría con carga simbólica alta"
    ],
    no: [
      "Necesitas números de adopción → cuanti",
      "El código es irrelevante para tu categoría → Triggers & Barriers es más directo",
      "Buscas resultados sin lectura cualitativa → método incompatible"
    ]
  },
  "decision-velocity": {
    yes: [
      "Optimización de checkout o funnel de conversión",
      "Diseño de UX para decisiones de alto esfuerzo",
      "Lanzamientos en categorías con velocidad inusual",
      "Comparadores de precio o configuradores complejos"
    ],
    no: [
      "Necesitas validar hipótesis con A/B → esta metodología genera hipótesis, no las valida",
      "La fricción es del producto, no de la decisión → Journey Friction Mapping",
      "La velocidad del mercado no es el problema central"
    ]
  },
  "journey-friction-mapping": {
    yes: [
      "Optimización de conversión con datos de abandono sin causa",
      "Rediseño de experiencia de onboarding o compra",
      "Defensa de share cuando el journey de la competencia es mejor",
      "Expansión a canales nuevos"
    ],
    no: [
      "Necesitas usability testing observacional → fricciones invisibles requieren otro método",
      "La fricción es de motivación, no de experiencia → Triggers & Barriers primero",
      "Ya tienes el journey mapeado y solo necesitas priorizar → Process Trace directo"
    ]
  },
  "influence-architecture": {
    yes: [
      "Estrategia de lanzamiento en categoría con nodos especializados",
      "Defensa reputacional con crisis de narrativa activa",
      "Detección de tendencias emergentes antes de mainstream",
      "Campañas de influencia con ROI de activación real"
    ],
    no: [
      "Necesitas solo métricas de engagement → herramientas de listening estándar",
      "La influencia de tu categoría es masiva y obvia → ahí el mapa no aporta",
      "No tienes recursos para activar los nodos que identifiques"
    ]
  }
};

const foundationsSubtitle: Record<string, string> = {
  "triggers-y-barriers": "Lo que la psicología de la decisión y la teoría del cambio ya validaron.",
  "value-perception-matrix": "La tradición intelectual del valor percibido, prospect theory y brand equity.",
  "cultural-codes-decoding": "Semiótica estructural, mitologías y descripción densa aplicadas al consumo.",
  "decision-velocity": "Dual-Process, choice architecture y decision fatigue como sistema operativo.",
  "journey-friction-mapping": "Friction theory, behavioral inhibition y diseño centrado en abandono.",
  "influence-architecture": "Análisis de redes sociales y diffusion of innovations sobre conversación real."
};

export default async function MethodologyDetailPage({ params }: MethodologyDetailProps) {
  const { slug } = await params;
  const methodology = methodologies.find((m) => m.slug === slug);
  if (!methodology) notFound();

  const stats = heroStats[slug] ?? [];
  const protocol = protocolSteps[slug] ?? methodology.protocol.map((p, i) => ({ name: `Movimiento ${i + 1}`, description: p }));
  const when = whenToUse[slug];
  const foundationLead = foundationsSubtitle[slug] ?? "El criterio académico que sostiene el rigor de esta metodología.";

  const relatedCases = useCases.filter((uc) =>
    uc.methodologies.some((m) => m.toLowerCase().includes(methodology.name.split(" ")[0].toLowerCase()))
  ).slice(0, 3);

  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero-experience method-detail-hero">
        <div className="hero-experience__inner method-detail-hero__inner">
          <div className="hero-copy">
            <span className="eyebrow">METODOLOGÍA {methodology.number}</span>
            <h1 className="display-lg">{methodology.name}</h1>
            <p className="body-lg">{methodology.lead}</p>
            <p className="method-question">{methodology.question}</p>
            {stats.length > 0 && (
              <div className="method-stats-strip">
                {stats.map((s) => (
                  <div className="method-stat glass" key={s.label}>
                    <strong>{s.value}</strong>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="method-hero-diagram glass" aria-hidden="true">
            <span className="method-hero-diagram__number">{methodology.number}</span>
            <MethodologySignature slug={methodology.slug} />
            <span className="method-hero-diagram__caption">Firma metodológica</span>
          </div>
        </div>
      </section>

      {/* ─── 1. Problema (top priority) ────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <article className="detail-block accent-panel method-problem">
            <span className="eyebrow">EL PROBLEMA QUE RESUELVE</span>
            <h2>{methodology.question}</h2>
            <p>{methodology.problem}</p>
          </article>
        </div>
      </section>

      {/* ─── 2. Cómo funciona, paso a paso ─────────────────────────────────── */}
      <section className="section">
        <div className="section__inner">
          <div className="method-protocol-grid">
            <aside className="method-protocol-intro">
              <span className="eyebrow">CÓMO FUNCIONA, PASO A PASO</span>
              <h2>El protocolo en {protocol.length} movimientos.</h2>
              <p>
                Cada movimiento está diseñado para que la lectura no dependa del intérprete: el corpus,
                la codificación y la traducción a decisión son trazables hasta la fuente original.
              </p>
              <div className="method-protocol-meta">
                <strong>TRAZABILIDAD TOTAL</strong>
                <span>
                  Cada output regresa a la cita original. Nada se pierde entre el dato y la decisión que
                  termina en presentación de cliente.
                </span>
              </div>
            </aside>
            <div className="method-protocol-trace glass">
              <ProcessTrace steps={protocol} variant="codification" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── 3. Qué te llevas (techy first, traditional below) ────────────── */}
      <section className="section">
        <div className="section__inner">
          <header className="method-section-header">
            <span className="eyebrow">QUÉ TE LLEVAS</span>
            <h2>El output no es un PDF. Es un sistema vivo.</h2>
            <p>
              Cada metodología termina en un dashboard propietario, un corpus que tu stack puede leer y un brief
              estructurado para que tus IAs internas tengan contexto Noisia. Lo tradicional sigue disponible — solo
              dejó de ser el centro.
            </p>
          </header>

          <div className="deliverables-tier deliverables-tier--primary">
            {techDeliverables.map((item) => (
              <article className="deliverable-card glass" key={item.name}>
                <span className="chip deliverable-card__chip">{item.chip}</span>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <aside className="deliverables-tier deliverables-tier--secondary glass">
            <div className="deliverables-tier__head">
              <span className="eyebrow">Y TODO EXPORTABLE A</span>
              <h4>Si tu equipo prefiere los formatos tradicionales, también.</h4>
            </div>
            <div className="deliverables-tier__formats">
              {traditionalFormats.map((fmt) => (
                <span className="chip" key={fmt}>{fmt}</span>
              ))}
              {methodology.outputs.slice(0, 3).map((out) => (
                <span className="chip" key={out}>{out}</span>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* ─── 4. Cuándo aplica / cuándo no ──────────────────────────────────── */}
      {when && (
        <section className="section section--compact">
          <div className="section__inner">
            <header className="method-section-header method-section-header--centered">
              <span className="eyebrow">CUÁNDO ENTRA Y CUÁNDO NO</span>
              <h2>Honestidad metodológica.</h2>
              <p>No todo brief necesita {methodology.name}. Esta es la línea editorial.</p>
            </header>
            <div className="when-block">
              <div className="when-block__col when-block__col--yes glass">
                <h3>Cuándo {methodology.name} responde tu pregunta</h3>
                <ul>
                  {when.yes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="when-block__col when-block__col--no solid-panel">
                <h3>Cuándo otra cosa responde mejor</h3>
                <ul>
                  {when.no.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── 5. Casos relacionados — editorial, no card grid ───────────────── */}
      {relatedCases.length > 0 && (
        <section className="section">
          <div className="section__inner">
            <header className="method-section-header">
              <span className="eyebrow">DONDE YA SE APLICÓ</span>
              <h2>Casos que entraron por esta puerta.</h2>
              <p>Tres situaciones reales donde {methodology.name} fue la lente primaria del protocolo.</p>
            </header>
            <ol className="method-cases-list">
              {relatedCases.map((uc, idx) => {
                const industryShort = uc.industries.split(",")[0].trim();
                return (
                  <li className="method-case-row" key={uc.slug}>
                    <Link className="method-case-row__link" href={`/casos-de-uso/${uc.slug}`}>
                      <span className="method-case-row__index" aria-hidden="true">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="method-case-row__body">
                        <div className="method-case-row__meta">
                          <span className="method-case-row__industry">{industryShort}</span>
                          <span className="method-case-row__sep" aria-hidden="true">·</span>
                          <span className="method-case-row__methods">
                            {uc.methodologies.slice(0, 2).join(" + ")}
                          </span>
                        </div>
                        <h3 className="method-case-row__title">{uc.shortTitle}</h3>
                        <p className="method-case-row__vignette">{uc.vignette}</p>
                      </div>
                      <span className="method-case-row__arrow" aria-hidden="true">→</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      {/* ─── 6. Fundamentos — editorial bibliography, no card grid ──────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <header className="method-section-header">
            <span className="eyebrow">BASES TEÓRICAS</span>
            <h2>De dónde viene el rigor.</h2>
            <p>{foundationLead}</p>
          </header>
          <dl className="method-foundations-list">
            {methodology.foundations.map((f) => (
              <a
                key={f.theory}
                href={f.link}
                target="_blank"
                rel="noopener noreferrer"
                className="method-foundation-row"
              >
                <div className="method-foundation-row__head">
                  <dt className="method-foundation-row__theory">{f.theory}</dt>
                  <span className="method-foundation-row__author">{f.author}</span>
                </div>
                <dd className="method-foundation-row__desc">{f.description}</dd>
                <span className="method-foundation-row__arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </dl>
        </div>
      </section>

      {/* ─── 7. CTA final ─────────────────────────────────────────────────── */}
      <section className="section section--compact">
        <div className="section__inner">
          <div className="no-method-cta glass">
            <div className="no-method-cta__copy">
              <h2>¿Esta es tu pregunta?</h2>
              <p>
                Si lo que tienes enfrente se parece a esto, el diagnóstico define el corpus, las fuentes y el
                alcance — y si {methodology.name} entra sola o en combinación con otra metodología.
              </p>
            </div>
            <Button href="/diagnostico" variant="primary">
              Iniciar diagnóstico
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
