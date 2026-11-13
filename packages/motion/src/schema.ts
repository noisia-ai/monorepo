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

// ---------------------------------------------------------------- the data base (VIDEO.md §2)
// A video never shows a figure without saying what it stands on: how many mentions, where and when.

/** The corpus behind the whole piece. Channels ranked by mentions when the study has the breakdown. */
export const baseSchema = z
  .object({
    mentions: z.number().int().positive(),
    // "+1.18 M" when the source only gives a floor.
    plus: z.boolean().default(false),
    channels: z.array(z.object({ platform: z.string().min(1).max(30), mentions: z.number().int().nonnegative().optional() })).min(1).max(8),
    period: z.string().min(1).max(40),
    market: z.string().max(30).optional(),
    method: z.string().max(60).optional()
  })
  .refine((b) => b.channels.every((c) => c.mentions != null) || b.channels.every((c) => c.mentions == null), {
    message: "channels: give mentions for every channel or for none"
  });
export type Base = z.infer<typeof baseSchema>;

/** The line under a figure: the mentions it stands on, its period and, when known, its channels. */
// An official figure (a census, an electoral count) has no mentions: it carries its `source` instead.
export const noteSchema = z
  .object({
    mentions: z.number().int().nonnegative().optional(),
    what: z.string().max(60).optional(),
    period: z.string().min(1).max(40),
    channels: z.array(z.string().min(1).max(30)).max(4).optional(),
    source: z.string().max(60).optional()
  })
  .refine((n) => n.mentions != null || n.source, { message: "a note gives the mentions it stands on, or the source of an official figure" });
export type Note = z.infer<typeof noteSchema>;

const baseScene = z.object({ type: z.literal("base"), id: z.string().optional(), vo: z.string().max(400).optional(), background: z.lazy(() => backgroundSchema).optional() });

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
  emotion: z.string().regex(/^\[[a-z ]+\]$/).optional(),
  // What the voice reads when the literal spelling would be read wrong ("eh votado" → "he votado").
  // The card always shows `text`, literal.
  say: z.string().max(260).optional()
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
  quoteLanguage: z.string().optional(),
  // ElevenLabs models and narrator settings; audio.py has defaults (VIDEO.md §5.3). Newer models
  // accept fewer settings, so the piece says which ones it sends.
  model: z.string().optional(),
  quoteModel: z.string().optional(),
  settings: z.record(z.union([z.number(), z.boolean()])).optional()
});

const common = {
  voices: voicesSchema.optional(),
  // Prompt for an instrumental bed from ElevenLabs /v1/music. Without it, no music.
  music: z.string().max(600).optional(),
  // An approved track is kept while it lasts as long as the video (audio.py never regenerates it).
  musicLock: z.boolean().optional(),
  // The insight cue played on every Spark: "kit" for the kit's own sound, or a file in the piece folder.
  sfx: z.object({ insight: z.string().optional() }).optional(),
  locale: locale.default("es"),
  tag: z.string().max(40).optional(),
  background: backgroundSchema.default({ kind: "wash" })
};

// ---------------------------------------------------------------- copy rules on what is said and shown
// Noisia works after the listening: the verb is "analizamos", never "escuchamos" (COPY_RULES §0.5).
// No reveal colons in the narration ("La base:"), they read as a slide, not as speech.
const SAID = ["vo", "vo2", "title", "head", "text"] as const;
function copyRules(scenes: Record<string, unknown>[], ctx: z.RefinementCtx) {
  scenes.forEach((s, i) => {
    const spark = (s.spark ?? {}) as { line?: string; say?: string };
    // A quote scene's text is a real post, literal: the rule is for Noisia's own words.
    const said = SAID.filter((k) => !(k === "text" && s.type === "quote"));
    const fields: [string, unknown][] = [...said.map((k) => [k, s[k]] as [string, unknown]), ["spark.line", spark.line], ["spark.say", spark.say]];
    for (const [k, v] of fields) {
      if (typeof v !== "string") continue;
      if (/escuch|listen/i.test(v)) ctx.addIssue({ code: "custom", path: ["scenes", i, k], message: `scene ${i + 1} ${k}: say "analizamos" (we analyze), never "escuchamos" (we listen)` });
      if ((k === "vo" || k === "vo2") && /:/.test(v)) ctx.addIssue({ code: "custom", path: ["scenes", i, k], message: `scene ${i + 1} ${k}: no reveal colon in the narration` });
    }
  });
}

