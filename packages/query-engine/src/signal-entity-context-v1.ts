import { z } from "zod";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "./signal-workspace-embeddings-v1";
export const entityKindSchemaV1 = z.enum([
  "primary_brand",
  "competitor",
  "category",
]);
export const entityContextSchemaV1 = z
  .object({
    entities: z.array(
      z
        .object({
          entity_id: z.string().min(1),
          kind: entityKindSchemaV1,
          name: z.string().min(1),
          aliases: z.array(z.string()),
          disambiguation: z.string().max(300).nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (c) =>
      new Set(c.entities.map((e) => e.entity_id)).size === c.entities.length,
    "duplicate_entity_id",
  );
export type EntityContextV1 = z.infer<typeof entityContextSchemaV1>;
export function normalizeEntityAliasV1(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
export function canonicalEntityContextV1(
  input: EntityContextV1,
): EntityContextV1 {
  return {
    entities: entityContextSchemaV1
      .parse(input)
      .entities.map((e) => ({
        ...e,
        name: normalizeEntityAliasV1(e.name),
        aliases: [
          ...new Set(e.aliases.map(normalizeEntityAliasV1).filter(Boolean)),
        ].sort(),
        disambiguation: e.disambiguation?.trim() || null,
      }))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
  };
}
export function entityContextDigestV1(c: EntityContextV1) {
  return digest(canonicalEntityContextV1(c));
}
const terms = (e: EntityContextV1["entities"][number]) => [
  ...new Set(
    [e.name, ...e.aliases].map(normalizeEntityAliasV1).filter(Boolean),
  ),
];
export type EntityContextDiffV1 = {
  affected_mode: "targeted" | "full";
  lexical_terms: string[];
  labeled_entity_ids: string[];
};
export function diffEntityContextV1(
  previous: EntityContextV1 | null,
  next: EntityContextV1,
): EntityContextDiffV1 {
  const out: EntityContextDiffV1 = {
    affected_mode: previous ? "targeted" : "full",
    lexical_terms: [],
    labeled_entity_ids: [],
  };
  const before = new Map(
    canonicalEntityContextV1(previous ?? { entities: [] }).entities.map((e) => [
      e.entity_id,
      e,
    ]),
  );
  const after = new Map(
    canonicalEntityContextV1(next).entities.map((e) => [e.entity_id, e]),
  );
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id),
      b = after.get(id);
    if (digest(a ?? null) === digest(b ?? null)) continue;
    if (
      [...(a ? terms(a) : []), ...(b ? terms(b) : [])].some(
        (t) => t.length < 3,
      ) ||
      [a, b].some((e) => e?.kind === "category" && e.aliases.length === 0)
    )
      out.affected_mode = "full";
    if (
      a &&
      (!b ||
        a.kind !== b.kind ||
        terms(a).some((t) => !terms(b).includes(t)) ||
        a.disambiguation !== b.disambiguation)
    )
      out.labeled_entity_ids.push(id);
    if (b)
      out.lexical_terms.push(
        ...(!a || a.kind !== b.kind || a.disambiguation !== b.disambiguation
          ? terms(b)
          : terms(b).filter((t) => !terms(a).includes(t))),
      );
  }
  out.lexical_terms = [...new Set(out.lexical_terms)].sort();
  out.labeled_entity_ids.sort();
  return out;
}
export function entityAliasMatchesV1(text: string, alias: string) {
  const escaped = normalizeEntityAliasV1(alias).replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  return (
    escaped.length > 0 &&
    new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(
      normalizeEntityAliasV1(text),
    )
  );
}
export function isEntityContextAffectedV1(
  diff: EntityContextDiffV1,
  root: { title: string | null; text: string; entity_ids: string[] },
) {
  return (
    diff.affected_mode === "full" ||
    root.entity_ids.some((id) => diff.labeled_entity_ids.includes(id)) ||
    diff.lexical_terms.some((t) =>
      entityAliasMatchesV1(`${root.title ?? ""} ${root.text}`, t),
    )
  );
}
export function effectiveEntitiesDigestV1(
  entities: readonly { entity_id: string; kind: string; salience: string }[],
) {
  return digest(
    [...entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
  );
}
