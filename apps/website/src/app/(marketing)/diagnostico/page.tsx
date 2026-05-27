import { DiagnosticWizard } from "@/components/forms/DiagnosticWizard";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Diagnóstico",
  description: "Cuestionario breve para entender qué decisión necesitas tomar.",
  path: "/diagnostico"
});

export default function DiagnosticPage() {
  return (
    <section className="section diag-page-section">
      <div className="section__inner diag-page-inner">
        <header className="diag-page-header">
          <span className="eyebrow">DIAGNÓSTICO</span>
          <h1 className="display-md">Empecemos por la decisión. El método viene después.</h1>
          <p className="body-lg">
            8–10 minutos. Leemos tus respuestas antes de cualquier llamada para recomendar el siguiente paso correcto.
          </p>
        </header>
        <DiagnosticWizard />
      </div>
    </section>
  );
}
