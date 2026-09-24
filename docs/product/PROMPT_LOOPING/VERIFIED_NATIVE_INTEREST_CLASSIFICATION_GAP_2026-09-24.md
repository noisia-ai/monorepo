# Intereses nativos: recuperación conectada, resolución pendiente

24 septiembre 2026, heartbeat 08:20 UTC. Base examinada1775434 (producto a881d21). Root y un auxiliar readonly. Evidencia de código y de pruebas existentes inspeccionadas; no prueba remota ni evaluación nueva de calidad. Amplía Compass y VERIFIED_BRAND_GUIDANCE_PIPELINE_2026-09-24.md.

## Resultado comprobado

Un interés manual sí aporta guías a BERTopic y tiene búsqueda semántica sobre el corpus. Esa búsqueda persiste candidatos, pero no produce por sí misma asociaciones persistentes de ese interés para Signal. La infraestructura genérica de clasificación existe; falta su motor productivo integrado para esta ruta. No está autorizado fingir el cierre cambiando doubt por approved.

El descubrimiento editorial tiene otro recorrido que sí está conectado: grupo computacional → interpretación → Topic descubierto → asignaciones del grupo original → selección del Topic → Signal. Que el primer recorrido esté incompleto no invalida las entregas de ese segundo recorrido ni justifica repetirlas.

## Evidencia verificable

Rutas relativas al checkout focal:

| Paso | Implementación observada | Consecuencia |
| --- | --- | --- |
| Recuperación del interés | infrastructure/db/signal-workspace-topic-computation.ts:295 y :346 exige uncalibrated/approval_policy:none y guarda items/suggestions doubt | Resultado persistido y consultable; no assignment de clasificación |
| Resultado UI | apps/studio/src/components/brands/TopicsManager.tsx:500 muestra candidatos con ranking y evidencia | Búsqueda completada no significa interés publicado |
| Motor genérico | services/workers/src/workers/signal-workspace-classification.ts:45 exige motor y stores inyectados; no tiene integración productiva por defecto | Existe ledger/worker reutilizable, no un clasificador automático ya operativo |
| Despacho real | services/workers/src/workers/signal-topic-classification-outbox.ts:161 admite workspace-topic-classification-v1 sólo con sourceProjection | El contrato sin proyección se rechaza; no basta con encolarlo |
| Reglas anteriores | services/workers/src/workers/signal-topic-classification.ts:609 y infrastructure/db/signal-topic-catalog.ts:1123 limitan clasificación/corrección al contrato legacy | No asumir que la ruta antigua consume los candidatos nativos |
| Descubrimiento | packages/query-engine/src/signal-workspace-topic-materialization-v1.ts:64 conserva intereses existentes y crea workspace_discovery separado | Guiar descubrimiento no enlaza automáticamente sus grupos al mismo term_key del interés |
| Asignación comprobada | services/workers/src/workers/signal-workspace-topic-projection.ts:300 persiste computed_cluster/pending y aplica overrides humanos después | Pertenencia computacional trazable; no promesa de precisión semántica |
| Selección/lectura | infrastructure/db/signal-workspace-topic-selection.ts exige membresía vigente; signal-workspace-topics-serving.ts:343 consume computed_cluster/pending o human/approved vigente | La lista doubt de búsqueda no aparece como tópico clasificado en Signal |

Pruebas existentes inspeccionadas, NO ejecutadas otra vez: migrations/signal-workspace-topic-computation.integration.test.ts:138–154 exige cero assignments después de recuperar candidatos; services/workers/src/workers/signal-workspace-topic-projection.test.ts:171 y :224 cubren membresía computada y prioridad de corrección humana. El test de búsqueda confirma una frontera deliberada, no prueba que el producto final esté completo.

La UI de selección actualmente usa una explicación genérica de pertenencia al grupo incluso en intereses manuales. Debe ajustarse junto con el estado real de la integración; cambiar sólo ese texto no cerraría la capacidad pendiente.

## Corte de implementación que sigue

Objetivo observable: guardar un interés con definición/límites → procesar corpus → obtener asociaciones para ese mismo interés → seleccionarlo en Signal, manteniendo también los Topics descubiertos. Una búsqueda sin asociaciones todavía debe presentarse como recuperación, no como un resultado clasificado.

Reutilizar ledger de generaciones/asignaciones, cola, identidades semánticas, correcciones y lectores vigentes. No crear otro sistema de Jobs ni un listado de aprobaciones por mención. Separar la decisión semántica de la publicación: el usuario selecciona Topics, no etiqueta manualmente millones de registros.

Primer cambio local acotado: integrar los intereses explícitos y sus versiones como entrada identificable de la resolución editorial sobre grupos; conservar snapshots/hashes históricos y llamadas ya pagadas. Añadir pruebas sin proveedor que demuestren que definición, exclusiones y term_key llegan intactos al contrato de decisión y que una decisión no puede referirse a intereses o grupos ajenos al manifiesto. No cambiar solicitudes históricas en curso ni reenviarlas con otro prompt bajo la misma identidad.

Después conectar las decisiones validadas a la materialización/proyección existentes, con un origen distinguible del descubrimiento. Antes de implementar esta segunda parte debe quedar explícito qué evidencia permite atribuir un grupo completo al interés y cómo se representa un grupo mixto. Una relación temática entre grupos no basta para declarar que todas sus menciones cumplen la definición. Usar recuperación para encontrar evidencia y agrupar el trabajo editorial; no un umbral inventado, un LLM por mención o la promoción automática del top32.

### Aceptación del recorrido completo

- Identidad del interés conservada; no reemplazarlo por un Topic descubierto con nombre parecido.
- Candidato por similitud sin decisión permanece candidato. Un grupo mixto o evidencia insuficiente no produce pertenencia afirmada para todas sus raíces.
- Decisiones con evidencia/linaje/versiones vigentes; correcciones explícitas prevalecen y cambios de definición invalidan reutilización indebida.
- Cobertura de todo el corpus elegible, sin usar shortlist truncado como censo ni ausencia de candidato como rechazo.
- Conteos deterministas, raíz deduplicada, ámbitos y permisos vigentes; Signal usa la misma población, sin inventar precisión.
- Reintento sin gasto duplicado, segunda carga reutiliza raíces intactas y procesa nuevas/cambiadas; prueba real incremental sigue pendiente hasta disponer de nueva carga legítima.
- Discovery conserva sus grupos, selección y evidencia. Laika no cambia.

## Estado operativo

No se modificó código de producto en este ciclo. No se ejecutaron tests cerrados, SQL, imports, fit, embeddings, llamadas Claude/Voyage ni reintentos de conexión. UAT sigue a42b9b4, Worker original0b68b3e0, import-only local a881d21 debajo de documentación. Dev-test continúa pendiente de corrección de conexión28P01 por el operador; no eludir aceptación PostgreSQL. Linear requiere reconexión: hallazgo y plan pendientes de sincronización, no ticket creado ni cerrado.

Este mapa queda cerrado: el siguiente ciclo debe implementar el primer cambio local delimitado, no repetir esta auditoría ni el mapa de guías anterior.
