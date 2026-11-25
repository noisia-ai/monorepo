# The image of a study

Each study has its own image, in two shapes made from the same scene:

| Shape | File in the study folder | Loaded as | Where it shows |
|---|---|---|---|
| Vertical 2:3 | `imagen.png` | `hero.webp` | The study's page, next to the title |
| Horizontal 3:2 | `imagen-wide.png` | `hero-wide.webp`, `email-banner.jpg` | The study's card in the index (cropped to 16:9) and the banner of the access email (cropped to 1.85:1) |

Without `imagen-wide.png`, the card and the email use the vertical image. Without either, the page
and the card show the deck's cover.

## The look: real people in the study's moment, in haze, in the real place washed to white

**History.** On 17 Nov 2026 Brandhon chose "a person in haze, in the real place, washed to white"
after a test on the insurance study. The rule then was one person, seen from behind or in profile,
face never readable, slightly off-center, one quiet action. Twenty studies later, on 25 Nov 2026,
he looked at the grid of `/insights/estudios` and said they were all the same: everyone on the left,
no faces, everyone worried, so it looked like AI. Each image must look and feel different and
show the insight of its own study. This version keeps the finish and lets the scene vary.

### What stays the same in every image (the finish)

- **A real photograph of real people in a real place**, taken candidly by a photojournalist. Never
  a cutout on blank paper, a digital illustration or a stock photo.
- **The place in black and white, washed almost to white.** Very high-key and low-contrast, as if
  the exposure were set for the people. Ground, sky and bystanders far back are grey too. It is
  still recognizable: a courthouse, a pharmacy counter, a farm road. The edges of the frame fade
  to white, so the image melts into the white page. The page still lays it over white with
  `multiply` and a soft mask.
- **The people are the only things in color**, a little muted and natural.
- **Haze around the people** that fades the lower edges of the frame into light.
- **The anaglyph edge, on the people only.** A coral-red fringe (`#D91441`) on one side and a cyan
  one (`#009CA8`) on the other, like a slightly misregistered print. This is the brand's neon, used
  as glow and never as a fill (`packages/kb/Design.md`).
- **Fine film grain** over the whole frame.
- **Ordinary faces.** Lines, stubble, glasses, uneven hair, everyday clothes, varied ages and
  builds. Not models and not attractive stock faces. Nobody looks into the camera.
- **Never:** text, letters or numbers, logos or brands, readable documents, labels or screens,
  watermarks, public figures, children. No stock gestures: no hand on the forehead, no head in the
  hands, no one staring at a letter in despair unless the insight asks for it.

### What changes on purpose, study by study (the scene)

Every study chooses these six things in its brief, from its insight:

| Axis | Options |
|---|---|
| Camera | Close, medium or wide shot; people on the left, in the center or on the right; eye level, from below or from above |
| People | One, two, three or a group |
| Face | Visible and readable (the default), in profile, or not seen (only when the insight needs distance, such as someone small in a huge landscape) |
| Emotion | It comes from the insight: relief, triumph, anger, laughter, disbelief, fatigue, resignation, defiance, determination, curiosity. Worry is one option among many |
| Time and light | Dawn, morning, hard midday, golden hour, dusk, night under a lamp, grey rain |
| Inside or outside | A home, a counter or an office, or a street, a park, a farm, the steps of a building |

**The scene tells the study's finding, not the industry's topic.** Cover the title: what happens in
the photo should be the finding. "In Germany a friend's recommendation is what moves money to
another bank" is three friends on a bench, one showing the others her new bank. "In Brazil, my
plan denied it and I won in court" is a mother and her son laughing on the courthouse steps.
"Customers in the US have nowhere else to go" is a man, tiny, under the only cable that reaches his
farm.

### The rule so that no two studies look alike

Before generating a set of studies, write them in one table (study, finding, scene, people, face,
emotion, camera, light, inside or outside) and check:

- **Same market** (for example the four Mexico studies) and **same industry** (for example the
  five insurance studies): different emotions, a different number of people in at least two of
  them, at least one inside and one outside, different times of day, and a different camera
  position or distance.
- **Across all published studies:** no emotion more than twice; a face visible in most; one person
  alone in at most half; a phone at the ear at most twice; a letter or paper in the hand at most
  three times.
- After generating, look at all of them together on one contact sheet, with the studies already
  on the site, before picking.

## How the prompt is built

`pnpm content:image` writes one prompt per shape. It joins these blocks, in this order (the model
weighs the start most):

| # | Block | Comes from | What it says |
|---|---|---|---|
| 1 | Photograph | `STYLE.photograph` in `scripts/content/image.ts` | A candid documentary photograph on location, on 35mm film, by a photojournalist. Never a cutout, an illustration or a stock photo. |
| 2 | People | `STYLE.person` | Ordinary people, in color; their face and body carry the emotion of the brief; haze; anaglyph edge on the people only. |
| 3 | Place | `STYLE.place` | The real place, all of it black and white, high-key, washed to white; the light still tells the time of day; edges fade to white. |
| 4 | Finish | `STYLE.finish` | Grain; the distance, placement, number of people and energy come from the brief, not from a template. |
| 5 | Frame | `SHAPES.<shape>.frame` | Follow the camera written in the brief. Wide: keep people and action in the central band, safe for crops. |
| 6 | Never | `STYLE.never` | The forbidden list, the stock gestures, no one looking into the camera. |
| 7 | Study | `estudio.json` `en.title` + `en.dek` | What the study is about. |
| 8 | People | `market` in `estudio.json` | "The people look like everyday residents of Mexico." |
| 9 | Moment | `image.brief` | The camera, who, what they do, the face, the emotion and the finding. |
| 10 | Place | `image.place` | Where it happens, the time and light, and what is around them. |

