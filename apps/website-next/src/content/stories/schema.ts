import { z } from "zod";

/**
 * An insight story is pure data. A small library of animated scene templates
 * (src/motion/scenes) turns it into motion, so publishing a new insight never
 * requires new code. The same data renders natively in the browser, as a static
 * card for reduced motion, as indexable text, and can be exported to video.
 */

const label = z.string().min(1).max(80);

export const sceneSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hook"), text: z.string().min(1).max(90) }),
  z.object({
    type: z.literal("stat"),
    value: z.number(),
    suffix: z.string().max(6).optional().default(""),
    label: z.string().min(1).max(110),
    context: z.string().max(140).optional()
  }),
  z.object({
    type: z.literal("compare"),
    unit: z.string().max(6).optional().default(""),
    items: z.array(z.object({ label, value: z.number(), highlight: z.boolean().optional() })).min(2).max(5)
  }),
  z.object({
    type: z.literal("journey"),
    unit: z.string().max(6).optional().default(""),
    steps: z.array(z.object({ label, value: z.number() })).min(3).max(7),
    highlightIndex: z.number().int().min(0)
  }),
  z.object({
    type: z.literal("split"),
    left: z.object({ label, value: z.number(), suffix: z.string().max(6).optional().default("") }),
    right: z.object({ label, value: z.number(), suffix: z.string().max(6).optional().default("") }),
    caption: z.string().max(140).optional()
  }),
  z.object({
    type: z.literal("tension"),
    want: z.string().min(1).max(90),
    but: z.string().min(1).max(90),
    value: z.number().nullable().optional()
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().min(1).max(260),
    translation: z.string().max(260).optional(),
    platform: z.string().min(1).max(30),
    meta: z.string().max(60).optional()
  }),
  z.object({ type: z.literal("takeaway"), text: z.string().min(1).max(140) })
]);

const evidenceSchema = z.object({
  quote: z.string().min(1),
  translation: z.string().optional(),
  platform: z.string().min(1),
  date: z.string().nullable().optional()
});

const localizedSchema = z.object({
  title: z.string().min(1).max(90),
  dek: z.string().max(200),
  scenes: z.array(sceneSchema).min(2).max(7),
  takeaway: z.string().max(160),
  evidence: z.array(evidenceSchema).max(5).default([])
});

export const industries = [
  "salud-y-farmacias",
  "moda-y-artesania",
  "tecnologia-de-consumo",
  "belleza-y-cuidado-personal",
  "hogar-y-descanso",
  "alimentos-y-bebidas",
  "deportes-y-entretenimiento",
  "telecom",
  "movilidad",
  "apuestas-y-gaming",
  "retail",
  "cultura-y-sociedad"
] as const;

export const storySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  industry: z.enum(industries),
  // editorial = Noisia's own public research; example = illustrative finding from client-style work.
  kind: z.enum(["editorial", "example"]).default("example"),
  market: z.string().max(12),
  method: z.string().max(60).optional(),
  sources: z.array(z.string()).default([]),
  period: z.string().max(40).optional(),
  report: z.string().optional(),
  es: localizedSchema,
  en: localizedSchema
});

export type Scene = z.infer<typeof sceneSchema>;
export type Story = z.infer<typeof storySchema>;
export type StoryLocale = z.infer<typeof localizedSchema>;
export type Industry = (typeof industries)[number];
