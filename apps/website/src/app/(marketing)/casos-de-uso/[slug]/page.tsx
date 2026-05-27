import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { MethodologySignature } from "@/components/marketing/MethodologySignature";
import { ProcessTrace, type ProcessStep } from "@/components/marketing/ProcessTrace";
import { StructuredData } from "@/components/seo/StructuredData";
import { useCases, type UseCase } from "@/content/site";
import { SITE_URL, absoluteUrl, breadcrumbJsonLd, createPageMetadata } from "@/lib/seo";

type UseCaseDetailProps = {
  params: Promise<{ slug: string }>;
};

type CaseDossier = {
  client: string;
  setup: string;
  tools: string[];
  sources: string[];
  thesis: string;
  editorial: string;
  extraction: string;
  insights: Array<{ label: string; value: string; detail: string }>;
  evidence: Array<{ quote: string; source: string; tag: string }>;
  bars: Array<{ label: string; value: string; width: number; tone?: "tension" | "signal" }>;
  outputs: string[];
  decision: string;
};

export function generateStaticParams() {
  return useCases.map((useCase) => ({ slug: useCase.slug }));
}

export async function generateMetadata({ params }: UseCaseDetailProps) {
  const { slug } = await params;
  const useCase = useCases.find((item) => item.slug === slug);
  return createPageMetadata({
    title: useCase ? useCase.shortTitle : "Caso de uso",
    description: useCase?.approach ?? "Caso de uso de Noisia para convertir conversación social en decisiones de negocio.",
    path: useCase ? `/casos-de-uso/${useCase.slug}` : "/casos-de-uso"
  });
}

