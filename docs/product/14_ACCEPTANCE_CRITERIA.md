# Noisia Studio — Acceptance Criteria por Feature

> Cada feature del MVP tiene AC en formato "Given/When/Then". El feature está done cuando todos los AC pasan en CI + revisión manual del Insights Manager (Codex valida con producto, no solo con tests).

---

## Cómo se usa este doc

- **Codex:** convierte cada feature de aquí en uno o varios issues de GitHub.
- **Tú (fundador):** robusteces los AC durante el desarrollo según hallazgos.
- **CI:** los tests de cada feature mapean 1:1 a los AC.
- **Closing the feature:** se cierra cuando los AC pasan + Insights Manager firma en plataforma.

---

## Fase 1 — Foundation (semanas 1-4)

### F1.1 — Monorepo migración

**Como** dev
**Quiero** convertir el repo actual a monorepo con Turborepo
**Para que** el website siga funcionando idéntico mientras agregamos studio + workers + packages

**AC:**
- [ ] El comando `pnpm dev:website` levanta el website en localhost:3000 sin cambios visuales vs antes
- [ ] El comando `pnpm dev:studio` levanta studio vacío en localhost:3001
- [ ] El comando `pnpm typecheck` pasa sin errores en root
- [ ] El comando `pnpm build` construye todo el monorepo
- [ ] El folder `knowledge-base/` está movido a `packages/kb/` y el website lo importa sin errores
- [ ] El docs del paquete está en `docs/product/`
- [ ] CI corre `lint + typecheck + test` en cada PR

### F1.2 — Setup base Supabase + Drizzle

**AC:**
- [ ] Supabase project `noisia-studio-dev` creado
- [ ] `infrastructure/db/schema/` contiene definiciones Drizzle de las tablas: `organizations`, `users`, `brands`, `themes`, `methodologies`, `study_corpora`
- [ ] `pnpm db:migrate` aplica migrations sin errores
- [ ] `pnpm db:seed` carga: 6 methodologies (YAMLs), 60+ brand_seeds, 1 organization de demo (Seguros El Potosí + Noisia Internal)
- [ ] Conexión funciona desde `psql $DATABASE_URL`

### F1.3 — Auth Kinde

**AC:**
- [ ] Kinde app configurada con roles definidos
- [ ] Middleware en `apps/studio/src/middleware.ts` protege `/studio/*` y `/portal/*`
- [ ] Login funciona: visitar `/studio` → redirige a Kinde → vuelve a `/studio` con sesión
- [ ] `GET /api/auth/me` devuelve user + organization + accessible_brands
- [ ] Logout funciona y limpia sesión
- [ ] Roles correctos por user_type (mapping Kinde org roles → DB users.primary_role)

### F1.4 — Browser de brands & themes

**AC:**
- [ ] Página `/studio/brands` lista brands del usuario con paginación
- [ ] Página `/studio/themes` lista themes (incluye los de Noisia internal)
- [ ] Filtros funcionan: por organization, industry, status
- [ ] Click en brand abre `/studio/brands/:id` con detalle + competidores
- [ ] `POST /api/brands` crea brand nueva (solo founder/admin/kam)
- [ ] `POST /api/themes` crea theme nuevo
- [ ] Validation Zod en server-side: errores devuelven 422 con campos específicos

### F1.5 — Importador CSV manual de SentiOne

**AC:**
- [ ] Página `/studio/corpora/:id/import` permite drag-drop o file picker de CSV
- [ ] Parse del CSV maneja delimiter `;` y header SentiOne completo (45+ columnas)
- [ ] Mapping a schema canónico Noisia preserva campos críticos (text, author, date, url, platform, sentiment, engagement)
- [ ] Deduplicación por `text_hash` dentro del corpus
- [ ] Exclusión automática de mentions con texto <30 caracteres
- [ ] Response devuelve stats: `record_count, included_count, excluded_count, duplicate_count`
- [ ] Import_batch queda registrado con `source_file_name, source_file_hash, imported_by`
- [ ] Browser de mentions accesible en `/studio/corpora/:id/mentions` con paginación + filtros

---

## Fase 2 — Engine de Validación de Queries (semanas 5-8)

### F2.1 — Composer de query inicial

**Como** Insights Manager
**Quiero** que el sistema genere automáticamente el primer query SentiOne
**Para que** no tenga que escribir queries complejos manualmente

**AC:**
- [ ] Endpoint `POST /api/corpora/:id/run-engine` encola un job en BullMQ
- [ ] Worker lee: brand_seeds (catálogo + competidores configurados), signal_phrases del manifest de la metodología, exclusiones globales, memoria_industry, memoria_brand
- [ ] LLM (Claude vía Vercel AI SDK) compone query usando los inputs
- [ ] Query persiste en `query_iterations` con `iteration_number=1, query_text, query_components` (jsonb)
- [ ] UI muestra progress bar mientras se compone (polling cada 2s)

