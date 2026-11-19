# Photos in Insights pieces: experiment, on hold

**Status, 19 Nov 2026: on hold.** Brandhon reviewed three tries and did not like how they look.
The format needs time to define before any piece carries a photo. Nothing from these tries is on
the site.

## What was tried

All three used two local test pieces. They are not public pieces and they never went live.

| # | Date | Idea | Images | Cost (approx.) | Verdict |
|---|---|---|---|---|---|
| 1 | 17 Nov | A photo in the study style (person in haze, place washed to white) in the lower part of the piece, fading into the white canvas. The scenes sit above it. | 4 | USD 0.80 | "No me lo imaginaba así." Wanted the photo full screen. |
| 2 | 18 Nov | One photo full screen, darker and not washed to white. Each scene was replaced by one large line over it: the hook, one number with its label, the quote, the takeaway. | 2 | USD 0.40 | Led to try 3: more photos, and keep the motion. |
| 3 | 18 Nov | Several photos per piece, one per scene, with a cross-fade and a slow push-in. The usual animated scenes play over them unchanged, with all their charts, icons and word-by-word text, in a light-on-dark palette. | 6 | USD 1.20 | "No me gustó cómo se ven." On hold. |

Total spent on the experiment: **12 images, about USD 2.40**.

## Where the work is

- **The code of try 3** is on the branch `website/insights-photo-experiment`, which is not
  merged:
  - `src/motion/PhotoStory.tsx`;
  - the scene colors as CSS variables (`sceneColor` and `PHOTO_SCENE_VARS` in `src/motion/theme.ts`);
  - the story's `image` field as a list.
- **What is on `main`** since PR #219:
  - a story can carry one `image` (in `src/content/stories/schema.ts`), drawn in the lower part of
    the piece;
  - no published piece uses it.
- **The images and prompts** are not in git. The prompts followed the house style in
  `STUDY_IMAGES.md`, with the place not washed to white for tries 2 and 3.

## What it showed

- **Keep the motion.** Brandhon was clear that photos must not replace the scenes' animation,
  charts and icons. Try 2 replaced them, and that was wrong.
- **Charts over a photo need a dark, busy-free frame.** In try 3 the photo had to be darkened
  heavily for white type and bars to read, and the photo lost much of its weight.
- **One photo per scene** changes what the eye sees every 3 to 5 seconds. It was meant to hold
  attention (the "boredom index"). It has not been measured.
- **Faces.** One of the images showed a readable face in profile, which breaks the house rule.
  Any new image has to be checked for that.

## Before trying again

Decide these first, with Brandhon:
1. **The role of the photo.** It could be the background of every scene, a cover scene only, or a
   cut-in between scenes.
2. **The look.** It could be the study style washed to white (white canvas, dark type) or a darker
   photo with light type.
3. **Which pieces carry photos:** every piece, or only the first piece of each study.
4. **How to measure** whether the photos hold attention: completion of the piece, or reaching the
   last scene.

## What it would cost

At about USD 0.20 per image (`gpt-image-2.6-sunburst`, high quality, 1024×1536):

| Option | Images | Cost |
|---|---|---|
| One photo per piece, for the 27 live pieces | 27 | ~USD 5.40 |
| Four photos per piece (like try 3), for the 27 live pieces | 108 | ~USD 21.60 |
| The same, with one retry per piece | ~135 | ~USD 27 |
| Each new study (about 6 pieces, four photos each) | 24 | ~USD 4.80 |

Show the figure before generating; image runs cost real money (AGENTS.md). The real spend is in
the OpenAI usage panel. The figures here are estimates.
