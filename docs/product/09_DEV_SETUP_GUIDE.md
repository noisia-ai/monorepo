# Noisia Studio — Dev Setup Guide

> Guía paso a paso. Codex acompaña al fundador en la creación de las cuentas necesarias antes de tocar código. Lee de arriba hacia abajo.

---

## 0. Pre-requisitos local

Antes de cualquier servicio externo, en tu laptop:

- [ ] Node.js 20 LTS instalado (`node --version` debe decir v20.x.x)
- [ ] pnpm 10 instalado (`pnpm --version`)
- [ ] Docker Desktop instalado y corriendo
- [ ] Git con SSH configurado para GitHub
- [ ] Cuenta GitHub con acceso al org `noisia-ai`
- [ ] VS Code o editor preferido

Comando rápido de verificación:
```bash
node -v && pnpm -v && docker -v && git --version
```

---

## 1. Cuentas que necesitas crear (en orden)

### 1.1 Supabase (DB + Auth básica)

1. Ve a https://supabase.com
2. Crear cuenta con tu email Noisia
3. Crear proyecto: nombre `noisia-studio-dev`, región `us-east-1` (más cerca a México), password fuerte para DB
4. **Esperar ~2 minutos** mientras se provisiona
5. Copiar al `.env.local`:
   - `SUPABASE_URL` (Settings → API → Project URL)
   - `SUPABASE_ANON_KEY` (Settings → API → anon public)
   - `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → service_role — TOP SECRET, never client-side)
   - `DATABASE_URL` (Settings → Database → Connection string → URI)

**Costo:** $0 hasta 500MB DB + 2GB storage. Suficiente para MVP.

**Crear otro proyecto para producción cuando llegue el momento:** `noisia-studio-prod`.

### 1.2 Kinde (Auth)

1. Ve a https://kinde.com
2. Sign up con email Noisia
3. Crear business: `Noisia AI`
4. En el dashboard:
   - **Applications:** crear app `Noisia Studio` (Type: Back-end web application)
   - **Organizations:** habilitar feature Organizations (lo necesitamos para multi-cliente)
   - **Roles:** crear roles `founder`, `admin`, `kam`, `insights_manager`, `ux_data_specialist`, `client_owner`, `brand_manager`, `agency_insights`
5. Copiar al `.env.local`:
   - `KINDE_CLIENT_ID`
   - `KINDE_CLIENT_SECRET`
   - `KINDE_ISSUER_URL`
   - `KINDE_SITE_URL` = `http://localhost:3001` (dev)
   - `KINDE_POST_LOGOUT_REDIRECT_URL` = `http://localhost:3001`
   - `KINDE_POST_LOGIN_REDIRECT_URL` = `http://localhost:3001/studio`

**Costo:** $0 hasta 7,500 MAU. Cuando crezcamos, $25/mes.

**Configurar callback URLs:**
- Allowed callback URLs: `http://localhost:3001/api/auth/kinde_callback` (dev) + `https://studio.noisia.ai/api/auth/kinde_callback` (prod)
- Allowed logout redirect URLs: `http://localhost:3001` + `https://studio.noisia.ai`

### 1.3 Anthropic (Claude API)

1. Ve a https://console.anthropic.com
2. Sign up
3. Settings → API Keys → Create Key, llamarla `noisia-studio-dev`
4. Copiar al `.env.local`:
   - `ANTHROPIC_API_KEY`

**Costo:** pay-as-you-go. ~$0.003 por mil tokens input Claude 3.5 Sonnet, $0.015 output. Para MVP estimado $50-200/mes según volumen de análisis.

**Mejora futura:** configurar `OPENAI_API_KEY` también como fallback en Vercel AI SDK config.

### 1.4 Upstash Redis (cola BullMQ)

1. Ve a https://upstash.com
2. Sign up con GitHub
3. Console → Create Database → llamar `noisia-queue-dev`, región `us-east-1`
4. Copiar:
   - `REDIS_URL` (TCP connection string, el formato `redis://default:xxx@host:port`)

**Costo:** $0 hasta 10,000 commands/día. Para MVP suficiente. Después $0.20 por 100K commands.

**Alternativa:** Railway Redis si ya tienes el website ahí. Costo similar.

### 1.5 Railway (hosting)

1. Ya tienes cuenta (el website está ahí)
2. Crear nuevo proyecto: `noisia-studio`
3. Connect repo `noisia-ai` (cuando ya esté en GitHub como monorepo)
4. Después crear segundo proyecto: `noisia-workers`

**Costo:** los proyectos del studio + workers probablemente $5-15/mes cada uno.

### 1.6 Sentry (error tracking)

