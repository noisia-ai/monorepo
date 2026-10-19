import { z } from "zod";

import {
  SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS
} from "@/lib/data-os/signal-semantic-context-pack";

const key = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(200);
const explicitLocale = z.object({
  state: z.literal("explicit_locale"),
  locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u)
}).strict();

const createApplicability = z.discriminatedUnion("state", [
  z.object({ state: z.literal("workspace_inherited"), locale: z.null() }).strict(),
  explicitLocale
]);

const ordinaryApplicability = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["preserve", "workspace_inherited"]), locale: z.null() }).strict(),
  explicitLocale
]);

const createValues = z.object({
  element_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS),
  display_text: z.string().trim().min(1).max(500),
  canonical_key: key,
  scope: z.string().trim().max(200).nullable(),
  relation_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),
  relation_target_key: key.nullable(),
  applicability: createApplicability
}).strict()
  .refine((entry) => Boolean(entry.relation_kind) === Boolean(entry.relation_target_key),
    "relation pair required")
  .refine((entry) => entry.element_kind !== "locale_variant"
    || entry.applicability.state === "explicit_locale", "locale_variant requires a locale");

export const signalSemanticContextCreateCommandSchemaV1 = z.object({
  contract_version: z.literal("create-semantic-context-element-v1"),
  generation_key: key,
  values: createValues
}).strict();

const ordinaryBase = z.object({
  contract_version: z.literal("edit-semantic-context-element-v1"),
  generation_key: key,
  expected_version: z.number().int().min(1),
  state_token: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();

const ordinaryValues = z.object({
  display_text: z.string().trim().min(1).max(500),
  canonical_key: key,
  scope: z.string().trim().max(200).nullable(),
  relation_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS).nullable(),
  relation_target_key: key.nullable(),
  applicability: ordinaryApplicability
}).strict().refine((entry) => Boolean(entry.relation_kind) === Boolean(entry.relation_target_key),
  "relation pair required");

export const signalSemanticContextOrdinaryCommandSchemaV1 = z.discriminatedUnion("action", [
  ordinaryBase.extend({ action: z.literal("save"), values: ordinaryValues }).strict(),
  ordinaryBase.extend({ action: z.literal("undo"), target_version: z.number().int().min(1) }).strict(),
  ordinaryBase.extend({ action: z.literal("archive") }).strict(),
  ordinaryBase.extend({ action: z.literal("restore") }).strict()
]);
