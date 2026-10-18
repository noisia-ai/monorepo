import styles from "./ui.module.css";

export type FaqItem = { q: string; a: string };

/** Native disclosure list plus FAQPage structured data for search and answer engines. */
export function Faq({ items }: { items: FaqItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } }))
  };
  return (
    <div className={styles.faq}>
      {items.map((item) => (
        <details key={item.q} className={styles.faqItem}>
          <summary className={styles.faqQ}>{item.q}</summary>
          <p className={styles.faqA}>{item.a}</p>
        </details>
      ))}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
