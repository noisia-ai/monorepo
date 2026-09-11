export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      error: "brand_intake_suggestions_disabled",
      message: "La investigación previa al guardado no está disponible. Completa el formulario y crea la marca para preparar su contexto con el flujo gobernado."
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
