import { FaqList } from "./FaqList";
import type { FaqIcon } from "./faq-icons";

/** An FAQ entry; `icon` adds a small icon tile before the question. */
export type FaqItem = { q: string; a: string; icon?: FaqIcon };

/** Animated question list plus FAQPage structured data for search and answer engines. */
export function Faq({ items }: { items: FaqItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } }))
  };
  return (
    <>
      <FaqList items={items} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
