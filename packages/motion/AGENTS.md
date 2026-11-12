# AGENTS.md · packages/motion

- Lee `README.md` de este paquete y `packages/pitch-kit/VIDEO.md` antes de tocar una composición o
  armar un video. El pedido de un video llega por el bloque de video de `packages/pitch-kit/PROMPTS.md`.
- Una pieza nueva es un JSON, no código. Código nuevo solo si el formato no lo cubre; entonces el
  componente va en `src/` contra `src/engine.ts` y el esquema en `src/schema.ts`.
- Las piezas de un caso viven en la carpeta del caso, nunca en este repo (es público). `examples/`
  solo lleva datos de reportes ya publicados en noisia.ai.
- Secretos: `packages/motion/.env` (licencia de Remotion) y el `.env` del caso (ElevenLabs). Nunca en
  git, nunca en el chat. Generar voces cuesta dinero: `audio.py --budget` y decir el gasto antes.
- Antes de entregar: `--qa` (truena si dos bloques se cruzan; un encimado bloquea la entrega) y revisar
  la hoja de contactos; `qa.py check` sobre el MP4; pedirle al usuario que escuche el audio.
- Un componente nuevo marca sus bloques con `data-qa="<escena>.<elemento>"` para que la guardia de
  layout los mida (`src/common/LayoutGuard.tsx`).
- Una sesión de caso no edita este paquete: si el kit produce un defecto, lo corrige en una copia
  parchada en la carpeta del caso y deja el parche para integrarlo (`packages/pitch-kit/VIDEO.md` §8).
- Hecho = `pnpm --filter @noisia/motion typecheck` y `test` en verde.
