# @noisia/motion · el builder de video

Un JSON entra, un video sale. Las reglas de marca, estilo, guion y audio están en
[`packages/pitch-kit/VIDEO.md`](../pitch-kit/VIDEO.md); este paquete las ejecuta. Si algo aquí
contradice a VIDEO.md, manda VIDEO.md y se corrige el código.

## Los cuatro formatos

| Formato | Entra | Sale | Composición |
|---|---|---|---|
| `clip` | Una historia de `apps/website-next/src/content/stories/public/*.json`, sin cambios | MP4 1080 × 1920, ~21 s | `src/clip` |
| `social` | Una pieza `format: "social"` (ejemplos `examples/social*.json`) | MP4 1080 × 1920, 15 a 30 s | `src/social` |
| `study` | Una pieza `format: "study"` y su `.timing.json` | MP4 1080 × 1920, 90 a 150 s, con voces y música | `src/study` |
| `deck` | Una pieza `format: "deck"` con su caja en la slide | GIF (o MP4) del tamaño exacto de la caja | `src/deck` |

El esquema de cada pieza, con sus límites de texto, vive en [`src/schema.ts`](src/schema.ts). Una pieza
que no valida no renderiza.

**La base es obligatoria** (VIDEO.md §2). Una pieza social o de estudio trae `base` (menciones totales,
canales con sus menciones, periodo, mercado) y exactamente una escena `{ "type": "base" }`; cada cifra
trae su `note` (`mentions`, `what`, `period`, `channels`). Sin eso, el esquema la rechaza. El clip
cierra con la base de la historia (`sources`, `period`, `market`).

## Comandos (desde `packages/motion`)

```bash
# Clip: una historia publicada del website
node builders/build-video.mjs --format clip --in ../../apps/website-next/src/content/stories/public/the-mexican-home.json --story casa-propia-es-futuro --locale es --out out/clip.mp4

# Social y estudio
node builders/build-video.mjs --format social --in examples/social-muted.json --out out/social.mp4
node builders/build-video.mjs --format study --in examples/study.json --out out/study.mp4

# Motion de deck: GIF que arranca en el diagrama completo, con blanco exacto
node builders/build-video.mjs --format deck --in examples/deck-hub.json --out out/hub.gif --gif

# QA: stills en cada marcador y transición de escena y hoja de contactos, en lugar del video.
# En el estudio truena (exit 1) si dos bloques se cruzan, con sus nombres y el cuadro.
node builders/build-video.mjs --format study --in examples/study.json --qa out/qa-study
python3 builders/qa.py check out/study.mp4 --format study

# Borrador rápido a media resolución
node builders/build-video.mjs --format study --in examples/study.json --out out/draft.mp4 --scale 0.5

# Studio de Remotion para ver y ajustar las composiciones (renders sin cobro)
pnpm studio
```

## Audio y timing (`builders/audio.py`)

```bash
python3 builders/audio.py pieza.json --budget     # caracteres a generar; sin llamar a la API
python3 builders/audio.py pieza.json --estimate   # timing sin audio, para un borrador mudo; sin API
python3 builders/audio.py pieza.json              # voces y música con ElevenLabs, timing real
```

- Escribe `pieza.timing.json` junto a la pieza y el audio en `audio/` de la carpeta de la pieza. Si
  falta el timing, `build-video` corre `--estimate` solo.
- La key de ElevenLabs cuesta dinero. Vive en el `.env.local` de la raíz del repo
  (`ELEVENLABS_API_KEY=`), ignorado por git, nunca en el chat ni en el repo; `audio.py` la busca
  ahí solo. Antes de generar se corre `--budget` y se dice el gasto.
- Las reglas de tiempo de §5.3 (la voz en el cuadro 6, la cita 6 cuadros después, el Spark 8 después,
  la escena cierra 20 después) son constantes al inicio de `audio.py`: un solo lugar.
- La carpeta del caso puede traer `images/` (atmósfera); la pieza las nombra como `images/x.jpg`.
- Modelos y ajustes de voz: `voices.model`, `voices.quoteModel` y `voices.settings` en la pieza; si
  no, los defaults de `audio.py`. Una cita con `say` se lee así y se muestra literal.
- La música aprobada se bloquea con `"musicLock": true`. Ningún audio se sobrescribe sin guardar el
  anterior como `_prev_<fecha>`.
- La seña del insight (`builders/cue.py` → `public/sfx/insight.wav`) suena en cada Spark del estudio
  por defecto; `"sfx": {}` la quita y `"sfx": {"insight": "audio/otra.wav"}` la cambia.

## Licencia de Remotion

Noisia tiene licencia de empresa. La key secreta y la pública van en el `.env.local` de la raíz del
repo, con las demás llaves de herramientas (ignorado por git; plantilla en `.env.example`).
`packages/motion/.env` también se lee, si existe. `build-video` pasa la secreta a cada `renderMedia`
y `renderStill`; el Studio usa la pública. Cada render automático cuenta para la facturación: para
iterar se usan `--qa` (stills a media resolución) y el Studio, y el MP4 completo al final.

## Fondos

`public/backgrounds/v-*.jpg` son el bloom de Noisia en 9:16, generado con
`python3 ../pitch-kit/commercial/builder/make_shapes.py --vertical public/backgrounds`. Estáticos a
propósito: el grano animado infló un video de 14.7 MB a 415 MB.

| Fondo | Dónde vive el color |
|---|---|
| `v-bottom` | Abajo, cian y rojo: gancho y cierre |
| `v-top` | Arriba, navy, rojo y cian: apertura |
| `v-corner` | Esquina inferior derecha, cian |
| `v-soft` | Esquina superior derecha, tenue: fondo de toda una pieza |

## Cómo está armado

- `src/engine.ts` es la única puerta al motor. Los componentes nunca importan de `remotion`
  directo, para que el website pueda correrlos con su propio runtime (mismos nombres).
- `src/brand`: tokens, curvas y resortes del canon, Google Sans local, logo real, logos de
  plataforma (Simple Icons) e íconos del kit (`pitch-kit/assets/icons.json`).
- `src/common`: fondo, barra de progreso, subtítulos palabra por palabra, cierre con logo y la mezcla.
- `src/charts`: anillo, barras, número héroe con cuadrícula de puntos y paneles enfrentados.
- Los ejemplos salen de un reporte publicado en noisia.ai/insights; `pnpm test` comprueba que cada
  cita sea un fragmento literal de su evidencia.

## Ruido conocido

Remotion avisa que espera `zod` 4.5.4. Ese aviso es para `@remotion/zod-types`, que no se usa aquí;
el paquete usa zod 3 como el website, y los renders no se ven afectados.
