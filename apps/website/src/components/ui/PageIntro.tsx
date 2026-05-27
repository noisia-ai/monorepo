import type { ReactNode } from "react";

type PageIntroProps = {
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
};

export function PageIntro({ eyebrow, title, lead, children }: PageIntroProps) {
  return (
    <section className="page-intro">
      <div className="page-intro__inner">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="display-lg">{title}</h1>
        {lead ? <p className="body-lg">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
