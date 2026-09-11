export const BRAND_KNOWLEDGE_SOURCE_MAX_CHARS = 200_000;
export const BRAND_KNOWLEDGE_NOTES_MAX_CHARS = 100_000;

export function buildAutomaticBrandContextText(args: {
  name: string;
  description?: string | null;
  industry?: string | null;
  industrySub?: string | null;
  countries: string[];
  aliases: string[];
  competitors: string[];
  notes?: string | null;
}) {
  const text = [
    `Marca: ${args.name}`,
    args.description?.trim() ? `Descripción: ${args.description.trim()}` : null,
    args.industry?.trim() ? `Industria: ${args.industry.trim()}` : null,
    args.industrySub?.trim() ? `Subindustria: ${args.industrySub.trim()}` : null,
    `Mercados: ${args.countries.join(", ")}`,
    args.aliases.length ? `Alias y handles: ${args.aliases.join(", ")}` : null,
    args.competitors.length ? `Competidores: ${args.competitors.join(", ")}` : null,
    args.notes?.trim() ? `Contexto adicional confirmado por el usuario:\n${args.notes.trim()}` : null
  ].filter((value): value is string => Boolean(value)).join("\n\n");
  if (text.length > BRAND_KNOWLEDGE_SOURCE_MAX_CHARS) {
    throw new Error("brand_context_knowledge_source_too_large");
  }
  return text;
}
