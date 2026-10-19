import type { Industry } from "../stories/schema";

/**
 * Industry pages: the questions Noisia can answer in each industry (questions, never findings),
 * where the conversation lives, and which feed stories belong to it.
 * Source: packages/pitch-kit/commercial/INDUSTRIES.md. Politics is deliberately left out.
 */
/** Icon keys; src/components/learn/icons.ts maps each one to an Iconoir icon. */
export type IndustryIcon =
  | "food"
  | "betting"
  | "mobility"
  | "telecom"
  | "banking"
  | "retail"
  | "tech"
  | "fashion"
  | "beauty"
  | "home"
  | "entertainment"
  | "education"
  | "travel"
  | "b2b";

/** The moment of a brand a question belongs to: the Spanish slug of a page in src/content/moments.ts. */
export type MomentKey = "monitorear" | "defender" | "optimizar" | "lanzar" | "entrar" | "innovar";

export type IndustryEntry = {
  slug: { es: string; en: string };
  icon: IndustryIcon;
  /** Feed industries whose stories appear on this page. */
  storyIndustries: Industry[];
  es: IndustryCopy;
  en: IndustryCopy;
};

export type IndustryCopy = {
  name: string;
  metaDescription: string;
  title: string;
  lead: string;
  questions: { moment: MomentKey; text: string }[];
  where: string[];
};

/** Interface copy of the index and the detail pages. */
export const industriesPage = {
  es: {
    metaTitle: "Inteligencia social por industria",
    metaDescription: "Las preguntas que la conversación pública puede responder en cada industria, de alimentos y bebidas a telecom, banca, belleza o turismo.",
    title: "Lo que podemos entender en tu industria",
    lead: "Elige tu industria y mira las preguntas que la conversación puede responder. Lo que encontremos depende de tu marca y de tu momento.",
    searchLabel: "Buscar una industria",
    searchPlaceholder: "Busca tu industria o tu pregunta",
    empty: "No encontramos esa industria con esas palabras.",
    questionsCount: (n: number) => `${n} preguntas`,
    questions: "Preguntas que podemos responder",
    questionsLead: "Cada pregunta se conecta con un momento de tu marca. Toca uno para ver cómo lo resolvemos.",
    where: "Dónde vive la conversación",
    whereLead: "Las fuentes se eligen según la pregunta. Estas son las que más pesan en esta industria.",
    stories: "Insights de esta industria",
    seeFeed: "Ver todos en el feed",
    related: "Otras industrias",
    allIndustries: "Todas las industrias",
    ctaTitle: "¿Tu pregunta no está aquí?",
    ctaText: "Tráela al taller. Si la conversación puede responderla, te decimos cómo.",
    ctaLabel: "Agenda un taller gratis"
  },
  en: {
    metaTitle: "Social intelligence by industry",
    metaDescription: "The questions public conversation can answer in each industry, from food and beverage to telecom, banking, beauty or travel.",
    title: "What we can understand in your industry",
    lead: "Pick your industry and see the questions the conversation can answer. What we find depends on your brand and your moment.",
    searchLabel: "Search for an industry",
    searchPlaceholder: "Search your industry or your question",
    empty: "We couldn't find an industry with those words.",
    questionsCount: (n: number) => `${n} questions`,
    questions: "Questions we can answer",
    questionsLead: "Each question connects to a moment of your brand. Tap one to see how we solve it.",
    where: "Where the conversation lives",
    whereLead: "Sources are chosen for the question. These are the ones that weigh most in this industry.",
    stories: "Insights from this industry",
    seeFeed: "See them all in the feed",
    related: "Other industries",
    allIndustries: "All industries",
    ctaTitle: "Your question isn't here?",
    ctaText: "Bring it to the workshop. If the conversation can answer it, we'll tell you how.",
    ctaLabel: "Book a free workshop"
  }
};

