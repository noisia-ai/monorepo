# Noisia Studio — Test Strategy

> Cómo se testea cada cosa. Sin tests, los outputs al cliente eventualmente fallan en silencio y nadie lo nota hasta que hay reputación lastimada.

---

## 1. Niveles de test (de barato a caro)

| Nivel | Qué testea | Tool | Velocidad | Cuándo se corre |
|---|---|---|---|---|
| **Static** | Tipos, lint, imports | TypeScript + ESLint | <30s | Cada save (editor) + pre-commit |
| **Unit** | Una función pura aislada | Vitest | <5s | Cada save (watch mode) + CI |
| **Integration** | Varias funciones + DB real | Vitest + Supabase local | 30-60s | CI + manual |
| **Contract** | API endpoints contra schema | Vitest + supertest | 1-2 min | CI |
| **E2E** | User journey completo en navegador | Playwright | 5-15 min | CI nightly + pre-release |
| **Visual regression** | Componentes visuales no cambiaron | Chromatic o Percy | 2-5 min | CI |
| **AI quality** | Outputs IA cumplen quality gates | Custom + LLM-as-judge | 1-3 min por test | Pre-deploy de cambios en prompts |

---

## 2. Qué se testea y dónde

### 2.1 Unit (Vitest)

Funciones puras, lógica de transformación, validators.

**Locations:** `packages/*/src/**/*.test.ts`

**Ejemplos críticos:**

```typescript
// packages/humanizer/src/humanize.test.ts
import { humanize } from './humanize';

describe('humanize', () => {
  it('removes em dashes mid-sentence', () => {
    const input = "Mi casita — no es diminutivo — es identidad.";
    expect(humanize(input)).not.toContain('—');
  });

  it('removes negative parallelisms', () => {
    const input = "No es A, es B.";
    expect(humanize(input)).not.toMatch(/no es .{1,20}, es/i);
  });

  it('removes AI vocabulary', () => {
    const input = "Este pivotal underscore es enduring.";
    expect(humanize(input)).not.toMatch(/pivotal|underscore|enduring/i);
  });
});

// packages/methodologies/src/loader.test.ts
import { loadMethodology } from './loader';

describe('loadMethodology', () => {
  it('parses triggers-barriers manifest correctly', async () => {
    const manifest = await loadMethodology('triggers-barriers');
    expect(manifest.slug).toBe('triggers-barriers');
    expect(manifest.coding_dimensions.layer.values).toHaveLength(4);
  });

  it('rejects malformed YAML', async () => {
    await expect(loadMethodology('invalid-slug')).rejects.toThrow();
  });
});

// packages/query-engine/src/seed-composer.test.ts
describe('composeQuery', () => {
  it('combines brand_seeds + signal_phrases + exclusions correctly', () => {
    const query = composeQuery({
      brandSeeds: ['Seguros El Potosí'],
      signalPhrases: ['no me cubrió', 'vale la pena'],
      exclusions: ['Potosí municipio']
    });
    expect(query).toContain('Seguros El Potosí');
    expect(query).toContain('AND NOT');
    expect(query).toContain('Potosí municipio');
  });
});
```

### 2.2 Integration (Vitest + DB local)

Pipeline ingestor, transformaciones de mentions, persistencia.

**Locations:** `services/workers/src/**/*.integration.test.ts`

**Setup:** Docker compose levanta Postgres test temporal. Cada test corre en transacción que rollbacks al final.

**Ejemplos:**

```typescript
// services/workers/src/ingestor/sentione-csv.integration.test.ts
import { ingestSentioneCsv } from './sentione-csv';
import { setupTestDb, teardownTestDb } from '../testing/db';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

describe('SentiOne CSV ingestor', () => {
  it('imports 100 mentions and deduplicates by text_hash', async () => {
    const corpusId = await createTestCorpus();
    const result = await ingestSentioneCsv({
      corpusId,
      filePath: 'fixtures/sentione_sample.csv'
    });
    expect(result.included_count).toBeGreaterThan(0);
    expect(result.duplicate_count).toBeGreaterThan(0);  // sample tiene dups intencional
  });

  it('rejects mentions with text < 30 chars', async () => {
    const corpusId = await createTestCorpus();
    const result = await ingestSentioneCsv({
      corpusId,
      filePath: 'fixtures/sentione_too_short.csv'
    });
    expect(result.excluded_count).toBeGreaterThan(0);
  });
});
```

