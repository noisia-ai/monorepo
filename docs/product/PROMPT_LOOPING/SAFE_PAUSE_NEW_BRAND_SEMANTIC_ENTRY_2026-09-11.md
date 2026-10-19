# Parada segura: entrada semántica de marca nueva

Fecha: 11 septiembre 2026, 23:11 México / 12 septiembre 2026, 05:11 UTC

Estado: **PAUSADO por instrucción expresa del operador**.

## Control de la pausa

- Automatización `noisia-topics-to-signal-uat-loop`: `PAUSED`, verificada en el archivo de la app.
- Chat objetivo: `01a079df-5eea-7a32-a910-f185e5f1d484`.
- No quedaron agentes trabajando ni procesos de desarrollo delegados en este corte.
- No se ejecutaron imports, fit, SQL adicional ni proveedores durante la parada.
- Health público de Studio a `2026-09-12T05:11:03.251Z`: `status=ok`, perfil `uat`, aplicación,
  entorno y configuración de proveedor `ok`, sin variables o capacidades faltantes. La comprobación
  pública omite deliberadamente DB e identidad; el recibo de base de datos válido sigue siendo el
  posterior a SQL0161.

## Qué se terminó en este tramo

El producto ya tiene un recorrido reutilizable y visible que llega hasta la frontera del corpus real:

1. **Crear marca.** El formulario explica el recorrido, usa un selector IANA buscable y deja el slug
   bajo autoridad del servidor. El alta concede acceso sólo al workspace creado.
2. **Contexto de marca.** Brand OS conserva identidad, competidores y varias bases de conocimiento.
   La preparación gratuita no depende de Claude, Redis ni Worker.
3. **Automatización semántica.** Completar el formulario inicial cuenta como aprobación editorial.
   Claude puede proponer y publicar una versión; el usuario edita o elimina excepciones en lugar de
   aprobar listas masivas.
4. **Prototipos semánticos.** Voyage queda detrás de cotización, confirmación, política y recibos. Los
   prototipos guían la búsqueda taxonomy-driven; no sustituyen embeddings del corpus ni el
   descubrimiento abierto.
5. **Intereses editables.** Topics detecta cambios posteriores de intereses, marca guías pendientes y
   ofrece refresco explícito con caché por hash, sin repetir Claude.
6. **Handoff al corpus.** Datos presenta el recorrido Contexto → Topics → Importar. El sistema ya no
   necesita que ingeniería siembre una marca o menciones para llegar a ese punto.

Commit de producto: `5ab45c5a85bce8ac8013cc4b5cbaae12277edfb7`.

Commit de documentación anterior: `bdf98b89dc7457b34d1eea4df88de8316ef0fd65`.

## Estado UAT comprobado

- Worker activo: `a4fbe6ed-bc7a-46ae-8a31-2d44c86f0c75`.
- Studio activo: `e8959109-5d5c-4c44-a6a3-bd6a21420f96`.
- Ambos ejecutan el producto `5ab45c5`.
- SQL0161 se aplicó una sola vez a `2026-09-12T01:42:19.183Z`.
- SHA-256 SQL0161:
  `e4519724cd7271fff3a85b65ebadfb41b4cbe021e5f646cfcada66ccbfd24bf9`.
- El recibo de `2026-09-12T01:52:32.609Z` confirmó las funciones y ACL esperadas, grants públicos
  cero y también cero políticas activas, admisiones, ejecuciones de embeddings, llamadas inciertas o
  recibos de prototipos.
- La política inicial está configurada con un tope diario server-side de USD 30, pero crear la
  política no admite trabajos, no encola y no gasta. No se creó ninguna política en esta entrega.

No reaplicar SQL0153–0161.

## QA y evidencia conservada

El corte cerró PostgreSQL compuesto, suites DB/Studio/Worker, typechecks, lint, build y revisión de
seguridad. El agente de interfaz y la navegación autenticada terminaron con **P0 0 / P1 0 / P2 0**.

Se comprobaron:

- alta de marca ES/EN;
- búsqueda real en el catálogo IANA y filtrado de `Tijuana`;
- múltiples bases de conocimiento y controles para agregar otra;
- Brand OS y su preparación interna;
- Topics, Datos y Signal canónico sin errores de consola;
- recuperación de idioma a ES después de QA.

La captura móvil física no estuvo disponible dentro de la sesión autenticada. La cobertura móvil de
este corte proviene de las pruebas responsive ES/EN ya cerradas. Esto es una limitación de evidencia,
no un hallazgo funcional.

## Qué significa National en este corte

National no es la entrega ni una dependencia. Sólo confirma que el cambio reusable no rompió datos
anteriores:

- 7,396 menciones únicas recibidas;
- 16 archivos;
- 6,826 menciones preparadas;
- 32 Topics editables de 357 grupos computacionales interpretados parcialmente;
- 142 asociaciones seleccionadas visibles en Signal.

No se reimportó National, no se repitió Voyage, no se reinició BERTopic y no se agregó código por
marca. Los 357 grupos son unidades del fit computacional anterior; 32 tienen interpretación/topic
materializado. Esa cifra no prueba precisión semántica ni representa 357 Topics publicados.