1. Ve a https://sentry.io, sign up
2. Crear projects: `noisia-studio-web`, `noisia-studio-workers`
3. Copiar DSNs:
   - `SENTRY_DSN_STUDIO`
   - `SENTRY_DSN_WORKERS`

**Costo:** $0 hasta 5K errores/mes.

### 1.7 PostHog (analytics)

1. Self-hosted: deploy en Railway desde Docker template oficial PostHog ($5-10/mes)
2. O Cloud free tier: https://posthog.com hasta 1M eventos/mes
3. Copiar:
   - `POSTHOG_KEY`
   - `POSTHOG_HOST`

### 1.8 Resend (email)

1. Ve a https://resend.com
2. Sign up con email Noisia
3. Verificar dominio `noisia.ai` (paso DNS — toma ~30 min de propagación)
4. Crear API key
5. Copiar:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL` (algo como `noreply@noisia.ai` o `studio@noisia.ai`)

**Costo:** $0 hasta 3,000 emails/mes y 100 emails/día.

### 1.9 Cuentas pendientes (para después)

- **SentiOne API:** comprar después de validar MVP funcional con CSV. Pricing on-request directo con SentiOne (típicamente $500-2000/mes).
- **Datashake:** post-MVP. Pricing por volumen.
- **Apify:** post-MVP cuando necesitemos integraciones one-off. $49/mes plan starter.
- **Twilio o Meta Business:** postpuesto con WhatsApp.

---

## 2. `.env.example` completo

Crear `apps/studio/.env.example` con todas las variables que el dev necesita conocer. Sin valores reales, solo placeholders y comentarios.

```bash
# ─── DATABASE (Supabase) ──────────────────────────────────────
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx  # TOP SECRET — never expose client-side
DATABASE_URL=postgresql://postgres:xxx@db.xxxx.supabase.co:5432/postgres

# ─── AUTH (Kinde) ─────────────────────────────────────────────
KINDE_CLIENT_ID=
KINDE_CLIENT_SECRET=
KINDE_ISSUER_URL=https://noisia.kinde.com
KINDE_SITE_URL=http://localhost:3001
KINDE_POST_LOGOUT_REDIRECT_URL=http://localhost:3001
KINDE_POST_LOGIN_REDIRECT_URL=http://localhost:3001/studio

# ─── LLM (Anthropic + opcional OpenAI fallback) ───────────────
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL_DEFAULT=claude-3-5-sonnet-20241022
ANTHROPIC_MODEL_FALLBACK=claude-3-opus-20240229
OPENAI_API_KEY=  # opcional, vacío en MVP

# ─── QUEUE (Redis) ─────────────────────────────────────────────
REDIS_URL=redis://default:xxx@xxx.upstash.io:6379

# ─── STORAGE (Supabase Storage) ────────────────────────────────
SUPABASE_STORAGE_BUCKET_OUTPUTS=outputs
SUPABASE_STORAGE_BUCKET_CORPUS_FILES=corpus-files
SUPABASE_STORAGE_BUCKET_AVATARS=avatars

# ─── EMAIL (Resend) ────────────────────────────────────────────
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=noreply@noisia.ai

# ─── MONITORING ────────────────────────────────────────────────
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
POSTHOG_KEY=phc_xxx
POSTHOG_HOST=https://app.posthog.com

# ─── APP CONFIG ────────────────────────────────────────────────
NEXT_PUBLIC_APP_NAME=Noisia Studio
NEXT_PUBLIC_APP_URL=http://localhost:3001  # cambiar en prod
NEXT_PUBLIC_WEBSITE_URL=http://localhost:3000  # url del website
NODE_ENV=development

# ─── FEATURES FLAGS ────────────────────────────────────────────
FEATURE_WHATSAPP=false           # postpuesto MVP
FEATURE_MULTI_COUNTRY=false      # postpuesto MVP
FEATURE_BILLING=false            # postpuesto MVP

# ─── PIPELINE (opcional para tunear) ───────────────────────────
QUERY_ENGINE_MAX_ITERATIONS=5
QUERY_ENGINE_SAMPLE_SIZE_PER_ITERATION=50
ANALYSIS_PIPELINE_TIMEOUT_SECONDS=900
```

---

## 3. Setup local con Docker Compose

Crear `infrastructure/docker/docker-compose.yml`:

```yaml
version: '3.8'

services:
  # Solo necesario si NO queremos usar Supabase remoto para dev.
  # Si el dev usa Supabase managed dev project, este no se levanta.
  postgres:
    image: postgres:15-alpine
    profiles: ["local-only"]  # docker compose --profile local-only up
    environment:
      POSTGRES_DB: noisia_studio_dev
      POSTGRES_USER: noisia
      POSTGRES_PASSWORD: localdev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  bull-board:
    image: deadly0/bull-board:latest
    ports:
      - "3030:3000"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - redis

