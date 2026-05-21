# Deploy Noisia Website

## Recomendación

Usar **GitHub + Railway**.

No recomiendo **GitHub Pages** para este proyecto porque hoy corre sobre Next.js 15 estándar. Aunque podríamos forzar un export estático, nos metería restricciones innecesarias para futuras iteraciones.

## Estado actual

El proyecto ya quedó preparado para Railway:

- `package.json` declara `packageManager: "pnpm@10.33.2"`
- `pnpm-lock.yaml` es el lockfile activo
- `railway.json` usa Nixpacks y arranca con `pnpm run start`
- `next.config.mjs` usa Next.js estándar, sin `output: "standalone"`
- `.gitignore` está listo

## GitHub

El repo local ya está inicializado y conectado a:

- `https://github.com/noisia-ai/website.git`

Commits locales:

1. `014fe39` — `Initial Noisia website`
2. `7f8b3a8` — `Prepare project for Railway deployment`

El push actual falla por permisos:

```bash
remote: Permission to noisia-ai/website.git denied to brandhonO.
fatal: unable to access 'https://github.com/noisia-ai/website.git/': The requested URL returned error: 403
```

## Para subir a GitHub

Cuando la cuenta tenga permisos al repo:

```bash
git push -u origin main
```

## Railway

1. Entra a Railway y crea un proyecto nuevo.
2. Elige **Deploy from GitHub repo**.
3. Selecciona `noisia-ai/website`.
4. Railway debería detectar Next.js automáticamente.
5. Verifica:
   - Package manager: `pnpm`
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm run build`
   - Start command: `pnpm run start`
6. Google Analytics ya usa el Measurement ID `G-CPCFPVBDTP`. Si alguna vez necesitas cambiarlo sin tocar código, en `Variables` agrega `NEXT_PUBLIC_GA_MEASUREMENT_ID` con el nuevo Measurement ID de GA4 (`G-...`).
7. En `Networking`, haz clic en **Generate Domain** para obtener el dominio `*.up.railway.app`.

## Dominio `noisia.ai`

Lo más limpio:

1. Agregar `www.noisia.ai` como custom domain en Railway.
2. Crear un `CNAME` desde `www` al target que te entregue Railway.
3. Agregar también `noisia.ai` si tu proveedor DNS soporta `CNAME flattening`, `ALIAS` o `ANAME`.

Si tu proveedor no soporta apex flattening:

- deja `www.noisia.ai` como dominio principal
- redirige `noisia.ai` a `www.noisia.ai` desde tu DNS o desde Cloudflare

## Validación local antes de deploy

```bash
/Users/brandhon_o/.local/share/pnpm/pnpm install --frozen-lockfile
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs /Users/brandhon_o/.local/share/pnpm/pnpm exec next build
/Users/brandhon_o/.local/share/pnpm/pnpm exec tsc --noEmit
```

Antes de revisar visualmente, reinicia el server local y limpia `.next` si aparece un `ChunkLoadError`:

```bash
rm -rf .next
NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs /Users/brandhon_o/.local/share/pnpm/pnpm exec next dev -p 3002
```