### F2.2 — Evaluador de muestra

**AC:**
- [ ] Worker ejecuta query contra mock SentiOne (MVP usa CSVs históricos como mock)
- [ ] Mock devuelve sample aleatorio de 50 mentions
- [ ] LLM evalúa la sample con prompt específico: densidad temática, balance T/B, cobertura fuentes, idioma, geo MX
- [ ] Evaluación produce: `quality_score (0-100), density_score, noise_score, ai_evaluation_notes`
- [ ] Query iteration se actualiza con la evaluación

### F2.3 — Loop de refinamiento

**AC:**
- [ ] Si `quality_score >= 85` → corpus pre-aprobado, status=`corpus_building → pending_analyst_review`
- [ ] Si `50 <= quality_score < 85` → IA propone 2-3 ajustes específicos, UI muestra al Insights Manager
- [ ] Si `quality_score < 50` → LLM marca como `needs_redesign`, UI pide al Insights Manager rediseñar
- [ ] Insights Manager puede: aceptar ajuste IA, modificar, descartar
- [ ] Decisión del Insights Manager queda en `query_iterations.insights_manager_decision`
- [ ] Max 5 iteraciones antes de forzar revisión humana

### F2.4 — Aprobación de corpus

**AC:**
- [ ] Endpoint `POST /api/corpora/:id/approve-corpus` requiere rol insights_manager con acceso
- [ ] Al aprobar: status pasa a `corpus_approved`, mentions cambian inclusion_status `pending → included`
- [ ] Insights Manager debe ver botón solo si pasó pre-aprobación o si quiere overridear
- [ ] Log de aprobación: `corpus_first_approved_at, insights_manager_user_id`

---

## Fase 3 — Triggers & Barriers ejecutable (semanas 9-12)

### F3.1 — Pre-flight check

**AC:**
- [ ] Worker corre pre-flight con prompt `tb_pre_flight_v1` sobre el corpus aprobado
- [ ] Pre-flight valida 5 puntos del playbook T&B
- [ ] Si decisión = ABORTAR: analysis_run status=`failed`, blockers en JSON
- [ ] Si decisión = PROCEDER: continúa con Paso 1

### F3.2 — Paso 1: Pase abierto

**AC:**
- [ ] LLM ejecuta prompt `tb_paso1_v1` sobre muestra de 200 mentions aleatorias
- [ ] Output: tagged_mentions + unique_tags_with_counts
- [ ] Validación: 40 <= len(unique_tags) <= 90
- [ ] Si <40 o >90: retry con prompt refinado (max 2 retries)
- [ ] Tags emergentes persisten en `mention_codings.emergent_tags`

### F3.3 — Paso 2: Codificación 4 layers

**AC:**
- [ ] LLM ejecuta prompt `tb_paso2_v1` sobre TODAS las mentions del corpus
- [ ] Output: polarity + layer + secondary_layer (opcional) + ambiguous bool per mention
- [ ] Validación: `pct_ambiguas < 0.05`
- [ ] Si >5% ambiguas: re-ejecutar Paso 1 con instrucción de tags más finos
- [ ] Codings persisten en `mention_codings` con `classifier_version`

### F3.4 — Paso 3: Jerarquización 3D

**AC:**
- [ ] Worker agrupa codings por `(polarity, layer, tag_emergente)`
- [ ] Para cada grupo calcula: frecuencia, intensidad_promedio (LLM evalúa), capacidad_predictiva (regex sobre mention text)
- [ ] Cada grupo se persiste como `findings` con `metrics jsonb`
- [ ] Score compuesto: `freq_normalized * 0.4 + intensidad * 0.3 + predictiva * 0.3`

### F3.5 — Paso 4: Movilidad

**AC:**
- [ ] LLM marca cada finding como `movible_por_marca`, `influenciable_parcialmente` o `estructural`
- [ ] Razón obligatoria en `findings.movilidad_razon`

### F3.6 — Paso 5: Comparativo (opcional)

**AC:**
- [ ] Si corpus tiene `competitive_corpus_ids`: repetir pasos 1-4 para cada competidor
- [ ] Construir tabla cruzada `comparative_analysis` jsonb en analysis_run
- [ ] Identificar: triggers/barriers compartidos vs diferenciales

### F3.7 — Paso 6: Síntesis + Humanizer

