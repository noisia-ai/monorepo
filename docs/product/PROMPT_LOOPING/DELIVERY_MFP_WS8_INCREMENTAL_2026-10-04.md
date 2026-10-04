# WS8 — segunda carga y recorrido guiado (código en revisión)

Spec canónico v1.3. Rama `feat/mfp-ws8-incremental`, base `4e067126`.
Este recibo acredita implementación y pruebas focales; no acredita despliegue, aceptación semántica ni recorrido UI real.

## Comportamiento implementado

La segunda carga reutiliza assets, vectores, fichas y pertenencias con claves vigentes. El motor incremental existente predice grupos conocidos para todas las raíces relevantes nuevas; sólo el residuo relevante sin `belongs` efectivo vigente entra en agrupación emergente. Correcciones humanas prevalecen; pertenencia obsoleta, abstención y error no excluyen del residuo. La población y el residuo se sellan al admitir; SQL vuelve a validarlos. El contexto numérico compatible conserva el modelo congelado; el contexto editorial usa Brand OS actual. Proyección conserva el denominador elegible y abstiene raíces fuera de la población relevante. Conceptos emergentes interpretados y entregados se pueden adoptar explícitamente, sin heredar pertenencia por similitud.

El bootstrap MFP exige creador financiero interno configurado y autoridad vigente, pero no depende de propuestas semánticas antiguas ni del cap heredado USD5. Mantiene máximos explícitos y ocho acciones de producto. La interpretación incremental usa política activa, admisión y ledger existentes; `NULL` significa ausencia de máximo. `9999-12-31T23:59:59.999Z` representa exclusivamente `infinity` en transporte JSON/UI; no reemplaza la autoridad SQL ni altera vencimientos finitos. Legacy conserva su contrato.

Migraciones nuevas: 0237–0238. El primer ensayo PostgreSQL remoto compiló ambas dentro de rollback; falló después durante admisión numérica y no acredita el contrato completo ni instalación. Se añadió diagnóstico seguro y continúa la prueba compuesta. La corrección WS6/0240 añade fences compartidos de población vigente a proyección/serving y debe integrarse antes de la demostración. No se modifica SQL histórico instalado.

## Evidencia y límites

Focales ligeras: bootstrap/adopción/guard 13 PASS; contrato UI editorial 25 PASS; archivos incrementales 8 PASS y 1 omitida por fixture Python ausente; proyección incremental pura 27 PASS, incluida raíz fuera de población con corrección humana y 201 fragmentos. Python real en CI `d1bbe26`: 12 PASS (34.15 s), incluido residuo restringido y compatibilidad legacy. TC remoto DB/Worker/Studio sobre `825538b`: PASS; TC/lint CI sobre `d1bbe26`: PASS. Source congelado para segundo PG: `48ad7f9`; CI final aún pendiente. Las pruebas de contrato no prueban calidad semántica ni proveedor real.

Harness remoto: `scripts/dev-corpus/incremental-check.ts --rollback-check --editorial-check`, usando `NOISIA_MFP_IDENTITY_FILE` privado y guard de destino existente. Primer bloque reutiliza parent real y prueba población/residuo, replay, política infinity/finita, máximo y revocación. Segundo bloque usa artefactos numéricos explícitamente simulados para evidence→admisión→plan→reserva→send→renovación. La función SQL de capacidad se prueba con sello de reserva del día anterior; el transporte se prueba el día real actual. Esto no equivale a observar una medianoche real. Ninguna prueba llama proveedores ni conserva mutaciones tras rollback.

Llamadas de proveedor de este corte: 0; coste observado USD0. Estimación de ejecución real: registrar tokens/llamadas/tiempo y actualizar tras cada carga; presupuesto orientativo, sin crear máximos implícitos. Orquestador conserva operación de infraestructura, migraciones y proveedores.

## Demostración guiada pendiente

1. Crear marca cliente por UI; completar Brand OS y 2–3 conceptos humanos editables. Registrar contexto de entidades y digests.
2. Importar carga 1 con procedencia; preparar assets/vectores/fichas, descubrir, adoptar y seleccionar conceptos, evaluar pertenencias y consultar Signal. Capturar filas recibidas/únicas/elegibles/relevantes y llamadas/coste por etapa.
3. Importar carga 2: 200 nuevas, 30 duplicadas y 20 textos editados. Mostrar reutilización de claves vigentes, llamadas por cada etapa, predicción conocida y propuestas emergentes del residuo. Comparar ambos denominadores y Signal actualizado.
4. Editar un concepto: reevaluar todo su corpus aplicable. Añadir alias y competidor: invalidar sólo raíces afectadas; comprobar correcciones humanas y que fichas obsoletas no se sirven vigentes. Cambio narrativo aislado: cero nueva ficha/pertenencia por ese cambio.
5. Recuperar una ejecución interrumpida y repetir la misma solicitud: cero doble cobro/escritura. Verificar máxima explícita y revocación de autoridad. Guardar recibo separado de pruebas simuladas, proveedor y aceptación humana.

Pendiente: corpus/human gold del fundador, verificación PG/CI, ejecución real de segunda carga, UI autenticada y aceptación UAT del corte recuperable. No declarar producción integral a partir de este documento.


## Revisión de paginación y segundo PG remoto

- PG remoto `48ad7f9`: DDL0237–0238 compiló dentro del rollback; preflight,
  rechazo de residual adulterado, inicio/replay numérico, política ilimitada y
  claim numérico pasaron. El checkpoint numérico sintético llegó a admisión
  editorial y rechazó `workspace_incremental_editorial_claim_invalid` (23514).
  Rollback físico completado; **no es un PG PASS**. El siguiente harness conserva
  el guard y añade diagnóstico de predicados booleanos, sin textos ni IDs.
- Corregidos los dos guards del Worker que pedían200 y rechazaban más de128,
  y el límite128 del preparador de archivos. MFP usa200; legacy conserva128.
- Regresión ligera del Worker: cuatro casos ejecutan la función real hasta el
  checkpoint de entrada con páginas129 y200+1, y rechazan una página201 de raíces
  o fragmentos. Stores, almacenamiento y padre son simulados. Cero Python,
  PostgreSQL, modelos o proveedores en esta prueba. Suite focal de archivos más
  paginación: **11PASS/1SKIP**, 2.5s; el SKIP requiere bytes Python privados.
- El harness editorial separa evidence/preview/begin/enqueue/claim; el trigger de
  diagnóstico existe sólo dentro de la transacción que se revierte, conserva la
  condición de rechazo y publica exclusivamente nombres de predicados y booleans.
