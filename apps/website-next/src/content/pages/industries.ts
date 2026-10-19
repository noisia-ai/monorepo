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
    title: "Qué podemos responder en tu industria",
    lead: "Elige tu industria y mira las preguntas que la conversación puede responder. Lo que encontremos depende de tu marca y de lo que estés decidiendo.",
    searchLabel: "Buscar una industria",
    searchPlaceholder: "Busca tu industria o tu pregunta",
    empty: "No encontramos esa industria con esas palabras.",
    questionsCount: (n: number) => `${n} preguntas`,
    questions: "Preguntas que podemos responder",
    questionsLead: "Cada pregunta corresponde a un momento de tu marca. Toca una para ver cómo la resolvemos.",
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
    title: "What we can answer in your industry",
    lead: "Pick your industry and see the questions the conversation can answer. What we find depends on your brand and the decision in front of you.",
    searchLabel: "Search for an industry",
    searchPlaceholder: "Search your industry or your question",
    empty: "We couldn't find an industry with those words.",
    questionsCount: (n: number) => `${n} questions`,
    questions: "Questions we can answer",
    questionsLead: "Each question belongs to a moment of your brand. Tap one to see how we solve it.",
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
        "Inteligencia social para alimentos y bebidas. Leemos en qué ocasiones se elige tu categoría, por qué alguien vuelve a comprar y qué terreno sigue libre.",
      title: "Qué ocasiones, precios y rituales mueven tu categoría",
      lead:
        "Incluye cerveza, lácteos, agua, bebidas listas para tomar, café, snacks y cafeterías. Leemos cómo la gente elige lo que vendes y qué la hace volver a comprarlo.",
      questions: [
        { moment: "defender", text: "¿En qué ocasiones se elige tu categoría, y en cuáles gana otra bebida?" },
        { moment: "lanzar", text: "¿Qué empuja a probar un producto nuevo en el anaquel, y qué hace que se repita?" },
        { moment: "optimizar", text: "¿Dónde se justifica pagar más, y dónde el precio se siente caro?" },
        { moment: "innovar", text: "¿Qué significa tu marca en la mesa, en la fiesta, en el partido o en la rutina?" },
        { moment: "entrar", text: "¿Qué terreno ya ocupa cada competidor, y cuál sigue libre?" },
        { moment: "optimizar", text: "¿Cómo cambia la conversación entre ciudades, temporadas o eventos?" },
        { moment: "monitorear", text: "¿Cómo aterrizó tu lanzamiento o tu campaña, semana a semana?" }
      ],
      where: ["TikTok", "Instagram", "Facebook", "X", "Reseñas de Google Maps", "Comentarios en retail"]
    },
    en: {
      name: "Food and beverage",
      metaDescription:
        "Social intelligence for food and beverage brands. Which occasions your category wins, why people buy again, and which ground competitors have left open.",
      title: "What occasions, prices and rituals move your category",
      lead:
        "Covers beer, dairy, water, ready-to-drink beverages, coffee, snacks and coffee shops. We look at how people choose what you sell and what brings them back to buy it again.",
      questions: [
        { moment: "defender", text: "In which occasions do people pick your category, and in which does another drink win?" },
        { moment: "lanzar", text: "What makes someone try a new product on the shelf, and what makes them buy it again?" },
        { moment: "optimizar", text: "Where does paying more feel worth it, and where does the price feel too high?" },
        { moment: "innovar", text: "What does your brand mean at the table, at a party, at the game or in a daily routine?" },
        { moment: "entrar", text: "What ground does each competitor already hold, and what is still open?" },
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
        "Social listening para casas de apuestas. Qué hace que alguien abra una cuenta, qué le da confianza y qué dicen los jugadores de pagos, bonos y servicio.",
      title: "Qué hace que alguien confíe en una plataforma de apuestas",
      lead:
        "Leemos cómo hablan los jugadores de la apuesta y qué separa a una plataforma de otra cuando la comparan.",
      questions: [
        { moment: "entrar", text: "¿Qué empuja a abrir una cuenta en una casa de apuestas, y qué la frena?" },
        { moment: "lanzar", text: "¿Qué genera confianza en una plataforma nueva frente a las que ya están?" },
        { moment: "innovar", text: "¿Cómo se vive la apuesta en un partido, un torneo o una temporada?" },
        { moment: "defender", text: "¿Qué está diciendo la gente de los pagos, los bonos y el servicio de cada marca?" },
        { moment: "optimizar", text: "¿Qué lenguaje pertenece a la categoría y cuál suena prestado?" },
        { moment: "monitorear", text: "¿Cómo cambia la reputación de tu marca frente a cada competidor de un periodo a otro?" }
      ],
      where: ["X", "Reddit", "YouTube", "Reseñas de tiendas de apps", "Foros de apuestas"]
    },
    en: {
      name: "Betting and gaming",
      metaDescription:
        "Social listening for sportsbooks. What gets people to open an account, what earns their trust, and what players say about payouts and bonuses.",
      title: "What makes someone trust a betting platform",
      lead:
        "We look at how players talk about betting and what sets one platform apart when they compare them.",
      questions: [
        { moment: "entrar", text: "What makes someone open an account with a sportsbook, and what holds them back?" },
        { moment: "lanzar", text: "What builds trust in a new platform compared with the ones already there?" },
        { moment: "innovar", text: "How do people experience betting during a match, a tournament or a season?" },
        { moment: "defender", text: "What are people saying about each brand's payouts, bonuses and service?" },
        { moment: "optimizar", text: "Which language belongs to the category, and which sounds borrowed?" },
        { moment: "monitorear", text: "How does your brand's reputation shift against each competitor from one period to the next?" }
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
        "Inteligencia social para renta de autos y automotriz. Por qué un viajero elige tu marca, dónde se rompe la confianza y qué pesa al comprar un auto.",
      title: "Dónde se gana y se pierde la confianza en cada trayecto",
      lead:
        "Incluye renta de autos y automotriz. Leemos el recorrido completo, de la búsqueda a la devolución, y lo que pesa al comprar un auto.",
      questions: [
        { moment: "defender", text: "¿Por qué un viajero elige rentar con una marca, o abre una app?" },
        { moment: "optimizar", text: "¿En qué momentos del recorrido (búsqueda, mostrador, devolución, factura) se pierde la confianza?" },
        { moment: "entrar", text: "¿Qué empuja y qué detiene la compra de un auto, un eléctrico o unas llantas de una marca nueva?" },
        { moment: "lanzar", text: "¿Qué hace que una primera experiencia con un eléctrico sea buena?" },
        { moment: "defender", text: "¿Cómo se habla de tu marca frente a cada competidor en aeropuertos, ciudades y mercados?" },
        { moment: "monitorear", text: "¿Qué se dice de tu marca y de cada sucursal, periodo a periodo?" }
      ],
      where: ["Reseñas de Google Maps", "Tripadvisor", "Trustpilot", "X", "Reddit", "YouTube"]
    },
    en: {
      name: "Mobility",
      metaDescription:
        "Social intelligence for car rental and automotive brands. Why travelers rent with you, where trust breaks on the trip, and what weighs on buying a car.",
      title: "Where trust is won and lost along every trip",
      lead:
        "Covers car rental and automotive. We look at the full journey, from search to return, and what weighs on buying a car.",
      questions: [
        { moment: "defender", text: "Why does a traveler rent with one brand, or open an app instead?" },
        { moment: "optimizar", text: "At which points of the journey (search, counter, return, invoice) does trust break?" },
        { moment: "entrar", text: "What drives and what stops buying a car, an EV or tires from a new brand?" },
        { moment: "lanzar", text: "What makes a first experience with an EV a good one?" },
        { moment: "defender", text: "How do people talk about your brand against each competitor across airports, cities and markets?" },
        { moment: "monitorear", text: "What are people saying about your brand and each location, period by period?" }
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
        "Social listening para telecom. Qué hace que un cliente se cambie de compañía o se quede, y cómo se habla de cobertura, atención y precio en cada región.",
      title: "Qué hace que alguien se quede o se cambie de compañía",
      lead:
        "Leemos la conversación de servicio tema por tema y la cruzamos con lo que ya mides en tus encuestas.",
      questions: [
        { moment: "defender", text: "¿Qué hace que alguien se cambie de compañía, y qué lo retiene?" },
        { moment: "optimizar", text: "¿En qué temas de servicio la conversación coincide con lo que mide tu encuesta, y en cuáles no?" },
        { moment: "entrar", text: "¿Qué se dice de la cobertura, la atención y el precio, por región?" },
        { moment: "innovar", text: "¿En qué temas te está ganando cada competidor?" },
        { moment: "monitorear", text: "¿Qué temas de servicio suben o bajan de un reporte a otro, y dónde?" }
      ],
      where: ["X", "Facebook", "Reseñas de tiendas de apps", "Reddit", "Foros locales"]
    },
    en: {
      name: "Telecom",
      metaDescription:
        "Social listening for telecom. What makes customers switch carriers or stay, and how people talk about coverage, support and price in each region.",
      title: "What makes customers stay or switch carriers",
      lead:
        "We read the service conversation topic by topic and line it up with what your surveys already measure.",
      questions: [
        { moment: "defender", text: "What makes someone switch carriers, and what keeps them?" },
        { moment: "optimizar", text: "On which service topics does the conversation match what your survey measures, and on which does it not?" },
        { moment: "entrar", text: "What are people saying about coverage, support and price, by region?" },
        { moment: "innovar", text: "On which topics is each competitor beating you?" },
        { moment: "monitorear", text: "Which service topics rise or fall from one report to the next, and where?" }
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
        "Inteligencia social para banca, fintech y seguros. Qué da confianza para abrir una cuenta en línea, dónde se cae el alta y cómo se habla de dinero.",
      title: "Qué genera confianza cuando se trata de dinero",
      lead:
        "Leemos el camino de la intención al alta y cómo habla la gente de su dinero cuando algo sale bien o mal.",
      questions: [
        { moment: "entrar", text: "¿Qué genera confianza para abrir una cuenta o contratar un seguro en línea?" },
        { moment: "optimizar", text: "¿Dónde se rompe el camino entre la intención y el alta?" },
        { moment: "defender", text: "¿Qué se dice de la atención cuando hay un cargo no reconocido, un reclamo o un siniestro?" },
        { moment: "innovar", text: "¿Qué lenguaje usa la gente para hablar de dinero, deuda y protección?" },
        { moment: "lanzar", text: "¿Cómo se compara tu marca con la banca tradicional y con las apps nuevas?" },
        { moment: "monitorear", text: "¿Qué conversación de reputación vale la pena atender antes de que escale?" }
      ],
      where: ["X", "Reddit", "Reseñas de tiendas de apps", "Facebook", "Foros de finanzas personales"]
    },
    en: {
      name: "Banking, fintech and insurance",
      metaDescription:
        "Social intelligence for banks, fintechs and insurers. What earns trust to open an account online, where sign-up drops off, and how people talk about money.",
      title: "What builds trust when money is involved",
      lead:
        "We look at the path from intent to sign-up and how people talk about their money when things go right or wrong.",
      questions: [
        { moment: "entrar", text: "What builds enough trust to open an account or buy insurance online?" },
        { moment: "optimizar", text: "Where does the path from intent to sign-up break?" },
        { moment: "defender", text: "What do people say about support when there's an unknown charge, a complaint or a claim?" },
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
        "Social listening para retail y farmacias. En qué momento de la visita, en tienda o en línea, se pierde al cliente y qué fricciones resuelve la operación.",
      title: "En qué momento de la compra se pierde a un cliente",
      lead:
        "Incluye retail, farmacias y e-commerce. Leemos la visita fricción por fricción, por sucursal o por ciudad.",
      questions: [
        { moment: "optimizar", text: "¿En qué momento de la visita, en tienda o en línea, se pierde al cliente?" },
        { moment: "innovar", text: "¿Qué fricciones se arreglan con operación y cuáles con comunicación?" },
        { moment: "defender", text: "¿Qué empuja a elegir una cadena sobre otra cuando el producto es el mismo?" },
        { moment: "entrar", text: "¿Qué se dice de la entrega, el surtido y la atención, por sucursal o ciudad?" },
        { moment: "monitorear", text: "¿Qué sucursales o servicios concentran la conversación en cada periodo?" }
      ],
      where: ["Reseñas de Google Maps", "X", "Facebook", "Reseñas de tiendas de apps"]
    },
    en: {
      name: "Retail and pharmacies",
      metaDescription:
        "Social listening for retail and pharmacies. Where in the visit, in store or online, you lose a customer, and which friction points operations can fix.",
      title: "At which point of the purchase you lose a customer",
      lead:
        "Covers retail, pharmacies and e-commerce. We read the visit one friction point at a time, by store or by city.",
      questions: [
        { moment: "optimizar", text: "At which point of the visit, in store or online, do you lose the customer?" },
        { moment: "innovar", text: "Which friction points get fixed through operations, and which through communication?" },
        { moment: "defender", text: "What makes people pick one chain over another when the product is the same?" },
        { moment: "entrar", text: "What are people saying about delivery, assortment and service, by store or city?" },
        { moment: "monitorear", text: "Which stores or services drive the conversation in each period?" }
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
        "Inteligencia social para tecnología de consumo. Qué lleva a comprar un dispositivo para la casa, qué preocupa de la privacidad y cómo se usa de verdad.",
      title: "Cómo se usa de verdad un dispositivo en casa",
      lead:
        "Leemos qué empuja y qué frena la compra, y la distancia entre lo que promete el anuncio y lo que la gente vive con el producto.",
      questions: [
        { moment: "entrar", text: "¿Qué empuja a comprar un dispositivo nuevo para la casa, y qué lo frena?" },
        { moment: "defender", text: "¿Qué preocupa de la privacidad, la pantalla o la conexión, y a quién?" },
        { moment: "innovar", text: "¿Cómo se usa el producto de verdad, frente a cómo se anuncia?" },
        { moment: "optimizar", text: "¿Qué está ganando cada competidor en la conversación?" },
        { moment: "monitorear", text: "¿Cómo aterrizó tu lanzamiento y qué se dice desde entonces?" }
      ],
      where: ["Reddit", "YouTube", "X", "Reseñas de retailers", "Reseñas de tiendas de apps"]
    },
    en: {
      name: "Consumer tech",
      metaDescription:
        "Social intelligence for consumer tech. What gets people to buy a device for their home, what worries them about privacy, and how they really use it.",
      title: "How people really use a device at home",
      lead:
        "We look at what pushes and what stalls the purchase, and the gap between what the ad promises and how people live with the product.",
      questions: [
        { moment: "entrar", text: "What drives people to buy a new device for their home, and what holds them back?" },
        { moment: "defender", text: "What worries people about privacy, screens or connectivity, and who worries most?" },
        { moment: "innovar", text: "How do people really use the product, compared with how it is advertised?" },
        { moment: "optimizar", text: "What is each competitor winning in the conversation?" },
        { moment: "monitorear", text: "How did your launch land, and what have people said since?" }
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
        "Inteligencia social para moda y artesanía. Por qué la gente paga por diseño de autor, qué significa tu marca y qué historia le toca contar.",
      title: "Qué hace que alguien pague por diseño de autor",
      lead:
        "Incluye moda, diseño y artesanía. Leemos lo que significa tu marca para quien la compra y lo que se discute de autoría en la categoría.",
      questions: [
        { moment: "defender", text: "¿Qué hace que la gente pague por diseño de autor frente a la imitación?" },
        { moment: "innovar", text: "¿Tu marca se compra como regalo, como identidad, como orgullo o como patrimonio?" },
        { moment: "entrar", text: "¿Qué conversación de apropiación, autoría o pago justo toca a la categoría?" },
        { moment: "lanzar", text: "¿Qué territorio narrativo puede ocupar tu marca sin sonar genérica?" },
        { moment: "monitorear", text: "¿Cómo se habla de cada colección o colaboración?" }
      ],
      where: ["Instagram", "TikTok", "Pinterest", "Facebook", "Prensa de moda"]
    },
    en: {
      name: "Fashion and craft",
      metaDescription:
        "Social intelligence for fashion and craft brands. Why people pay for original design, what your brand means to them, and which story it should tell.",
      title: "What makes people pay for original design",
      lead:
        "Covers fashion, design and craft. We look at what your brand means to the people who buy it and what they argue about authorship in the category.",
      questions: [
        { moment: "defender", text: "What makes people pay for original design instead of a copy?" },
        { moment: "innovar", text: "Do people buy your brand as a gift, as identity, as pride or as heritage?" },
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
        "Social listening para marcas de belleza. Qué lleva a probar una marca, qué la mantiene en la rutina y qué creadores mueven de verdad la categoría.",
      title: "Qué hace que una marca entre y se quede en la rutina",
      lead:
        "Incluye belleza y cuidado personal. Leemos qué lleva a probar una marca y qué hace que se vuelva a comprar.",
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
        "Social listening for beauty brands. What gets people to try a brand, what keeps it in their routine, and which creators really move the category.",
      title: "What gets a brand into the routine, and keeps it there",
      lead:
        "Covers beauty and personal care. We look at what gets people to try a brand and what makes them buy it again.",
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
        "Inteligencia social para hogar, descanso y mascotas. Qué hace que alguien invierta en un colchón, un mueble o su mascota, y qué dice después de comprar.",
      title: "Qué pesa antes y después de comprar para tu casa",
      lead:
        "Incluye hogar, descanso y mascotas. Leemos la decisión de compra y lo que pasa después, de la entrega a las devoluciones.",
      questions: [
        { moment: "entrar", text: "¿Qué hace que alguien invierta en un colchón, un mueble o un producto para su mascota?" },
        { moment: "optimizar", text: "¿Qué se dice de la entrega, la prueba en casa y las devoluciones?" },
        { moment: "defender", text: "¿Cómo se habla de la categoría en reseñas frente a redes?" },
        { moment: "monitorear", text: "¿Qué temas de producto o servicio aparecen de un reporte a otro?" }
      ],
      where: ["Trustpilot", "Reseñas de Google", "Reseñas de retailers", "Instagram", "Facebook"]
    },
    en: {
      name: "Home and pets",
      metaDescription:
        "Social intelligence for home, sleep and pet brands. What makes people invest in a mattress, furniture or their pet, and what they say after they buy.",
      title: "What weighs on buying for the home, before and after",
      lead:
        "Covers home, sleep and pets. We look at the purchase decision and what comes after, from delivery to returns.",
      questions: [
        { moment: "entrar", text: "What makes someone invest in a mattress, a piece of furniture or a product for their pet?" },
        { moment: "optimizar", text: "What do people say about delivery, trying it at home and returns?" },
        { moment: "defender", text: "How do people talk about the category in reviews compared with social media?" },
        { moment: "monitorear", text: "Which product or service topics come up from one report to the next?" }
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
        "Social listening para cine, música en vivo y medios. Qué hace memorable un evento, qué papel juegan los patrocinadores y qué se dice antes y después.",
      title: "Qué hace que un evento se quede en la memoria",
      lead:
        "Incluye cine, música en vivo y medios. Leemos lo que vive el público, del anuncio al día siguiente.",
      questions: [
        { moment: "innovar", text: "¿Qué hace que un evento se sienta memorable, y qué lo desgasta?" },
        { moment: "entrar", text: "¿Qué papel juegan las marcas patrocinadoras en la experiencia?" },
        { moment: "optimizar", text: "¿Qué formatos y contenidos sostienen la conversación de una audiencia?" },
        { moment: "lanzar", text: "¿Cómo se vive cada evento antes, durante y después?" },
        { moment: "monitorear", text: "¿Qué se dijo de cada evento, función o estreno?" }
      ],
      where: ["TikTok", "Instagram", "X", "YouTube", "Reseñas de venues"]
    },
    en: {
      name: "Entertainment",
      metaDescription:
        "Social listening for film, live music and media. What makes an event memorable, what role sponsors play, and what audiences say before and after.",
      title: "What makes an event stick in people's memory",
      lead:
        "Covers film, live music and media. We look at what the audience lives through, from the announcement to the day after.",
      questions: [
        { moment: "innovar", text: "What makes an event feel memorable, and what wears it down?" },
        { moment: "entrar", text: "What role do sponsor brands play in the experience?" },
        { moment: "optimizar", text: "Which formats and content keep an audience's conversation going?" },
        { moment: "lanzar", text: "How do people experience each event before, during and after?" },
        { moment: "monitorear", text: "What did people say about each event, show or premiere?" }
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
        "Inteligencia social para universidades. Qué pesa al elegir un programa, cómo hablan de tu institución estudiantes, egresados y padres, y qué la distingue.",
      title: "Qué pesa al elegir una universidad o un programa",
      lead:
        "Leemos a cada grupo que habla de tu institución y lo que la separa de las opciones con las que la comparan.",
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
        "Social intelligence for universities. What weighs on choosing a program, how students, alumni and parents talk about your school, and what sets it apart.",
      title: "What weighs on choosing a university or program",
      lead:
        "We read each group that talks about your institution and what sets it apart from the options people weigh it against.",
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
        "Social listening para turismo y hoteles. Por qué un viajero elige un destino o un hotel y qué momentos del viaje dejan las mejores y las peores reseñas.",
      title: "Qué hace que un destino o un hotel se elija sobre otro",
      lead:
        "Incluye turismo y hospitalidad. Leemos el viaje completo, de la elección a la reseña.",
      questions: [
        { moment: "entrar", text: "¿Qué hace que un destino o un hotel se elija sobre otro?" },
        { moment: "optimizar", text: "¿Qué momentos del viaje dejan las mejores y las peores reseñas?" },
        { moment: "defender", text: "¿Qué se dice de la seguridad, el precio y la experiencia local?" },
        { moment: "monitorear", text: "¿Cómo se habla del destino en temporada alta y en eventos?" }
      ],
      where: ["Tripadvisor", "Reseñas de Google Maps", "Instagram", "TikTok", "YouTube"]
    },
    en: {
      name: "Travel",
      metaDescription:
        "Social listening for travel and hotels. Why travelers pick a destination or hotel, and which moments of a trip lead to the best and worst reviews.",
      title: "Why travelers pick one destination or hotel over another",
      lead:
        "Covers travel and hospitality. We read the whole trip, from the choice to the review.",
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
        "Inteligencia social B2B. Qué se dice de tu categoría en medios y comunidades especializadas y qué temas regulatorios o ambientales pueden escalar.",
      title: "Qué se dice de tu categoría antes de llegar a la prensa",
      lead:
        "Incluye infraestructura y sostenibilidad. Son industrias de ciclo largo, con menos conversación pública, así que elegimos las fuentes con más cuidado.",
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
        "Social intelligence for B2B. What specialized media and communities say about your category, and which regulatory or environmental issues could escalate.",
      title: "What is said about your category before the press picks it up",
      lead:
        "Covers infrastructure and sustainability. These are long-cycle industries with less public conversation, so we choose sources with more care.",
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
