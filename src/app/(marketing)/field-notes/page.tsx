import Link from "next/link";
import { fieldNotes } from "@/content/site";

export const metadata = {
  title: "Field Notes",
  description: "Ensayos cortos de Noisia sobre inteligencia social, cultura y estrategia."
};

const TOPICS = ["Método", "Cultura", "Influencia", "Decisiones"];

const noteTopics: Record<string, string> = {
  "sentiment-score-murio": "Método",
  "categoria-antropologia": "Cultura",
  "influencia-real-metrica": "Influencia"
};

export default function FieldNotesPage() {
  const [featured, ...rest] = fieldNotes;

  return (
    <>
      <section className="hero-experience">
        <div className="hero-experience__inner">
          <div className="hero-copy">
            <span className="eyebrow">FIELD NOTES</span>
            <h1 className="display-lg">Notas de campo.<br />Pocas piezas, más criterio.</h1>
            <p className="body-lg">
              Notas firmadas para discutir método, cultura, influencia y decisiones. Sin churn de SEO.
            </p>
            <div className="method-question-pills">
              {TOPICS.map((topic) => (
                <span className="method-question-pill" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__inner">
          {featured && (
            <Link
              className="field-note-card field-note-card--feature glass"
              href={`/field-notes/${featured.slug}`}
            >
              <div className="field-note-card__meta">
                <span className="chip">{noteTopics[featured.slug] ?? "Método"}</span>
                <span className="field-note-card__time">
                  {featured.date} · {featured.readingTime} min
                </span>
              </div>
              <h2>{featured.title}</h2>
              <p className="field-note-card__dek">{featured.dek}</p>
              <blockquote className="field-note-card__pullquote">
                &ldquo;{featured.body[0]}&rdquo;
              </blockquote>
              <b className="link-arrow">
                Leer <span>→</span>
              </b>
            </Link>
          )}

          <div className="field-notes-grid">
            {rest.map((note) => (
              <Link className="field-note-card glass" href={`/field-notes/${note.slug}`} key={note.slug}>
                <div className="field-note-card__meta">
                  <span className="chip">{noteTopics[note.slug] ?? "Método"}</span>
                  <span className="field-note-card__time">
                    {note.date} · {note.readingTime} min
                  </span>
                </div>
                <h2>{note.title}</h2>
                <p className="field-note-card__dek">{note.dek}</p>
                <b className="link-arrow">
                  Leer <span>→</span>
                </b>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