**AC:**
- [ ] LLM redacta `cultural_reading` por finding, `activation_playbook`, `friction_removal_plan`
- [ ] Cada output narrativo pasa por `@noisia/humanizer` antes de persistir
- [ ] Validación post-humanizer: cero matches de regex `pivotal|underscore|landscape|enduring|tapestry`
- [ ] Validación: cero negative parallelisms tipo "no es X, es Y"
- [ ] Validación: cero em dashes mid-sentence en cuerpo de texto

### F3.8 — Quality gates automatizados

**AC:**
- [ ] Worker corre los 7 gates definidos en manifest T&B
- [ ] Cada gate devuelve `{pass: bool, message: text}`
- [ ] Si todos pass: `analysis_run.status = approved_for_review`
- [ ] Si alguno falla: `status = requires_review`, blockers visibles en UI
- [ ] Insights Manager NO puede publicar si hay gates fallando (hard block)

### F3.9 — Curación humana

**AC:**
- [ ] Página `/studio/corpora/:id/findings` lista findings ordenados por `metrics.score_compuesto DESC`
- [ ] Insights Manager puede editar inline: `commercial_name, one_liner, cultural_reading, confidence_level`
- [ ] Puede agregar/quitar evidence_quotes (drag-drop ordering)
- [ ] Botón "Regenerar con humanizer" re-procesa narrativo de un finding
- [ ] Botón "Publicar al cliente" requiere todos los findings aprobados + KAM visto bueno

---

## Fase 4 — Dashboard outputs (semanas 13-16)

### F4.1 — Banco de bloques inicial

**AC:**
- [ ] Tabla `dashboard_blocks_catalog` poblada con 9 bloques universales + 2 específicos T&B
- [ ] Cada bloque tiene: `block_id, name, description, methodologies_compatible, component_path, props_schema, preview_screenshot_url, status`
- [ ] Página `/studio/blocks/catalog` lista bloques con preview

### F4.2 — Render del Dashboard normal

**AC:**
- [ ] Página `/portal/dashboards/:slug` renderiza el dashboard
- [ ] Layout viene de `dashboards.layout_config` (orden de bloques + props_override)
- [ ] Cada bloque del banco renderiza con su data específica
- [ ] Filtros funcionan: layer, polaridad, periodo, plataforma
- [ ] Responsive: funciona en desktop + tablet + mobile
- [ ] FCP <2s en 3G simulado

### F4.3 — Scrollytelling

**AC:**
- [ ] Página `/portal/dashboards/:slug/scrollytelling` renderiza vista vertical
- [ ] 13 scrolls definidos en manifest T&B se renderizan en orden
- [ ] Cada scroll trigger animation cuando entra en viewport
- [ ] Navegación: barra lateral con jump-to-scroll
- [ ] Mobile-first design (la vista nació para celular)

### F4.4 — Exports

**AC:**
- [ ] `GET /api/dashboards/:slug/export.pdf` genera PDF con Puppeteer del dashboard normal
- [ ] PDF mantiene paleta, tipografía, todos los bloques
- [ ] `GET /api/dashboards/:slug/export.csv` devuelve findings + evidence + metrics en formato tabular
- [ ] `GET /api/dashboards/:slug/export.md` devuelve markdown completo del análisis

### F4.5 — Comentarios

**AC:**
- [ ] Cada bloque/finding tiene icono de comentario visible
- [ ] Click abre panel lateral con thread de comments
- [ ] `POST /api/dashboards/:slug/comments` crea comment
- [ ] Comments tienen reacciones: like, important, addressed, concerned
- [ ] Threading: un comment puede tener `parent_comment_id`
- [ ] Notificación al Insights Manager por email cuando hay comment nuevo
- [ ] Insights Manager puede marcar comment como `addressed`

### F4.6 — Change requests

**AC:**
- [ ] Botón "Pedir cambio" en cada bloque
- [ ] `POST /api/dashboards/:slug/change-requests` crea ticket
- [ ] Lista en `/studio/change-requests` para Insights Manager
- [ ] Status flow: new → in_progress → completed/rejected
- [ ] Cliente recibe notificación cuando su request cambia status

### F4.7 — Publicación

**AC:**
- [ ] `POST /api/corpora/:id/dashboard/publish` requiere quality gates pasados + Insights Manager aprobó
- [ ] Genera `client_url_slug` único
- [ ] Notifica por email a Brand Manager con link
- [ ] Dashboard pasa a `status=published, first_published_at=now()`

---

## Fase 5 — Notificaciones y memoria evolutiva (semanas 17-20)

### F5.1 — Email notifications (WhatsApp postpuesto)

**AC:**
- [ ] Resend integrado
- [ ] Templates: comment_new, change_request_status, dashboard_published, pattern_alert
- [ ] Preferencias del usuario en `users.preferences.notifications`
- [ ] Unsubscribe link funcional

