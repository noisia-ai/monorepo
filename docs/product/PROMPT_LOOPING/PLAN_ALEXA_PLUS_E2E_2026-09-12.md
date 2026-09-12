# Plan Alexa Plus end to end en UAT — 12 septiembre 2026

## Objetivo visible

Crear Alexa Plus como workspace nuevo usando las mismas pantallas disponibles para un cliente y
terminar con Topics útiles, editables y respaldados por citas, además de una selección publicada y
comprobable en Signal. Alexa Plus es un caso de prueba desechable; cada corrección debe servir para
cualquier marca y acercar el producto a operación self service.

La ventana autónoma inicia a las 07:00:39 UTC y termina con parada segura a más tardar a las
15:00:39 UTC. El loop `noisia-topics-to-signal-uat-loop` queda activo únicamente durante esta
ventana.

## Fuentes del experimento

Directorio de entrada: `/Users/brandhon_o/Downloads/Noisia - Alexa Plus CSVs`.

| Alcance | Archivo | Filas CSV | MiB |
| --- | --- | ---: | ---: |
| Marca | `Primary - Alexa (MX, ene-ago).csv` | 4,499 | 5.71 |
| Marca | `Primary - Alexa Plus (MX, jul-ago).csv` | 1,903 | 9.43 |
| Competencia | `Competencia - JBL (US).csv` | 825 | 10.92 |
| Competencia | `Competencia - Google Nest (US).csv` | 3,147 | 17.45 |
| Competencia | `Competencia - Bose (US).csv` | 2,060 | 25.44 |
| Competencia | `Competencia - Sonos (US).csv` | 4,500 | 33.88 |
| Competencia | `Competencia - Apple HomePod (US).csv` | 15,483 | 44.68 |
| Categoría | `Categoria - Alexa vs ChatGPT+Google+Siri (MX).csv` | 3,070 | 29.72 |
| Categoría | `Categoria - Smart Speakers (US).csv` | 21,847 | 88.49 |

El parser canónico confirmó 57,334 filas y 253.40 MiB. Antes de PostgreSQL estima 47,285 raíces
únicas, 43,159 elegibles, 4,126 excluidas por texto corto y 10,049 duplicaciones internas o entre
archivos. Esos valores son preflight, no resultados de importación; los recibos remotos son la
fuente final.

`_rename_map.csv` documenta el origen de los nombres. No se importa. Los dos CSV dentro de
`_descartar` se excluyen porque son un duplicado y una muestra sustituida por el corpus amplio.
El inventario exacto, encabezados, codificación, fechas y duplicados se registran antes del primer
upload.

## Primer checkpoint comprobado — 07:31 UTC

- Alexa Plus fue creada desde UAT por la pantalla real con ID
  `5894a799-7609-4395-9e01-89770051b75f` y slug aislado
  `alexa-plus-e2e-2026-09-12`.
- La ayuda de Claude Sonnet 4.6 completó el intake inicial; el operador interno revisó el resultado
  antes de guardar. Quedaron una knowledge base automática y doce competidores editables.
- La preparación automática de Brand Context llegó a `awaiting_authorization`. El corte actual
  mueve esa autorización acotada a Brand OS, conserva Topics como catálogo editorial y permite que
  sólo `noisia_admin`, `founder` o `admin` internos activos inicien el mismo contrato compuesto y
  auditable que el cliente administrador.
- La clasificación de plataforma SentiOne ahora respeta el campo explícito; cuando éste sólo dice
  el tipo de contenido, infiere la red desde el hostname y nunca desde texto, path o query.
- SQL0162 pasó replay completo de 156 migraciones y cinco pruebas PostgreSQL del contrato compuesto
  en una base desechable. DB 616/0 fallos, Studio 1009/0 fallos, build y typechecks pasan; revisión
  independiente P0/P1/P2 = 0. SQL0162 todavía no se ha aplicado a UAT en este checkpoint.

## Recorrido y gates