### 2.3 Contract (API)

Cada endpoint cumple su contract definido en `08_API_CONTRACTS.md`.

**Locations:** `apps/studio/src/app/api/**/*.contract.test.ts`

**Ejemplos:**

```typescript
// apps/studio/src/app/api/corpora/route.contract.test.ts
describe('POST /api/corpora', () => {
  it('creates corpus with brand_id', async () => {
    const res = await POST({ body: {
      brand_id: testBrandId,
      methodology_id: tbMethodologyId,
      business_question: '...'
    }});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('rejects when both brand_id and theme_id are present', async () => {
    const res = await POST({ body: {
      brand_id: testBrandId,
      theme_id: testThemeId,
      methodology_id: tbMethodologyId
    }});
    expect(res.status).toBe(422);
  });

  it('rejects without auth', async () => {
    const res = await POST({ body: {}, headers: {} });
    expect(res.status).toBe(401);
  });
});
```

### 2.4 E2E (Playwright)

Journeys críticos completos en navegador real.

**Locations:** `apps/studio/e2e/**/*.spec.ts`

**Journeys a cubrir en MVP:**

```typescript
// e2e/01-insights-manager-creates-corpus.spec.ts
test('Insights Manager crea corpus T&B desde cero', async ({ page }) => {
  await login(page, 'insights_manager');
  await page.goto('/studio/corpora/new');

  await page.selectOption('select[name="brand_id"]', testBrandId);
  await page.selectOption('select[name="methodology_id"]', tbMethodologyId);
  await page.fill('textarea[name="business_question"]', '...');
  await page.click('button:has-text("Crear corpus")');

  await expect(page).toHaveURL(/\/corpora\/[a-f0-9-]+/);
  await expect(page.locator('h1')).toContainText('Seguros El Potosí');
});

// e2e/02-cliente-views-published-dashboard.spec.ts
test('Cliente accede a dashboard publicado', async ({ page }) => {
  await login(page, 'brand_manager');
  await page.goto('/portal/dashboards/published-test-slug');

  await expect(page.locator('[data-block="hero_stats"]')).toBeVisible();
  await expect(page.locator('[data-block="tb_matrix_4layers"]')).toBeVisible();
});

// e2e/03-csv-upload-and-browse-mentions.spec.ts
// e2e/04-engine-validation-loop.spec.ts
// e2e/05-analysis-run-end-to-end.spec.ts
// e2e/06-client-comments-on-finding.spec.ts
// e2e/07-export-pdf.spec.ts
```

### 2.5 AI Quality tests

Los outputs de la IA deben pasar quality gates antes de ser entregados. Pero los quality gates son automatizables y se testean también.

**Locations:** `services/workers/src/pipeline/quality-gates/**/*.test.ts`

```typescript
// services/workers/src/pipeline/quality-gates/traceability.test.ts
describe('traceability gate', () => {
  it('passes when every finding has mention_ids_sample', () => {
    const output = loadFixture('tb-output-with-traceability.json');
    expect(traceabilityGate(output)).toEqual({ pass: true });
  });

  it('fails when a finding has no evidence', () => {
    const output = loadFixture('tb-output-without-traceability.json');
    const result = traceabilityGate(output);
    expect(result.pass).toBe(false);
    expect(result.failed_findings).toHaveLength(1);
  });
});
```

**LLM-as-judge** para validar outputs subjetivos:

```typescript
// services/workers/src/pipeline/llm-judges/humanizer-check.test.ts
describe('humanizer LLM judge', () => {
  it('detects AI-pattern text', async () => {
    const text = "El pivotal underscore de este enduring tapestry...";
    const judgment = await llmJudgeHumanizer(text);
    expect(judgment.pass).toBe(false);
    expect(judgment.violations).toContain('ai_vocabulary');
  });

  it('passes human-written text', async () => {
    const text = "Mi casita es la palabra del afecto. La gente la dice cuando presume su lugar.";
    const judgment = await llmJudgeHumanizer(text);
    expect(judgment.pass).toBe(true);
  });
});
```

---

## 3. Cómo se mockea SentiOne (sin gastar API credits)

**MVP:** mock completo de la respuesta SentiOne con fixtures.

