import logoRaw from "../assets/logo_black.svg?raw";

const navItems = [
  { href: "#landscape", label: "Panorama" },
  { href: "#perception-gap", label: "Perception Gap" },
  { href: "#viral-crisis", label: "Febrero" },
  { href: "#markets", label: "Mercados" },
  { href: "#influence", label: "Influencia" },
  { href: "#strategic-bets", label: "Apuestas" }
];

export const renderSiteNav = () => `
  <a class="skip-link" href="#main-content">Saltar al contenido</a>
  <nav class="site-nav" aria-label="Navegación principal" data-site-nav>
    <div class="site-nav__inner">
      <a class="brand-mark" href="#" aria-label="Ir al inicio">
        <span class="brand-mark__logo" aria-hidden="true">${logoRaw}</span>
        <span class="brand-mark__copy">
          <strong>Cheaf Perception Gap</strong>
          <span>Noisia Snapshot</span>
        </span>
      </a>

      <div class="nav-links" data-nav-links>
        ${navItems
          .map((item) => `<a href="${item.href}" data-nav-link>${item.label}</a>`)
          .join("")}
      </div>

      <a class="nav-cta" href="#closing">Hablemos</a>
      <button class="nav-menu-button" type="button" aria-expanded="false" aria-controls="mobile-nav" data-nav-menu>
        <span></span>
        <span></span>
        <span class="sr-only">Abrir navegación</span>
      </button>
      <div class="site-nav__progress" aria-hidden="true">
        <span data-scroll-progress></span>
      </div>
    </div>
  </nav>
`;

export const renderSiteFooter = () => `
  <footer class="site-footer">
    <div class="site-footer__inner">
      <div class="site-footer__hero">
        <div class="site-footer__brand">
          <span class="site-footer__eyebrow">Noisia Snapshot · Abril 2026</span>
          <span class="site-footer__logo" aria-hidden="true">${logoRaw}</span>
          <p>
            Social Intelligence Snapshot para Cheaf. Una lectura ejecutiva de 1,131 señales públicas entre enero y abril de 2026.
          </p>
        </div>

        <a class="site-footer__back" href="#app">Volver arriba</a>
      </div>

      <div class="site-footer__rail">
        <div class="site-footer__group" aria-label="Secciones del reporte">
          <span class="site-footer__label">Secciones</span>
          <div class="site-footer__chips">
            ${navItems
              .map((item) => `<a class="site-footer__chip" href="${item.href}">${item.label}</a>`)
              .join("")}
          </div>
        </div>

        <div class="site-footer__group">
          <span class="site-footer__label">Cobertura</span>
          <div class="site-footer__stats">
            <span class="site-footer__stat">90 días</span>
            <span class="site-footer__stat">12 fuentes</span>
            <span class="site-footer__stat">AR · CL · MX · CO</span>
            <span class="site-footer__stat">Abril 2026</span>
          </div>
        </div>
      </div>
    </div>
  </footer>
`;

export const initSiteNav = () => {
  const nav = document.querySelector<HTMLElement>("[data-site-nav]");
  const menuButton = document.querySelector<HTMLButtonElement>("[data-nav-menu]");
  const progress = document.querySelector<HTMLElement>("[data-scroll-progress]");
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-nav-link]"));
  const sections = links
    .map((link) => document.querySelector<HTMLElement>(link.hash))
    .filter(Boolean) as HTMLElement[];

  if (!nav || !menuButton || !progress) return;

  const closeMenu = () => {
    nav.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
  };

  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  links.forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  const updateProgress = () => {
    const maxScroll =
      document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const ratio = maxScroll > 0 ? window.scrollY / maxScroll : 0;
    progress.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
  };

  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      links.forEach((link) => {
        const active = link.hash === `#${visible.target.id}`;
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    },
    {
      rootMargin: "-30% 0px -55% 0px",
      threshold: [0.15, 0.4, 0.7]
    }
  );

  sections.forEach((section) => observer.observe(section));
};
