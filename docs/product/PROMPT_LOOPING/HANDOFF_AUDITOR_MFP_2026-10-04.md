# Entrega al auditor — Ficha por mención y Motor de pertenencia

**Desarrollo detenido por instrucción del fundador el 4 de octubre de 2026.** Censo de parada verificado a las **18:02:41 UTC / 12:02:41 de Ciudad de México**. Este documento define el trabajo realizado, su evidencia y sus límites; no es una autorización para reanudarlo.

**Producto integrado:** `develop`, commit `4bbd2e254b736fcb69ce44dbd91a1d5f56038288`, PR [#31](https://github.com/noisia-ai/monorepo/pull/31). **Canon:** [spec v1.3](SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md), preservado junto con [accesos y entorno](MFP_ACCESS_AND_ENV_2026-10-04.md) antes de delegar. Los recibos anteriores conservan estados intermedios —«PR pendiente», «no instalado»— que este corte actualiza; no deben leerse como estado operativo actual.

## 1. Qué se entrega y qué no está aceptado

Se implementó e integró una ruta genérica de importación con procedencia, preparación diferencial, ficha por mención, descubrimiento sobre relevantes, adopción de conceptos editables, pertenencia con citas y lectura en Signal. Se ejecutaron dos cargas reales del corpus privado de desarrollo mediante funciones de producto y Workers remotos. Se comprobaron reutilización, edición selectiva de un concepto, invalidación por alias, recuperación e idempotencia.

**No está demostrado el self-service completo por navegador.** La marca del ensayo se creó mediante el servicio de producto, no mediante alta UI. Tampoco están cerrados gold humano, aprobación de etiquetadores, QA bilingüe del recorrido ni aceptación del fundador. La interfaz existe, pero pruebas SSR, PostgreSQL y llamadas a funciones no sustituyen esa aceptación. **No hay entrega de este programa en UAT ni producción.** `main`, servicios UAT y datos productivos no se modificaron para ejecutar MFP.

La última recuperación editorial sí terminó en el Worker real: evidencia vigente, 11 unidades heredadas, cero unidades nuevas para interpretar y todos sus outboxes completados. La revisión posterior del texto de menciones **no se aplicó**: el CSV fue rechazado por versiones contradictorias de una identidad. Se preservaron el rechazo y una carga corregida de prueba, sin ejecutarla antes del alto.

## 2. Estado seguro y punto exacto de parada

| Comprobación remota de parada | Resultado |
|---|---:|
| Runs de etiquetado `queued/running` | 0 |
| Runs de embeddings `queued/running` | 0 |
| Preparaciones `queued/running` | 0 |
| Ejecuciones numéricas/editoriales `queued/running` | 0 |
| Imports `queued/processing` | 0 |
| Llamadas de etiquetado `reserved/submitting/submitted/unknown` | 0 |
| Worker general `NOISIA_MFP_WORKER_ENABLED` | `false` |
| Agentes auxiliares desarrollando | 0; todos completados |
| Historial de migraciones MFP | 229 entradas totales |

Fuente privada: `.data/dev-corpus/audit-stop-status-2026-10-04.log` en el checkout principal y `/app/.data/dev-corpus/audit-stop-status-2026-10-04.json` en el volumen remoto. El censo cubre la base MFP, no producción. No se reactivó la automatización antigua ni se creó otra para continuar el programa.

Los servicios remotos siguen disponibles para revisión y conservan su coste de infraestructura. No se apagó PostgreSQL compartido ni se borraron datos, colas, archivos, recibos o credenciales. Los flags de las funciones MFP y las claves mínimas permanecen configurados, pero el Worker general está inactivo y no queda cómputo aceptado en ejecución. No iniciar Workers, proveedores, nuevas cargas, migraciones o reintentos durante la auditoría sin nueva instrucción del fundador.

## 3. Definición del trabajo por workstream

| WS | Implementación y resultado | Límite de aceptación |
|---|---|---|
| WS0 | Spec/accesos versionados; canon señalado en AGENTS; inventario y copia verificada de 110 documentos históricos, 2,289,848 bytes; 13 ramas remotas antiguas retiradas con etiquetas conservadas. | Los originales históricos siguen sin versionar. Los checkouts históricos ajenos al programa se preservaron; no se declara cumplida toda la limpieza antigua. |
| WS1 | Base lógica/rol MFP, Redis, runner y Studio aislados; guard de identidad remota, corpus, scripts finitos recuperables, almacenamiento privado y Python CPU. Importación explícita de revisiones con historial y publicación atómica. | Runtime persistente instalado pero apagado; revisión real de texto pendiente. No Docker, PG, Redis, Worker ni builds pesados en la Mac. |
| WS2 | Contratos genéricos de ficha, contexto de entidades versionado, Claude Sonnet 5.5, ledger común, caché por contenido, correcciones humanas y recuperación de errores técnicos. | Etiquetador experimental. Cobertura técnica completa no equivale a precisión humana. |
| WS3 | Cliente JEV, validación y mapeo multientidad, probabilidades crudas, ejecución por páginas y ledger WS2; corpus inicial completado y replay sin transporte. | No hay ganador semántico ni calibración acreditada. JEV no está activo en el runtime de parada. |
| WS4 | Evaluador offline con selección fija de 150 raíces y split 90 dev / 60 test, matrices, abstenciones/errores separados, métricas y coste. | Resultado `no_evaluado`: no se inventó gold ni se aprobó automáticamente un modelo. |
| WS5 | Motor multi-concepto con evidencias literales, preview aislado, ejecución completa, claves CE/entidades efectivas, overrides y lectura de pertenencia en Signal. | Hay decisiones reales de proveedor, pero falta evaluación humana de calidad y recorrido UI. |
| WS6 | Discovery limitado a relevantes, estado `unrelated`, adopción explícita de conceptos; admisión self-service sin topes heredados; reparación de proyección/serving. | Conceptos descubiertos y adoptados para desarrollo, no gold del fundador. |
| WS7 | Estado de etapas, editor de ficha/intereses, filtros, excepciones, correcciones por lote, preview, costes y citas resaltadas; ES-MX/EN-US. | Pruebas de componentes y PostgreSQL realizadas; QA autenticada bilingüe y corrección de tres excepciones por UI pendientes. |
| WS8 | Incremental con modelo congelado, residuo relevante sin pertenencia, contexto editorial vigente, embeddings gobernados y recuperación de evidencia con componente vacío. | Segunda carga funcional remota comprobada; nueva marca por UI, ediciones de texto y aceptación integral pendientes. |

La infraestructura y las reparaciones se hicieron dentro de estos WS; no se abrió otro programa ni se prolongó interest decision V2/V3. Alexa+ no se convirtió en una excepción del código o de los prompts.

### Contratos que se conservaron

- `entities[]` admite varias entidades con `kind` y `salience`; cualquier entidad compatible puede habilitar un concepto.
- El contexto de entidades de Brand OS está versionado. Alias/productos/competidores invalidan el conjunto afectado; cambios narrativos no deben invalidar indiscriminadamente.
- Las lecturas vigentes exigen contenido, contexto e identidad compatibles. Pertenencia conserva `entity_context_digest` y `effective_entities_digest`; no se sirve una ficha obsoleta como actual.
- Error técnico, abstención, refusal y veredicto semántico permanecen separados. Las correcciones humanas prevalecen; una entidad retirada puede exigir revisión humana sin convertir el caso en negativo.
- Similitud o pertenencia a un grupo numérico no se usa como prueba de pertenencia a un concepto adoptado. Signal usa `concept_membership` para éstos.
- Selección y persistencia por páginas/lotes; crudo antes del parser y liquidación; idempotencia y conciliación de llamadas inciertas. No se introdujo una transacción por mención.
- Presupuesto orientativo y máximo estricto opcional son distintos. Se eliminaron topes heredados en la ruta MFP conservando máximos configurados explícitamente, permisos y reserva/liquidación.

## 4. Código integrado y trazabilidad

El anexo [archivos cambiados](MFP_AUDIT_CHANGED_FILES_2026-10-04.tsv) enumera **291 archivos** entre `c577f8fd` —spec v1.1 antes de este programa— y `4bbd2e25`, con estado Git, tamaño y SHA256 del contenido final. El diff agregado es 24,335 inserciones y 1,575 eliminaciones. Es inventario de cambios, no una métrica de calidad; excluye esta entrega documental posterior y todos los datos privados.

| Integración | Commit | Alcance |
|---|---|---|
| Preservación/canon WS0 | `876e2d7a` | v1.3, accesos e historia |
| PR16 | `7833fedf` | Harness y recursos remotos aislados |
| PR18 | `fb1503c4` | Ficha Claude y ledger común |
| PR17 | `b596a421` | JEV experimental y recuperación |
| PR19 | `ada9d986` | Población relevante y adopción |
| PR22 | `1b3ebe72` | Arranque remoto verificado y Python |
| PR21 | `c8f2cbf7` | UI mínima MFP |
| PR20 | `341a03b9` | Pertenencia y Signal |
| PR23 | `4e067126` | Discovery self-service y máximos opcionales |
| PR24 | `6daf32e2` | Proyección de la población sellada |
| PR25 | `00b6e3f9` | Incremental y editorial gobernados |
| PR27 | `61006bca` | Evidencia Signal y estimación pendiente |
| PR26 | `18f2b0ae` | Embeddings MFP self-service |
| PR29 | `fccc2fc2` | Evaluador offline |
| PR30 | `988012b6` | Recibo de avance real |
| PR28 | `9cb54169` | Revisiones explícitas de contenido |
| PR31 | `4bbd2e25` | Evidencia de componentes vacíos y recuperación |

Puntos de entrada para revisar implementación: [contratos Query Engine](../../../packages/query-engine/src/), [DB y stores](../../../infrastructure/db/), [Workers](../../../services/workers/src/workers/), [rutas MFP](../../../apps/studio/src/app/api/data-os/signal/), [componentes MFP](../../../apps/studio/src/components/brands/), [harness remoto](../../../scripts/dev-corpus/README.md) y [evaluador](../../../scripts/eval/README.md). El TSV permite localizar cada archivo exacto sin reconstruir la conversación.

Las ramas de los WS integrados se retiraron y sus worktrees se archivaron mediante la app con snapshots recuperables. Se conservaron los checkouts históricos `/Users/brandhon_o/.codex/worktrees/uat-editorial-polling/noisia-website` y `/Users/brandhon_o/Downloads/noisia-product`; no se borró trabajo ajeno para satisfacer la limpieza. El borrador [develop→main](MFP_DEVELOP_TO_MAIN_PR_DRAFT_2026-10-04.md) es sólo documentación: no se fusionó ni se publicó producción.

## 5. Entorno instalado

Proyecto Railway `noisia-signal-v02-uat`, ID `b7b7b325-f273-4eb6-80e0-d66e266159b2`; entorno **dev-test** `5bad359d-cfa4-4e8f-aa41-98e6f075375a`. El nombre del proyecto no significa que MFP se haya entregado en UAT.

| Recurso | Identidad / estado |
|---|---|
| PostgreSQL | Servicio `8cc1601e-a87a-4b23-ae7c-9a4dc0a315a0`; host privado `pgvector.railway.internal:5432`; base/rol `noisia_mfp`; PostgreSQL 17.11, pgvector 0.8.6, pgcrypto 1.3; system identifier `7683766906362679330`. El servicio PG es compartido; la base MFP está separada. |
| Redis MFP | `4cef4bb5-cf97-476c-952c-af575b0399bf`; `mfp-redis.railway.internal:6379`, autenticado y persistente. |
| Runner | `a5706eaa-7d67-4d63-8e7e-2b9fc7424508`; privado, una réplica; volumen `cbf691ef-ced9-414b-a462-edd22da90b48` en `/app/.data/dev-corpus`. |
| Studio | `f87fe1ae-5f7e-45e0-9a19-7c162b315b1b`; [Studio dev-test](https://mfp-studio-dev-test.up.railway.app). |
| Imagen runner integrada | Deployment `bea8b526-a755-4420-8c3f-c4f1ce510624`, `SUCCESS`; cuatro archivos críticos verificados por SHA contra `4bbd2e25`. |
| Imagen Studio integrada | Deployment `6ed2e168-f399-46bb-a7a4-391c7bf99e05`, `SUCCESS`; `/api/health` HTTP200 al cierre. |

Ambas imágenes se enviaron desde un archivo Git limpio de `4bbd2e25`, sin `.data` ni env privados. SHA256 del tar: `b19572cc52a2bc88f0ad88e922aeda36f14c83d810f154a7b3d40e26a68a87e7`, 61,143,040 bytes. Los builds se hicieron en Railway/CI. El último despliegue eliminó los archivos candidatos superpuestos usados durante pruebas: el runner quedó nuevamente en la versión integrada.

Autodeploy se desactivó previamente en Studio/runner MFP después de un reinicio que interrumpió un ensayo y cuyo rollback se verificó; ver [recibo runtime](DELIVERY_MFP_WS1_RUNTIME_2026-10-04.md). No hay cambios de configuración UAT/producción. Flags legacy de interest decision batch/V2 y JEV no están activos; Engine y refresh scheduler están apagados.

### Migraciones

Se verificaron **16 migraciones MFP instaladas** contra Git: 0221–0228, 0231–0233, 0237–0238, 0240–0242. [Anexo de hashes](MFP_AUDIT_INSTALLED_MIGRATIONS_2026-10-04.tsv). Los números omitidos no se inventan ni se reaplican. El historial completo contiene 229 entradas, incluidas las anteriores al programa.

Las últimas instalaciones fueron: 0240 a las 15:20:47 UTC; 0237–0238 a las 15:47:57; 0241 a las 17:18:24; **0242 a las 17:53:26.482**. Cada una se aplicó una sola vez tras su ensayo. En 0241/0242 se compararon los conjuntos vigentes antes/después: las 2,184 fichas de todos los fixtures MFP y las 136 pertenencias conservaron sus hashes. SQL0242 tiene SHA `f9a5e3b6e9a41dcd25d1dbdfc60dbd7a4e639408fc9647e6db3f47ade684414f` y dejó el historial en 229. No repetir ninguna migración instalada.

## 6. Demostración real y resultados

El workspace real de desarrollo es `ba454146-8c92-4f38-83f3-fea9827b7e31`; su identidad privada está en `/app/.data/dev-corpus/voyage-real/.data/dev-corpus/identity.json`. Se mantuvo separado del fixture de embeddings simulados. Los CSV son corpus de desarrollo con procedencia; sus transformaciones de prueba no representan nuevas observaciones del proveedor.

| Etapa | Primera carga | Segunda carga al alto |
|---|---|---|
| Filas recibidas | 1,000 | 250 |
| Resultado importación | 905 incluidas, 72 excluidas, 23 duplicadas | 181 nuevas incluidas, 18 nuevas excluidas, 51 duplicadas |
| Raíces acumuladas | 977 | 1,176 |
| Elegibles / excluidas | 905 / 72 | 1,086 / 90 |
| Fragmentos preparados | 3,158 | 3,634 |
| Voyage | 3,144 nuevos, 14 caché | 475 nuevos, 3,159 caché |
| Ficha Claude | 831 labeled, 74 abstained | 1,003 labeled, 83 abstained; cero errores pendientes |
| Pertenencia vigente | 122 pares tras ejecución completa | 136: 4 belongs, 1 insufficient, 131 not_belongs |

La segunda preparación reutilizó 931 raíces, incorporó 199 y encontró 46 cambios de procedencia. **Esos 46 no eran cambios materiales de texto.** La revisión de texto es el pendiente separado que se describe abajo.

### Ficha y entidades

Claude Sonnet 5.5 completó la primera carga mediante el contrato ordinal v3 con hasta ocho raíces por request; textos largos se procesan solos. Es un tamaño técnico de transporte observado, no un tope de corpus ni de gasto. Las variantes con 25 ordinales encontraron límites de compilación del proveedor; se preservaron sus rechazos, sin declararlos calidad semántica ni coste cero cuando no hubo usage.

La identidad seleccionada sigue `experimental`, digest `sha256:2c2458f8e3b0b11163136c96d5b808ff52db64b30e80def7547f8fd04dff66fd`. Los excesos del límite de palabras de `asunto` se conservaron como errores y se recuperaron explícitamente, sin truncar ni debilitar el parser. La segunda carga procesó 181 raíces nuevas, reutilizó 905 y recuperó dos errores de formato. Población final: 456 relevantes, 505 ajenas, 47 spam y 78 unknown.

El ensayo real de alias A→B→A afectó 58 raíces y dejó 847 intactas; la vuelta a A identificó 63 afectadas y las recuperó desde caché, con cero llamadas nuevas. Se conservaron contexto y selección gold. La no invalidación narrativa, entidades múltiples, retirada de entidad y precedencia humana tienen pruebas PostgreSQL; **no está realizado el escenario integral por UI de añadir alias+competidor+narrativa entre cargas**.

JEV completó el corpus inicial: 898 labeled, siete abstained, cero errores finales, 915 llamadas contando diez recuperaciones. Acuerdo de relevancia Claude–JEV: 686/905, 75.8%; es acuerdo entre modelos, no precisión. [Due diligence oficial](JEV_DUE_DILIGENCE.md) registra idioma, límites, uso/retención y derechos antes del envío. No se exigió carta del proveedor. No se acreditó ZDR ni calibración.

### Discovery, conceptos y Signal

El primer fit `7033cd67-8b6d-482c-ac37-085aefd0cfe1` procesó 374 relevantes y 1,259 fragmentos. Produjo 11 grupos; interpretación/consolidación: dos Topics, siete Noise y dos insufficient. Dos propuestas se adoptaron como conceptos editables y se juzgó su pertenencia por separado.

Se verificó preview de 30 raíces y ejecución completa de 122 pares, con replay a cero llamadas. La edición de un concepto invalidó sólo sus 61 pares; el otro concepto y las 905 fichas permanecieron intactos. Segunda carga: 73 pares nuevos/afectados, luego dos adicionales tras recuperar la última ficha; estado final de 136 decisiones sin pares pendientes.

Signal observado mediante funciones de producto: fuente vigente, denominador 1,086, cuatro menciones únicas asignadas —una al concepto de viajes y tres al de upsell—, base `concept_membership`, citas disponibles y calidad `not_calibrated`. No es verificación de pantalla autenticada ni prueba de calidad del concepto.

El incremental `29495512-9517-4a9b-b9fc-a119ff93ca11` quedó READY a las 16:50:16 UTC, sobre 456 relevantes, 1,449 fragmentos y dos componentes, reutilizando el modelo congelado. No se repitió el fit completo. Derivación completada a las 17:02:56; proyección a las 17:07:42, 1,086 raíces y 3,634 fragmentos.

La evidencia posterior falló por dos casos del componente vacío: agregado SQL NULL frente a `[]` y exigencia de unidad emergente para un origen sellado sin unidades. PR31/SQL0242 corrige sólo esas condiciones, conserva validación de archivos, origen exacto y vigencia, y permite una recuperación explícita gratuita con el mismo job. El drainer actualiza el actor desde el recibo autorizado antes de reintentar un job terminal; los trabajos activos no se modifican.

**Recuperación real completada a las 17:56:22.911 UTC**: plan `161174c5-7023-451a-81fb-ee2888832339`, digest `sha256:54e8b92602c7ced65d900eb3aa02685409b57f0ba21a1f57602376ba8ea70283`. Preparación `ready`, vigente, sin trabajo pendiente; admisión `workspace_incremental_editorial_no_new_units`, 11 heredadas y cero targets. No hay interpretación pagada que iniciar en ese corte. El indicador numérico histórico `analysis_complete=false` no se usó para afirmar aceptación integral.

### Revisiones de texto: fallo preservado y acción no ejecutada

SQL0241 y la opción explícita `revise_existing` están integradas y desplegadas. El intento sobre el mismo `load2.csv` de 250 filas falló a partir de las 17:57 UTC con `content_revision_conflicting_rows`: había más de una versión para una identidad dentro del archivo. **Cero revisiones publicadas; historial de revisiones vacío al alto.** Las fichas/pertenencias conservan los contenidos anteriores.

La inspección del bloque de 20 filas editadas encontró **19 IDs únicos**, todos con cambio exclusivamente en `Content of posts`; un ID aparecía dos veces. Se preparó `load2-text-revisions.csv` de 19 identidades, eligiendo explícitamente la última fila de edición de ese bloque de la fixture. Esa selección se documentó fuera del producto; no se añadió una regla implícita de «última fila gana». El archivo original y la importación rechazada se conservaron.

CSV preparado, **no importado**: 252,974 bytes, SHA256 `0fbd92dfb84d8d867580b968bbe3c664e28788712cd1d37e1fbd00105c1d0379`; copia local y remota idénticas. Su recibo privado `load2-text-revisions-construction.json` conserva las filas seleccionadas. Se detectó y corrigió una normalización de finales de línea al transferirlo, antes de cualquier importación. El helper de ficha posterior también está preparado, **sin admisión ni llamadas**. El alto del fundador se recibió en este punto y no se inició la siguiente carga.

## 7. Evidencia: distinguir software, proveedor y aceptación

| Nivel | Evidencia representativa | Qué acredita |
|---|---|---|
| CI final integrado | [Run 37221379841](https://github.com/noisia-ai/monorepo/actions/runs/37221379841), head `8171bd9a`, íntegramente PASS antes del squash | Secret scan, tipos, lint, suites, build Studio, readiness y smoke del código integrado. |
| PostgreSQL WS2 | 22 aserciones de proyección humana; ensayo de locks y 200 raíces/47 reservas; alias y caché | Persistencia, autoridad, recuperación y selectividad; transporte simulado donde el recibo lo identifica. |
| PostgreSQL WS5/WS7 | 44 aserciones de pertenencia; pruebas reales de lectura/filtros y correcciones por lote, con rollback | CE, humanos, derechos, preview, citas y Signal; no una sesión de navegador. |
| PostgreSQL proyección | PR24, dos escenarios, 905 raíces/374 selladas, páginas 200/200/200/200/105, rollback | Población sellada, correcciones exteriores e integridad, sin proveedor. |
| PostgreSQL revisiones | PR28, 26 comprobaciones, admisión/jobs y triggers reales, almacenamiento simulado, rollback | Atomicidad, conflictos, fuente/actor, base y obsolescencia; no demuestra que se hayan aplicado las ediciones reales. |
| PostgreSQL evidencia vacía | `eedc0d71`, digest/control no vacío, origen ajeno, permisos, misma cola, publicación/replay/plan válido y censo idéntico tras rollback | Corrección SQL0242 sobre archivos reales. Un negativo simula únicamente el booleano de condición; los demás controles SQL son reales. |
| Proveedor | Claude ficha/juez, JEV y Voyage con respuestas crudas/usage/recibos privados; runs descritos arriba | Transporte, esquema y resultados reales. No reemplaza gold. |
| Recuperación operativa | Worker real 17:56, plan ready, outboxes completed | Reparación aplicada y funcionando en dev-test; cero proveedor y cero fit nuevo. |
| Aceptación humana/UI | **Pendiente** | No afirmar self-service completo, ganador semántico, calibración ni producción. |

Las pruebas específicas de recuperación tuvieron revisión independiente sin P1/P2 abiertos en el diff final. Esto no es una auditoría independiente de todo el programa ni una certificación de ausencia de defectos. Los primeros ensayos fallidos y sus diagnósticos se conservaron; no se presentan como PASS.

## 8. Costes y estimaciones

Coste conocido acumulado de proveedores: **USD6.940558684**. Es reconstrucción de recibos/usage, no una factura consolidada. Incluye ensayos, recuperaciones y ejecuciones fallidas con uso conocido.

| Categoría | USD conocidos |
|---|---:|
| Claude ficha, probes y recuperación/alias | 5.134006 |
| JEV corpus y probes | 0.155584684 |
| Voyage, ambas cargas | 0.110427 |
| Claude pertenencia, probes/preview y ambas cargas | 1.130097 |
| Discovery e interpretación/consolidación | 0.410444 |
| **Total** | **6.940558684** |

Veinticinco solicitudes históricas de gramática rechazada no informaron usage liquidable; permanecen como coste desconocido, no cero, y no se suman como gasto conocido. La tarifa JEV calculada por tokens y el ledger pueden diferir por redondeo hacia arriba a microUSD por llamada; el recibo WS3 conserva ambos. Las últimas recuperaciones de ficha costaron USD0.022075, y los dos últimos pares de pertenencia USD0.011807. La recuperación editorial, el import rechazado y la preparación documental no generaron llamadas de proveedor.

Railway consultado al alto: servicios dedicados MFP **USD0.09365891407645766** —runner 0.0573338254996692, Studio 0.03197296517833334 y Redis 0.004352123398455119—. PostgreSQL compartido: **USD0.2839015086459619**, sin asignación exclusiva a MFP. No se suma el consumo de `studio-uat`/`workers-uat` al programa. Fuente privada: `railway-usage-audit-stop-2026-10-04.json`; son importes acumulados observados, no una estimación final del mes. Los recursos conservados seguirán devengando infraestructura.

No hay máximo estricto configurado para las acciones pagadas de esta ejecución MFP; la política conserva autorización, exposición y contabilidad. Presupuesto orientativo no detuvo el programa. Las estimaciones se actualizaron antes de cada admisión; el spec conserva un horizonte de ingeniería, **no una fecha prometida de entrega**. Gold y aceptación UI impiden fechar una aceptación integral con la evidencia actual.

## 9. Accesos y evidencias privadas

Leer [MFP_ACCESS_AND_ENV](MFP_ACCESS_AND_ENV_2026-10-04.md). Archivo privado compartido: `/Users/brandhon_o/.config/noisia/mfp/credentials.env`, permisos 0600 dentro de directorio 0700; cargar con dotenv, nunca `source`. No contiene conexiones de DB/Redis ni flags/modelos. Las conexiones del entorno están en configuración privada separada. No se imprimen ni se adjuntan secretos al auditor en este documento.

| Evidencia privada | Ubicación / finalidad |
|---|---|
| Censo final | `.data/dev-corpus/audit-stop-status-2026-10-04.log`; JSON equivalente en volumen remoto |
| Instalación 0241/0242 | `.data/dev-corpus/sql0241-install-2026-10-04.log`, `sql0242-install-2026-10-04.log`; recibos remotos `sql0241-install.json`, `sql0242-install.json` |
| Prueba PG final 0242 | `.data/dev-corpus/ws8-evidence-0242-pg-eedc0d7.log`; fixture `ws8-evidence-0242-fixture.json` |
| Recuperación real | `.data/dev-corpus/load2-evidence-repair-request-1756.log`, `load2-evidence-repair-worker-1756.log`, `load2-evidence-repair-status-1757.log` |
| Revisión rechazada | `.data/dev-corpus/load2-content-revisions-import-1757.log`; batch preservado en DB |
| Revisión preparada | `.data/dev-corpus/load2-text-revisions.csv`, `load2-text-revisions-construction.json`; copias en volumen, sin ejecutar |
| Corpus, gold y diarios | `.data/dev-corpus/` principal y `/app/.data/dev-corpus/`; bucket privado `mfp-corpus-files`; selección gold fija, sin anotaciones fabricadas |
| Handoff privado operativo | `/Users/brandhon_o/.config/noisia/mfp/orchestrator-current.md`; diagnóstico y referencias, no fuente de autorización para continuar |
| Historia preservada | `~/Downloads/noisia-archive-2026-10-04/mfp-ws0-untracked-2026-10-04/`; inventario versionado |

`.data/`, CSV, respuestas crudas, textos, IDs de personas y claves no se versionaron. La auditoría puede consultar los recibos privados con el acceso existente, pero no debe publicarlos como anexo sin revisar su contenido. No es necesario leer JSONL históricos de Codex ni conversaciones exportadas para verificar este trabajo.

## 10. Pendientes y condiciones para una reanudación futura

Todo lo siguiente queda **pendiente, sin iniciar por esta entrega**:

1. Auditoría de implementación/evidencias y nueva instrucción del fundador para reanudar desarrollo.
2. Callback/logout exactos de Kinde para Studio dev-test y recorrido autenticado. La solicitud específica seguía sin resolver; se observó `Invalid callback URL`. No faltan claves genéricas. El permiso Railway otorgado no se reinterpretó como modificación de toda la configuración de autenticación.
3. Evaluación humana de 150 raíces, conceptos de referencia y pruebas separadas de Claude/JEV. [EVAL_MFP](EVAL_MFP_2026-10-04.md) sigue `no_evaluado`; no aprobar etiquetador hasta cumplir el protocolo.
4. Si se retoma la revisión de texto: inspeccionar su recibo y la base actual, importar la carga explícita de 19 identidades, preparar diferencialmente, medir fichas/embeddings/pertenencias nuevas y actualizar Signal. No reintentar ciegamente el archivo contradictorio ni inventar una nueva idempotency key para eludir el rechazo.
5. Activar y verificar el Worker persistente sólo tras el censo de trabajos, con la configuración MFP existente. Los Workers finitos ya probados no acreditan continuidad self-service sin intervención.
6. Nueva marca por UI → Brand OS → intereses → ambas cargas → discovery/adopción/pertenencia → tres excepciones corregidas → Signal, en ES/EN. Añadir alias y competidor y cambiar narrativa entre cargas para verificar selectividad integral.
7. QA del fundador y entrega parcial coherente en UAT si se acuerda el corte. Producción conserva aceptación integral; no fusionar `develop → main` por este handoff.

No repetir fits, imports aceptados, SQL instalado, pruebas cerradas o investigaciones históricas para «retomar contexto». Las recuperaciones deben partir del estado y los recibos conservados. No se requiere reiniciar el proyecto.

## 11. Índice de recibos

- [WS0 e historia](DELIVERY_MFP_WS0_2026-10-04.md), [inventario histórico](MFP_WS0_HISTORICAL_INVENTORY_2026-10-04.tsv), [revisión de ramas](MFP_WS0_REVIEW_2026-10-04.md).
- [WS1 corpus/harness](DELIVERY_MFP_WS1_2026-10-04.md), [runtime](DELIVERY_MFP_WS1_RUNTIME_2026-10-04.md), [revisiones de importación](DELIVERY_MFP_IMPORT_REVISIONS_2026-10-04.md).
- [WS2 Claude](DELIVERY_MFP_WS2_2026-10-04.md), [WS3 JEV](DELIVERY_MFP_WS3_2026-10-04.md), [tratamiento JEV](JEV_DUE_DILIGENCE.md), [WS4 evaluador](DELIVERY_MFP_WS4_2026-10-04.md).
- [WS5 pertenencia](DELIVERY_MFP_WS5_2026-10-04.md), [WS6 discovery](DELIVERY_MFP_WS6_2026-10-04.md), [self-service](DELIVERY_MFP_WS6_SELF_SERVICE_2026-10-04.md), [proyección](DELIVERY_MFP_WS6_PROJECTION_2026-10-04.md).
- [WS7 UI](DELIVERY_MFP_WS7_2026-10-04.md), [Signal/evidencia](DELIVERY_MFP_WS7_SIGNAL_EVIDENCE_2026-10-04.md), [WS8 incremental](DELIVERY_MFP_WS8_INCREMENTAL_2026-10-04.md), [embeddings](DELIVERY_MFP_WS8_SELFSERVICE_2026-10-04.md), [componentes vacíos](DELIVERY_MFP_WS8_EMPTY_COMPONENT_2026-10-04.md).
- [Avance anterior, 17:39 UTC](MFP_PROGRAM_PROGRESS_2026-10-04.md). Este handoff es el corte posterior de parada y prevalece al interpretar el estado final.