```typescript
// services/workers/src/connectors/sentione-mock.ts
import sampleResponse from '../fixtures/sentione/seguros-potosi-sample.json';

export class SentioneMockClient {
  async query(params: SentioneQuery): Promise<SentioneResponse> {
    // En tests, devuelve fixture deterministico
    if (process.env.NODE_ENV === 'test') {
      return filterFixtureByQuery(sampleResponse, params);
    }
    // En prod, llama API real
    return realSentioneCall(params);
  }
}
```

**Fixtures:** los corpora reales de los 4 estudios pasados (Cultural Foresight 2026, FIH, The Mexican Home) se convierten en JSONs anonimizados para servir como fixtures.

**Para tests determinísticos:** snapshots de query → response. Una vez confirmado que el snapshot es correcto, los tests comparan contra el snapshot.

---

## 4. Cómo se valida que la IA no rompe

Tres mecanismos:

### 4.1 Quality gates automatizados

Cada output IA pasa por los 7 gates del manifest de la metodología. Si falla cualquier gate, el output NO se publica y se marca como `requires_review`.

```typescript
// services/workers/src/pipeline/run-quality-gates.ts
export async function runQualityGates(output: MethodologyOutput, manifest: MethodologyManifest) {
  const results = await Promise.all(
    manifest.quality_gates.map(gate => runGate(gate, output))
  );
  const allPass = results.every(r => r.pass);
  return { pass: allPass, results };
}
```

### 4.2 Prompt regression tests

Cuando el dev cambia un prompt, debe correr la suite de regression que ejecuta ese prompt contra fixtures conocidos y compara output.

```typescript
// services/workers/src/pipeline/prompts/__tests__/tb-paso2-codificacion.regression.test.ts
test('Paso 2 codificación: layers se asignan correctamente sobre fixture conocida', async () => {
  const fixture = loadFixture('seguros-potosi-paso1-output.json');
  const result = await runPrompt('tb_paso2_v1', { input: fixture });

  // Distribución esperada por layer (basada en validación humana previa)
  expect(result.stats.distribution.psicologico.barriers).toBeWithinRange(250, 350);
  expect(result.stats.distribution.cultural.triggers).toBeWithinRange(80, 120);
  expect(result.stats.pct_ambiguas).toBeLessThan(0.05);
});
```

### 4.3 Manual review canary

10% de los outputs en producción se mandan a doble revisión humana, aunque hayan pasado quality gates. Si el doble review encuentra problemas sistemáticos, el prompt se ajusta.

```typescript
// Flag en analysis_runs:
// canary_review_required: BOOLEAN
```

---

## 5. Convertir los 4 estudios pasados en fixtures

Los corpora reales son oro para testing. Plan:

### Estudios disponibles

| Estudio | Tipo | Ubicación |
|---|---|---|
| Cultural Foresight México 2026 | Tema | `/Users/brandhon_o/Downloads/foresight_2026/` |
| Future is Human | Tema | `/Users/brandhon_o/Downloads/future_is_human/` |
| The Mexican Home | Tema | `/Users/brandhon_o/Downloads/what_home_means/` |
| (Foundation Snapshots) | Varios | (en mismas carpetas) |

### Plan de conversión

```bash
# Crear carpeta fixtures
mkdir -p services/workers/src/fixtures/historical_studies

# Cada estudio se convierte en:
# - 1 corpus.json (las mentions normalizadas al schema Noisia)
# - 1 master_output.json (el output esperado de la metodología corrida)
# - 1 evidence.json (las citas curadas)
```

Script de conversión (lo escribe Codex):

```typescript
// scripts/convert-historical-studies.ts
import { readCsv, readJson, normalizeMention } from './lib';

const studies = [
  { name: 'foresight-2026', methodology: 'cultural-codes-decoding', sources: [...] },
  { name: 'future-is-human', methodology: 'cultural-codes-decoding', sources: [...] },
  { name: 'mexican-home', methodology: 'cultural-codes-decoding', sources: [...] },
];

for (const study of studies) {
  const mentions = await readSourcesAndNormalize(study.sources);
  const output = await readJson(study.outputPath);

  await writeFixture(`historical_studies/${study.name}/corpus.json`, mentions);
  await writeFixture(`historical_studies/${study.name}/expected_output.json`, output);
}
```

**Uso en tests:**