const CASE_DOSSIERS: Record<string, CaseDossier> = {
  "lanzamiento-de-campana": {
    client: "Marca de bebidas funcionales entrando a México",
    setup:
      "El equipo tenía tres rutas creativas y un brief global. Lo que faltaba era saber cuál podía sonar local sin volverse cliché.",
    tools: ["Meta Ads", "TikTok", "Brandwatch", "Google Trends", "Notion"],
    sources: ["comentarios de TikTok", "reseñas de retail", "foros de wellness", "videos de consumo"],
    thesis: "La historia con permiso no era la más aspiracional. Era la que nombraba una frustración cotidiana con lenguaje mexicano.",
    editorial:
      "La marca quería hablar de rendimiento. La conversación pedía control: energía sin sentirse atrapado por otra promesa de productividad. El giro no estuvo en inventar un territorio, sino en dejar de importar una ambición global que aquí sonaba prestada.",
    extraction: "Territorios creativos cruzados contra expresiones espontáneas de deseo, cansancio y permiso cultural.",
    insights: [
      { label: "Territorio viable", value: "Cómplice", detail: "Conecta frustración diaria con solución sin moralizar." },
      { label: "Riesgo", value: "Aspiracional genérico", detail: "Aparece mucho en publicidad, poco en conversación orgánica." },
      { label: "Ángulo", value: "Control personal", detail: "La gente no busca más intensidad; busca elegir cuándo activarse." }
    ],
    evidence: [
      { quote: "Si me prometen energía como si yo fuera máquina, me pierden.", source: "TikTok · comentario largo", tag: "cansancio · productividad" },
      { quote: "Quiero algo que me ayude sin ponerme acelerado.", source: "Review retail", tag: "control · confianza" }
    ],
    bars: [
      { label: "Permiso cultural", value: "alto", width: 74, tone: "signal" },
      { label: "Riesgo de cliché", value: "medio", width: 38, tone: "tension" },
      { label: "Claridad de brief", value: "alto", width: 82, tone: "signal" }
    ],
    outputs: ["Brief de territorio", "Mapa de tensión cultural", "Citas para equipo creativo", "Guía de tono"],
    decision: "La campaña se enfocó en control y energía elegida, no en alto rendimiento."
  },
  "optimizacion-de-medios": {
    client: "Ecommerce de skincare con inversión alta en performance",
    setup: "El funnel marcaba abandono, pero no explicaba si fallaba canal, oferta, landing o promesa.",
    tools: ["Shopify", "Klaviyo", "GA4", "Meta Ads", "Hotjar"],
    sources: ["checkout reviews", "comentarios de pauta", "Q&A de producto", "tickets de soporte"],
    thesis: "El mensaje no estaba roto en medios; estaba incompleto justo antes de compra.",
    editorial:
      "La pauta aceleraba a usuarias expertas, pero dejaba a nuevas compradoras sin respuesta sobre riesgo, compatibilidad y reversibilidad. La solución no fue subir frecuencia: fue cambiar qué se decía antes del checkout.",
    extraction: "Dudas previas a compra ordenadas por etapa del journey y nivel de carga cognitiva.",
    insights: [
      { label: "Fricción principal", value: "Riesgo de probar", detail: "La gente entiende el beneficio, pero no qué pasa si no funciona." },
      { label: "Momento crítico", value: "Antes del carrito", detail: "El bloqueo aparece antes de ver precio final." },
      { label: "Mensaje reparable", value: "Prueba segura", detail: "Reaseguro, evidencia y comparación resuelven más que descuento." }
    ],
    evidence: [
      { quote: "Sí quiero probar, pero no sé si me va a irritar y luego ya lo compré.", source: "Comentario en anuncio", tag: "riesgo · piel sensible" },
      { quote: "La página dice ingredientes, pero no me dice si sirve para mí.", source: "Hotjar survey", tag: "compatibilidad · decisión" }
    ],
    bars: [
      { label: "Duda de compatibilidad", value: "alta", width: 68, tone: "tension" },
      { label: "Confianza en prueba", value: "baja", width: 32, tone: "tension" },
      { label: "Interés declarado", value: "alto", width: 79, tone: "signal" }
    ],
    outputs: ["Mapa de fricción", "Cambios de landing", "Mensajes por etapa", "Prioridad de pruebas"],
    decision: "La marca cambió la arquitectura de prueba antes de tocar inversión de medios."
  },
  "desarrollo-de-producto": {
    client: "App financiera buscando nueva funcionalidad",
    setup: "Producto tenía una lista larga de ideas. Ninguna distinguía deseo bonito de necesidad mal resuelta.",
    tools: ["App Store", "Zendesk", "Amplitude", "Slack", "Productboard"],
    sources: ["reviews de app", "tickets", "foros fintech", "búsquedas internas"],
    thesis: "La oportunidad no era una feature más; era reducir el miedo de equivocarse.",
    editorial:
      "Los usuarios no pedían educación financiera en abstracto. Pedían una forma de saber si una decisión pequeña iba a salirles cara. El producto debía traducir riesgo antes que agregar más información.",
    extraction: "Jobs funcionales y emocionales clasificados por frecuencia, intensidad y valor percibido.",
    insights: [
      { label: "Job abierto", value: "Decidir sin castigo", detail: "El usuario quiere simular consecuencias antes de mover dinero." },
      { label: "Barrera", value: "Miedo a error", detail: "La fricción no es interfaz; es costo percibido de equivocarse." },
      { label: "Ruta", value: "Simulación guiada", detail: "Más útil que contenido educativo genérico." }
    ],
    evidence: [
      { quote: "No quiero otro artículo, quiero saber si esto me conviene a mí.", source: "App Store", tag: "personalización · riesgo" },
      { quote: "Me da miedo moverle y que luego no pueda regresarlo.", source: "Ticket soporte", tag: "reversibilidad · confianza" }
    ],
    bars: [
      { label: "Deseo de simulación", value: "alto", width: 76, tone: "signal" },
      { label: "Contenido genérico", value: "bajo", width: 28, tone: "tension" },
      { label: "Riesgo percibido", value: "alto", width: 71, tone: "tension" }
    ],
    outputs: ["Landscape de jobs", "Rutas de concepto", "Priorización de roadmap", "Citas por segmento"],
    decision: "Roadmap priorizó un simulador de decisión antes que una biblioteca educativa."
  },
  "entrada-a-nuevo-mercado": {
    client: "Marca regional preparando entrada a México",
    setup: "El playbook de otro país funcionaba en ventas, pero sonaba ajeno en conversación local.",
    tools: ["SEMrush", "TikTok", "YouTube", "Similarweb", "Sheets"],
    sources: ["creadores locales", "foros de categoría", "comentarios de anuncios", "reviews de competidores"],
    thesis: "El permiso local venía de control y practicidad, no de prestigio importado.",
    editorial:
      "La categoría parecía aspiracional vista desde afuera. Localmente, el exceso se leía como distancia. Entrar mejor implicaba hablar de uso concreto, prueba social y voces que ya traducían la categoría.",
    extraction: "Códigos locales, voces puente y narrativas que activan rechazo o aceptación.",
    insights: [
      { label: "Código viable", value: "Practicidad aspiracional", detail: "Eleva sin parecer presumido." },
      { label: "Voz puente", value: "Creadores técnicos", detail: "Traducen la categoría sin sonar pagados." },
      { label: "Riesgo", value: "Prestigio importado", detail: "Activa distancia cultural." }
    ],
    evidence: [
      { quote: "Se ve padre, pero otra vez marcas hablándonos como si todos viviéramos igual.", source: "TikTok", tag: "distancia · mercado" },
      { quote: "Cuando alguien te enseña cómo usarlo, sí hace sentido.", source: "YouTube comentario", tag: "uso · educación" }
    ],
    bars: [
      { label: "Permiso local", value: "medio-alto", width: 64, tone: "signal" },
      { label: "Riesgo de distancia", value: "alto", width: 69, tone: "tension" },
      { label: "Voces traductoras", value: "alto", width: 78, tone: "signal" }
    ],
    outputs: ["Dossier de código local", "Mapa de voces", "Territorios a evitar", "Brief de entrada"],
    decision: "La entrada cambió de prestigio internacional a utilidad local demostrable."
  },
  reposicionamiento: {
    client: "Marca legacy de cuidado personal",
    setup: "La marca quería rejuvenecer. La conversación sugería que el problema no era edad, sino distancia emocional.",
    tools: ["Talkwalker", "YouTube", "Qualtrics", "Brand tracker", "Miro"],
    sources: ["reviews", "comentarios de campaña", "foros de cuidado", "comparativas de competidores"],
    thesis: "No necesitaba sonar joven. Necesitaba ocupar cuidado confiable sin perder eficiencia.",
    editorial:
      "El reposicionamiento no pedía cambiar personalidad completa. Pedía dejar de hablar como fórmula funcional y recuperar una promesa de cuidado que la categoría había dejado disponible.",
    extraction: "Asociaciones de marca, códigos de categoría y gaps de valor percibido.",
    insights: [
      { label: "Código actual", value: "Eficiencia fría", detail: "Funciona, pero no abraza." },
      { label: "Espacio libre", value: "Cuidado experto", detail: "Confianza emocional con prueba funcional." },
      { label: "Límite", value: "No forzar juventud", detail: "Ser joven sonaba impostado." }
    ],
    evidence: [
      { quote: "Sé que sirve, pero la marca se siente como consultorio viejo.", source: "Foro de cuidado", tag: "marca · distancia" },
      { quote: "Confío más cuando explican sin hablarme como experta.", source: "Review retail", tag: "claridad · confianza" }
    ],
    bars: [
      { label: "Eficiencia percibida", value: "alta", width: 81, tone: "signal" },
      { label: "Calidez", value: "baja", width: 29, tone: "tension" },
      { label: "Credibilidad para cuidado", value: "alta", width: 72, tone: "signal" }
    ],
    outputs: ["Mapa de posición", "Rutas narrativas", "Claims defendibles", "Riesgos de tono"],
    decision: "Reposicionamiento hacia cuidado experto, no rejuvenecimiento decorativo."
  },
  "defensa-competitiva": {
    client: "Servicio digital perdiendo usuarios ante un challenger",
    setup: "El equipo atribuía la pérdida a precio. Los usuarios hablaban de claridad, soporte y trato justo.",
    tools: ["Salesforce", "Zendesk", "Reddit", "Google Reviews", "Looker"],
    sources: ["tickets de cancelación", "reviews del competidor", "foros", "comentarios de app"],
    thesis: "El competidor ganaba porque había convertido soporte en promesa de marca.",
    editorial:
      "La defensa competitiva no salió de comparar features. Salió de leer el lenguaje que justificaba la migración. El usuario no decía 'me fui por barato'; decía 'allá sí me explican'.",
    extraction: "Narrativas de migración cruzadas contra fricciones del journey y promesas competitivas.",
    insights: [
      { label: "Motivo visible", value: "Transparencia", detail: "La claridad pesa más que el precio en menciones de salida." },
      { label: "Promesa rival", value: "Me explican", detail: "El soporte se volvió argumento emocional." },
      { label: "Defensa", value: "Prueba operativa", detail: "Mostrar cómo responde la marca antes de perder usuarios." }
    ],
    evidence: [
      { quote: "No me fui por barato. Me fui porque allá sí explican qué pasa.", source: "Review competidor", tag: "migración · soporte" },
      { quote: "Aquí todo se siente escondido hasta que tienes un problema.", source: "Ticket cancelación", tag: "confianza · transparencia" }
    ],
    bars: [
      { label: "Precio", value: "secundario", width: 34, tone: "tension" },
      { label: "Transparencia", value: "alto", width: 76, tone: "signal" },
      { label: "Soporte como marca", value: "alto", width: 70, tone: "signal" }
    ],
    outputs: ["Mapa de migración", "Brief de defensa", "Mensajes por fricción", "Citas de churn"],
    decision: "La respuesta dejó de competir por descuento y empezó a competir por confianza verificable."
  },
  "validacion-de-hipotesis": {
    client: "Equipo de venture validando una tesis de categoría",
    setup: "La tesis sonaba fuerte en comité, pero no estaba claro si la conversación la sostenía fuera de usuarios expertos.",
    tools: ["Notion", "Pitch deck", "Google Trends", "Reddit", "Crunchbase"],
    sources: ["comunidades nicho", "reseñas de sustitutos", "búsquedas", "discusión de early adopters"],
    thesis: "La hipótesis era cierta, pero solo para usuarios expertos. En compradores nuevos faltaba lenguaje de entrada.",
    editorial:
      "La validación útil no fue decir sí o no. Fue mostrar dónde la tesis tenía evidencia, dónde se rompía y qué tendría que cambiar para volverse mercado.",
    extraction: "Señales a favor y en contra de la tesis, separadas por nivel de familiaridad con la categoría.",
    insights: [
      { label: "Tesis", value: "Parcialmente sostenida", detail: "Fuerte en nicho, débil en entrada." },
      { label: "Bloqueo", value: "Lenguaje experto", detail: "La gente nueva no entiende qué problema resuelve." },
      { label: "Siguiente paso", value: "Reformular target", detail: "Primera fase para usuarios con dolor explícito." }
    ],
    evidence: [
      { quote: "Para mí esto es obvio, pero explicárselo a alguien nuevo cuesta.", source: "Reddit", tag: "experto · adopción" },
      { quote: "No entiendo por qué lo necesito si ya tengo X.", source: "Review sustituto", tag: "comparación · entrada" }
    ],
    bars: [
      { label: "Evidencia en usuarios expertos", value: "alta", width: 82, tone: "signal" },
      { label: "Claridad masiva", value: "baja", width: 26, tone: "tension" },
      { label: "Potencial ajustado", value: "medio", width: 58, tone: "signal" }
    ],
    outputs: ["Brief de evidencia", "Señales contra la tesis", "Riesgos de adopción", "Recomendación"],
    decision: "La tesis avanzó, pero con target y mensaje de entrada redefinidos."
  },
  "anticipacion-de-tendencias": {
    client: "Marca de beauty buscando señales antes de campaña anual",
    setup: "El equipo veía hashtags creciendo, pero no sabía cuáles eran moda pasajera y cuáles cambiaban lenguaje.",
    tools: ["TikTok", "Pinterest", "YouTube", "SparkToro", "Sheets"],
    sources: ["creadores medianos", "comentarios largos", "foros de rutina", "búsquedas emergentes"],
    thesis: "La pista útil no era el hashtag más grande. Era un vocabulario nuevo que varias comunidades empezaban a repetir.",
    editorial:
      "Lo importante no era perseguir lo más visto. Era detectar frases raras, chistes y dudas que todavía parecían pequeñas, pero ya estaban cambiando cómo la gente nombraba la categoría.",
    extraction: "Vocabulario emergente, voces tempranas y señales que empezaban a cruzar comunidades.",
    insights: [
      { label: "Señal", value: "Lenguaje nuevo", detail: "Aparece antes que el hashtag masivo." },
      { label: "Validador", value: "Creador puente", detail: "No es celebrity; traduce entre nichos." },
      { label: "Uso", value: "Monitoreo activo", detail: "La marca sabe qué términos seguir." }
    ],
    evidence: [
      { quote: "No sé cómo llamarlo, pero cada vez más gente lo pide así.", source: "Comentario TikTok", tag: "vocabulario · señal débil" },
      { quote: "Esto antes era de nicho, ahora ya lo preguntan mis amigas.", source: "YouTube", tag: "difusión · comunidad" }
    ],
    bars: [
      { label: "Volumen masivo", value: "medio", width: 44, tone: "tension" },
      { label: "Crecimiento de lenguaje", value: "alto", width: 73, tone: "signal" },
      { label: "Cruce de comunidades", value: "alto", width: 69, tone: "signal" }
    ],
    outputs: ["Radar de señales", "Vocabulario emergente", "Mapa de voces", "Hipótesis de activación"],
    decision: "La marca eligió monitorear lenguaje y voces puente, no perseguir hashtags grandes."
  },
  "decodificacion-de-crisis": {
    client: "Plataforma de servicios enfrentando conversación crítica",
    setup: "El volumen subía, pero el riesgo real era una frase sencilla que volvía repetible la acusación.",
    tools: ["X", "TikTok", "Meltwater", "Comms tracker", "Slack"],
    sources: ["posts virales", "respuestas de usuarios", "medios digitales", "comunidades afectadas"],
    thesis: "La crisis crecía porque una acusación sencilla se volvió fácil de repetir.",
    editorial:
      "Responder a todo habría amplificado el problema. El punto era encontrar la frase que estaba cargando la conversación, quién la estaba validando y qué respuesta podía bajarle fuerza sin sonar defensiva.",
    extraction: "Frases repetibles, voces que amplificaban la acusación y rutas de respuesta posibles.",
    insights: [
      { label: "Motor", value: "Frame moral", detail: "La acusación era fácil de repetir y difícil de matizar." },
      { label: "Nodo", value: "Comunidad afectada", detail: "No era influencer aislado; era validación colectiva." },
      { label: "Respuesta", value: "Reconocer + precisar", detail: "Evitar negación total y explicar acción concreta." }
    ],
    evidence: [
      { quote: "El problema no es el error, es que parecen no entender por qué importa.", source: "X thread", tag: "legitimidad · respuesta" },
      { quote: "Si salen con comunicado genérico, se va a poner peor.", source: "TikTok", tag: "respuesta · riesgo" }
    ],
    bars: [
      { label: "Volumen", value: "medio", width: 46, tone: "tension" },
      { label: "Frase fácil de repetir", value: "alta", width: 78, tone: "tension" },
      { label: "Ruta de respuesta", value: "clara", width: 66, tone: "signal" }
    ],
    outputs: ["Mapa narrativo", "Voces de riesgo", "Guía de respuesta", "Citas críticas"],
    decision: "La respuesta se enfocó en quitarle fuerza a la acusación central, no en contestar cada mención."
  },
  "influencia-de-categoria": {
    client: "Marca tech buscando voces creíbles para categoría emergente",
    setup: "La lista de influencers tenía audiencia, pero no explicaba quién hacía comprensible la idea.",
    tools: ["SparkToro", "YouTube", "LinkedIn", "Reddit", "Sheets"],
    sources: ["canales técnicos", "creadores medianos", "comunidades de práctica", "comentarios cruzados"],
    thesis: "La voz más útil no era la más grande. Era la persona que varias comunidades usaban para entender la categoría.",
    editorial:
      "La influencia que mueve decisión suele verse poco espectacular: tutoriales largos, respuestas técnicas, hilos que otros citan. El mapa encontró quién conectaba comunidades antes de seleccionar embajadores.",
    extraction: "Nodos de traducción, puentes entre comunidades y tipo de credibilidad por voz.",
    insights: [
      { label: "Nodo clave", value: "Traductor técnico", detail: "Hace que la categoría sea entendible sin simplificarla de más." },
      { label: "Riesgo", value: "Audiencia vacía", detail: "Mucho alcance, poca autoridad para decidir." },
      { label: "Activación", value: "Co-creación", detail: "Mejor que pauta directa." }
    ],
    evidence: [
      { quote: "Cuando esta cuenta lo explica, por fin entiendo para qué sirve.", source: "YouTube comentario", tag: "credibilidad · traducción" },
      { quote: "No le creo a la marca, pero sí a quienes lo usan todos los días.", source: "Reddit", tag: "uso · autoridad" }
    ],
    bars: [
      { label: "Alcance bruto", value: "medio", width: 48, tone: "tension" },
      { label: "Credibilidad técnica", value: "alta", width: 80, tone: "signal" },
      { label: "Puente entre comunidades", value: "alto", width: 72, tone: "signal" }
    ],
    outputs: ["Mapa de influencia", "Dossier de voces", "Roles por comunidad", "Estrategia de activación"],
    decision: "La marca priorizó voces traductoras y co-creación sobre pauta con perfiles grandes."
  }
};

