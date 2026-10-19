type NavHref = "/soluciones" | "/como-funciona" | "/metodos" | "/insights" | "/nosotros";

type NavKey = "solutions" | "howItWorks" | "methods" | "insights" | "about";

/** The header and the phone menu: the three pages that sell. */
export const mainNav: { key: NavKey; href: NavHref }[] = [
  { key: "solutions", href: "/soluciones" },
  { key: "howItWorks", href: "/como-funciona" },
  { key: "insights", href: "/insights" }
];

/** The footer adds the pages that support the decision. */
export const footerNav: { key: NavKey; href: NavHref }[] = [...mainNav, { key: "methods", href: "/metodos" }, { key: "about", href: "/nosotros" }];
