import { z } from "zod";

/**
 * A video is pure data: one JSON "piece" per video, validated here before anything renders.
 * Rules behind every field: packages/pitch-kit/VIDEO.md.
 */

const label = z.string().min(1).max(80);
const locale = z.enum(["es", "en"]);

// ---------------------------------------------------------------- the clip scenes (website schema)
// Same templates and text limits as apps/website-next/src/content/stories/schema.ts, so a story
// published on noisia.ai/insights renders here unchanged.
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
export type Scene = z.infer<typeof sceneSchema>;

const storyLocale = z.object({
  title: z.string().min(1).max(90),
  scenes: z.array(sceneSchema).min(2).max(7)
}).passthrough();

/** A website story file (src/content/stories/public/*.json). Only what the clip needs is checked. */
export const storySchema = z.object({ id: z.string(), es: storyLocale, en: storyLocale }).passthrough();

// ---------------------------------------------------------------- shared pieces
export const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bloom"), name: z.enum(["v-top", "v-bottom", "v-corner", "v-soft"]).default("v-bottom") }),
  z.object({ kind: z.literal("wash") }),
  z.object({ kind: z.literal("white") }),
  // Atmosphere only (VIDEO.md §4.3): never evidence. `src` is relative to the piece's folder.
  z.object({ kind: z.literal("image"), src: z.string(), veil: z.number().min(0).max(1).default(0.35) })
]);
export type Background = z.infer<typeof backgroundSchema>;

/** A real post. `verified` must be true: the literal check happened before it got here. */
export const quoteSchema = z.object({
  text: z.string().min(1).max(260),
  translation: z.string().max(260).optional(),
  platform: z.string().min(1).max(30),
  meta: z.string().max(60).optional(),
  verified: z.literal(true),
  voiced: z.boolean().default(false),
  // eleven_v3 emotion tag said before the quote, e.g. "[laughing]". Filtered out of the timestamps.
  emotion: z.string().regex(/^\[[a-z ]+\]$/).optional()
});
export type Quote = z.infer<typeof quoteSchema>;

export const chartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ring"), value: z.number().min(0).max(100), label: z.string().max(80), tone: z.enum(["teal", "coral"]).default("teal") }),
  z.object({
    kind: z.literal("bars"),
    unit: z.string().max(6).default(""),
    items: z.array(z.object({ label, value: z.number(), highlight: z.boolean().optional() })).min(2).max(6)
  }),
  z.object({
    kind: z.literal("number"),
    value: z.number(),
    from: z.number().optional(),
    suffix: z.string().max(8).default(""),
    label: z.string().max(110),
    dots: z.object({ total: z.number().int().min(10).max(400), on: z.number().int().min(0) }).optional()
  }),
  z.object({
    kind: z.literal("split"),
    left: z.object({ label, value: z.number(), suffix: z.string().max(6).default("") }),
    right: z.object({ label, value: z.number(), suffix: z.string().max(6).default("") })
  })
]);
export type Chart = z.infer<typeof chartSchema>;

/** The line the creative team takes away. Teal soft by default; dark only with a purpose (§4.2). */
export const sparkSchema = z.object({
  line: z.string().min(1).max(90),
  sub: z.string().max(200).optional(),
  style: z.enum(["soft", "dark"]).default("soft"),
  say: z.string().max(200).optional()
});

const voicesSchema = z.object({
  narrator: z.string(),
  quotes: z.record(z.string()).default({}),
  quoteLanguage: z.string().optional()
});

const common = {
  voices: voicesSchema.optional(),
  // Prompt for an instrumental bed from ElevenLabs /v1/music. Without it, no music.
  music: z.string().max(600).optional(),
  locale: locale.default("es"),
  tag: z.string().max(40).optional(),
  background: backgroundSchema.default({ kind: "wash" })
};