const defaultDossier = (useCase: UseCase): CaseDossier => ({
  client: `Equipo de ${useCase.industries.split(",")[0].toLowerCase()} con una decisión en puerta`,
  setup: "El equipo tenía datos dispersos y una hipótesis difícil de defender con ejemplos reales.",
  tools: ["CRM", "Social", "Reviews", "BI", "Deck"],
  sources: ["conversación pública", "reseñas", "tickets", "foros", "comentarios largos"],
  thesis: useCase.vignette,
  editorial: useCase.approach,
  extraction: "Señales a favor y en contra de la decisión, conectadas con fuentes y métodos.",
  insights: [
    { label: "Pregunta", value: "Aterrizada", detail: "La decisión se convirtió en una pregunta que sí se podía responder." },
    { label: "Evidencia", value: "Conectada", detail: "Cada hallazgo conservó fuente, cita y razón de relevancia." },
    { label: "Salida", value: "Accionable", detail: "El equipo recibió una recomendación defendible." }
  ],
  evidence: [
    { quote: "Esto explica mejor el problema que el tablero de volumen.", source: "Cita anonimizada", tag: "evidencia · decisión" },
    { quote: "La recomendación cambió cuando vimos quién decía qué y por qué.", source: "Workshop interno", tag: "contexto · fuente" }
  ],
  bars: [
    { label: "Claridad de pregunta", value: "alta", width: 78, tone: "signal" },
    { label: "Ruido inicial", value: "medio", width: 42, tone: "tension" },
    { label: "Evidencia para decidir", value: "alta", width: 74, tone: "signal" }
  ],
  outputs: useCase.deliverables,
  decision: "La decisión se tomó con evidencia trazable y límites claros."
});

