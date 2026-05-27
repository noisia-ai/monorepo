import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MethodologySignature } from "@/components/marketing/MethodologySignature";
import { ProcessTrace, type ProcessStep } from "@/components/marketing/ProcessTrace";
import { StructuredData } from "@/components/seo/StructuredData";
import { methodologies, useCases } from "@/content/site";
import { SITE_URL, absoluteUrl, breadcrumbJsonLd, createPageMetadata } from "@/lib/seo";

type MethodologyDetailProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return methodologies.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: MethodologyDetailProps) {
  const { slug } = await params;
  const methodology = methodologies.find((m) => m.slug === slug);
  return createPageMetadata({
    title: methodology ? methodology.name : "Metodología",
    description: methodology?.lead ?? "Metodología de Noisia para convertir conversación social en decisiones claras.",
    path: methodology ? `/metodologias/${methodology.slug}` : "/metodologias"
  });
}

// Hero stat chips: dimensiones simples del método.
const heroStats: Record<string, Array<{ label: string; value: string }>> = {
  "triggers-y-barriers": [
    { value: "1K–15K", label: "señales revisadas" },
    { value: "100%", label: "supervisado" },
    { value: "12+", label: "industrias validadas" }
  ],
  "value-perception-matrix": [
    { value: "2K–20K", label: "señales revisadas" },
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
    { value: "2K–18K", label: "señales revisadas" },
    { value: "4", label: "tipos de fricción" },
    { value: "12+", label: "industrias validadas" }
  ],
  "influence-architecture": [
    { value: "5K–30K", label: "nodos mapeados" },
    { value: "4–8", label: "comunidades" },
    { value: "8+", label: "industrias validadas" }
  ]
};

const protocolSteps: Record<string, ProcessStep[]> = {
  "triggers-y-barriers": [
    { name: "Entender la necesidad", description: "Mapeamos qué quiere resolver la gente en la categoría: motivos prácticos, emocionales y sociales." },
    { name: "Escuchar donde aparece", description: "Buscamos conversaciones donde la gente expresa dudas, deseo, rechazo o comparación." },
    { name: "Separar fuerza y freno", description: "Clasificamos cada expresión como algo que acerca a la compra o la bloquea." },
    { name: "Priorizar lo que pesa", description: "No todo lo repetido importa igual. Medimos tamaño, intensidad y capacidad de mover decisión." },
    { name: "Convertirlo en acción", description: "Cada fuerza relevante termina en una decisión de comunicación, producto o experiencia." }
  ],
  "value-perception-matrix": [
    { name: "Reconocer alternativas", description: "Leemos contra qué opciones compara la gente, no solo contra los competidores obvios." },
    { name: "Detectar valor", description: "Identificamos qué entiende el consumidor como valor: ahorro, tiempo, confianza, estatus o menor riesgo." },
    { name: "Comparar por dimensión", description: "Vemos dónde tu marca gana, dónde pierde y dónde no está siendo reconocida." },
    { name: "Encontrar gaps", description: "Ubicamos permisos desaprovechados y argumentos de valor poco claros." },
    { name: "Defender margen", description: "Convertimos esos gaps en argumentos para precio, comunicación o posicionamiento." }
  ],
  "cultural-codes-decoding": [
    { name: "Leer conversaciones densas", description: "Entramos a foros, comunidades y comentarios donde la gente explica más de lo que reacciona." },
    { name: "Detectar lenguaje", description: "Identificamos palabras, metáforas y comparaciones que revelan cómo se entiende la categoría." },
    { name: "Mapear permisos", description: "Vemos qué se admira, qué incomoda, qué se rechaza y qué se considera auténtico." },
    { name: "Armar el código", description: "Reconstruimos las reglas no escritas que ordenan la conversación." },
    { name: "Elegir posición", description: "Ubicamos qué espacio puede ocupar la marca con credibilidad." }
  ],
  "decision-velocity": [
    { name: "Reconstruir la decisión", description: "Leemos cómo la gente decide, qué compara y qué necesita antes de avanzar." },
    { name: "Ubicar momentos de duda", description: "Detectamos en qué etapa aparece la fricción: antes del click, durante la compra o después." },
    { name: "Ver qué acelera", description: "Identificamos pruebas, mensajes o señales que hacen avanzar la decisión." },
    { name: "Ver qué bloquea", description: "Separamos dudas que frenan por riesgo, esfuerzo, precio, confianza o exceso de información." },
    { name: "Reordenar la elección", description: "Recomendamos qué información debe aparecer antes para que la decisión avance." }
  ],
  "journey-friction-mapping": [
    { name: "Reconstruir el camino real", description: "Vemos cómo la gente vive el recorrido, no solo cómo aparece en el mapa interno." },
    { name: "Nombrar fricciones", description: "Clasificamos dudas, esfuerzo, inercia, enojo o confusión por etapa." },
    { name: "Ubicar quiebres", description: "Detectamos dónde la intención se cae antes de convertirse en acción." },
    { name: "Cruzar con touchpoints", description: "Vemos cuáles fricciones puede corregir la marca y cuáles requieren otra estrategia." },
    { name: "Priorizar mejoras", description: "Ordenamos qué remover primero según impacto y costo de resolverlo." }
  ],
  "influence-architecture": [
    { name: "Mapear comunidades", description: "Identificamos dónde se conversa la categoría y qué grupos conectan entre sí." },
    { name: "Encontrar voces clave", description: "No buscamos solo audiencia; buscamos voces que cambian significado o validan ideas." },
    { name: "Clasificar roles", description: "Separamos validadores, conectores, detractores, especialistas y comunidades puente." },
    { name: "Leer propagación", description: "Vemos cómo viajan narrativas entre grupos y quién las vuelve creíbles." },
    { name: "Priorizar acción", description: "Definimos qué voces conviene activar, escuchar o monitorear." }
  ]
};

