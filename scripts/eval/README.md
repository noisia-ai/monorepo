# Evaluador MFP offline

Implementa las métricas de §9.4 del spec v1.3. No inicia proveedores, no consulta
la base, no selecciona gold y no aprueba etiquetadores. Los datos de entrada
permanecen en `.data/dev-corpus/` o fuera del checkout. El Markdown contiene sólo
agregados; nunca texto, asuntos, citas, nombres, IDs de raíces o claves de conceptos.

## Ejecutar

```sh
node --import tsx scripts/eval/facets-report.ts \
  --selection .data/dev-corpus/gold-selection.json \
  --selection-sha256 <huella-fijada-antes-de-evaluar> \
  --partition dev \
  --output .data/dev-corpus/eval-pending.md
```

Sin `--gold` produce `no_evaluado`. No crea un gold ficticio. La huella debe ser la
ya conservada al fijar la selección, no una huella nueva de un archivo modificado.
El script comprueba sus bytes exactos. Reutiliza la selección y el JSONL de
`scripts/dev-corpus/gold-template.ts` / `gold-import.ts`; no reestratifica.

Con el gold asistido por Opus y revisado por el fundador, añadir:

```sh
--gold .data/dev-corpus/gold.jsonl \
--bundle .data/dev-corpus/eval-variants.json
```

`--partition dev` es el valor predeterminado y sólo calcula métricas supervisadas
en esas 90 raíces. `--partition test` evalúa las 60 retenidas para el reporte final;
el script no busca ni ajusta umbrales. Conserva un reporte distinto por partición:
la salida usa creación exclusiva, no sobreescribe recibos previos.

La revisión 2 añade tres vistas de juez por concepto: A sobre raíces en las que
emitió decisión o insufficient frente a B sobre exactamente esas raíces; pipelines
completos A y B, cada uno con su propia puerta de ficha; y la intersección donde
ambos emitieron juicio binario. Pending, error e insufficient sobre gold positivo
cuentan como FN operativos del pipeline, separados de not_belongs explícito.
La intersección es calidad condicional y siempre muestra su cobertura. No existe
comparador preregistrado de jueces ni ganador automático. El coste B juez proviene
del journal privado (input_tokens × precio configurado), no del ledger común;
frozen_before_test es una declaración del operador, no prueba temporal.

C2 se calcula sin red ni base con `node --import tsx scripts/eval/hybrid-c2.ts
--selection <selección> --gold <gold.jsonl> --bundle <eval-variants.json>
--output <resumen-privado.json>`. La salida se crea de forma exclusiva y contiene
sólo agregados e identidades ordinales de conceptos. Compara en dev y test la
puerta+juez JEV, esa ruta con confirmación Claude sólo de positivos y puerta JEV
con juez Claude para todos los elegibles. Las tres vistas son raíces con juicio
Claude, pipeline completo e intersección binaria. Una predicción guardada de Claude
es un sustituto del veredicto de confirmación; el bundle no prueba que haya una
cita para la solicitud híbrida. El coste híbrido es una proyección con tasas
observadas de componentes, nunca gasto liquidado de un recorrido híbrido.

## Contrato de exportación

Los tipos exactos y validaciones están en `contract.ts`. El bundle JSON tiene:

- `contract_version: "mfp-eval-v1"`.
- `human_gold` declara procedencia real: `{ origin: "human", reviewer_confirmed: true }`
  para anotación humana, o `{ origin: "ai_assisted_founder_reviewed", reviewer_confirmed: true,
  assistant_model, reviewed_rows, corrected_rows }` para anotación asistida y revisión
  del fundador. `null` mientras no exista. Es declaración del operador, no certificación
  técnica de quién anotó los datos.
- `variants[]`: una entrada por variante, con `variant`, `labeler_digest`,
  `prediction_rows`, `costs` y, en JEV final, `thresholds`.
- Variantes A: `A_facets_adaptive_low`, `A_facets_between_tools`, `A_judge_low`,
  `A_judge_medium`. B: `B_facets_jev`, `B_judge_jev`. A y B aparecen separadas;
  variantes ausentes se reportan explícitamente.
- Cada fila conserva `root_id`, `input_digest`, `status` y `facets` en el formato
  de dimensiones `{value, abstained, confidence}` de WS2/WS3. Las filas de juez
  aportan `memberships: { [concept_key]: verdict }`. Los veredictos aceptados son
  `belongs`, `not_belongs`, `insufficient`, `refused`, `error`, `pending`.
  Una clave ausente es `pending`: sólo se exporta `not_belongs` si existe una
  decisión explícita del motor, nunca por ausencia de respuesta del proveedor.
- `costs`: `settled_usd` (número o null desconocido), `reserved_usd`,
  `unknown_calls`, `mentions_attempted`, `wall_ms` (número o null desconocido).
  Exportar costes de ejecución de cada variante, con llamadas de recuperación;
  cada llamada pertenece a una variante, no duplicar el ledger. Tiempo de pared
  es fin menos inicio de la ejecución, no suma de latencias paralelas. USD/1000
  usa menciones intentadas, incluyendo errores. Los costes pueden pertenecer al
  corpus completo y no al split gold; no repartirlos proporcionalmente como
  si fueran mediciones. El informe suma sólo liquidado conocido y señala reservas
  o incertidumbre; el coste nulo no se presenta como cero por variante.
- `thresholds` B: `{selected_on: "dev", frozen_before_test: true,
  development_round: 0|1, values: {...}}`. Ficha usa `entity`, `salience`, `spam`,
  `minimum_choice_confidence`; juez usa `membership`. Valores 0..1. Al exportar,
  comprobar que coinciden con `identity.params` del etiquetador evaluado; el
  evaluador no reconstruye identidad ni reinterpreta outputs. El dato declarado
  no demuestra por sí solo que el operador no miró test. Una ronda y una
  corrección focal dev son el máximo del protocolo; no se cambia con test.