volumes:
  postgres_data:
  redis_data:
```

**Recomendación:** usar Supabase managed para Postgres incluso en dev (gratis para 1 proyecto). Solo levantar Redis local con Docker.

```bash
# Levantar solo Redis y bull-board
cd infrastructure/docker
docker compose up -d redis bull-board

# Verificar
docker compose ps
# Acceder bull-board: http://localhost:3030
```

---

## 4. Setup del monorepo paso a paso

### Día 1 — clonar y migrar

```bash
# Clonar
git clone git@github.com:noisia-ai/website.git noisia-ai
cd noisia-ai

# Hacer la conversión a monorepo (ver 07_REPO_STRUCTURE.md sección 3)
# ... ejecutar los pasos de migración ...

# Instalar deps
pnpm install

# Verificar que el website sigue funcionando
pnpm dev:website
# Abrir http://localhost:3000 — debe verse igual que antes
```

### Día 2 — Supabase + Drizzle

```bash
# 1. Crear .env.local en apps/studio con valores del Supabase project
cp apps/studio/.env.example apps/studio/.env.local
# Editar y poner valores reales

# 2. Setup Drizzle
cd infrastructure/db
pnpm add drizzle-orm drizzle-kit pg
pnpm add -D @types/pg

# 3. Definir schema (ver 04_DATABASE_SCHEMA.md adaptado)
# Crear archivos en infrastructure/db/schema/

# 4. Generar primera migration
pnpm drizzle-kit generate

# 5. Aplicar a Supabase
pnpm drizzle-kit migrate

# 6. Cargar seeds iniciales
pnpm db:seed
```

### Día 3 — Studio app scaffold

```bash
cd apps/studio

# 1. Crear app Next.js 15 dentro de apps/studio (NO usar create-next-app si ya existe el folder)
pnpm add next@latest react@latest react-dom@latest
pnpm add -D typescript @types/react @types/react-dom @types/node tailwindcss postcss autoprefixer

# 2. Estructura mínima
mkdir -p src/app
echo "export default function Page() { return <h1>Noisia Studio</h1>; }" > src/app/page.tsx

# 3. Tailwind config — extender preset desde packages/ui
# Ver packages/ui/tailwind-preset.ts

# 4. Levantar
pnpm dev
# Abrir http://localhost:3001
```

### Día 4 — Kinde auth

```bash
cd apps/studio
pnpm add @kinde-oss/kinde-auth-nextjs

# Setup según docs: https://docs.kinde.com/developer-tools/sdks/backend/nextjs-app-router/
# Crear src/app/api/auth/[kindeAuth]/route.ts

# Crear src/middleware.ts para proteger rutas /studio/*

# Probar:
# - Visitar http://localhost:3001/studio (debe redirigir a Kinde login)
# - Login con tu cuenta
# - Debería redirigir back a /studio
```

### Día 5 — primer endpoint funcional

```bash
# Crear API route que devuelve el catalog de methodologies del seed
# apps/studio/src/app/api/methodologies/route.ts

import { db } from "@/lib/db";
import { methodologies } from "@noisia/db/schema";

export async function GET() {
  const data = await db.select().from(methodologies);
  return Response.json({ data });
}

# Probar:
curl http://localhost:3001/api/methodologies
# Debe devolver los 6 methodologies del seed
```

A los 5 días tienes:
- Monorepo funcional
- Supabase conectado con schema base
- Auth con Kinde funcional
- Primer endpoint API consumiendo DB

---

## 5. Setup CI/CD (GitHub Actions)

Crear `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

Crear `.github/workflows/deploy-studio.yml`:

```yaml
name: Deploy Studio
on:
  push:
    branches: [main]
    paths:
      - 'apps/studio/**'
      - 'packages/**'
      - 'infrastructure/db/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway
        uses: bervProject/railway-deploy@main
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          service: 'noisia-studio'
```

Equivalente para `deploy-website.yml` y `deploy-workers.yml`.

---

## 6. Scripts útiles para el dev

Agregar al `package.json` root:

```json
{
  "scripts": {
    "setup": "./scripts/setup.sh",
    "fresh-db": "pnpm db:migrate && pnpm db:seed",
    "studio": "pnpm --filter @noisia/studio dev",
    "website": "pnpm --filter @noisia/website dev",
    "workers": "pnpm --filter @noisia/workers dev",
    "all": "concurrently \"pnpm studio\" \"pnpm workers\" \"docker compose up redis\"",
    "bull-board": "open http://localhost:3030",
    "supabase-studio": "open https://app.supabase.com/project/_/editor",
    "logs:studio": "railway logs --service noisia-studio",
    "logs:workers": "railway logs --service noisia-workers"
  }
}
```

