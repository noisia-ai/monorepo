import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";
import { NavArrowRight } from "iconoir-react";
import { Button } from "@/components/ui/Button";
import { LEARN_ICONS, type LearnIcon } from "./icons";
import styles from "./learn.module.css";

type Href = ComponentProps<typeof Button>["href"];

/** Centered page hero: optional icon tile, H1, optional subtitle and lead. */
export function LearnHero({
  title,
  subtitle,
  lead,
  Icon,
  children
}: {
  title: string;
  subtitle?: string;
  lead?: string;
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  children?: ReactNode;
}) {
  return (
    <header className={styles.hero} data-reveal>
      {Icon ? (
        <span className={styles.heroIcon} aria-hidden>
          <Icon />
        </span>
      ) : null}
      <h1 className={styles.h1}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      {lead ? <p className={styles.lead}>{lead}</p> : null}
      {children}
    </header>
  );
}

/** Section heading with an optional lead. */
export function SectionHead({ title, lead, center = false, id }: { title: string; lead?: string; center?: boolean; id?: string }) {
  return (
    <div className={center ? styles.sectionHeadCenter : styles.sectionHead}>
      <h2 className={styles.h2} id={id}>
        {title}
      </h2>
      {lead ? <p className={styles.sectionLead}>{lead}</p> : null}
    </div>
  );
}

/** The closing invitation of every Learn page. */
export function LearnCta({ title, text, label, href = "/taller" }: { title: string; text?: string; label: string; href?: Href }) {
  return (
    <section className={styles.cta} data-reveal>
      <h2 className={styles.h2}>{title}</h2>
      {text ? <p className={styles.lead}>{text}</p> : null}
      <div className={styles.ctaActions}>
        <Button href={href} arrow>
          {label}
        </Button>
      </div>
    </section>
  );
}

/** A list of further reading, one row per link, each with its icon. */
export function LinkList({ items }: { items: { label: string; text?: string; href: string; icon: LearnIcon }[] }) {
  return (
    <ul className={styles.linkList}>
      {items.map((item) => {
        const Icon = LEARN_ICONS[item.icon];
        return (
          <li key={item.href}>
            <a href={item.href} className={styles.linkRow}>
              <span className={styles.iconBadge} aria-hidden>
                <Icon />
              </span>
              <span>
                <span className={styles.linkLabel}>{item.label}</span>
                {item.text ? <span className={styles.linkText}>{item.text}</span> : null}
              </span>
              <NavArrowRight className={styles.chevron} aria-hidden />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