// ---------------------------------------------------------------- social
export const socialSceneSchema = z.intersection(
  sceneSchema,
  z.object({ vo: z.string().max(400).optional(), background: backgroundSchema.optional() })
);
export const socialSchema = z.object({
  format: z.literal("social"),
  ...common,
  scenes: z.array(socialSceneSchema).min(2).max(7)
});
export type SocialPiece = z.infer<typeof socialSchema>;

// ---------------------------------------------------------------- study
export const studySceneSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cold"),
    id: z.string(),
    quote: quoteSchema,
    words: z.array(z.string().max(30)).min(4).max(24),
    title: z.string().max(90),
    corpus: z.object({ value: z.number(), label: z.string().max(60) }),
    vo: z.string().max(400),
    background: backgroundSchema.optional()
  }),
  z.object({
    type: z.literal("chapter"),
    id: z.string(),
    label: z.string().max(40),
    head: z.string().max(110),
    chart: chartSchema.optional(),
    quote: quoteSchema.optional(),
    spark: sparkSchema,
    vo: z.string().max(400),
    background: backgroundSchema.optional()
  }),
  z.object({
    type: z.literal("climax"),
    id: z.string(),
    label: z.string().max(40),
    head: z.string().max(110),
    count: z.object({ from: z.number(), label: z.string().max(80) }),
    chat: z.array(quoteSchema).min(2).max(5),
    empty: z.string().max(60),
    spark: sparkSchema,
    vo: z.string().max(400),
    vo2: z.string().max(200).optional(),
    background: backgroundSchema.optional()
  }),
  z.object({
    type: z.literal("close"),
    id: z.string(),
    bet: z.array(z.string().max(80)).min(1).max(4),
    vo: z.string().max(400),
    background: backgroundSchema.optional()
  })
]);
export type StudyScene = z.infer<typeof studySceneSchema>;
export const studySchema = z.object({
  format: z.literal("study"),
  ...common,
  scenes: z.array(studySceneSchema).min(3).max(14)
});
export type StudyPiece = z.infer<typeof studySchema>;

// ---------------------------------------------------------------- deck motion
const deckBase = {
  format: z.literal("deck"),
  // The exact box on the 1920×1080 slide grid; the GIF is placed at x, y, w, h without scaling.
  box: z.object({ w: z.number().int().min(200).max(1920), h: z.number().int().min(150).max(1080) }),
  seconds: z.number().min(6).max(20).default(12),
  locale: locale.default("es")
};
export const deckSchema = z.discriminatedUnion("pattern", [
  z.object({ ...deckBase, pattern: z.literal("counter"), steps: z.array(z.object({ value: z.number(), label: z.string().max(40) })).min(2).max(5), source: z.string().max(60).optional() }),
  z.object({ ...deckBase, pattern: z.literal("stepper"), steps: z.array(z.object({ label: z.string().max(28), icon: z.string().optional() })).min(3).max(7) }),
  z.object({ ...deckBase, pattern: z.literal("cycle"), stages: z.array(z.string().max(24)).min(3).max(8), center: z.string().max(30).optional() }),
  z.object({ ...deckBase, pattern: z.literal("hub"), sources: z.array(z.string()).min(3).max(10), center: z.string().max(30).optional() })
]);
export type DeckPiece = z.infer<typeof deckSchema>;

// ---------------------------------------------------------------- timing (written by builders/audio.py)
export const timingSchema = z.object({
  fps: z.number(),
  total: z.number(),
  estimated: z.boolean().default(false),
  scenes: z.array(
    z.object({
      id: z.string(),
      from: z.number(),
      len: z.number(),
      marks: z.record(z.number()).default({}),
      clips: z
        .array(
          z.object({
            kind: z.enum(["vo", "quote", "spark"]),
            file: z.string().nullable(),
            at: z.number(),
            len: z.number(),
            words: z.array(z.tuple([z.string(), z.number(), z.number()]))
          })
        )
        .default([])
    })
  ),
  music: z.string().nullable().default(null),
  sfx: z.record(z.string()).default({})
});
export type Timing = z.infer<typeof timingSchema>;
export type TimedScene = Timing["scenes"][number];
export type Clip = TimedScene["clips"][number];
