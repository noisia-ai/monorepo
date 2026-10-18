import type { Block, PageContent } from "@/content/pages/types";
import { Faq } from "@/components/ui/Faq";
import { Reveal } from "@/components/ui/Reveal";
import { MotionBlock } from "@/components/motion/MotionBlock";
import styles from "./blocks.module.css";

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        <div className={styles.text}>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          {block.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case "cards":
    case "steps":
      return (
        <div>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          {block.lead ? <p className={styles.lead}>{block.lead}</p> : null}
          <ol className={block.type === "steps" ? styles.steps : styles.cards}>
            {block.items.map((item, i) => (
              <Reveal key={item.name} delay={i * 0.04}>
                <li className={block.type === "steps" ? styles.step : styles.card}>
                  {block.type === "steps" ? <span className={styles.number}>{String(i + 1).padStart(2, "0")}</span> : null}
                  <h3 className={styles.h3}>{item.name}</h3>
                  <p>{item.text}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      );
    case "table":
      return (
        <div>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          {block.lead ? <p className={styles.lead}>{block.lead}</p> : null}
          <div className={styles.tableWrap} tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={h} scope="col" data-hi={i === block.highlightColumn}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) =>
                      i === 0 ? (
                        <th key={i} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td key={i} data-hi={i === block.highlightColumn}>
                          {cell}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "quote":
      return (
        <figure className={styles.quote}>
          <blockquote>{block.text}</blockquote>
          {block.source ? <figcaption>{block.source}</figcaption> : null}
        </figure>
      );
    case "faq":
      return (
        <div>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          <Faq items={block.items} />
        </div>
      );
    case "callout":
      return (
        <div className={styles.callout}>
          <h2 className={styles.h3}>{block.title}</h2>
          <p>{block.text}</p>
        </div>
      );
    case "links":
      return (
        <div>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          <ul className={styles.links}>
            {block.items.map((item) => (
              <li key={item.href}>
                <a href={item.href} className={styles.link}>
                  <span className={styles.linkLabel}>{item.label}</span>
                  {item.text ? <span className={styles.linkText}>{item.text}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    case "motion":
      return (
        <div>
          {block.title ? <h2 className={styles.h2}>{block.title}</h2> : null}
          {block.lead ? <p className={styles.lead}>{block.lead}</p> : null}
          {block.name === "sources-hub" ? (
            <MotionBlock name="sources-hub" copy={block.copy} label={block.title ?? block.copy.center} />
          ) : (
            <MotionBlock name="one-conversation" copy={block.copy} label={block.title ?? block.copy.framework} />
          )}
        </div>
      );
    case "cta":
      return (
        <div className={styles.cta}>
          <h2 className={styles.h2}>{block.title}</h2>
          {block.text ? <p className={styles.lead}>{block.text}</p> : null}
          <a href={block.href} className={styles.ctaButton}>
            {block.label}
          </a>
        </div>
      );
  }
}

/** Standard inner page: plain H1 and lead, then blocks in a single readable column. */
export function ContentPage({
  page,
  aside,
  wide = false,
  split = false
}: {
  page: PageContent;
  aside?: React.ReactNode;
  wide?: boolean;
  /** On desktop the aside (e.g. a form) sits in its own sticky column beside the text. */
  split?: boolean;
}) {
  return (
    <article className={split ? `${styles.page} ${styles.split}` : styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>{page.title}</h1>
        {page.lead ? <p className={styles.pageLead}>{page.lead}</p> : null}
      </header>
      {aside ? <div className={split ? styles.asideSplit : wide ? styles.asideWide : styles.aside}>{aside}</div> : null}
      <div className={styles.blocks}>
        {page.blocks.map((block, i) => (
          <section key={i} className={styles.block}>
            <BlockView block={block} />
          </section>
        ))}
      </div>
    </article>
  );
}
