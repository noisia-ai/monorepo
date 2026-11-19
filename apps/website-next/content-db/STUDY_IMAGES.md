# The image of a study

Each study has its own image, in two shapes made from the same scene:

| Shape | File in the study folder | Loaded as | Where it shows |
|---|---|---|---|
| Vertical 2:3 | `imagen.png` | `hero.webp` | The study's page, next to the title |
| Horizontal 3:2 | `imagen-wide.png` | `hero-wide.webp`, `email-banner.jpg` | The study's card in the index (cropped to 16:9) and the banner of the access email (cropped to 1.85:1) |

Without `imagen-wide.png`, the card and the email use the vertical image. Without either, the page
and the card show the deck's cover.

## The look: a person in haze, in the real place, washed to white

Chosen by Brandhon on 17 Nov 2026 after a test on the insurance study. The test compared three
styles and this one won:
- the documentary cutout used before;
- a portrait with cyan and coral doubles, like the site's editorials;
- a person in mist, like the reference images Brandhon chose.

**Why it has a background.** A person on a blank white or transparent background reads as an AI
image. A photograph has a place. The place is what makes the image believable and tells the reader
where the moment happens.

What every image has:
- **A real photograph of a real place.** It must never look like a cutout on blank paper or a
  digital illustration.
- **One person, face never readable.** They are seen in profile or three-quarter from behind,
  looking down or away. They are the only thing in the frame with tone and a little muted color.
- **Haze around the person.** It dissolves the lower body into light.
- **The anaglyph edge, on the person only.** A coral-red fringe (`#D91441`) on one side and a cyan
  one (`#009CA8`) on the other, like a slightly misregistered print. This is the brand's neon, used
  as glow and never as a fill (`packages/kb/Design.md`).
- **The place behind them, washed almost to white.** It is in black and white, very high-key and
  low-contrast, as if the exposure were set for the person. It is still recognizable: a dining
  room, a pharmacy counter, a branch office. The edges of the frame fade to white, so the image
  melts into the white page. The page still lays it over white with `multiply` and a soft mask.
- **One clear human action, the moment of the study.** Not a pose and not a metaphor. It is the
  instant where the study's tension shows: reading the letter that denies the claim, holding the
  router while on hold, weighing a medicine box at the counter. This follows Human Signals §06
  (`packages/pitch-kit/HUMAN_SIGNALS.md`).
- **Fine film grain** over the whole frame.
- **Never:** text, letters or numbers, logos or brands, readable documents, labels or screens,
  watermarks, recognizable faces, public figures, children.

## How the prompt is built

`pnpm content:image` writes one prompt per shape. It joins these blocks, in this order (the model
weighs the start most):

| # | Block | Comes from | What it says |
|---|---|---|---|
| 1 | Photograph | `STYLE.photograph` in `scripts/content/image.ts` | A real documentary photograph on location, large-format film. Never a cutout or an illustration. |
| 2 | Person | `STYLE.person` | Profile or from behind, face never readable, haze, anaglyph edge on the figure only. |
| 3 | Place | `STYLE.place` | The real place behind, black and white, high-key, washed to white, recognizable, edges fading to white. |
| 4 | Finish | `STYLE.finish` | Grain; quiet and cinematic; one clear action. |
| 5 | Frame | `SHAPES.<shape>.frame` | Vertical: person slightly off-center, room rising behind. Wide: person in a third, the room filling the rest, safe for crops. |
| 6 | Never | `STYLE.never` | The forbidden list, plus "no person isolated on a blank background". |
| 7 | Study | `estudio.json` `en.title` + `en.dek` | What the study is about. |
| 8 | People | `market` in `estudio.json` | "The person looks like an everyday resident of Mexico." |
| 9 | Moment | `image.brief` | Who, and the moment they are living. |
| 10 | Place | `image.place` | Where it happens and what is behind them. |

Blocks 1 to 6 are the house style and are the same for every study. **Only blocks 7 to 10 change.**
If the house style changes, it changes in `STYLE` and in this file together.

### Writing `image.brief` and `image.place`

They are in English, in `estudio.json`:

```json
"image": {
  "brief": "A man in his mid forties in a button-down shirt, in profile, reading a single sheet of paper, a thin folder under his arm, shoulders dropped and head lowered, as if his insurance claim was just turned down.",
  "place": "The small dining room of his apartment in Mexico City, late afternoon: the dining table with a few envelopes, a chair, a kitchen doorway, a window with a sheer curtain."
}
```

