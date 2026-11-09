import { z } from "zod";

export const labelingStudyInterestSchemaV1 = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  name: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1).max(1200),
  active: z.boolean()
}).strict();

export const labelingStudySettingsInputSchemaV1 = z.object({
  expected_revision: z.number().int().nonnegative(),
  category: z.string().trim().min(1).max(160),
  lexicon_terms: z.array(z.string().trim().min(1).max(200)).max(256),
  candidate_language: z.enum(["en", "original"]),
  interest_threshold: z.number().finite().min(0).max(1),
  interests: z.array(labelingStudyInterestSchemaV1).max(32),
  display_names: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    z.object({ en: z.string().trim().min(1).max(160), es: z.string().trim().min(1).max(160) }).strict()).optional()
}).strict();

export type LabelingStudySettingsInputV1 = z.infer<typeof labelingStudySettingsInputSchemaV1>;
export type LabelingStudySettingsV1 = Omit<LabelingStudySettingsInputV1, "expected_revision"> & {
  contract_version: "mass-labeling-study-policy-v1";
  workspace_id: string;
  revision: number;
  can_edit: boolean;
  lexicon_provenance: "brand_os" | "editorial" | "analyst";
  topics?: Array<{ topic_key: string; name: string; en: string; es: string }>;
};

export function labelingStudySettingsInputV1(state: LabelingStudySettingsV1,
  draft: { category: string; terms: string; threshold: string; interests: LabelingStudySettingsInputV1["interests"];
    names?: LabelingStudySettingsInputV1["display_names"] }) {
  return labelingStudySettingsInputSchemaV1.safeParse({
    expected_revision: state.revision,
    category: draft.category,
    lexicon_terms: [...new Set(draft.terms.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))],
    candidate_language: state.candidate_language,
    interest_threshold: draft.threshold.trim() ? Number(draft.threshold) : null,
    interests: draft.interests,
    display_names: draft.names ?? state.display_names
  });
}
