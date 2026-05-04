import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { fieldNotes } from "@/content/site";

type FieldNotePageProps = {
  params: Promise<{ slug: string }>;
};

const NOTE_TOPICS: Record<string, string> = {
  "sentiment-score-murio": "Método",
  "categoria-antropologia": "Cultura",
  "influencia-real-metrica": "Influencia",
};

export function generateStaticParams() {
  return fieldNotes.map((note) => ({ slug: note.slug }));
}

export async function generateMetadata({ params }: FieldNotePageProps) {
  const { slug } = await params;
  const note = fieldNotes.find((item) => item.slug === slug);
  return {
    title: note ? note.title : "Field Note",
    description: note?.dek,
  };
}

export default async function FieldNotePage({ params }: FieldNotePageProps) {
  const { slug } = await params;
  const note = fieldNotes.find((item) => item.slug === slug);
  if (!note) notFound();

  const topic = NOTE_TOPICS[slug] ?? "Método";
  const related = fieldNotes.filter((n) => n.slug !== slug).slice(0, 2);

  return (
    <>
      {/* Hero */}
      <section className="hero-experience">
        <div className="hero-experience__inner">
          <div className="hero-copy hero-copy--essay">
            <div className="fn-hero-meta">
              <span className="chip">{topic}</span>
              <span className="fn-hero-meta__date">{note.date} · {note.readingTime} min</span>
            </div>
            <h1 className="display-lg">{note.title}</h1>
            <p className="fn-hero-dek">{note.dek}</p>
          </div>
        </div>
      </section>

      {/* Article body */}
      <section className="section">
        <article className="essay-col">
          {/* First paragraph as pull-quote lede */}
          {note.body.length > 0 && (
            <p className="essay-lede">{note.body[0]}</p>
          )}
          {/* Remaining paragraphs */}
          {note.body.slice(1).map((paragraph, i) => (
            <p className="essay-graf" key={i}>{paragraph}</p>
          ))}

          {/* CTA block */}
          <div className="essay-cta glass">
            <h2>La pregunta correcta cambia el tipo de evidencia que vale la pena mirar.</h2>
            <div className="essay-cta__actions">
              <Button href="/diagnostico">Iniciar diagnóstico</Button>
              <span className="essay-cta__note">
                Lectura promedio antes de iniciar diagnóstico: 2 field notes.
              </span>
            </div>
          </div>
        </article>
      </section>

      {/* Related notes */}
      {related.length > 0 && (
        <section className="section section--compact">
          <div className="section__inner">
            <div className="fn-related">
              <h2 className="fn-related__heading">Sigue leyendo</h2>
              <div className="fn-related-grid">
                {related.map((rel) => (
                  <Link
                    key={rel.slug}
                    className="fn-related-card glass"
                    href={`/field-notes/${rel.slug}`}
                  >
                    <span className="chip">{NOTE_TOPICS[rel.slug] ?? "Método"}</span>
                    <h3>{rel.title}</h3>
                    <p>{rel.dek}</p>
                    <b className="link-arrow">
                      Leer <span>→</span>
                    </b>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
