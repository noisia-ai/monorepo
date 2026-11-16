type NavHref = "/soluciones" | "/como-funciona" | "/metodos" | "/insights" | "/insights/estudios" | "/nosotros";

type NavKey = "solutions" | "howItWorks" | "methods" | "insights" | "studies" | "about";

/** The header and the phone menu: the pages that sell, and the studies next to Insights. */
export const mainNav: { key: NavKey; href: NavHref }[] = [
  { key: "solutions", href: "/soluciones" },
  { key: "howItWorks", href: "/como-funciona" },
  { key: "insights", href: "/insights" },
  { key: "studies", href: "/insights/estudios" }
];

/** The footer adds the pages that support the decision. */
export const footerNav: { key: NavKey; href: NavHref }[] = [...mainNav, { key: "methods", href: "/metodos" }, { key: "about", href: "/nosotros" }];