const techDeliverables = [
  {
    name: "Lectura navegable",
    description: "Un espacio para revisar hallazgos, fuentes, tags y recomendaciones sin perder el hilo de la decisión.",
    chip: "Reporte vivo"
  },
  {
    name: "Evidencia ordenada",
    description: "Cada señal queda etiquetada por fuente, tema, peso y relación con la pregunta.",
    chip: "Base de evidencia"
  },
  {
    name: "Brief listo para equipo",
    description: "Un resumen estructurado para alinear estrategia, marketing, producto o investigación.",
    chip: "Brief listo"
  },
  {
    name: "Actualizaciones si cambia la señal",
    description: "Si aparecen señales nuevas, la lectura puede actualizarse sin empezar desde cero.",
    chip: "Seguimiento"
  }
];

const traditionalFormats = ["PDF dossier", "Deck presentable", "Documento colaborable", "Mapa de trabajo", "Sheet priorizado"];

const whenToUse: Record<string, { yes: string[]; no: string[] }> = {
  "triggers-y-barriers": {
    yes: [
      "Lanzamiento de producto donde la categoría ya existe",
      "Optimización de conversión cuando ya tienes tracción",
      "Comunicación que necesita activar comportamiento",
      "Defensa competitiva cuando estás perdiendo share",
      "Reposicionamiento motivacional"
    ],
    no: [
      "Necesitas tamaño de mercado → encuesta cuantitativa",
      "Necesitas testear un concepto específico → testing",
      "La categoría aún no existe → primero hay que entender el mercado",
      "Quieres entender la experiencia completa → conviene mapear fricción"
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
      "Necesitas elasticidad de precio → estudio cuantitativo",
      "Entrando a categoría nueva → primero hay que leer el código local",
      "Necesitas share y tamaño de mercado → datos secundarios o cuantitativo"
    ]
  },
  "cultural-codes-decoding": {
    yes: [
      "Entrada a mercado donde la categoría opera con código local",
      "Reposicionamiento profundo de marca con herencia cargada",
      "Transferibilidad de campañas globales a mercados locales",
      "Lanzamiento en categoría con carga simbólica alta"
    ],
    no: [
      "Necesitas números de adopción → cuantitativo",
      "El código es irrelevante para tu categoría → conviene leer motivadores y barreras",
      "Buscas resultados sin lectura cualitativa → método incompatible"
    ]
  },
  "decision-velocity": {
    yes: [
      "Optimización de checkout o conversión",
      "Diseño de UX para decisiones de alto esfuerzo",
      "Lanzamientos en categorías con velocidad inusual",
      "Comparadores de precio o configuradores complejos"
    ],
    no: [
      "Necesitas validar hipótesis con A/B → esta lectura genera hipótesis, no las valida",
      "La fricción está en la experiencia → conviene mapear el recorrido",
      "La velocidad del mercado no es el problema central"
    ]
  },
  "journey-friction-mapping": {
    yes: [
      "Optimización de conversión cuando sabes dónde caen, pero no por qué",
      "Rediseño de experiencia de onboarding o compra",
      "Defensa de share cuando la experiencia del competidor se siente mejor",
      "Expansión a canales nuevos"
    ],
    no: [
      "Necesitas observar uso en vivo → conviene usability testing",
      "La fricción es de motivación → conviene leer motivadores y barreras",
      "Ya tienes el recorrido mapeado y solo necesitas priorizar → basta una revisión operativa"
    ]
  },
  "influence-architecture": {
    yes: [
      "Estrategia de lanzamiento en categoría con nodos especializados",
      "Defensa reputacional con crisis de narrativa activa",
      "Detección de tendencias antes de que sean obvias",
      "Campañas de influencia que necesitan más que alcance"
    ],
    no: [
      "Necesitas solo métricas de engagement → herramienta de listening estándar",
      "La influencia de tu categoría es masiva y obvia → ahí el mapa no aporta",
      "No tienes recursos para activar los nodos que identifiques"
    ]
  }
};

