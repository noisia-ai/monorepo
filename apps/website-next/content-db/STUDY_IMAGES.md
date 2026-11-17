# The image of a study

Each study has its own image. It opens the study's page, next to the title, and is the study's card
in the index. Until a study has one, the page shows the deck's cover.

## What it looks like

The editorial reports set the tone (`public/assets/insights/*-editorial.png`). A study image
follows the same idea with less treatment:

- **A real, ordinary person**, photographed naturally: honest expression, real skin, minimal
  retouching. No poses for the camera and no stock-photo smiles. Silhouettes and the anaglyph
  effect of the reports are allowed but not required.
- **Doing the thing the study is about**, at the moment it reads: checking a price, weighing two
  options, holding the keys. The brief says what that moment is.
- **Waist-up or three-quarter**, centered, looking slightly away, vertical 2:3.
- **On seamless white**, without floor, horizon or shadow, with white space on every side. The page
  melts the image into its white background (`mix-blend-mode: multiply`, soft mask at the edges).
- **Muted wardrobe**, at most one small accent in the brand's cyan or coral.
- **People who look like the markets** of the study.
- **Never**: text, logos, brands, readable screens, watermarks, celebrities or public figures,
  children.

## How it is made

1. In `estudio.json`, `image.brief` says in English who is in the picture and what they are doing,
   in two or three sentences. The house style is added by the script; the brief is only the scene.
2. `pnpm content:image <web folder>` writes `imagen.prompt.txt` (the full prompt) and asks OpenAI
   (`gpt-image-2.6-sunburst`, 1024×1536, high quality) for two candidates: `imagen-1.png`,
   `imagen-2.png`. Each costs about USD 0.20; `--n` goes up to 4, `--dry-run` only writes the
   prompt. The key is `OPENAI_API_KEY` in the repo root's `.env.local`.
3. Pick one, rename it to `imagen.png` and describe it in `es.image_alt` and `en.image_alt`.
4. `pnpm content:study <web folder>` loads it as `hero.webp` (public, like the cover) with the
   rest of the study.

The style lives in `scripts/content/image.ts` (`STYLE`); change it there and here together.

## Example brief

Black Friday in Europe (`black-friday-europa-2026`):

> A woman in her early thirties in a wool coat and scarf, a paper shopping bag in one hand and her
> phone in the other, glancing at the phone with a skeptical, half-amused look, as if checking
> whether a Black Friday price is really lower than two weeks ago.
