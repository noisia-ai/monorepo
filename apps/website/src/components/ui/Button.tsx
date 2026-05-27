import Link from "next/link";
import type { ReactNode } from "react";

type ButtonProps = {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
  type?: "button" | "submit";
};

export function Button({ href, children, variant = "primary", icon, type = "button" }: ButtonProps) {
  const className = `button button--${variant}`;
  const content = (
    <>
      {children}
      {icon}
    </>
  );

  if (href) {
    return (
      <Link className={className} href={href}>
        {content}
      </Link>
    );
  }

  return (
    <button className={className} type={type}>
      {content}
    </button>
  );
}