- Probabilidades JEV por fila, opcionales: `probabilities: [{task,key,probability}]`.
  `entity` y `salience` usan `key=entity_id`, desde cada `noul` crudo persistido;
  no sustituirlas por la confianza agregada del conjunto. `spam` usa `key="true"`.
  `voice`/`act` usan la clase elegida como `key` y su confianza. `membership` usa
  `concept_key` y probabilidad de pertenecer. El evaluador deriva el resultado
  verdadero del gold, no recibe `correct:true` del exportador. No exportar texto
  crudo. El número de probabilidades evaluadas hace visible cobertura incompleta;
  su ausencia produce N/D, no ECE=0. Salience se evalúa sobre entidades presentes
  en gold. Voice/act usan confianza de clase elegida, no un promedio artificial
  de la distribución de todas las clases.

Las filas adicionales al gold sólo alimentan acuerdo Claude–JEV, emparejadas
por raíz e input_digest. Exportar el corpus completo (~1000 raíces), incluyendo
estados técnicos. El informe muestra el tamaño realmente exportado; no afirma
que sea una población completa verificada contra DB. No mezcla etiquetas de
inputs antiguos. Una fila gold con digest distinto provoca error de exportación.

## Ejecución privada WS4

En el runner MFP, los comandos WS4 toman la identidad de `identity_path` en
`.data/dev-corpus/voyage-real/fixture-manifest.json`. El manifest y la identidad
deben declarar `rental-corpus-voyage-v1`; el gate JEV comprueba workspace,
organización y marca exactos en DB. La identidad del fixture distinto en la raíz
del volumen no interviene.

`install-concepts-v2.ts` instala los tres conceptos confirmados
en el catálogo dev-test mediante CAS e idempotencia. Conserva el ámbito del
catálogo y añade al campo de definición las seis reglas de etiquetado del JSON
v2, además de inclusiones, exclusiones y ejemplos. Verifica que el catálogo
resultante coincide antes de ejecutar jueces.

`rights-check.ts` es la comprobación previa a JEV: transacción de sólo lectura,
binding efectivo import/source, retención y licencia `llm-processing` vigentes,
una fuente y las dos cargas completadas del fixture `voyage-real` (excluye la
carga fallida), cero trabajo o facturación en vuelo.
`jev-judge.ts --real` repite ese gate antes de enviar texto y conserva solicitudes,
respuestas crudas y resultados en un journal privado de creación exclusiva. Un
intento sin respuesta durable queda `pending` y nunca se reenvía a ciegas.

Las variantes A se piden con `scripts/dev-corpus/facets.ts --real
--thinking=adaptive|between_tools` y `scripts/dev-corpus/memberships.ts --real
--effort=low|medium`; los flags de producto/proveedor, política financiera y
confirmación de recálculo siguen siendo obligatorios. `export-bundle.ts` toma
un `eval-run-manifest.json` privado con los IDs explícitos de cada run, exige
identidad/modelo/estado final congruentes, extrae predicciones y costes del ledger
y recupera probabilidades JEV de recibos privados con SHA256/tamaño verificados
según 0255. Escribe `eval-variants.json` sin textos. Sólo se fija el umbral JEV con las 90
raíces dev; el reporte test usa ese umbral congelado y no ajusta prompts.

## Denominadores y límites

- Validación de 150 raíces únicas, split fijo 90/60, estrato y input_digest contra
  selección, enums y conceptos completos. Gold con menos de 15 comparaciones
  humanas conserva todas sus filas y reporta la limitación. Los candidatos
  léxicos no se confunden con comparaciones humanas confirmadas.
- Exactitud incluye todas las respuestas; abstenciones/errores/rechazos/faltantes
  no se convierten en negativos. F1 macro omite sólo clases sin soporte ni
  predicción. Precision/recall sin denominador son N/D.
- Entidades: micro por (raíz, entidad), macro por entidad del CE, coincidencia
  exacta de conjunto, kind/prominencia sobre pares correctos. Gold con abstención
  de entidades queda fuera de esos denominadores y se cuenta aparte. La falta
  de predicción no acierta por casualidad un conjunto vacío.
- Pertenencia: gold `insufficient` se cuenta fuera del binario; precisión/recall
  sobre decisiones humanas determinadas. Salidas técnicas o insuficientes
  conservan FN cuando gold es positivo. Wilson 95% para recall. Errores semánticos
  FP/FN separados de estados técnicos. JEV no acredita citas/evidencia.
- Fiabilidad: diez bins fijos de ancho 0.1; el último incluye 1. ECE pondera por
  número de probabilidades en cada bin. Tabla y diagrama de barras en Markdown.
  Nunca declara calibración por calcular ECE: faltan criterio aceptado y revisión.
- Los candidatos por dimensión sólo se proponen en test, comparando variantes
  presentes: F1 macro (entidades micro), diferencia <0.03 se resuelve por menor
  coste completo. Coste incierto o empate dejan candidato N/D. No son aprobación
  ni prueba de umbrales de aceptación. Asunto no tiene exactitud de texto libre;
  su utilidad requiere revisión humana. Idioma sí tiene matriz/exactitud/F1.

El exportador debe conservar fuente, identidad completa, parámetros, evidencia
humana y fingerprints privados. Este corte no crea un nuevo ledger ni un proceso
que aparente certificar decisiones humanas.

## Checks

```sh
node --test --import tsx scripts/eval/*.test.mjs
pnpm exec tsc --project scripts/eval/tsconfig.json
```

Pruebas sintéticas matemáticas, sin proveedor ni DB. CI ejecuta estos checks antes
de las suites existentes; builds e integración permanecen remotos.