`scripts/setup.sh`:

```bash
#!/bin/bash
set -e

echo "🔍 Verificando prerequisitos..."
command -v node || (echo "Falta Node.js" && exit 1)
command -v pnpm || (echo "Falta pnpm" && exit 1)
command -v docker || (echo "Falta Docker" && exit 1)

echo "📦 Instalando dependencias..."
pnpm install

echo "🐳 Levantando servicios Docker..."
cd infrastructure/docker
docker compose up -d redis bull-board
cd ../..

echo "🗄️  Aplicando migrations a Supabase..."
pnpm db:migrate

echo "🌱 Cargando seeds..."
pnpm db:seed

echo "✅ Listo. Corre 'pnpm all' para levantar studio + workers + redis."
```

---

## 7. Validación de setup completo

Checklist final antes de empezar a desarrollar Fase 1:

- [ ] `node --version` = v20.x.x
- [ ] `pnpm --version` >= 10
- [ ] Supabase project creado, conexión funciona desde `psql $DATABASE_URL`
- [ ] Kinde app creada, callback URLs configurados
- [ ] `.env.local` en apps/studio con todas las vars
- [ ] Docker compose levanta redis sin errores
- [ ] `pnpm install` corre limpio
- [ ] `pnpm typecheck` pasa
- [ ] `pnpm db:migrate` aplica migrations sin errores
- [ ] `pnpm db:seed` carga las 6 methodologies + brand_seeds catalog
- [ ] `pnpm dev:website` levanta el website actual
- [ ] `pnpm dev:studio` levanta studio en localhost:3001
- [ ] Visitar studio → redirige a Kinde login → puedes hacer login → vuelves a /studio
- [ ] `curl http://localhost:3001/api/methodologies` devuelve 6 methodologies
- [ ] Sentry recibe un evento de prueba
- [ ] BullMQ ui accesible en http://localhost:3030

Si los 13 puntos pasan, estás listo para arrancar Fase 1 del MVP (ver `01_PRODUCT_SPEC_MASTER.md` sección 10).

---

## 8. Recursos para Codex

Documentación oficial que necesitará consultar:

- **Next.js 15 App Router:** https://nextjs.org/docs/app
- **Supabase Postgres:** https://supabase.com/docs/guides/database
- **Supabase Auth (no la usamos pero útil leer):** https://supabase.com/docs/guides/auth
- **Kinde Next.js SDK:** https://docs.kinde.com/developer-tools/sdks/backend/nextjs-app-router/
- **Drizzle ORM:** https://orm.drizzle.team/docs/overview
- **Vercel AI SDK:** https://ai-sdk.dev/docs
- **BullMQ:** https://docs.bullmq.io/
- **Turborepo:** https://turborepo.com/docs
- **shadcn/ui:** https://ui.shadcn.com
- **Recharts:** https://recharts.org/en-US/api

---

## 9. Cuando algo falle

Orden de troubleshooting:

1. **Verificar `.env.local`** — la mayoría de errores son env vars faltantes
2. **Reiniciar docker** — `docker compose restart`
3. **Limpiar node_modules** — `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`
4. **Verificar Supabase** — entrar al dashboard, ver si el proyecto está pausado (free tier se pausa después de 7 días sin actividad)
5. **Verificar Kinde** — ver si callback URL coincide exactamente
6. **Revisar Sentry** — debería tener el stacktrace

```typescript
// TODO mejora-futura: armar un /api/healthcheck que valide
// conexión a Supabase, Redis, Kinde, Anthropic, Sentry y devuelva
// el estado de cada uno. Útil para debug y para CI.
```

---

## 10. Próximos pasos después del setup

Una vez completado este setup:

1. Lee `01_PRODUCT_SPEC_MASTER.md` sección 10 (Roadmap MVP).
2. Lee `13_ACCEPTANCE_CRITERIA.md` para la primera feature de Fase 1.
3. Crea issues en GitHub usando el formato de AC.
4. Empieza a desarrollar.

Cualquier duda → consulta el doc relevante:
- Algo sobre data → `04_DATABASE_SCHEMA.md`
- Algo sobre cómo funciona T&B → `03_TRIGGERS_BARRIERS_DEEPDIVE.md`
- Algo sobre API → `08_API_CONTRACTS.md`
- Algo sobre tests → `12_TEST_STRATEGY.md`
- Algo sobre estructura → `07_REPO_STRUCTURE.md`
