import type { ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  lead?: string;
  align?: "left" | "center";
};

export function SectionHeader({ eyebrow, title, lead, align = "left" }: SectionHeaderProps) {
  return (
    <div className={`section-heading section-heading--${align}`}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2 className="display-lg">{title}</h2>
      {lead ? <p className="body-lg">{lead}</p> : null}
    </div>
  );
}
