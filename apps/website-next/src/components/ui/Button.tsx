import type { ComponentProps, ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import styles from "./ui.module.css";

type Props = {
  href: ComponentProps<typeof Link>["href"];
  /** The site has exactly two buttons: filled (primary) and outlined (secondary). */
  variant?: "primary" | "secondary";
  children: ReactNode;
  arrow?: boolean;
  className?: string;
};

export function Button({ href, variant = "primary", children, arrow = false, className }: Props) {
  return (
    <Link href={href} className={clsx(styles.button, styles[`button-${variant}`], className)}>
      {children}
      {arrow ? <ArrowRight aria-hidden className={styles.buttonIcon} /> : null}
    </Link>
  );
}