### F5.2 — Pattern anomaly detection

**AC:**
- [ ] Cron worker corre diario: detecta findings con frecuencia >3 std-dev sobre baseline histórico
- [ ] Crea `pattern_alerts` con severity (info/warning/critical)
- [ ] AI summary humanizado generado
- [ ] Notifica Insights Manager por email
- [ ] Insights Manager puede aprobar o descartar antes de notificar al cliente

### F5.3 — Memoria que crece con cada estudio

**AC:**
- [ ] Al finalizar analysis_run, worker actualiza `memory_industry` con tags emergentes nuevos
- [ ] Actualiza `memory_methodology` con failure modes detectados
- [ ] Actualiza `memory_brand` con findings del corpus
- [ ] Próximos estudios de la misma industria consultan la memoria actualizada

### F5.4 — Comparativos antes/después

**AC:**
- [ ] Bloque `comparative_block` permite seleccionar dos `analysis_run` para comparar
- [ ] Calcula deltas por finding: nuevo, desaparecido, bajó, subió, mutó
- [ ] Visualización con flechas y % de cambio
- [ ] Cita representativa de ambos periodos lado a lado

---

## Fase 6 — Integración UI de fuentes (semanas 21-24)

### F6.1 — UI de configuración de integración

**AC:**
- [ ] Página `/studio/integrations/new` con form: name, integration_type, config (json), field_mapping
- [ ] Soporta tipos: sentione_api, datashake_api, apify_actor, webhook, custom_api
- [ ] Encriptación de credenciales en `integrations.config` (Supabase Vault o pgcrypto)

### F6.2 — Test de integración (10 mentions)

**AC:**
- [ ] Botón "Test integration" trigger pull de 10 mentions
- [ ] Resultado muestra: sample mentions, mapping aplicado, issues detectados
- [ ] `integrations.validation_test_passed = true` solo si todos los 10 mentions mapean correctamente

### F6.3 — Activación de integración

**AC:**
- [ ] Botón "Activate" requiere `validation_test_passed = true`
- [ ] Integración aparece como opción al crear corpus
- [ ] `import_batches` puede tener `source_integration_id`

---

## Cross-feature AC (aplican a todo)

### CC1 — Performance

- [ ] Páginas del studio cargan en <2s en buena conexión
- [ ] API endpoints responden en <500ms p95
- [ ] Workers de pipeline no bloquean la UI (todo async via BullMQ)

### CC2 — Seguridad

- [ ] Todas las rutas autenticadas validan sesión Kinde
- [ ] RLS de Supabase activo: cada usuario solo ve data de sus brands/themes accessible
- [ ] Credenciales nunca expuestas client-side (validar con grep en build)
- [ ] CORS configurado para producir errores claros, no expuesto a todos los origins

### CC3 — Accesibilidad

- [ ] Contraste WCAG AA en textos
- [ ] Navegación por teclado funciona en flujos críticos
- [ ] Alt text en imágenes
- [ ] Forms tienen labels asociados

### CC4 — Auditoría

- [ ] Cada acción crítica (publicar, aprobar, eliminar) queda en log
- [ ] `quality_filter_logs` registra cada exclusión de mention
- [ ] `analysis_runs` registra cada corrida con pipeline_version

### CC5 — Resiliencia

- [ ] Workers reintentan jobs fallidos hasta 3 veces con backoff exponencial
- [ ] LLM calls tienen timeout de 60s y fallback model configurado
- [ ] Cuando Supabase está down, UI muestra mensaje claro (no white screen)
- [ ] Health check endpoint `/api/health` valida conexión a Supabase + Redis + Kinde

---

## Formato sugerido para issues de GitHub

Cada feature de aquí se convierte en uno o varios issues. Template:

```markdown
## Feature: F3.7 — Síntesis + Humanizer
**Fase:** 3 — Triggers & Barriers ejecutable
**Estimación:** 3 días
**Dependencias:** F3.1-F3.6

### Acceptance Criteria
- [ ] LLM redacta cultural_reading...
- [ ] Cada output narrativo pasa por @noisia/humanizer...
- [ ] Validación post-humanizer: cero matches de regex...
- [ ] ...

### Done definition
- [ ] AC pasan en CI
- [ ] Insights Manager firma en demo
- [ ] PR aprobado
- [ ] Documentación actualizada
- [ ] // TODO mejora-futura: comentado donde aplique
```

---

## Mejora futura

```typescript
// TODO mejora-futura: cuando el equipo crezca a 2+ devs, agregar:
// - Plantilla pull-request con checklist de AC
// - Coverage gates en CI (al menos 70% en packages críticos)
// - Análisis de drift entre AC documentados vs tests reales
```
