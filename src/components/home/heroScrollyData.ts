export type VoiceCard = {
  platform: string;
  market: string;
  age: string;
  quote: string;
  position: {
    x: string;
    y: string;
    rotate: string;
  };
};

export type PipelineStep = {
  label: string;
  detail: string;
  metric: string;
  fill: string;
};

export type ForceMetric = {
  label: string;
  value: string;
  tone?: "signal" | "tension";
};

export const heroVoiceCards: VoiceCard[] = [
  {
    platform: "TikTok",
    market: "MX",
    age: "hace 3 h",
    quote: "Todos repiten innovación, pero la gente pregunta si de verdad funciona en México.",
    position: { x: "clamp(-620px, -35vw, -430px)", y: "clamp(-245px, -25vh, -160px)", rotate: "-8deg" }
  },
  {
    platform: "Instagram",
    market: "MX",
    age: "hace 2 h",
    quote: "La marca se ve bien, pero la gente pregunta por pruebas, no por otro claim.",
    position: { x: "clamp(380px, 32vw, 590px)", y: "clamp(-235px, -22vh, -150px)", rotate: "7deg" }
  },
  {
    platform: "X",
    market: "MX",
    age: "hace 8 h",
    quote: "La queja no crece por volumen: crece porque una frase se vuelve fácil de repetir.",
    position: { x: "clamp(-700px, -41vw, -500px)", y: "clamp(18px, 6vh, 84px)", rotate: "-5deg" }
  },
  {
    platform: "YouTube",
    market: "MX",
    age: "hace 1 h",
    quote: "El demo se ve bien, pero nadie explica qué cambia en mi día a día.",
    position: { x: "clamp(470px, 39vw, 700px)", y: "clamp(20px, 7vh, 92px)", rotate: "6deg" }
  },
  {
    platform: "Facebook",
    market: "MX",
    age: "hace 6 d",
    quote: "Si hay garantía humana, pago. Si todo es bot, no me arriesgo.",
    position: { x: "clamp(-560px, -30vw, -350px)", y: "clamp(205px, 27vh, 285px)", rotate: "-4deg" }
  },
  {
    platform: "Reddit",
    market: "MX",
    age: "hace 9 h",
    quote: "No necesito otra feature. Necesito saber qué pasa si falla.",
    position: { x: "clamp(420px, 30vw, 620px)", y: "clamp(210px, 28vh, 300px)", rotate: "4deg" }
  },
  {
    platform: "Amazon",
    market: "MX",
    age: "hace 2 h",
    quote: "Las reseñas dicen que llega rápido, pero varias personas reportan cambios de talla.",
    position: { x: "clamp(-315px, -18vw, -210px)", y: "clamp(-305px, -34vh, -230px)", rotate: "5deg" }
  },
  {
    platform: "Klaviyo",
    market: "MX",
    age: "hace 11 h",
    quote: "Los usuarios abren el correo de reposición, pero no vuelven si no hay prueba de garantía.",
    position: { x: "clamp(210px, 18vw, 320px)", y: "clamp(-300px, -33vh, -220px)", rotate: "-5deg" }
  },
  {
    platform: "Salesforce",
    market: "MX",
    age: "hace 3 d",
    quote: "El ticket se cerró como resuelto, pero la duda de confianza siguió abierta.",
    position: { x: "clamp(-760px, -45vw, -610px)", y: "clamp(-80px, -8vh, -46px)", rotate: "4deg" }
  },
  {
    platform: "Zendesk",
    market: "MX",
    age: "hace 6 h",
    quote: "Cuando soporte explica el porqué, la queja baja de tono y se vuelve reparable.",
    position: { x: "clamp(610px, 45vw, 770px)", y: "clamp(-90px, -9vh, -42px)", rotate: "-6deg" }
  },
  {
    platform: "Mercado Libre",
    market: "MX",
    age: "hace 2 d",
    quote: "Las preguntas previas no son dudas menores: son el mapa de lo que impide comprar.",
    position: { x: "clamp(-580px, -36vw, -430px)", y: "clamp(150px, 19vh, 220px)", rotate: "6deg" }
  },
  {
    platform: "Google Reviews",
    market: "MX",
    age: "hace 7 h",
    quote: "La compra fue fácil. La explicación después fue donde me perdí.",
    position: { x: "clamp(430px, 36vw, 580px)", y: "clamp(155px, 20vh, 230px)", rotate: "-4deg" }
  },
  {
    platform: "Shopify",
    market: "MX",
    age: "hace 1 d",
    quote: "El carrito se abandona cuando el costo de envío aparece hasta el final.",
    position: { x: "clamp(-680px, -39vw, -510px)", y: "clamp(170px, 23vh, 260px)", rotate: "-7deg" }
  },
  {
    platform: "WhatsApp",
    market: "MX",
    age: "hace 10 h",
    quote: "El seguimiento por WhatsApp ayuda, pero si suena automático rompe confianza.",
    position: { x: "clamp(560px, 38vw, 690px)", y: "clamp(175px, 24vh, 270px)", rotate: "5deg" }
  },
  {
    platform: "App Store",
    market: "MX",
    age: "hace 1 d",
    quote: "La app hace lo que promete, pero el onboarding me perdió.",
    position: { x: "clamp(-110px, -8vw, -70px)", y: "clamp(300px, 36vh, 365px)", rotate: "-3deg" }
  },
  {
    platform: "Trustpilot",
    market: "MX",
    age: "hace 4 d",
    quote: "La promesa es fuerte, pero la experiencia no la sostiene igual.",
    position: { x: "clamp(96px, 10vw, 180px)", y: "clamp(302px, 36vh, 370px)", rotate: "3deg" }
  }
];

export const heroPipelineSteps: PipelineStep[] = [
  {
    label: "Escucha en México",
    detail: "TikTok · Instagram · X · marketplaces · CRM",
    metric: "+214M señales",
    fill: "100%"
  },
  {
    label: "Normalizando",
    detail: "Duplicados fuera · contexto dentro · fuente clara",
    metric: "42.8M útiles",
    fill: "82%"
  },
  {
    label: "Entendiendo",
    detail: "Tono · intención · duda · experiencia · valor",
    metric: "8.6M expresiones",
    fill: "64%"
  },
  {
    label: "Separando",
    detail: "Lo que empuja · lo que frena",
    metric: "1.3M señales",
    fill: "46%"
  },
  {
    label: "Priorizando",
    detail: "Tamaño · urgencia · impacto",
    metric: "86,420 evidencias",
    fill: "30%"
  },
  {
    label: "Traduciendo",
    detail: "Lectura → movimiento recomendado",
    metric: "12 decisiones",
    fill: "18%"
  }
];

export const heroIndustryMetrics: ForceMetric[] = [
  { label: "telecom y conectividad", value: "62.4%", tone: "tension" },
  { label: "retail y marketplaces", value: "58.7%", tone: "tension" },
  { label: "fintech y banca digital", value: "54.8%", tone: "tension" },
  { label: "CPG, food y beauty", value: "43.6%", tone: "signal" }
];

export const heroRoleRead = [
  { state: "CX", share: "61", label: "reclamos por soporte lento, respuestas automáticas y poca claridad" },
  { state: "Producto", share: "54", label: "fallas repetidas, onboarding confuso y expectativa no cumplida" },
  { state: "Precio", share: "47", label: "molestia cuando el costo extra aparece tarde o no se justifica" }
];