```typescript
test('Cultural Codes pipeline produces consistent output on historical corpus', async () => {
  const corpus = await loadFixture('historical_studies/foresight-2026/corpus.json');
  const expected = await loadFixture('historical_studies/foresight-2026/expected_output.json');

  const actual = await runMethodologyPipeline(corpus, 'cultural-codes-decoding');

  // Validar que las señales detectadas son similares (no idénticas, hay variabilidad LLM)
  expect(actual.signals).toHaveLength(expected.signals.length);
  for (const expectedSignal of expected.signals) {
    const found = actual.signals.find(s => similarSignal(s, expectedSignal));
    expect(found).toBeDefined();
  }
});
```

---

## 6. Strategy de fixtures sintéticos

Cuando un fixture real no existe (porque la feature es nueva), generar sintéticos con IA:

```typescript
// scripts/generate-synthetic-fixtures.ts
import { generateText } from 'ai';

const prompts = {
  'seguros-trigger-psicologico': 'Genera 50 menciones sintéticas de Twitter MX sobre seguros que expresen un trigger psicológico (tranquilidad, alivio anticipado). Variar autor, fecha, estilo.',
  // ...
};

for (const [name, prompt] of Object.entries(prompts)) {
  const mentions = await generateBatch(prompt, 50);
  await writeFixture(`synthetic/${name}.json`, mentions);
}
```

**Importante:** los fixtures sintéticos están etiquetados como `synthetic` para que en producción no se confundan con data real.

---

## 7. CI configuration

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint

  unit:
    needs: static
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit

  integration:
    needs: unit
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env: { POSTGRES_PASSWORD: test }
        ports: ['5432:5432']
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration

  contract:
    needs: integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test:contract

  e2e:
    needs: contract
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install
      - run: pnpm test:e2e
```

**Estrategia:** fail fast. Si static falla, no corren los siguientes niveles.

---

## 8. Métricas de cobertura

**MVP:** no obsesionarse con 100% coverage. Cubrir:

- 80%+ unit en `packages/humanizer`, `packages/query-engine`, `packages/methodologies`
- 60%+ integration en `services/workers/src/ingestor` y `services/workers/src/pipeline`
- E2E happy path de los 7 journeys críticos
- 100% contract coverage de endpoints documentados en `08_API_CONTRACTS.md`

**Post-MVP:** aumentar gradualmente con cada bug reportado en producción.

---

## 9. Anti-patterns a evitar en tests

```typescript
// TODO mejora-futura: evitar estos patrones desde el día 1

// ❌ MAL: test que depende del orden
test('first creates user', ...);
test('then creates org', ...);  // depende del anterior

// ✅ BIEN: cada test es independiente
test('creates org with valid user', async () => {
  const user = await createTestUser();
  const org = await createTestOrg({ owner: user });
  // ...
});

// ❌ MAL: mockear todo
test('analysis pipeline', () => {
  vi.mock('./db');
  vi.mock('./ai');
  vi.mock('./queue');
  // No estás testeando nada real
});

// ✅ BIEN: integration tests con servicios reales
test('analysis pipeline (integration)', async () => {
  const corpus = await seedTestCorpus();
  await runAnalysis(corpus.id);
  const result = await db.select().from(findings).where(...);
  expect(result).toHaveLength(...);
});

// ❌ MAL: testear que la IA dijo exactamente X
test('analysis returns specific text', async () => {
  const result = await runAnalysis(corpus);
  expect(result.cultural_reading).toBe('Exactly this text');  // brittle
});

// ✅ BIEN: testear propiedades del output
test('analysis returns coherent cultural_reading', async () => {
  const result = await runAnalysis(corpus);
  expect(result.cultural_reading.length).toBeGreaterThan(100);
  expect(result.cultural_reading).not.toMatch(/pivotal|underscore/i);  // humanizer
});
```

---

## 10. Roadmap de test maturity

**Mes 1-2 (Fase 1-2 del MVP):**
- Static + unit en packages
- Integration tests de ingestor SentiOne CSV
- 2-3 E2E happy path

**Mes 3-4 (Fase 3-4):**
- Contract tests de todos los endpoints
- Quality gates automatizados como tests
- E2E de los 7 journeys críticos

**Mes 5-6 (Fase 5-6):**
- LLM-as-judge para outputs subjetivos
- Visual regression para dashboard
- Performance tests (¿cuánto tarda una analysis_run completa?)

**Post-MVP:**
- Chaos engineering en workers
- Load tests cuando lleguen 5+ clientes simultáneos
- Security audit + penetration testing