export const industryEntries: IndustryEntry[] = [
  {
    slug: { es: "alimentos-y-bebidas", en: "food-and-beverage" },
    icon: "food",
    storyIndustries: ["alimentos-y-bebidas"],
    es: {
      name: "Alimentos y bebidas",
      metaDescription:
        "Entiende en qué ocasiones se elige tu categoría, qué hace que alguien repita y qué territorio sigue libre frente a tu competencia.",
      title: "Qué ocasiones, precios y rituales mueven tu categoría",
      lead:
        "Incluye cerveza, lácteos, agua, bebidas listas para tomar, café, snacks y cafeterías. Te ayudamos a leer cómo se elige, se prueba y se repite lo que vendes.",
      questions: [
        { moment: "defender", text: "¿En qué ocasiones se elige tu categoría, y en cuáles gana otra bebida?" },
        { moment: "lanzar", text: "¿Qué empuja a probar un producto nuevo en el anaquel, y qué hace que se repita?" },
        { moment: "optimizar", text: "¿Dónde se justifica pagar más, y dónde el precio se siente caro?" },
        { moment: "innovar", text: "¿Qué significa tu marca en la mesa, en la fiesta, en el partido o en la rutina?" },
        { moment: "entrar", text: "¿Qué está capitalizando cada competidor, y qué territorio sigue libre?" },
        { moment: "optimizar", text: "¿Cómo cambia la conversación entre ciudades, temporadas o eventos?" },
        { moment: "monitorear", text: "¿Cómo aterrizó tu lanzamiento o tu campaña, semana a semana?" }
      ],
      where: ["TikTok", "Instagram", "Facebook", "X", "Reseñas de Google Maps", "Comentarios en retail"]
    },
    en: {
      name: "Food and beverage",
      metaDescription:
        "Understand which occasions your category wins, what makes people buy again, and which territory your competitors have left open.",
      title: "What occasions, prices and rituals move your category",
      lead:
        "Covers beer, dairy, water, ready-to-drink beverages, coffee, snacks and coffee shops. We help you read how people choose, try and come back to what you sell.",
      questions: [
        { moment: "defender", text: "In which occasions do people pick your category, and in which does another drink win?" },
        { moment: "lanzar", text: "What makes someone try a new product on the shelf, and what makes them buy it again?" },
        { moment: "optimizar", text: "Where does paying more feel worth it, and where does the price feel too high?" },
        { moment: "innovar", text: "What does your brand mean at the table, at a party, at the game or in a daily routine?" },
        { moment: "entrar", text: "What is each competitor capitalizing on, and which territory is still open?" },
        { moment: "optimizar", text: "How does the conversation change across cities, seasons or events?" },
        { moment: "monitorear", text: "How did your launch or campaign land, week by week?" }
      ],
      where: ["TikTok", "Instagram", "Facebook", "X", "Google Maps reviews", "Retail comments"]
    }
  },
  {
    slug: { es: "apuestas-y-gaming", en: "betting-and-gaming" },
    icon: "betting",
    storyIndustries: ["apuestas-y-gaming"],
    es: {
      name: "Apuestas y gaming",
      metaDescription:
        "Entiende qué empuja a abrir una cuenta en una casa de apuestas, qué genera confianza y qué se dice de pagos, bonos y servicio.",
      title: "Qué hace que alguien confíe en una plataforma de apuestas",
      lead:
        "Te ayudamos a leer cómo se vive la apuesta y qué separa a una plataforma de otra en la conversación de los jugadores.",
      questions: [
        { moment: "entrar", text: "¿Qué empuja a abrir una cuenta en una casa de apuestas, y qué la frena?" },
        { moment: "lanzar", text: "¿Qué genera confianza en una plataforma nueva frente a las que ya están?" },
        { moment: "innovar", text: "¿Cómo se vive la apuesta en un partido, un torneo o una temporada?" },
        { moment: "defender", text: "¿Qué está diciendo la gente de los pagos, los bonos y el servicio de cada marca?" },
        { moment: "optimizar", text: "¿Qué lenguaje pertenece a la categoría y cuál suena prestado?" },
        { moment: "monitorear", text: "¿Cómo se mueve la reputación de tu marca frente a cada competidor, mes a mes?" }
      ],
      where: ["X", "Reddit", "YouTube", "Reseñas de tiendas de apps", "Foros de apuestas"]
    },
    en: {
      name: "Betting and gaming",
      metaDescription:
        "Understand what makes people open a sportsbook account, what builds trust, and what they say about payouts, bonuses and service.",
      title: "What makes someone trust a betting platform",
      lead:
        "We help you read how people experience betting and what sets one platform apart from another in players' own conversation.",
      questions: [
        { moment: "entrar", text: "What makes someone open an account with a sportsbook, and what holds them back?" },
        { moment: "lanzar", text: "What builds trust in a new platform compared with the ones already there?" },
        { moment: "innovar", text: "How do people experience betting during a match, a tournament or a season?" },
        { moment: "defender", text: "What are people saying about each brand's payouts, bonuses and service?" },
        { moment: "optimizar", text: "Which language belongs to the category, and which sounds borrowed?" },
        { moment: "monitorear", text: "How is your brand's reputation moving against each competitor, month by month?" }
      ],
      where: ["X", "Reddit", "YouTube", "App store reviews", "Betting forums"]
    }
  },
  {
    slug: { es: "movilidad", en: "mobility" },
    icon: "mobility",
    storyIndustries: ["movilidad"],
    es: {
      name: "Movilidad",
      metaDescription:
        "Entiende por qué un viajero elige rentar con tu marca, dónde se pierde la confianza y qué empuja la compra de un auto o un eléctrico.",
      title: "Dónde se gana y se pierde la confianza en cada trayecto",
      lead:
        "Incluye renta de autos y automotriz. Te ayudamos a leer el recorrido completo, de la búsqueda a la devolución, y lo que pesa al comprar.",
      questions: [
        { moment: "defender", text: "¿Por qué un viajero elige rentar con una marca, o abre una app?" },
        { moment: "optimizar", text: "¿En qué momentos del recorrido (búsqueda, mostrador, devolución, factura) se pierde la confianza?" },
        { moment: "entrar", text: "¿Qué empuja y qué detiene la compra de un auto, un eléctrico o unas llantas de una marca nueva?" },
        { moment: "lanzar", text: "¿Qué hace que una primera experiencia con un eléctrico sea buena?" },
        { moment: "defender", text: "¿Cómo se habla de tu marca frente a cada competidor en aeropuertos, ciudades y mercados?" },
        { moment: "monitorear", text: "¿Qué se dice de tu marca y sus sucursales mientras pasa?" }
      ],
      where: ["Reseñas de Google Maps", "Tripadvisor", "Trustpilot", "X", "Reddit", "YouTube"]
    },
    en: {
      name: "Mobility",
      metaDescription:
        "Understand why travelers rent with your brand, where trust breaks along the way, and what drives buying a car or an EV.",
      title: "Where trust is won and lost along every trip",
      lead:
        "Covers car rental and automotive. We help you read the full journey, from search to return, and what weighs on a purchase.",
      questions: [
        { moment: "defender", text: "Why does a traveler rent with one brand, or open an app instead?" },
        { moment: "optimizar", text: "At which points of the journey (search, counter, return, invoice) does trust break?" },
        { moment: "entrar", text: "What drives and what stops buying a car, an EV or tires from a new brand?" },
        { moment: "lanzar", text: "What makes a first experience with an EV a good one?" },
        { moment: "defender", text: "How do people talk about your brand against each competitor across airports, cities and markets?" },
        { moment: "monitorear", text: "What are people saying about your brand and its locations as it happens?" }
      ],
      where: ["Google Maps reviews", "Tripadvisor", "Trustpilot", "X", "Reddit", "YouTube"]
    }
  },
  {
    slug: { es: "telecom", en: "telecom" },
    icon: "telecom",
    storyIndustries: ["telecom"],
    es: {
      name: "Telecom",
      metaDescription:
        "Entiende qué hace que alguien cambie de compañía, qué lo retiene y cómo se habla de cobertura, atención y precio en cada región.",
      title: "Qué hace que alguien se quede o se cambie de compañía",
      lead:
        "Te ayudamos a leer la conversación de servicio tema por tema y a cruzarla con lo que ya mides en tus encuestas.",
      questions: [
        { moment: "defender", text: "¿Qué hace que alguien se cambie de compañía, y qué lo retiene?" },
        { moment: "optimizar", text: "¿En qué temas de servicio la conversación coincide con lo que mide tu encuesta, y en cuáles no?" },
        { moment: "entrar", text: "¿Qué se dice de la cobertura, la atención y el precio, por región?" },
        { moment: "innovar", text: "¿Qué está capitalizando cada competidor en la conversación?" },
        { moment: "monitorear", text: "¿Qué temas de servicio suben o bajan cada mes, y dónde?" }
      ],
      where: ["X", "Facebook", "Reseñas de tiendas de apps", "Reddit", "Foros locales"]
    },
    en: {
      name: "Telecom",
      metaDescription:
        "Understand what makes customers switch carriers, what keeps them, and how people talk about coverage, support and price by region.",
      title: "What makes customers stay or switch carriers",
      lead:
        "We help you read the service conversation topic by topic and line it up with what your surveys already measure.",
      questions: [
        { moment: "defender", text: "What makes someone switch carriers, and what keeps them?" },
        { moment: "optimizar", text: "On which service topics does the conversation match what your survey measures, and on which does it not?" },
        { moment: "entrar", text: "What are people saying about coverage, support and price, by region?" },
        { moment: "innovar", text: "What is each competitor capitalizing on in the conversation?" },
        { moment: "monitorear", text: "Which service topics rise or fall each month, and where?" }
      ],
      where: ["X", "Facebook", "App store reviews", "Reddit", "Local forums"]
    }
  },
  {
    slug: { es: "banca-fintech-y-seguros", en: "banking-fintech-insurance" },
    icon: "banking",
    storyIndustries: [],
    es: {
      name: "Banca, fintech y seguros",
      metaDescription:
        "Entiende qué genera confianza para abrir una cuenta o contratar un seguro en línea, dónde se rompe el alta y cómo se habla de dinero.",
      title: "Qué genera confianza cuando se trata de dinero",
      lead:
        "Te ayudamos a leer el camino entre la intención y el alta, y cómo habla la gente de su dinero cuando algo sale bien o mal.",
      questions: [
        { moment: "entrar", text: "¿Qué genera confianza para abrir una cuenta o contratar un seguro en línea?" },
        { moment: "optimizar", text: "¿Dónde se rompe el camino entre la intención y el alta?" },
        { moment: "defender", text: "¿Qué se dice de la atención cuando algo sale mal: un cargo, un reclamo, un siniestro?" },
        { moment: "innovar", text: "¿Qué lenguaje usa la gente para hablar de dinero, deuda y protección?" },
        { moment: "lanzar", text: "¿Cómo se compara tu marca con la banca tradicional y con las apps nuevas?" },
        { moment: "monitorear", text: "¿Qué conversación de reputación vale la pena atender antes de que escale?" }
      ],
      where: ["X", "Reddit", "Reseñas de tiendas de apps", "Facebook", "Foros de finanzas personales"]
    },
    en: {
      name: "Banking, fintech and insurance",
      metaDescription:
        "Understand what builds trust to open an account or buy insurance online, where sign-up breaks, and how people talk about money.",
      title: "What builds trust when money is involved",
      lead:
        "We help you read the path from intent to sign-up, and how people talk about their money when things go right or wrong.",
      questions: [
        { moment: "entrar", text: "What builds enough trust to open an account or buy insurance online?" },
        { moment: "optimizar", text: "Where does the path from intent to sign-up break?" },
        { moment: "defender", text: "What do people say about support when something goes wrong: a charge, a complaint, a claim?" },
        { moment: "innovar", text: "What language do people use to talk about money, debt and protection?" },
        { moment: "lanzar", text: "How does your brand compare with traditional banks and with newer apps?" },
        { moment: "monitorear", text: "Which reputation conversation is worth addressing before it escalates?" }
      ],
      where: ["X", "Reddit", "App store reviews", "Facebook", "Personal finance forums"]
    }
  },
  {
    slug: { es: "retail-y-farmacias", en: "retail-and-pharmacies" },
    icon: "retail",
    storyIndustries: ["retail", "salud-y-farmacias"],
    es: {
      name: "Retail y farmacias",
      metaDescription:
        "Entiende en qué momento de la visita, en tienda o en línea, se pierde al cliente, y qué fricciones se resuelven con operación.",
      title: "En qué momento de la compra se pierde a un cliente",
      lead:
        "Incluye retail, farmacias y e-commerce. Te ayudamos a leer la visita fricción por fricción, por sucursal o ciudad.",
      questions: [
        { moment: "optimizar", text: "¿En qué momento de la visita, en tienda o en línea, se pierde al cliente?" },
        { moment: "innovar", text: "¿Qué fricciones se arreglan con operación y cuáles con comunicación?" },
        { moment: "defender", text: "¿Qué empuja a elegir una cadena sobre otra cuando el producto es el mismo?" },
        { moment: "entrar", text: "¿Qué se dice de la entrega, el surtido y la atención, por sucursal o ciudad?" },
        { moment: "monitorear", text: "¿Qué sucursales o servicios concentran la conversación cada mes?" }
      ],
      where: ["Reseñas de Google Maps", "X", "Facebook", "Reseñas de tiendas de apps"]
    },
    en: {
      name: "Retail and pharmacies",
      metaDescription:
        "Understand at which point of the visit, in store or online, you lose a customer, and which friction points operations can fix.",
      title: "At which point of the purchase you lose a customer",
      lead:
        "Covers retail, pharmacies and e-commerce. We help you read the visit one friction point at a time, by store or city.",
      questions: [
        { moment: "optimizar", text: "At which point of the visit, in store or online, do you lose the customer?" },
        { moment: "innovar", text: "Which friction points get fixed through operations, and which through communication?" },
        { moment: "defender", text: "What makes people pick one chain over another when the product is the same?" },
        { moment: "entrar", text: "What are people saying about delivery, assortment and service, by store or city?" },
        { moment: "monitorear", text: "Which stores or services drive the conversation each month?" }
      ],
      where: ["Google Maps reviews", "X", "Facebook", "App store reviews"]
    }
  },
  {
    slug: { es: "tecnologia-de-consumo", en: "consumer-tech" },
    icon: "tech",
    storyIndustries: ["tecnologia-de-consumo"],
    es: {
      name: "Tecnología de consumo",
      metaDescription:
        "Entiende qué empuja a comprar un dispositivo para la casa, qué preocupa de la privacidad y cómo se usa de verdad frente al anuncio.",
      title: "Cómo se usa de verdad un dispositivo en casa",
      lead:
        "Te ayudamos a leer qué impulsa y qué frena la compra, y la distancia entre lo que se anuncia y lo que la gente vive con el producto.",
      questions: [
        { moment: "entrar", text: "¿Qué empuja a comprar un dispositivo nuevo para la casa, y qué lo frena?" },
        { moment: "defender", text: "¿Qué preocupa de la privacidad, la pantalla o la conexión, y a quién?" },
        { moment: "innovar", text: "¿Cómo se usa el producto de verdad, frente a cómo se anuncia?" },
        { moment: "optimizar", text: "¿Qué está ganando cada competidor en la conversación?" },
        { moment: "monitorear", text: "¿Cómo aterrizó tu lanzamiento y qué se dice cada mes?" }
      ],
      where: ["Reddit", "YouTube", "X", "Reseñas de retailers", "Reseñas de tiendas de apps"]
    },
    en: {
      name: "Consumer tech",
      metaDescription:
        "Understand what drives people to buy a device for their home, what worries them about privacy, and how they really use it.",
      title: "How people really use a device at home",
      lead:
        "We help you read what drives and what stalls the purchase, and the gap between how a product is advertised and how people live with it.",
      questions: [
        { moment: "entrar", text: "What drives people to buy a new device for their home, and what holds them back?" },
        { moment: "defender", text: "What worries people about privacy, screens or connectivity, and who worries most?" },
        { moment: "innovar", text: "How do people really use the product, compared with how it is advertised?" },
        { moment: "optimizar", text: "What is each competitor winning in the conversation?" },
        { moment: "monitorear", text: "How did your launch land, and what are people saying each month?" }
      ],
      where: ["Reddit", "YouTube", "X", "Retailer reviews", "App store reviews"]
    }
  },
  {
    slug: { es: "moda-y-artesania", en: "fashion-and-craft" },
    icon: "fashion",
    storyIndustries: ["moda-y-artesania"],
    es: {
      name: "Moda y artesanía",
      metaDescription:
        "Entiende qué hace que la gente pague por diseño de autor, qué significa tu marca y qué territorio narrativo puedes ocupar.",
      title: "Qué hace que alguien pague por diseño de autor",
      lead:
        "Incluye moda, diseño y artesanía. Te ayudamos a leer el significado de tu marca y la conversación sobre autoría que toca a la categoría.",
      questions: [
        { moment: "defender", text: "¿Qué hace que la gente pague por diseño de autor frente a la imitación?" },
        { moment: "innovar", text: "¿Qué significa tu marca: regalo, identidad, orgullo, patrimonio?" },
        { moment: "entrar", text: "¿Qué conversación de apropiación, autoría o pago justo toca a la categoría?" },
        { moment: "lanzar", text: "¿Qué territorio narrativo puede ocupar tu marca sin sonar genérica?" },
        { moment: "monitorear", text: "¿Cómo se habla de cada colección o colaboración?" }
      ],
      where: ["Instagram", "TikTok", "Pinterest", "Facebook", "Prensa de moda"]
    },
    en: {
      name: "Fashion and craft",
      metaDescription:
        "Understand why people pay for original design, what your brand means to them, and which narrative territory you can own.",
      title: "What makes people pay for original design",
      lead:
        "Covers fashion, design and craft. We help you read what your brand means and the authorship conversation around the category.",
      questions: [
        { moment: "defender", text: "What makes people pay for original design instead of a copy?" },
        { moment: "innovar", text: "What does your brand mean: a gift, identity, pride, heritage?" },
        { moment: "entrar", text: "Which conversation about appropriation, authorship or fair pay touches the category?" },
        { moment: "lanzar", text: "Which narrative territory can your brand own without sounding generic?" },
        { moment: "monitorear", text: "How do people talk about each collection or collaboration?" }
      ],
      where: ["Instagram", "TikTok", "Pinterest", "Facebook", "Fashion press"]
    }
  },
  {
    slug: { es: "belleza", en: "beauty" },
    icon: "beauty",
    storyIndustries: ["belleza-y-cuidado-personal"],
    es: {
      name: "Belleza",
      metaDescription:
        "Entiende qué empuja a probar una marca de belleza, qué la mantiene en la rutina y qué creadores mueven de verdad la categoría.",
      title: "Qué hace que una marca entre y se quede en la rutina",
      lead:
        "Incluye belleza y cuidado personal. Te ayudamos a leer la prueba, la recompra y los momentos que mueven la compra.",
      questions: [
        { moment: "lanzar", text: "¿Qué empuja a probar una marca nueva, y qué hace que se quede en la rutina?" },
        { moment: "optimizar", text: "¿Qué fechas y momentos (regalo, temporada, ocasión) mueven la compra?" },
        { moment: "entrar", text: "¿Qué creadores mueven de verdad la categoría, más allá de los seguidores?" },
        { moment: "monitorear", text: "¿Cómo aterrizó tu campaña de temporada y qué se dijo de cada marca?" }
      ],
      where: ["TikTok", "Instagram", "YouTube", "Reseñas de retailers"]
    },
    en: {
      name: "Beauty",
      metaDescription:
        "Understand what makes people try a beauty brand, what keeps it in their routine, and which creators really move the category.",
      title: "What gets a brand into the routine, and keeps it there",
      lead:
        "Covers beauty and personal care. We help you read trial, repeat purchase and the moments that drive buying.",
      questions: [
        { moment: "lanzar", text: "What makes someone try a new brand, and what keeps it in their routine?" },
        { moment: "optimizar", text: "Which dates and moments (gifting, seasons, occasions) drive purchase?" },
        { moment: "entrar", text: "Which creators really move the category, beyond follower counts?" },
        { moment: "monitorear", text: "How did your seasonal campaign land, and what was said about each brand?" }
      ],
      where: ["TikTok", "Instagram", "YouTube", "Retailer reviews"]
    }
  },
  {
    slug: { es: "hogar-y-mascotas", en: "home-and-pets" },
    icon: "home",
    storyIndustries: ["hogar-y-descanso"],
    es: {
      name: "Hogar y mascotas",
      metaDescription:
        "Entiende qué hace que alguien invierta en un colchón, un mueble o algo para su mascota, y qué se dice después de la compra.",
      title: "Qué pesa antes y después de comprar para tu casa",
      lead:
        "Incluye hogar, descanso y mascotas. Te ayudamos a leer la decisión de compra y lo que pasa después: entrega, prueba y devoluciones.",
      questions: [
        { moment: "entrar", text: "¿Qué hace que alguien invierta en un colchón, un mueble o un producto para su mascota?" },
        { moment: "optimizar", text: "¿Qué se dice después de la compra: entrega, prueba, devoluciones?" },
        { moment: "defender", text: "¿Cómo se habla de la categoría en reseñas frente a redes?" },
        { moment: "monitorear", text: "¿Qué temas de producto o servicio aparecen cada mes?" }
      ],
      where: ["Trustpilot", "Reseñas de Google", "Reseñas de retailers", "Instagram", "Facebook"]
    },
    en: {
      name: "Home and pets",
      metaDescription:
        "Understand what makes people invest in a mattress, furniture or something for their pet, and what they say after they buy.",
      title: "What weighs on buying for the home, before and after",
      lead:
        "Covers home, sleep and pets. We help you read the purchase decision and what comes after: delivery, trial and returns.",
      questions: [
        { moment: "entrar", text: "What makes someone invest in a mattress, a piece of furniture or a product for their pet?" },
        { moment: "optimizar", text: "What do people say after the purchase: delivery, trial, returns?" },
        { moment: "defender", text: "How do people talk about the category in reviews compared with social media?" },
        { moment: "monitorear", text: "Which product or service topics come up each month?" }
      ],
      where: ["Trustpilot", "Google reviews", "Retailer reviews", "Instagram", "Facebook"]
    }
  },
  {
    slug: { es: "entretenimiento", en: "entertainment" },
    icon: "entertainment",
    storyIndustries: ["deportes-y-entretenimiento"],
    es: {
      name: "Entretenimiento",
      metaDescription:
        "Entiende qué hace memorable un evento, qué papel juegan los patrocinadores y cómo se vive cada función antes, durante y después.",
      title: "Qué hace que un evento se quede en la memoria",
      lead:
        "Incluye cine, música en vivo y medios. Te ayudamos a leer la experiencia completa de una audiencia, del anuncio al día siguiente.",
      questions: [
        { moment: "innovar", text: "¿Qué hace que un evento se sienta memorable, y qué lo desgasta?" },
        { moment: "entrar", text: "¿Qué papel juegan las marcas patrocinadoras en la experiencia?" },
        { moment: "optimizar", text: "¿Qué formatos y contenidos sostienen la conversación de una audiencia?" },
        { moment: "lanzar", text: "¿Cómo se vive cada evento antes, durante y después?" },
        { moment: "monitorear", text: "¿Qué se dice de cada evento, función o estreno mientras pasa?" }
      ],
      where: ["TikTok", "Instagram", "X", "YouTube", "Reseñas de venues"]
    },
    en: {
      name: "Entertainment",
      metaDescription:
        "Understand what makes an event memorable, what role sponsors play, and how audiences live each show before, during and after.",
      title: "What makes an event stick in people's memory",
      lead:
        "Covers film, live music and media. We help you read an audience's full experience, from the announcement to the day after.",
      questions: [
        { moment: "innovar", text: "What makes an event feel memorable, and what wears it down?" },
        { moment: "entrar", text: "What role do sponsor brands play in the experience?" },
        { moment: "optimizar", text: "Which formats and content keep an audience's conversation going?" },
        { moment: "lanzar", text: "How do people experience each event before, during and after?" },
        { moment: "monitorear", text: "What are people saying about each event, show or premiere as it happens?" }
      ],
      where: ["TikTok", "Instagram", "X", "YouTube", "Venue reviews"]
    }
  },
  {
    slug: { es: "educacion", en: "education" },
    icon: "education",
    storyIndustries: [],
    es: {
      name: "Educación",
      metaDescription:
        "Entiende qué pesa al elegir una universidad o un programa, cómo hablan estudiantes, egresados y padres, y qué te distingue.",
      title: "Qué pesa al elegir una universidad o un programa",
      lead:
        "Te ayudamos a leer a cada grupo que habla de tu institución y lo que la separa de las otras opciones que la gente compara.",
      questions: [
        { moment: "entrar", text: "¿Qué pesa al elegir una universidad o un programa, y qué frena la decisión?" },
        { moment: "defender", text: "¿Cómo hablan estudiantes, egresados y padres de tu institución?" },
        { moment: "innovar", text: "¿Qué la distingue de las otras opciones que la gente compara?" },
        { moment: "monitorear", text: "¿Qué conversación de cada campus o grupo de interés hay que atender?" }
      ],
      where: ["TikTok", "Instagram", "Facebook", "Reddit", "Reseñas de Google Maps"]
    },
    en: {
      name: "Education",
      metaDescription:
        "Understand what weighs on choosing a university or program, how students, alumni and parents talk, and what sets you apart.",
      title: "What weighs on choosing a university or program",
      lead:
        "We help you read each group that talks about your institution and what sets it apart from the other options people compare.",
      questions: [
        { moment: "entrar", text: "What weighs on choosing a university or program, and what holds the decision back?" },
        { moment: "defender", text: "How do students, alumni and parents talk about your institution?" },
        { moment: "innovar", text: "What sets it apart from the other options people compare?" },
        { moment: "monitorear", text: "Which conversation on each campus or stakeholder group needs attention?" }
      ],
      where: ["TikTok", "Instagram", "Facebook", "Reddit", "Google Maps reviews"]
    }
  },
  {
    slug: { es: "turismo", en: "travel" },
    icon: "travel",
    storyIndustries: [],
    es: {
      name: "Turismo",
      metaDescription:
        "Entiende qué hace que un destino o un hotel se elija sobre otro y qué momentos del viaje generan las mejores y peores reseñas.",
      title: "Qué hace que un destino o un hotel se elija sobre otro",
      lead:
        "Incluye turismo y hospitalidad. Te ayudamos a leer el viaje completo, de la elección a la reseña.",
      questions: [
        { moment: "entrar", text: "¿Qué hace que un destino o un hotel se elija sobre otro?" },
        { moment: "optimizar", text: "¿Qué momentos del viaje generan las mejores y las peores reseñas?" },
        { moment: "defender", text: "¿Qué se dice de la seguridad, el precio y la experiencia local?" },
        { moment: "monitorear", text: "¿Cómo se habla del destino en temporada alta y en eventos?" }
      ],
      where: ["Tripadvisor", "Reseñas de Google Maps", "Instagram", "TikTok", "YouTube"]
    },
    en: {
      name: "Travel",
      metaDescription:
        "Understand why travelers pick one destination or hotel over another, and which moments of a trip drive the best and worst reviews.",
      title: "Why travelers pick one destination or hotel over another",
      lead:
        "Covers travel and hospitality. We help you read the whole trip, from the choice to the review.",
      questions: [
        { moment: "entrar", text: "What makes people pick one destination or hotel over another?" },
        { moment: "optimizar", text: "Which moments of the trip lead to the best and the worst reviews?" },
        { moment: "defender", text: "What are people saying about safety, price and the local experience?" },
        { moment: "monitorear", text: "How do people talk about the destination in high season and during events?" }
      ],
      where: ["Tripadvisor", "Google Maps reviews", "Instagram", "TikTok", "YouTube"]
    }
  },
  {
    slug: { es: "b2b", en: "b2b" },
    icon: "b2b",
    storyIndustries: [],
    es: {
      name: "B2B",
      metaDescription:
        "Entiende qué se dice de tu categoría en medios y comunidades especializadas, y qué temas regulatorios o ambientales pueden escalar.",
      title: "Qué se dice de tu categoría antes de llegar a la prensa",
      lead:
        "Incluye infraestructura y sostenibilidad: industrias de ciclo largo donde la conversación pública es menor y el corpus se construye con más cuidado.",
      questions: [
        { moment: "entrar", text: "¿Qué se dice de tu categoría en medios, comunidades y búsquedas especializadas?" },
        { moment: "defender", text: "¿Qué temas regulatorios, ambientales o de comunidad pueden escalar?" },
        { moment: "optimizar", text: "¿Cómo se compara tu marca con sus competidores frente a inversionistas y prensa?" },
        { moment: "innovar", text: "¿Qué temas de sostenibilidad mueven la conversación de la categoría?" },
        { moment: "monitorear", text: "¿Qué historia de un proyecto o una planta está creciendo antes de llegar a la prensa?" }
      ],
      where: ["X", "LinkedIn (vía prensa)", "Medios especializados", "Búsqueda", "Foros técnicos"]
    },
    en: {
      name: "B2B",
      metaDescription:
        "Understand what specialized media and communities say about your category, and which regulatory or environmental issues could escalate.",
      title: "What is said about your category before the press picks it up",
      lead:
        "Covers infrastructure and sustainability: long-cycle industries where public conversation is thinner and the corpus takes more care to build.",
      questions: [
        { moment: "entrar", text: "What is said about your category in specialized media, communities and search?" },
        { moment: "defender", text: "Which regulatory, environmental or community issues could escalate?" },
        { moment: "optimizar", text: "How does your brand compare with its competitors in front of investors and the press?" },
        { moment: "innovar", text: "Which sustainability topics move the category's conversation?" },
        { moment: "monitorear", text: "Which story about a project or a plant is growing before it reaches the press?" }
      ],
      where: ["X", "LinkedIn (via press)", "Specialized media", "Search", "Technical forums"]
    }
  }
];