const PROCESS_STEPS: ProcessStep[] = [
  { name: "Pregunta", description: "Convertimos la duda del equipo en una pregunta de negocio que pueda responderse con evidencia." },
  { name: "Fuentes", description: "Cruzamos herramientas internas y conversación externa para no quedarnos con una sola versión del problema." },
  { name: "Hallazgos", description: "Separamos patrones, dudas y citas para que el equipo no decida por intuición suelta." },
  { name: "Decisión", description: "La salida se escribe como argumento: qué vimos, qué significa y qué conviene hacer." }
];

function methodologySlug(name: string): string {
  const map: Record<string, string> = {
    "Cultural Codes": "cultural-codes-decoding",
    "Triggers & Barriers": "triggers-y-barriers",
    "Journey Friction Mapping": "journey-friction-mapping",
    "Decision Velocity": "decision-velocity",
    "Value Perception Matrix": "value-perception-matrix",
    "Influence Architecture": "influence-architecture"
  };
  return map[name] ?? "";
}

export default async function UseCaseDetailPage({ params }: UseCaseDetailProps) {
  const { slug } = await params;
  const useCase = useCases.find((item) => item.slug === slug);
  if (!useCase) notFound();

  const dossier = CASE_DOSSIERS[slug] ?? defaultDossier(useCase);
  const linkedMethodologies = useCase.methodologies
    .map((m) => ({ name: m, slug: methodologySlug(m) }))
    .filter((m) => m.slug);
  const canonicalPath = `/casos-de-uso/${useCase.slug}`;
  const useCaseJsonLd = [
    breadcrumbJsonLd([
      { name: "Noisia", path: "/" },
      { name: "Casos de uso", path: "/casos-de-uso" },
      { name: useCase.shortTitle, path: canonicalPath }
    ]),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: useCase.title,
      description: useCase.approach,
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
        name: useCase.shortTitle,
        description: useCase.vignette
      },
      mainEntity: {
        "@type": "Service",
        name: `Noisia para ${useCase.shortTitle}`,
        serviceType: "Social intelligence use case",
        description: useCase.approach,
        audience: {
          "@type": "BusinessAudience",
          audienceType: useCase.industries
        },
        provider: {
          "@type": "Organization",
          name: "Noisia",
          url: SITE_URL
        },
        additionalProperty: useCase.deliverables.slice(0, 4).map((deliverable) => ({
          "@type": "PropertyValue",
          name: "Public deliverable",
          value: deliverable
        }))
      }
    }
  ];

  return (
    <>
      <StructuredData data={useCaseJsonLd} />
      <article className="case-article">
        <header className="case-article-hero">
          <div className="case-article-hero__inner">
            <div className="case-article-hero__copy">
              <span className="eyebrow">CASO DE USO</span>
              <h1>{useCase.title}</h1>
              <p>{dossier.editorial}</p>
              <div className="case-article-hero__meta">
                <span>{dossier.client}</span>
                <span>{useCase.shortTitle}</span>
              </div>
            </div>
            <aside className="case-article-brief glass">
              <span className="chip">Para qué sirve Noisia</span>
              <h2>{dossier.thesis}</h2>
              <p>{dossier.setup}</p>
              <div className="case-logo-strip">
                {dossier.tools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            </aside>
          </div>
        </header>

        <section className="section section--compact">
          <div className="section__inner">
            <div className="case-editorial-lede">
              <p>
                La pregunta no era producir más análisis. Era saber qué parte de la conversación podía cambiar una
                decisión concreta y qué evidencia alcanzaba para defenderla frente al equipo.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__inner">
            <div className="case-signal-layout">
              <div className="case-signal-copy">
                <span className="eyebrow">QUÉ MIRAMOS</span>
                <h2>El patrón apareció cuando juntamos fuentes internas con conversación real.</h2>
                <p>{dossier.extraction}</p>
                <div className="case-source-cloud">
                  {dossier.sources.map((source) => (
                    <span key={source}>{source}</span>
                  ))}
                </div>
              </div>

              <div className="case-signal-panel glass">
                <div className="case-signal-panel__head">
                  <span>Qué pesó en la decisión</span>
                  <strong>muestra ficticia</strong>
                </div>
                <div className="case-bars">
                  {dossier.bars.map((bar) => (
                    <div className="case-bar" key={bar.label}>
                      <div>
                        <span>{bar.label}</span>
                        <b>{bar.value}</b>
                      </div>
                      <i>
                        <em
                          className={bar.tone === "tension" ? "is-tension" : undefined}
                          style={{ width: `${bar.width}%` }}
                        />
                      </i>
                    </div>
                  ))}
                </div>
                <div className="case-panel-mentions">
                  <span>Menciones ejemplo</span>
                  {dossier.evidence.slice(0, 2).map((item) => (
                    <figure key={item.quote}>
                      <blockquote>“{item.quote}”</blockquote>
                      <figcaption>{item.source}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--compact">
          <div className="section__inner">
            <div className="case-insight-grid">
              {dossier.insights.map((insight) => (
                <article className="case-insight-card glass" key={insight.label}>
                  <span>{insight.label}</span>
                  <h3>{insight.value}</h3>
                  <p>{insight.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__inner">
            <div className="case-evidence-layout">
              <div>
                <span className="eyebrow">MENCIONES</span>
                <h2>El hallazgo debe poder volver a una frase real.</h2>
                <p>
                  Por eso la salida conserva citas, fuente y tema. El equipo puede ver de dónde salió la recomendación
                  y qué tan cerca está de la decisión.
                </p>
              </div>
              <div className="case-evidence-stack">
                {dossier.evidence.map((item) => (
                  <figure className="case-evidence-card glass" key={item.quote}>
                    <blockquote>“{item.quote}”</blockquote>
                    <figcaption>
                      <span>{item.source}</span>
                      <b>{item.tag}</b>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section__inner">
            <div className="method-protocol-grid">
              <aside className="method-protocol-intro">
                <span className="eyebrow">CÓMO SE ARMÓ</span>
                <h2>De una pregunta abierta a un movimiento concreto.</h2>
                <p>
                  Primero se aterriza la decisión. Luego se eligen las fuentes que pueden explicarla. Al final, el
                  equipo recibe una recomendación con evidencia visible y límites claros.
                </p>
              </aside>
              <div className="method-protocol-trace glass">
                <ProcessTrace steps={PROCESS_STEPS} variant="codification" />
              </div>
            </div>
          </div>
        </section>

        <section className="section section--compact">
          <div className="section__inner">
            <div className="case-output-panel glass">
              <div>
                <span className="eyebrow">QUÉ CAMBIÓ</span>
                <h2>{dossier.decision}</h2>
              </div>
              <div className="case-output-list">
                {dossier.outputs.map((output) => (
                  <span className="chip" key={output}>{output}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {linkedMethodologies.length > 0 && (
          <section className="section section--compact">
            <div className="section__inner">
              <header className="method-section-header">
                <span className="eyebrow">MÉTODOS USADOS</span>
                <h2>Los métodos que ayudaron a ordenar el caso.</h2>
              </header>
              <ul className="case-methods-list">
                {linkedMethodologies.map(({ name, slug: mSlug }, idx) => (
                  <li className="case-methods-row" key={mSlug}>
                    <Link className="case-methods-row__link" href={`/metodologias/${mSlug}`}>
                      <span className="case-methods-row__index" aria-hidden="true">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="case-methods-row__sig" aria-hidden="true">
                        <MethodologySignature slug={mSlug} />
                      </div>
                      <div className="case-methods-row__body">
                        <strong>{name}</strong>
                        <span>Ver cómo se aplica</span>
                      </div>
                      <span className="case-methods-row__arrow" aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="section section--compact">
          <div className="section__inner">
            <div className="no-method-cta glass">
              <div className="no-method-cta__copy">
                <h2>¿Tu pregunta se parece a esta?</h2>
                <p>Cuéntanos la decisión. Armamos la mezcla de fuentes, métodos y salida que la pueda sostener.</p>
              </div>
              <Button href="/diagnostico" variant="primary">
                Iniciar diagnóstico <ArrowRight size={16} strokeWidth={1.9} />
              </Button>
            </div>
          </div>
        </section>
      </article>
    </>
  );
}