/** Under 5,000 analyzed mentions the absolute count reads as a thin study: the figure goes in %. */
const THIN = 5000;
function thinNote(note: { mentions?: number } | undefined, i: number, ctx: z.RefinementCtx) {
  if (note?.mentions != null && note.mentions < THIN)
    ctx.addIssue({ code: "custom", path: ["scenes", i, "note", "mentions"], message: `scene ${i + 1}: ${note.mentions} mentions reads as a thin study; show the figure as a % and give the universe it comes from (5,000 or more), or a source` });
}

// ---------------------------------------------------------------- social
export const socialSceneSchema = z.union([
  baseScene,
  z.intersection(sceneSchema, z.object({ vo: z.string().max(400).optional(), background: backgroundSchema.optional(), note: noteSchema.optional() }))
]);
const FIGURES = ["stat", "compare", "journey", "split"];
export const socialSchema = z
  .object({
    format: z.literal("social"),
    ...common,
    base: baseSchema,
    scenes: z.array(socialSceneSchema).min(3).max(8)
  })
  .superRefine((piece, ctx) => {
    if (piece.scenes.filter((s) => s.type === "base").length !== 1)
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "a social piece carries exactly one base scene (mentions, channels, period)" });
    piece.scenes.forEach((s, i) => {
      const figure = FIGURES.includes(s.type) || (s.type === "tension" && s.value != null);
      if (figure && !("note" in s && s.note))
        ctx.addIssue({ code: "custom", path: ["scenes", i, "note"], message: `scene ${i + 1} (${s.type}) shows a figure without its note: mentions, period, channels` });
      if ("note" in s) thinNote(s.note, i, ctx);
    });
    copyRules(piece.scenes as Record<string, unknown>[], ctx);
  });
export type SocialPiece = z.infer<typeof socialSchema>;
export type SocialScene = SocialPiece["scenes"][number];

// ---------------------------------------------------------------- study
export const studySceneSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cold"),
    id: z.string(),
    quote: quoteSchema,
    words: z.array(z.string().max(30)).min(4).max(24),
    title: z.string().max(90),
    vo: z.string().max(400),
    background: backgroundSchema.optional()
  }),
  z.object({
    type: z.literal("chapter"),
    id: z.string(),
    label: z.string().max(40),
    head: z.string().max(110),
    chart: chartSchema.optional(),
    note: noteSchema.optional(),
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
    note: noteSchema.optional(),
    chat: z.array(quoteSchema).min(2).max(5),
    empty: z.string().max(60),
    spark: sparkSchema,
    vo: z.string().max(400),
    vo2: z.string().max(200).optional(),
    background: backgroundSchema.optional()
  }),
  z.object({
    type: z.literal("base"),
    id: z.string(),
    vo: z.string().max(400).optional(),
    background: backgroundSchema.optional(),
    // Closing by channels: the corpus was said in the cold open, so the base scene tells where people talk and about what.
    head: z.string().max(60).optional(),
    channelTopics: z
      .array(z.object({ platform: z.string().min(1).max(30), items: z.array(z.object({ label: z.string().max(40), value: z.number(), vs: z.string().max(30).optional() })).min(1).max(3) }))
      .max(3)
      .optional()
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
export const studySchema = z
  .object({
    format: z.literal("study"),
    ...common,
    base: baseSchema,
    scenes: z.array(studySceneSchema).min(3).max(15)
  })
  .superRefine((piece, ctx) => {
    if (piece.scenes.filter((s) => s.type === "base").length !== 1)
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "a study carries exactly one base scene (mentions, channels, period)" });
    // A cold open already states the base (total, period, channels), so after it chapters may drop
    // their note; without a cold open the note stays mandatory. A note that is shown needs 5,000
    // mentions or more: under that the absolute count reads as a thin study, so the figure goes in %.
    const opensWithBase = piece.scenes[0]?.type === "cold";
    piece.scenes.forEach((s, i) => {
      if (s.type === "chapter" && s.chart && !s.note && !opensWithBase)
        ctx.addIssue({ code: "custom", path: ["scenes", i, "note"], message: `chapter "${s.id}" shows a chart without its note: mentions, period, channels` });
      // The climax count is a figure too: without a cold open it needs its note, like a chapter's chart.
      if (s.type === "climax" && !s.note && !opensWithBase)
        ctx.addIssue({ code: "custom", path: ["scenes", i, "note"], message: `climax "${s.id}" shows a count without its note: mentions, period, channels` });
      if (s.type === "chapter" || s.type === "climax") thinNote(s.note, i, ctx);
    });
    copyRules(piece.scenes as Record<string, unknown>[], ctx);
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
