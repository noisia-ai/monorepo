// Words for each situation page: how we solve it (three steps, one per animated diagram),
// how it compares with the usual alternative, and what you receive.
import type { SituationDetail } from "./situation-details.types";

export const situationDetails: Record<string, Record<"es" | "en", SituationDetail>> = {
  monitorear: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Leemos la conversación de toda tu categoría",
          text: "Una búsqueda por el nombre de tu marca solo encuentra lo que lo menciona. Se le escapa quien habla de ti con un apodo, un error de dedo, el color del empaque o el nombre de un producto. Nosotros partimos de la conversación de toda tu categoría en redes, búsquedas, reseñas y foros, y ahí encontramos lo que habla de ti aunque no te nombre."
        },
        {
          title: "Los temas salen de lo que dice la gente",
          text: "El sistema agrupa las menciones por lo que dicen, sin una lista de temas decidida de antemano. Saca la prensa, el contenido de marca, la reventa y el spam, para que lo que se cuenta sea la voz de la gente. Un Intelligence Architect revisa cada tema, corrige lo que quedó mal agrupado y lo aprueba antes de que entre al reporte."
        },
        {
          title: "Mes contra mes, qué cambió y por qué",
          text: "Cada mes comparamos los mismos temas contra el mes anterior. El reporte dice qué creció, qué se apagó y qué apareció, y explica cada movimiento con citas literales, con su fuente y su fecha. Llegas a la reunión con la razón del cambio, además de la cifra.",
          method: "tb"
        }
      ],
      compare: {
        title: "Frente a una herramienta de listening",
        them: "Herramienta de listening",
        rows: [
          { label: "Qué se lee", them: "Las menciones que contienen las palabras clave elegidas", us: "La conversación de toda tu categoría, aunque no te nombre" },
          { label: "Cómo se ordena", them: "Volumen y sentimiento por palabra o etiqueta", us: "Temas que salen de lo que la gente dice" },
          { label: "El ruido", them: "Filtros que tu equipo configura y mantiene", us: "Prensa, contenido de marca, reventa y spam fuera de la cuenta" },
          { label: "Tus propios datos", them: "Viven en otra herramienta, aparte del dashboard", us: "NPS, encuestas y tickets leídos con los mismos temas" },
          { label: "Quién explica el cambio", them: "Tu equipo interpreta el dashboard cada mes", us: "Un Intelligence Architect lo explica y firma la lectura" }
        ]
      },
      deliverable: {
        title: "Lo que recibes cada mes",
        name: "Reporte de septiembre",
        items: [
          { name: "Lo que se movió", text: "Los temas de tu marca y tu categoría que crecieron, se apagaron o aparecieron, comparados con el mes anterior." },
          { name: "Por qué se movió", text: "La explicación de cada cambio, con las citas literales que la sostienen, su fuente y su fecha." },
          { name: "Qué vigilar", text: "Lo que conviene seguir de cerca antes del próximo reporte, con aviso si algo cambia antes." },
          { name: "Evidencia abierta", text: "Cada cifra con su cálculo, para que cualquier persona de tu equipo revise de dónde sale." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "We read the conversation of your whole category",
          text: "A search for your brand name only finds what mentions it. It misses people who talk about you with a nickname, a typo, the color of the pack or a product name. We start from the conversation of your whole category across social media, search, reviews and forums, and find there what is about you even when it doesn't name you."
        },
        {
          title: "Topics come from what people say",
          text: "The system groups mentions by what they say, with no topic list decided in advance. It takes out press, brand content, resale and spam, so what gets counted is people's voice. An Intelligence Architect reviews every topic, fixes what was grouped wrong and approves it before it goes into the report."
        },
        {
          title: "Month against month, what changed and why",
          text: "Every month we compare the same topics against the previous month. The report says what grew, what faded and what appeared, and explains each movement with verbatim quotes, with source and date. You walk into the meeting with the reason for the change, along with the number.",
          method: "tb"
        }
      ],
      compare: {
        title: "Compared with a listening tool",
        them: "Listening tool",
        rows: [
          { label: "What gets read", them: "Mentions that contain the chosen keywords", us: "The conversation of your whole category, even when it doesn't name you" },
          { label: "How it's organized", them: "Volume and sentiment by keyword or tag", us: "Topics that come from what people say" },
          { label: "Noise", them: "Filters your team sets up and maintains", us: "Press, brand content, resale and spam left out of the count" },
          { label: "Your own data", them: "Lives in another tool, apart from the dashboard", us: "NPS, surveys and tickets read with the same topics" },
          { label: "Who explains the change", them: "Your team reads the dashboard every month", us: "An Intelligence Architect explains it and signs off" }
        ]
      },
      deliverable: {
        title: "What you receive every month",
        name: "September report",
        items: [
          { name: "What moved", text: "The topics around your brand and category that grew, faded or appeared, compared with the previous month." },
          { name: "Why it moved", text: "The explanation for each change, with the verbatim quotes behind it, their source and their date." },
          { name: "What to watch", text: "What is worth following closely before the next report, with a heads-up if something changes sooner." },
          { name: "Open evidence", text: "Every number with its calculation, so anyone on your team can check where it comes from." }
        ]
      }
    }
  },

  anticipar: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Medimos la velocidad, además del volumen",
          text: "Una señal temprana es chica, vive en pocas comunidades y crece rápido. Un dashboard de volumen la deja abajo de la lista porque todavía pesa poco. Cruzamos cuánto se habla de cada tema con qué tan rápido crece y en cuántas comunidades aparece, y marcamos las chicas que se mueven rápido."
        },
        {
          title: "Cada señal tiene una etapa",
          text: "Colocamos cada señal en una de cuatro etapas (Emergente, Acelerando, Mainstreaming o Saturación). La etapa sale de cuatro criterios medidos cada mes, que son volumen, velocidad de crecimiento, cuántas comunidades la llevan y cuánto tiempo dura. Cuando una señal cambia de etapa entre un reporte y otro, te avisamos."
        },
        {
          title: "Lo que hay detrás de cada señal",
          text: "Una señal sirve cuando sabes por qué crece. Leemos el lenguaje con el que la gente habla de ella y sus razones en cuatro capas (psicológica, personal, social y cultural), y separamos lo que la impulsa de lo que la frena. Así sabes si tu marca tiene permiso para entrar y con qué palabras.",
          method: "tb"
        }
      ],
      compare: {
        title: "Frente a una lista de tendencias",
        them: "Lista de tendencias",
        rows: [
          { label: "De dónde sale", them: "Observación de expertos, prensa y reportes globales", us: "La conversación pública de tu mercado, leída completa" },
          { label: "Qué mide", them: "Qué temas están en el aire hoy", us: "Volumen, velocidad, comunidades y duración de cada señal" },
          { label: "La etapa", them: "Rara vez dice si algo empieza o ya pasó", us: "Emergente, Acelerando, Mainstreaming o Saturación, con criterio medido" },
          { label: "Relación con tu marca", them: "La misma lista sirve para cualquier marca", us: "Qué señales tienen permiso para tu marca y cuáles no" },
          { label: "Cada cuánto", them: "Una vez al año o por temporada", us: "Cada mes, con aviso cuando una señal cambia de etapa" }
        ]
      },
      deliverable: {
        title: "Lo que recibes cada mes",
        name: "Radar de septiembre",
        items: [
          { name: "Mapa de señales", text: "Cada señal colocada por volumen y velocidad, con las comunidades donde aparece." },
          { name: "La etapa de cada señal", text: "Emergente, Acelerando, Mainstreaming o Saturación, y qué cambió contra el mes anterior." },
          { name: "Qué mover y qué vigilar", text: "Las señales con permiso para tu marca ahora y las que conviene seguir sin tocar todavía." },
          { name: "Lenguaje y razones", text: "Las palabras que usa la gente y lo que impulsa o frena cada señal, listo para un brief." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "We measure speed as well as volume",
          text: "An early signal is small, lives in a few communities and grows fast. A volume dashboard leaves it at the bottom of the list because it still weighs little. We cross how much each topic is discussed with how fast it grows and how many communities carry it, and flag the small ones that move fast."
        },
        {
          title: "Every signal gets a stage",
          text: "We place each signal in one of four stages (Emerging, Accelerating, Mainstreaming or Saturation). The stage comes from four criteria measured every month, which are volume, growth speed, how many communities carry it and how long it lasts. When a signal changes stage between reports, we let you know."
        },
        {
          title: "What sits behind each signal",
          text: "A signal is useful once you know why it grows. We read the language people use to talk about it and their reasons in four layers (psychological, personal, social and cultural), and separate what drives it from what holds it back. So you know whether your brand has permission to step in and with which words.",
          method: "tb"
        }
      ],
      compare: {
        title: "Compared with a trend list",
        them: "Trend list",
        rows: [
          { label: "Where it comes from", them: "Expert observation, press and global reports", us: "The public conversation in your market, read in full" },
          { label: "What it measures", them: "Which topics are in the air today", us: "Volume, speed, communities and duration of each signal" },
          { label: "The stage", them: "Rarely says whether something is starting or over", us: "Emerging, Accelerating, Mainstreaming or Saturation, with measured criteria" },
          { label: "Fit with your brand", them: "The same list works for any brand", us: "Which signals your brand has permission to use" },
          { label: "How often", them: "Once a year or once a season", us: "Every month, with a heads-up when a stage changes" }
        ]
      },
      deliverable: {
        title: "What you receive every month",
        name: "September radar",
        items: [
          { name: "Signal map", text: "Every signal placed by volume and speed, with the communities where it shows up." },
          { name: "Each signal's stage", text: "Emerging, Accelerating, Mainstreaming or Saturation, and what changed since last month." },
          { name: "What to act on and what to watch", text: "The signals your brand can use now and the ones worth following without touching yet." },
          { name: "Language and reasons", text: "The words people use and what drives or holds back each signal, ready for a brief." }
        ]
      }
    }
  },

  optimizar: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "El recorrido real, momento por momento",
          text: "La analítica dice en qué paso se cae la gente. Leemos lo que cuenta en reseñas, foros, redes y quejas, y reconstruimos el recorrido como lo vive, momento por momento. Cada mes ves dónde sube la frustración y si mejoró o empeoró contra el mes anterior.",
          method: "jfm"
        },
        {
          title: "Por qué duele ese momento",
          text: "Un mismo punto del recorrido puede fallar por razones muy distintas. Una duda pide información, una desconfianza pide una garantía y un esfuerzo pide quitar pasos. Separamos las razones de cada fricción para que la solución apunte a la causa.",
          method: "tb"
        },
        {
          title: "Qué arreglar primero, junto a tu NPS",
          text: "Cruzamos la conversación con tu NPS, tus encuestas o tus tickets, ordenados con los mismos temas. Un Intelligence Architect aprueba la lectura y propone qué arreglar primero, qué depende de un tercero y qué solo hay que explicar mejor."
        }
      ],
      compare: {
        title: "Frente al NPS y las encuestas",
        them: "NPS y encuestas",
        rows: [
          { label: "Qué te dice", them: "Una calificación y cuánto cambió", us: "Dónde se frustra la gente y por qué" },
          { label: "Cuándo llega", them: "Después de la experiencia, en la siguiente ola", us: "Cada mes, desde lo que la gente ya contó" },
          { label: "Quién responde", them: "Quien acepta contestar la encuesta", us: "Quien habla por su cuenta en reseñas, foros y redes" },
          { label: "Las preguntas", them: "Las que tu equipo decidió hacer", us: "Los temas que trae la gente, aunque nadie preguntara" },
          { label: "Cómo se usan juntos", them: "El comentario abierto se lee aparte, a mano", us: "Tu NPS leído con los mismos temas que la conversación" }
        ]
      },
      deliverable: {
        title: "Lo que recibes cada mes",
        name: "Recorrido de septiembre",
        items: [
          { name: "El recorrido del mes", text: "Cada momento de la experiencia con su nivel de frustración, comparado con el mes anterior." },
          { name: "Puntos de quiebre", text: "Los momentos donde la gente abandona o se queja más, con sus razones y las citas que lo muestran." },
          { name: "Cruce con tus datos", text: "Dónde tu NPS o tus encuestas coinciden con la conversación y dónde cuentan otra cosa." },
          { name: "Qué arreglar primero", text: "Las mejoras en orden, separando lo que depende de tu equipo, lo que depende de un tercero y lo que conviene probar." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "The real journey, moment by moment",
          text: "Analytics tells you at which step people drop off. We read what they tell in reviews, forums, social media and complaints, and rebuild the journey as they live it, moment by moment. Every month you see where frustration rises and whether it got better or worse since last month.",
          method: "jfm"
        },
        {
          title: "Why that moment hurts",
          text: "The same step in the journey can fail for very different reasons. A doubt calls for information, distrust calls for a guarantee and effort calls for fewer steps. We separate the reasons behind each friction so the fix aims at the cause.",
          method: "tb"
        },
        {
          title: "What to fix first, next to your NPS",
          text: "We cross the conversation with your NPS, surveys or tickets, organized under the same topics. An Intelligence Architect approves the reading and proposes what to fix first, what depends on a third party and what just needs a better explanation."
        }
      ],
      compare: {
        title: "Compared with NPS and surveys",
        them: "NPS and surveys",
        rows: [
          { label: "What it tells you", them: "A score and how much it moved", us: "Where people get frustrated and why" },
          { label: "When it arrives", them: "After the experience, in the next wave", us: "Every month, from what people already shared" },
          { label: "Who answers", them: "Whoever agrees to take the survey", us: "People speaking on their own in reviews, forums and social" },
          { label: "The questions", them: "The ones your team chose to ask", us: "The topics people bring up, even unasked" },
          { label: "Using them together", them: "Open comments are read separately, by hand", us: "Your NPS read with the same topics as the conversation" }
        ]
      },
      deliverable: {
        title: "What you receive every month",
        name: "September journey",
        items: [
          { name: "This month's journey", text: "Every moment of the experience with its level of frustration, compared with the previous month." },
          { name: "Break points", text: "The moments where people drop out or complain the most, with their reasons and the quotes that show it." },
          { name: "Your data, side by side", text: "Where your NPS or surveys match the conversation and where they tell a different story." },
          { name: "What to fix first", text: "Improvements in order, split into what your team owns, what depends on a third party and what is worth testing." }
        ]
      }
    }
  },

  defender: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Por qué la gente se cambia",
          text: "Partimos de una pregunta concreta, como por qué la gente se va con la competencia. Leemos lo que cuentan quienes cambiaron de marca, en sus palabras, y lo agrupamos por razones. Un Intelligence Architect aprueba los temas y escribe la respuesta, con la promesa del otro que hoy se siente más creíble.",
          method: "tb"
        },
        {
          title: "Tu parte de la conversación, mes a mes",
          text: "Medimos tu parte de la conversación frente a cada competidor, mes a mes, con las mismas fuentes y el mismo criterio de limpieza. Además del porcentaje, explicamos qué tema movió cada cambio. Así sabes en qué conversación ganas terreno y en cuál lo pierdes."
        },
        {
          title: "Qué responder y qué reparar",
          text: "Para cada razón de cambio leemos qué hay detrás, sea una duda, un mal momento del servicio, una presión social o un código de la categoría. Eso separa lo que se arregla con producto o servicio de lo que se responde con comunicación, y muestra si la pelea es de valor percibido o de precio. Cada acción llega con responsable, indicador y riesgo.",
          method: "vpm"
        }
      ],
      compare: {
        title: "Frente a medir share of voice",
        them: "Share of voice",
        rows: [
          { label: "Qué mide", them: "Cuántas menciones tienes frente a cada competidor", us: "Por qué la gente prefiere a uno u otro" },
          { label: "Qué se cuenta", them: "Todo lo que nombra a cada marca", us: "Solo la voz de la gente, sin prensa, pauta ni spam" },
          { label: "El cambio de un mes a otro", them: "Cuánto subió o bajó el porcentaje", us: "Qué tema movió el cambio y con qué argumento" },
          { label: "Por qué se van", them: "Queda fuera del conteo", us: "Las razones de quienes cambiaron, en sus palabras" },
          { label: "Qué hacer", them: "Tu equipo lo deduce del porcentaje", us: "Qué responder, qué reparar y en qué orden" }
        ]
      },
      deliverable: {
        title: "Lo que recibes",
        name: "Estudio competitivo",
        items: [
          { name: "Por qué se van", text: "Las razones de quienes cambiaron de marca, hacia dónde se fueron y con qué argumento, ordenadas por peso." },
          { name: "Tu conversación frente a la competencia", text: "Tu parte de la conversación mes a mes contra cada competidor, con el tema que explica cada cambio." },
          { name: "Lo que conviene proteger", text: "Las razones por las que la gente se queda, para no romperlas al reaccionar." },
          { name: "Plan de defensa", text: "Qué responder y qué reparar, en orden, con responsable, indicador y riesgo." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "Why people switch",
          text: "We start from a specific question, such as why people leave for the competition. We read what people who switched brands say, in their own words, and group it by reason. An Intelligence Architect approves the topics and writes the answer, including the rival promise that feels more credible today.",
          method: "tb"
        },
        {
          title: "Your share of the conversation, month by month",
          text: "We measure your share of the conversation against each competitor, month by month, with the same sources and the same cleaning criteria. Along with the percentage, we explain which topic moved each change. So you know in which conversation you gain ground and in which you lose it."
        },
        {
          title: "What to answer and what to fix",
          text: "For each reason to switch we read what sits behind it, be it a doubt, a bad service moment, social pressure or a category code. That separates what gets fixed with product or service from what gets answered with communication, and shows whether the fight is about perceived value or price. Every action comes with an owner, an indicator and a risk.",
          method: "vpm"
        }
      ],
      compare: {
        title: "Compared with share of voice",
        them: "Share of voice",
        rows: [
          { label: "What it measures", them: "How many mentions you have against each competitor", us: "Why people prefer one brand over another" },
          { label: "What gets counted", them: "Everything that names each brand", us: "Only people's voice, without press, ads or spam" },
          { label: "Month-to-month change", them: "How much the percentage went up or down", us: "Which topic moved it and with what argument" },
          { label: "Why people leave", them: "Stays outside the count", us: "The reasons of those who switched, in their words" },
          { label: "What to do", them: "Your team infers it from the percentage", us: "What to answer, what to fix and in which order" }
        ]
      },
      deliverable: {
        title: "What you receive",
        name: "Competitive study",
        items: [
          { name: "Why people leave", text: "The reasons of those who switched brands, where they went and with what argument, ranked by weight." },
          { name: "Your conversation against the competition", text: "Your share of the conversation month by month against each competitor, with the topic behind each change." },
          { name: "What to protect", text: "The reasons people stay, so you don't break them while reacting." },
          { name: "Defense plan", text: "What to answer and what to fix, in order, with owner, indicator and risk." }
        ]
      }
    }
  },

  lanzar: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Lo que atrae y lo que frena",
          text: "Antes de lanzar, leemos lo que la gente ya dice de la categoría y del terreno que quieres ocupar. Separamos lo que la acerca de lo que la detiene, con su lenguaje literal, y un Intelligence Architect resume si ese terreno tiene permiso. Lo que la gente cuenta sin que nadie le pregunte muestra lo que la mueve.",
          method: "tb"
        },
        {
          title: "El porqué detrás de cada uno",
          text: "Cada motivo y cada freno se lee en cuatro capas (psicológica, personal, social y cultural). La capa dice qué puede mover tu marca, en qué solo influye y con qué tiene que alinearse. Así la campaña empuja donde tiene fuerza."
        },
        {
          title: "De tu decisión a una recomendación",
          text: "Tu decisión se convierte en una pregunta que la conversación puede responder, como cuál de tus territorios tiene permiso y cuál ya tiene dueño. Elegimos el método que la responde y entregamos una recomendación con la evidencia a favor y en contra. Tu agencia recibe también el lenguaje que conviene usar y el que conviene evitar.",
          method: "cc"
        }
      ],
      compare: {
        title: "Frente a un focus group o una encuesta",
        them: "Focus group o encuesta",
        rows: [
          { label: "Qué captura", them: "Lo que la gente responde cuando se le pregunta", us: "Lo que la gente dice por su cuenta, sin moderador" },
          { label: "Cuánta gente", them: "Una muestra reclutada para la ocasión", us: "La conversación pública de toda la categoría" },
          { label: "El lenguaje", them: "Pasa por la pregunta y el moderador", us: "Las palabras que la gente usa en su vida diaria" },
          { label: "Tiempo", them: "Semanas entre reclutar, moderar y analizar", us: "Días desde el brief hasta la primera respuesta" },
          { label: "Lo que mide mejor", them: "La reacción a un estímulo y la intención de compra", us: "El permiso de un territorio y los motivos y frenos que ya existen" }
        ]
      },
      deliverable: {
        title: "Lo que recibes",
        name: "Estudio de lanzamiento",
        items: [
          { name: "Lo que atrae y lo que frena", text: "Los motivos y los frenos alrededor de tu idea, con su peso y las citas que los sostienen." },
          { name: "Territorio recomendado", text: "Cuál construir, cuál ya tiene dueño en la conversación y por qué." },
          { name: "Lenguaje con permiso", text: "Las palabras y los tonos que la gente ya usa, y las promesas que la categoría ya gastó." },
          { name: "Brief con fuentes", text: "Un documento que tu agencia puede usar directo, con cada hallazgo ligado a lo que dijo la gente." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "What draws people and what holds them back",
          text: "Before you launch, we read what people already say about the category and the ground you want to take. We separate what pulls them closer from what stops them, in their own words, and an Intelligence Architect sums up whether that ground has permission. What people say when nobody is asking shows what moves them.",
          method: "tb"
        },
        {
          title: "The why behind each one",
          text: "Every driver and every barrier is read in four layers (psychological, personal, social and cultural). The layer tells you what your brand can move, what it can only influence and what it has to align with. So the campaign pushes where it has strength."
        },
        {
          title: "From your decision to a recommendation",
          text: "Your decision becomes a question the conversation can answer, such as which of your territories has permission and which one already has an owner. We pick the method that answers it and deliver a recommendation with the evidence for and against. Your agency also gets the language worth using and the language to avoid.",
          method: "cc"
        }
      ],
      compare: {
        title: "Compared with a focus group or survey",
        them: "Focus group or survey",
        rows: [
          { label: "What it captures", them: "What people answer when they are asked", us: "What people say on their own, with no moderator" },
          { label: "How many people", them: "A sample recruited for the occasion", us: "The whole public conversation in the category" },
          { label: "The language", them: "Shaped by the question and the moderator", us: "The words people use in daily life" },
          { label: "Time", them: "Weeks to recruit, moderate and analyze", us: "Days from brief to first answer" },
          { label: "What it measures best", them: "Reaction to a stimulus and purchase intent", us: "A territory's permission and the drivers and barriers already there" }
        ]
      },
      deliverable: {
        title: "What you receive",
        name: "Launch study",
        items: [
          { name: "What draws and what holds back", text: "The drivers and barriers around your idea, with their weight and the quotes behind them." },
          { name: "Recommended territory", text: "Which one to build on, which one already has an owner in the conversation and why." },
          { name: "Language with permission", text: "The words and tones people already use, and the promises the category has worn out." },
          { name: "Brief with sources", text: "A document your agency can use as is, with every finding tied to what people said." }
        ]
      }
    }
  },

  entrar: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Las reglas no escritas, desde la conversación local",
          text: "Leemos la conversación del mercado en su idioma y en sus comunidades, antes de que llegues. De ahí salen las reglas que nadie te va a explicar, como qué se respeta, qué se ridiculiza y qué error te marca como alguien de fuera. Leemos en 16 idiomas y en más de 20 países.",
          method: "cc"
        },
        {
          title: "Quién da credibilidad",
          text: "En cada mercado hay voces que legitiman, voces que conectan comunidades y voces que articulan la crítica. Las encontramos en la conversación, agrupamos lo que dicen y un Intelligence Architect aprueba el mapa antes de entregarlo. Así sabes con quién empezar y a quién vigilar.",
          method: "ia"
        },
        {
          title: "De tu decisión a una recomendación",
          text: "Tu decisión de entrada se vuelve una pregunta que la conversación puede responder, como qué código conviene ocupar o cómo fue recibida cada marca que llegó antes. Elegimos el método, respondemos con evidencia y cerramos con recomendaciones de tono, lenguaje y primeras voces."
        }
      ],
      compare: {
        title: "Frente a un estudio de mercado tradicional",
        them: "Estudio de mercado tradicional",
        rows: [
          { label: "Tiempo", them: "Semanas de campo y análisis", us: "Días desde el brief hasta la primera respuesta" },
          { label: "De dónde sale", them: "Encuestas, entrevistas e investigación de escritorio", us: "La conversación pública del mercado, en su idioma" },
          { label: "Qué responde mejor", them: "Tamaño, participación y perfil del consumidor", us: "Cómo se habla ahí, qué se respeta y quién da credibilidad" },
          { label: "Las voces", them: "Rara vez identifica quién legitima en la categoría", us: "Quién legitima, quién conecta y quién critica" },
          { label: "Varios mercados", them: "Cada país pide su propio trabajo de campo", us: "Cada país leído por separado, con el mismo criterio" }
        ]
      },
      deliverable: {
        title: "Lo que recibes",
        name: "Estudio de entrada",
        items: [
          { name: "Reglas no escritas", text: "Lo que significa la categoría en ese mercado, con las citas que lo sostienen." },
          { name: "Mapa de voces", text: "Quién legitima, quién conecta comunidades y a quién conviene vigilar." },
          { name: "Lo que conviene evitar", text: "Promesas gastadas, tonos que delatan a alguien de fuera y temas sensibles." },
          { name: "Brief de entrada", text: "Qué código ocupar, qué lenguaje usar y con qué voces empezar." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "The unwritten rules, from local conversation",
          text: "We read the market's conversation in its language and its communities, before you arrive. That is where the rules nobody will explain to you come from, such as what is respected, what is mocked and which mistake marks you as an outsider. We read in 16 languages across more than 20 countries.",
          method: "cc"
        },
        {
          title: "Who lends credibility",
          text: "Every market has voices that legitimize, voices that connect communities and voices that lead the criticism. We find them in the conversation, group what they say, and an Intelligence Architect approves the map before it is delivered. So you know who to start with and who to watch.",
          method: "ia"
        },
        {
          title: "From your decision to a recommendation",
          text: "Your entry decision becomes a question the conversation can answer, such as which code to take or how each brand that came before was received. We pick the method, answer with evidence and close with recommendations on tone, language and first voices."
        }
      ],
      compare: {
        title: "Compared with traditional market research",
        them: "Traditional market research",
        rows: [
          { label: "Time", them: "Weeks of fieldwork and analysis", us: "Days from brief to first answer" },
          { label: "Where it comes from", them: "Surveys, interviews and desk research", us: "The market's public conversation, in its language" },
          { label: "What it answers best", them: "Size, share and consumer profile", us: "How people talk there, what's respected and who lends credibility" },
          { label: "The voices", them: "Rarely identifies who legitimizes the category", us: "Who legitimizes, who connects and who criticizes" },
          { label: "Several markets", them: "Each country needs its own fieldwork", us: "Each country read separately, with the same criteria" }
        ]
      },
      deliverable: {
        title: "What you receive",
        name: "Market entry study",
        items: [
          { name: "Unwritten rules", text: "What the category means in that market, with the quotes that support it." },
          { name: "Map of voices", text: "Who legitimizes, who connects communities and who is worth watching." },
          { name: "What to avoid", text: "Worn-out promises, tones that give away an outsider and sensitive topics." },
          { name: "Entry brief", text: "Which code to take, which language to use and which voices to start with." }
        ]
      }
    }
  },

  innovar: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Los arreglos caseros muestran lo que falta",
          text: "Cuando la gente adapta un producto en casa, le cambia algo o lo usa para otra cosa, está diciendo qué le falta. Buscamos esos arreglos en reseñas, foros y redes, y leemos las razones detrás de cada uno. Ahí suele estar la necesidad que ninguna marca ha resuelto.",
          method: "tb"
        },
        {
          title: "Qué necesidades están creciendo",
          text: "Una necesidad puede ser real y estar estancada. Medimos cuánto se habla de cada una, qué tan rápido crece y en cuántas comunidades aparece, y la colocamos en su etapa, de Emergente a Saturación. Así eliges una que todavía tiene espacio."
        },
        {
          title: "De tu decisión a una recomendación",
          text: "Tu decisión se vuelve una pregunta que la conversación puede responder, como qué dimensión de valor nadie ocupa en tu categoría. Elegimos el método y entregamos rutas de concepto, cada una con la evidencia que la sostiene y los frenos que tendría que resolver. Cerramos con las preguntas que una prueba de concepto debería medir después.",
          method: "vpm"
        }
      ],
      compare: {
        title: "Frente a una lluvia de ideas interna",
        them: "Lluvia de ideas interna",
        rows: [
          { label: "De dónde salen las ideas", them: "La experiencia y la intuición de tu equipo", us: "Lo que la gente ya intenta resolver por su cuenta" },
          { label: "Qué conoce mejor", them: "Tu negocio, tus capacidades y tus restricciones", us: "Las necesidades de la gente, dichas en sus palabras" },
          { label: "Las hipótesis", them: "Tiende a confirmar lo que el equipo ya cree", us: "Pone a prueba las hipótesis del equipo con evidencia" },
          { label: "Cómo se prioriza", them: "Votación o consenso en la sala", us: "Por tamaño, crecimiento y relación con una compra" },
          { label: "Lo que queda", them: "Una lista de ideas", us: "Rutas de concepto con evidencia y preguntas para validar" }
        ]
      },
      deliverable: {
        title: "Lo que recibes",
        name: "Estudio de innovación",
        items: [
          { name: "Mapa de necesidades", text: "Lo que sigue sin resolverse, ordenado por tamaño, crecimiento y relación con una compra." },
          { name: "Arreglos caseros", text: "Cómo la gente compensa hoy lo que falta, con las citas que lo muestran." },
          { name: "Rutas de concepto", text: "Direcciones de producto con la evidencia a favor y los frenos que tendrían que disolver." },
          { name: "Preguntas para validar", text: "Lo que una prueba cuantitativa de concepto debería medir después." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "Home fixes reveal what's missing",
          text: "When people adapt a product at home, change something about it or use it for something else, they are telling you what is missing. We look for those fixes in reviews, forums and social media, and read the reasons behind each one. That is usually where the need no brand has solved lives.",
          method: "tb"
        },
        {
          title: "Which needs are growing",
          text: "A need can be real and still be flat. We measure how much each one is discussed, how fast it grows and how many communities carry it, and place it in its stage, from Emerging to Saturation. So you pick one that still has room."
        },
        {
          title: "From your decision to a recommendation",
          text: "Your decision becomes a question the conversation can answer, such as which dimension of value nobody owns in your category. We pick the method and deliver concept routes, each with the evidence behind it and the barriers it would have to solve. We close with the questions a concept test should measure next.",
          method: "vpm"
        }
      ],
      compare: {
        title: "Compared with an internal brainstorm",
        them: "Internal brainstorm",
        rows: [
          { label: "Where ideas come from", them: "Your team's experience and intuition", us: "What people already try to solve on their own" },
          { label: "What it knows best", them: "Your business, capabilities and constraints", us: "People's needs, in their own words" },
          { label: "Hypotheses", them: "Tends to confirm what the team already believes", us: "Tests the team's hypotheses against evidence" },
          { label: "How it prioritizes", them: "A vote or consensus in the room", us: "By size, growth and link to a purchase" },
          { label: "What you're left with", them: "A list of ideas", us: "Concept routes with evidence and questions to validate" }
        ]
      },
      deliverable: {
        title: "What you receive",
        name: "Innovation study",
        items: [
          { name: "Needs map", text: "What remains unsolved, ranked by size, growth and link to a purchase." },
          { name: "Home fixes", text: "How people make up for what is missing today, with the quotes that show it." },
          { name: "Concept routes", text: "Product directions with the evidence for them and the barriers they would have to remove." },
          { name: "Questions to validate", text: "What a quantitative concept test should measure next." }
        ]
      }
    }
  },

  planear: {
    es: {
      howTitle: "Cómo lo resolvemos",
      steps: [
        {
          title: "Tu año, mapeado",
          text: "Empezamos por tu calendario de lanzamientos, campañas y temporadas, como Hot Sale, regreso a clases o Buen Fin. El reporte continuo corre todo el año y cada estudio se coloca antes de la decisión que alimenta. La respuesta ya existe cuando llega la reunión."
        },
        {
          title: "Entre estudios, el reporte de cada mes",
          text: "Entre un estudio y otro, el reporte compara cada mes contra el anterior sobre los mismos temas. Muestra qué se movió y por qué, y detecta cuándo empieza a moverse la conversación de una temporada. Si aparece una pregunta urgente, hay espacio en el plan para ella.",
          method: "tb"
        },
        {
          title: "Cada estudio parte de lo que el reporte ya vio",
          text: "Los temas, las fuentes y las correcciones se acumulan durante el año. Cada estudio arranca con esa base, así que la pregunta llega más afinada y la respuesta tarda menos. Como todos usan el mismo criterio, los estudios se pueden comparar entre sí."
        }
      ],
      compare: {
        title: "Frente a contratar estudios sueltos",
        them: "Estudios sueltos",
        rows: [
          { label: "El arranque", them: "Cada estudio empieza de cero", us: "Cada estudio parte de temas y fuentes ya revisados" },
          { label: "Cuándo llegan", them: "Se piden cuando surge la pregunta", us: "Colocados antes de cada decisión del año" },
          { label: "Entre un estudio y otro", them: "Nadie sigue lo que pasa", us: "Un reporte continuo con lo que cambió" },
          { label: "Comparar resultados", them: "Criterios y fuentes cambian de un estudio a otro", us: "Mismos temas y criterios durante todo el año" },
          { label: "Quién los hace", them: "Equipos distintos según el proveedor o el momento", us: "El mismo Intelligence Architect durante el año" }
        ]
      },
      deliverable: {
        title: "Lo que recibes en el año",
        name: "Plan anual de investigación",
        items: [
          { name: "Calendario de estudios", text: "Cada estudio con su pregunta, su método y su fecha, colocado antes de la decisión que alimenta." },
          { name: "Reporte continuo", text: "Lo que se movió, por qué y qué vigilar, con los mismos temas que usan los estudios." },
          { name: "Un espacio permanente de tu marca", text: "Temas, correcciones y evidencia que se acumulan durante el año." },
          { name: "Un Intelligence Architect asignado", text: "La misma persona todo el año, que conoce tu categoría y responde por cada análisis." }
        ]
      }
    },
    en: {
      howTitle: "How we solve it",
      steps: [
        {
          title: "Your year, mapped",
          text: "We start from your calendar of launches, campaigns and seasons, such as Hot Sale, back to school or Buen Fin. The ongoing report runs all year and each study sits right before the decision it feeds. The answer is ready when the meeting comes."
        },
        {
          title: "Between studies, the ongoing report",
          text: "Between one study and the next, the report compares each month against the previous one on the same topics. It shows what moved and why, and catches when a season's conversation starts to move. If an urgent question comes up, the plan has room for it.",
          method: "tb"
        },
        {
          title: "Each study starts from what the report already saw",
          text: "Topics, sources and corrections build up over the year. Each study starts from that base, so the question arrives sharper and the answer takes less time. Since they all use the same criteria, the studies can be compared with each other."
        }
      ],
      compare: {
        title: "Compared with one-off studies",
        them: "One-off studies",
        rows: [
          { label: "Starting point", them: "Each study starts from scratch", us: "Each study starts from topics and sources already reviewed" },
          { label: "When they arrive", them: "Ordered when the question comes up", us: "Placed before each decision of the year" },
          { label: "Between studies", them: "Nobody follows what happens", us: "A ongoing report on what changed" },
          { label: "Comparing results", them: "Criteria and sources change from study to study", us: "Same topics and criteria all year" },
          { label: "Who does them", them: "Different teams depending on vendor or timing", us: "The same Intelligence Architect all year" }
        ]
      },
      deliverable: {
        title: "What you receive over the year",
        name: "Annual research plan",
        items: [
          { name: "Study calendar", text: "Each study with its question, method and date, placed before the decision it feeds." },
          { name: "Ongoing report", text: "What moved, why and what to watch, with the same topics the studies use." },
          { name: "A permanent space for your brand", text: "Topics, corrections and evidence that build up over the year." },
          { name: "An assigned Intelligence Architect", text: "The same person all year, who knows your category and answers for every analysis." }
        ]
      }
    }
  }
};
