import { ArrowUpRight, Download, MessageSquareText, Search, Share2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MethodologyChip, MethodologyIcon, resolveMethodologyMeta } from "@/components/ui/MethodologyIcon";
import { productConsoleScenes, type ProductConsoleScene } from "@/content/site";

type ProductConsoleProps = {
  scene?: ProductConsoleScene;
};

export function ProductConsole({ scene = productConsoleScenes[0] }: ProductConsoleProps) {
  return (
    <article className="product-console glass" aria-label={`Vista previa del producto Noisia: ${scene.title}`}>
      <div className="product-console__top">
        <div>
          <div className="product-console__eyebrow-row">
            <span className="eyebrow">{scene.label}</span>
            <div className="console-method-icons" aria-label="Métodos aplicados">
              {scene.methodologies.map((methodology) => {
                const meta = resolveMethodologyMeta(methodology);

                return (
                  <span
                    className="console-method-icon"
                    key={methodology}
                    title={meta.name}
                    aria-label={meta.name}
                  >
                    <MethodologyIcon identifier={methodology} />
                  </span>
                );
              })}
            </div>
          </div>
          <h2>{scene.title}</h2>
          <div className="console-methods" aria-label="Metodologías aplicadas">
            {scene.methodologies.map((methodology) => (
              <MethodologyChip identifier={methodology} key={methodology} compact />
            ))}
          </div>
        </div>
      </div>

      <div className="prompt-bar solid-panel">
        <Search size={18} strokeWidth={1.8} />
        <span>{scene.question}</span>
      </div>

      <div className="console-grid">
        <section className="narrative-card solid-panel">
          <span className="chip">Lectura de decisión</span>
          <h3>{scene.insight}</h3>
          <p>{scene.summary}</p>
          <div className="metric-row">
            {scene.metrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong className={metric.tone === "tension" ? "is-tension" : ""}>{metric.value}</strong>
              </div>
            ))}
          </div>
          {scene.ctaHref && (
            <Button href={scene.ctaHref} variant="secondary" icon={<ArrowUpRight size={16} strokeWidth={1.8} />}>
              {scene.ctaLabel ?? "Ver caso"}
            </Button>
          )}
        </section>

        <aside className="source-drawer glass">
          <span className="chip">Fuente original</span>
          <blockquote>“{scene.sourceQuote}”</blockquote>
          <dl>
            {scene.sourceMeta.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="chat-export-row">
        <div className="data-chat glass">
          <MessageSquareText size={17} strokeWidth={1.8} />
          <span>{scene.chatPrompt}</span>
        </div>
        <div className="export-bar glass">
          <button type="button" aria-label="Compartir link">
            <Share2 size={17} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Descargar PPT">
            <Download size={17} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Abrir reporte">
            <ArrowUpRight size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </article>
  );
}