Blocks 1 to 6 are the house style and are the same for every study. **Only blocks 7 to 10 change,
and they carry the whole scene.** If the house style changes, it changes in `STYLE` and in this
file together.

### Writing `image.brief` and `image.place`

They are in English, in `estudio.json`:

```json
"image": {
  "brief": "Camera: medium-wide shot from slightly below, the two of them in the right third, coming down wide stone steps, the building rising behind them. A short, round woman in her early sixties with grey curly hair and reading glasses pushed up on her head, holding a thick folder of papers against her chest, and her son in his thirties, stocky with a shaved head and a short-sleeved shirt, his arm around her shoulders. Both faces visible in three-quarter view, mid-step. She laughs with her eyes almost closed; he grins at her. The emotion is triumph and relief: her health plan denied a procedure, and she has just won in court.",
  "place": "The wide steps of a courthouse in central Recife at bright midday: hard tropical sun and short shadows, white modernist columns, a palm tree, a few people far back and out of focus. No readable signs, coats of arms, logos or text."
}
```

**`brief`, in this order:**
1. **Camera:** shot size, where the people are in the frame, the angle.
2. **Who:** for each person, age, build, hair and plain clothes. Make them different from the
   people in the other studies.
3. **What they do:** one clear action, caught in the middle. Objects never have a readable label.
4. **Face:** visible, in profile, or not seen, and the expression.
5. **"The emotion is …:"** one word or two, then the study's finding in one clause.

**`place`, in one or two sentences:**
- The real place in the study's market (a city or region of that country), not a generic office or
  studio.
- The time of day and the light.
- Three to five things around the people.
- End with "No readable signs, logos, labels or text anywhere."

**Checks before generating:**
- With the title covered, can someone read the study's finding in the scene?
- Is it a real moment rather than a symbol (no scales, no puzzle pieces, no arrows)?
- Is there nothing with text on it?
- Does the table pass the rule above against the other studies of its market and its industry?

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
3. Review the candidates on a contact sheet, next to the other studies, with the quality check in
   Human Signals §VIII:
   - Is the finding legible and the moment true?
   - Are the hands, anatomy and perspective right? Do the faces look like ordinary people?
   - Is there any text, any logo, any AI artifact?
   - Is the place black and white and washed, and do the people stand out?
   - Does it look different from the studies of the same market and the same industry?

   Pick one of each shape and rename them `imagen.png` and `imagen-wide.png`. The two shapes are
   separate takes of the same scene, so the people may differ a little between them.
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
  deck.
- **A deck that needs more scenes** (a cover, section covers) writes one prompt per scene: blocks
  1 to 6 copied as they are from `image.ts`, and blocks 7 to 10 for each scene. Same model,
  quality and sizes. The scenes of one deck follow the same rule as the studies: they must not
  look alike. This is what Pitch Kit does today. The copy lives in the case's folder, outside git,
  because the scenes carry client data. When `STYLE` changes, a deck still being built has to copy
  it again.
- **Pitch Kit's pointer** is `packages/pitch-kit/HUMAN_SIGNALS.md` §VII.1 ("La imagen de un
  estudio"). It names this file and `STYLE` as the source of the prompt.
- **Pitch Kit's own creative direction** (Human Signals, Kinetic Cinema) stays for sales decks,
  video and atmosphere: `packages/pitch-kit/HUMAN_SIGNALS.md`. This look is the documentary one,
  real people in the moment of a finding, for studies and their pages.
- **Photos inside Insights pieces** are on hold. See `INSIGHTS_IMAGES_EXPERIMENT.md`.

## What it has cost

At about USD 0.20 per image (high quality). The real spend is in the OpenAI usage panel.

| Date | What | Images | Cost (approx.) |
|---|---|---|---|
| 17 Nov 2026 | Style test on the insurance study: three styles, two candidates each | 6 | USD 1.20 |
| 17–18 Nov 2026 | Images of the four Triggers & Barriers studies, vertical and wide, with candidates | ~16 | USD 3.20 |
| 17–18 Nov 2026 | Insights experiment (on hold) | 12 | USD 2.40 |
| 19 Nov 2026 | A paid study deck by Pitch Kit: cover in both shapes (two candidates each) and 8 section covers | 12 | USD 2.40 |
| 20–22 Nov 2026 | Images of 16 new studies (UK, US and Canada, Brazil, Germany), first look | ~64 | USD 12.80 |
| 25 Nov 2026 | Test of this look: three studies, wide, two candidates each | 6 | USD 1.20 |
| 25 Nov 2026 | All 20 published studies again with this look, both shapes, two candidates each, plus one vertical redone (lettering on a sweatshirt) | 82 | USD 16.40 |
| | **Total** | **~198** | **~USD 39.60** |

**What to budget:**
- **A new study:** two candidates of each shape is 4 images, about USD 0.80. With one round of
  retries, about USD 1.60.
- **A paid study deck with section covers:** about 10 scenes, USD 2 to 3.
- Show the figure before generating.

## Reference

- The four reference images Brandhon chose (people in mist, anaglyph; one of them a group
  celebrating): `~/Downloads/Noisia imagenes/`, outside git.
- Human Signals and Kinetic Cinema, the creative direction this style comes from:
  `packages/pitch-kit/HUMAN_SIGNALS.md`. Kinetic Cinema's motion blur and flash stay for video and
  atmosphere.