1. **Alta desde UI.** Crear Alexa Plus en UAT. Usar «Investigar marca» con Claude Sonnet 4.6,
   revisar cada sugerencia y aceptar sólo contexto verificable. Confirmar selector IANA, países,
   industria, aliases, competidores, descripción y knowledge bases sin editar la base de datos.
2. **Contexto semántico.** Comprobar que Brand OS deriva y publica automáticamente la versión de
   vocabulario/límites a partir del contexto confirmado. El usuario puede editar o borrar
   excepciones; no debe aprobar prototipos uno por uno. Toda versión y fuente quedan explícitas.
3. **Topics e intereses.** Definir intereses guiados y verificar que funcionan como guías
   semánticas, sin convertirlos en coincidencias léxicas ni reemplazar el descubrimiento abierto.
4. **Importación desde UI.** Subir los nueve CSV en sus alcances marca, competencia y categoría.
   Confirmar recuentos por archivo, recibidas, rechazadas, duplicadas, cobertura y actividad. Si un
   error impide el recorrido, corregir la capacidad reusable y repetir sólo el archivo afectado.
5. **Procesamiento completo.** Desde UI obtener cotización/autorización con tope, ejecutar
   embeddings y modelado sobre todo el corpus, y comprobar cola, recuperación, idempotencia y
   progreso. Voyage puede usarse sin un tope económico adicional; toda ejecución conserva recibo.
6. **Interpretación.** Ejecutar sólo Sonnet 4.6, con tope visible y evidencia. No usar Opus. Claude
   nombra/rankea agrupaciones sin inventar datos y sin exigir revisión manual masiva.
7. **Catálogo y Signal.** Revisar calidad, editar títulos/descripciones si hace falta, seleccionar
   Topics útiles y comprobar Resumen, Topics y Menciones con población, citas y enlaces coherentes.
8. **Incremental si cabe.** Verificar el mecanismo para una segunda carga mediante evidencia
   sintética o un archivo legítimamente nuevo; no volver a subir corpus para simular novedad.

## Auditoría de producto durante el recorrido

Cada pantalla se captura y evalúa con cuatro preguntas:

- ¿La jerarquía, densidad, controles y estados coinciden con el Admin sobrio tipo Shopify del resto
  del producto?
- ¿El bloque ayuda al cliente a tomar una decisión o es un vestigio técnico que debe ocultarse,
  simplificarse o eliminarse?
- ¿La acción tiene un efecto real y recuperable en el backend?
- ¿Cuánto tarda navegación, primera respuesta y render, y la demora está en SSR/API, PostgreSQL,
  Redis, cola, proveedor o recursos de UAT?

Los agentes de interfaz, QA e insight son observadores de solo lectura. Entregan capturas,
reproducciones y criterio; Root determina los cambios. Las correcciones se hacen en cortes focales,
con pruebas pertinentes, revisión P0/P1/P2 y verificación UAT. No se modifica el producto para
hardcodear Alexa Plus.

## Evidencia obligatoria

- Capturas antes/después de hallazgos visibles y mediciones de navegación/API.
- Recibos de imports, población gobernada y rechazos/duplicados.
- Versiones de contexto semántico, guías y modelo computacional.
- Presupuesto, reserva, costo confirmado y llamadas inciertas de Voyage/Claude.
- Recuento de clusters, interpretaciones, Topics, seleccionados y asociaciones Signal.
- Comentarios en Linear sin cerrar cuestiones cuya aceptación siga pendiente.

## Límites y parada segura

No se toca producción/main ni se reutilizan Laika, National o workspaces Alexa anteriores. No se
repiten SQL0153–0161, imports, fits ni gates cerrados. No se leen secretos históricos ni se hace
limpieza destructiva. Si el corpus completo no termina dentro de la ventana, se deja corriendo sólo
si la operación es durable, acotada y autorizada; se documenta el cursor y el costo exactos. Al
terminar o al llegar a 15:00:39 UTC se pausa el loop y se registra qué está visible, qué fue probado
y cuál es el siguiente input legítimo.