**`brief` says who and the moment, in one or two sentences:**
- Age and plain clothes.
- What they hold: one or two objects, never with a readable label.
- The body: shoulders, head, hands. The face does not count, because it is not seen.
- "As if…": the study's tension in one clause.

**`place` says where it happens and lists three to five things behind the person:**
- Choose the place where the study's moment happens in that market: home, pharmacy counter, bank
  branch, street, car.
- Add the time of day.
- Do not use generic offices or studios.

**Checks before generating:**
- Can someone read the study's question in the scene without a caption?
- Is it a real moment rather than a symbol (no scales, no puzzle pieces, no arrows)?
- Is there nothing with text on it?
- Could the place be in the study's market?

## How it is made

1. Write `image.brief` and `image.place` in `estudio.json`.
2. Run `pnpm content:image <web folder>`. It writes `imagen.prompt.txt` and
   `imagen-wide.prompt.txt` and asks OpenAI (`gpt-image-2.6-sunburst`, high quality) for two
   candidates of each shape: `imagen-1.png`, `imagen-2.png`, `imagen-wide-1.png`,
   `imagen-wide-2.png`. Useful flags:
   - `--dry-run` only writes the prompts.
   - `--shape vertical|wide` draws one shape.
   - `--n` goes up to 4.

   Each image costs about USD 0.20, so two shapes with two candidates each is about USD 0.80. The
   script prints the cost before asking. The key is `OPENAI_API_KEY` in the repo root's
   `.env.local`.
3. Review the candidates with the quality check in Human Signals §VIII:
   - Is the moment true and the story legible?
   - Are the hands, anatomy and perspective right?
   - Is there any text, any readable face, any AI artifact?
   - Does the person stand out and does the place read?

   Pick one of each shape, preferably the same take, and rename them `imagen.png` and
   `imagen-wide.png`.
4. Describe the image in `es.image_alt` and `en.image_alt`. Say who it is and what they are doing,
   not the style.
5. Run `pnpm content:study <web folder>`. It loads `hero.webp`, `hero-wide.webp` and the email
   banner with the rest of the study.

## Using this look outside the website

Brandhon wants this look in the studies themselves too (the decks), not only on the website
(19 Nov 2026). There is one route for everyone, so the images match:
- **The style lives in one place:** the `STYLE` blocks in `scripts/content/image.ts`, mirrored by
  this file. Pitch Kit, a study agent or the website team do not write their own version of it.
- **For a study** (website page, card, email and, if the deck wants it, its cover or section
  images), write `image.brief` and `image.place` in the study's `estudio.json` and run
  `pnpm content:image <web folder>`. The same `imagen.png` and `imagen-wide.png` can go into the
  deck. A deck that needs more scenes writes one prompt per scene: blocks 1 to 6 as they are, and
  blocks 7 to 10 for each scene.
- **Pitch Kit's own creative direction** (Human Signals, Kinetic Cinema) stays for sales decks,
  video and atmosphere: `packages/pitch-kit/HUMAN_SIGNALS.md`. This look is the quiet one, one
  person and one moment in haze, for studies and their pages.
- **Photos inside Insights pieces** are on hold. See `INSIGHTS_IMAGES_EXPERIMENT.md`.

## What it has cost

At about USD 0.20 per image (high quality). The real spend is in the OpenAI usage panel.

| Date | What | Images | Cost (approx.) |
|---|---|---|---|
| 17 Nov 2026 | Style test on the insurance study: three styles, two candidates each | 6 | USD 1.20 |
| 17–18 Nov 2026 | Images of the four Triggers & Barriers studies, vertical and wide, with candidates | ~16 | USD 3.20 |
| 17–18 Nov 2026 | Insights experiment (on hold) | 12 | USD 2.40 |
| | **Total** | **~34** | **~USD 6.80** |

**What to budget:**
- **A new study:** two candidates of each shape is 4 images, about USD 0.80. With one round of
  retries, about USD 1.60.
- **A study whose deck uses this look in its sections:** add about USD 0.40 per scene (two
  candidates).
- Show the figure before generating.

## Reference

- The insurance study's test: two candidates of the chosen style, kept outside git.
- The four reference images Brandhon chose (person in mist, anaglyph): `~/Downloads/Noisia
  imagenes/`, outside git.
- Human Signals and Kinetic Cinema, the creative direction this style comes from:
  `packages/pitch-kit/HUMAN_SIGNALS.md`. Kinetic Cinema's motion blur and flash stay for video and
  atmosphere. The study image is quieter: one person, one moment, haze.