const foundationsSubtitle: Record<string, string> = {
  "triggers-y-barriers": "Se apoya en psicología de la decisión y teorías de cambio de comportamiento.",
  "value-perception-matrix": "Se apoya en teoría de valor percibido, riesgo y beneficios de marca.",
  "cultural-codes-decoding": "Se apoya en semiótica, antropología cultural y lectura contextual.",
  "decision-velocity": "Se apoya en teorías de decisión, arquitectura de elección y carga cognitiva.",
  "journey-friction-mapping": "Se apoya en teoría de fricción, experiencia de cliente y abandono.",
  "influence-architecture": "Se apoya en redes, difusión de ideas y roles de influencia."
};

export default async function MethodologyDetailPage({ params }: MethodologyDetailProps) {
  const { slug } = await params;
  const methodology = methodologies.find((m) => m.slug === slug);
  if (!methodology) notFound();

  const stats = heroStats[slug] ?? [];
  const protocol = protocolSteps[slug] ?? methodology.protocol.map((p, i) => ({ name: `Movimiento ${i + 1}`, description: p }));
  const when = whenToUse[slug];
  const foundationLead = foundationsSubtitle[slug] ?? "Las referencias que sostienen el criterio de esta lectura.";

  const relatedCases = useCases.filter((uc) =>
    uc.methodologies.some((m) => m.toLowerCase().includes(methodology.name.split(" ")[0].toLowerCase()))
  ).slice(0, 3);
  const canonicalPath = `/metodologias/${methodology.slug}`;
  const methodologyJsonLd = [
    breadcrumbJsonLd([
      { name: "Noisia", path: "/" },
      { name: "Metodologías", path: "/metodologias" },
      { name: methodology.name, path: canonicalPath }
    ]),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: methodology.name,
      description: methodology.lead,
      url: absoluteUrl(canonicalPath),
      inLanguage: "es-MX",
      isPartOf: {
        "@type": "WebSite",
        name: "Noisia",
        url: SITE_URL
      },
      provider: {
        "@type": "Organization",
        name: "Noisia",
        url: SITE_URL
      },
      about: {
        "@type": "Thing",
        name: methodology.question,
        description: methodology.uses
      },
      mainEntity: {
        "@type": "Service",
        name: methodology.name,
        serviceType: "Social intelligence methodology",
        description: methodology.lead,
        provider: {
          "@type": "Organization",
          name: "Noisia",
          url: SITE_URL
        },
        audience: {
          "@type": "BusinessAudience",
          audienceType: "Brand, product, research and strategy teams"
        },
        additionalProperty: methodology.outputs.slice(0, 4).map((output) => ({
          "@type": "PropertyValue",
          name: "Public output",
          value: output
        }))
      }
    }
  ];

  return (
    <>
      <StructuredData data={methodologyJsonLd} />
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
              <h2>La lectura en {protocol.length} movimientos.</h2>
              <p>
                Cada paso existe para que el hallazgo no dependa de intuición: la señal, la interpretación y la
                recomendación se mantienen conectadas.
              </p>
              <div className="method-protocol-meta">
                <strong>EVIDENCIA A LA VISTA</strong>
                <span>
                  Cada recomendación puede volver a la cita original que la sostiene.
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
            <h2>Una lectura que tu equipo puede usar.</h2>
            <p>
              El entregable combina recomendación, evidencia y formatos prácticos para presentar, discutir o bajar a ejecución.
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
              <p>No toda pregunta necesita {methodology.name}. Aquí marcamos cuándo sí ayuda y cuándo no.</p>
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
              <h2>Preguntas donde este método suele ayudar.</h2>
              <p>Situaciones donde {methodology.name} aporta una lectura clara para decidir.</p>
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
            <h2>De dónde viene el criterio.</h2>
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
                Si lo que tienes enfrente se parece a esto, el diagnóstico define si este método entra solo,
                combinado o si conviene otro camino.
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