## Análisis del estado del producto completo

El producto aún no está listo para producción. Está listo el **segmento previo al corpus** y existe
evidencia parcial del segmento posterior usando National. Falta unir ambos con un workspace nuevo y
operación puramente cliente.

| Tramo | Estado actual | Evidencia o deuda |
| --- | --- | --- |
| Crear marca | Entregado UAT | Selector IANA, slug y acceso scoped comprobados. |
| Brand OS y Knowledge Bases | Entregado UAT | Varias bases y preparación gratuita visibles. Falta probar contenido real de un prospecto nuevo. |
| Contexto semántico y prototipos | Implementado y protegido | Cotización, políticas, caché y recuperación cerradas. Falta una ejecución real nueva y evaluar calidad. |
| Topics/intereses definidos | Operable | Edición y refresco conectados. Falta comprobar que las guías mejoren recuperación semántica en corpus nuevo. |
| Importar marca/competencia/categoría | Existe | Falta una primera carga real nueva desde UI y reconciliar contadores/ámbitos en ese workspace. |
| Corpus embeddings y full fit | Arquitectura existente | Falta aceptación self-service con el nuevo corpus, 100% de elegibles y errores recuperables visibles. |
| Descubrimiento emergente | Parcial | Debe ejecutar sobre residual completo, conservar outliers y no confundir similitud léxica con precisión. |
| Interpretación Claude | Parcial comprobada | Sonnet 4.6, evidencia y costos existen. Falta completar todos los grupos relevantes bajo permiso cliente. |
| Catálogo Topics editable | Entregado parcial | CRUD y separación working/serving existen. Merge/split y calidad deben comprobarse con corpus nuevo. |
| Selección y Signal | Real con National | Falta generación completa del workspace nuevo y consistencia de cobertura, evidencia y fechas. |
| Segunda carga incremental | No aceptada con datos nuevos | Debe conservar identidad, ediciones y selección; asignar a clusters estables y crear emergentes. |
| Escala/operación productiva | Pendiente | Benchmark 2M, SLO, backpressure, recuperación, observabilidad y canary. |
| Cliente self-service/AuthZ | Parcial | Entrada a workspaces y selección separada existen; falta recorrido real completo con rol cliente. |
| Reportes con agente | Pendiente | Debe construirse después del monitoreo completo y con contratos de evidencia. |
| MCP | Pendiente | Requiere threat model, AuthZ, scopes y rate limits después del núcleo E2E. |

## Próximo experimento obligatorio

1. El operador elige o crea un prospecto real y completa Brand OS e intereses en UAT.
2. El operador carga por UI sus CSV reales, separados por marca, competencia y categoría.
3. El producto cotiza y obtiene admisiones cliente para embeddings del corpus, full fit y Sonnet.
4. Se exige contabilidad del corpus completo: recibidos, duplicados, inválidos, elegibles, procesados,
   outliers, sin tema y errores recuperables.
5. Se revisan Topics guiados y emergentes con evidencia real, edición y selección a Signal.
6. Una segunda carga real prueba incrementalidad, identidad estable, temas emergentes, costos y
   recuperación sin intervención de ingeniería.

El primer punto que requiere al operador es la elección del prospecto y sus archivos reales. No se
debe sustituir por fixtures o menciones inventadas.

## Pendientes registrados en Linear

- `NOI-73`: programa E2E y esta parada segura.
- `NOI-15`, `NOI-69`, `NOI-70`, `NOI-71`, `NOI-72`: alta, Brand OS, bases de conocimiento,
  contexto semántico y proveedor acotado; conservar abiertos hasta aceptación con marca real.
- `NOI-20`: experimento completo sin ingeniería; siguiente gate principal.
- `NOI-68`: full-corpus guiado + emergente.
- `NOI-78`: segunda carga incremental y emergentes con identidad estable.
- `NOI-81`: costos y respuestas inciertas de embeddings desde producto.
- `NOI-56`, `NOI-58`, `NOI-59`: escala, seguridad y paquete de producción.
- `NOI-46`, `NOI-50`: reportes con agente y MCP después del núcleo.

Ninguno de esos pendientes se cierra por esta entrega previa al corpus.

## Reanudación segura

1. Leer este documento y `DELIVERY_NEW_BRAND_SEMANTIC_ENTRY_UAT_2026-09-11.md`.
2. Verificar que el loop siga `PAUSED` hasta que el operador ordene reanudar.
3. Continuar en `/Users/brandhon_o/Downloads/noisia-brand-context-e2e-2026-09-10`, rama
   `codex/noisia-brand-context-e2e-2026-09-10`.
4. No tocar los drafts ajenos del checkout raíz `/Users/brandhon_o/Downloads/noisia-website`.
5. No repetir SQL0153–0161, imports, Voyage, fit o gates ya cerrados.
6. Usar Sonnet 4.6, nunca Opus; toda llamada pagada requiere tope exacto y recibo.
7. No producción ni `main` hasta cerrar marca nueva, incrementalidad, escala, seguridad y rollback.
