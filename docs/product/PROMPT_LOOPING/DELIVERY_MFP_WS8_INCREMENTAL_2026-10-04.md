# WS8 — segunda carga y recorrido guiado (código en revisión)

Spec canónico v1.3. Rama `feat/mfp-ws8-incremental`, base `4e067126`.
Este recibo acredita implementación y pruebas focales; no acredita despliegue, aceptación semántica ni recorrido UI real.

## Comportamiento implementado

La segunda carga reutiliza assets, vectores, fichas y pertenencias con claves vigentes. El motor incremental existente predice grupos conocidos para todas las raíces relevantes nuevas; sólo el residuo relevante sin `belongs` efectivo vigente entra en agrupación emergente. Correcciones humanas prevalecen; pertenencia obsoleta, abstención y error no excluyen del residuo. La población y el residuo se sellan al admitir; SQL vuelve a validarlos. El contexto numérico compatible conserva el modelo congelado; el contexto editorial usa Brand OS actual. Proyección conserva el denominador elegible y abstiene raíces fuera de la población relevante. Conceptos emergentes interpretados y entregados se pueden adoptar explícitamente, sin heredar pertenencia por similitud.

El bootstrap MFP exige creador financiero interno configurado y autoridad vigente, pero no depende de propuestas semánticas antiguas ni del cap heredado USD5. Mantiene máximos explícitos y ocho acciones de producto. La interpretación incremental usa política activa, admisión y ledger existentes; `NULL` significa ausencia de máximo. `9999-12-31T23:59:59.999Z` representa exclusivamente `infinity` en transporte JSON/UI; no reemplaza la autoridad SQL ni altera vencimientos finitos. Legacy conserva su contrato.

Migraciones nuevas: 0237–0238, pendientes de prueba PostgreSQL e instalación. La corrección WS6/0240 añade fences compartidos de población vigente a proyección/serving y debe integrarse antes de la demostración. No se modifica SQL histórico instalado.

## Evidencia y límites

Focales ligeras: bootstrap/adopción/guard 13 PASS; contrato UI editorial 25 PASS; archivos incrementales 8 PASS y 1 omitida por fixture Python ausente. Transpilación sintáctica TS/TSX sin errores. Typecheck, lint, suites y build se ejecutarán en CI remoto. Python focal y PostgreSQL compuesto están pendientes del runner remoto. Las pruebas de contrato no prueban calidad semántica ni proveedor real.

Llamadas de proveedor de este corte: 0; coste observado USD0. Estimación de ejecución real: registrar tokens/llamadas/tiempo y actualizar tras cada carga; presupuesto orientativo, sin crear máximos implícitos. Orquestador conserva operación de infraestructura, migraciones y proveedores.

## Demostración guiada pendiente

1. Crear marca cliente por UI; completar Brand OS y 2–3 conceptos humanos editables. Registrar contexto de entidades y digests.
2. Importar carga 1 con procedencia; preparar assets/vectores/fichas, descubrir, adoptar y seleccionar conceptos, evaluar pertenencias y consultar Signal. Capturar filas recibidas/únicas/elegibles/relevantes y llamadas/coste por etapa.
3. Importar carga 2: 200 nuevas, 30 duplicadas y 20 textos editados. Mostrar reutilización de claves vigentes, llamadas por cada etapa, predicción conocida y propuestas emergentes del residuo. Comparar ambos denominadores y Signal actualizado.
4. Editar un concepto: reevaluar todo su corpus aplicable. Añadir alias y competidor: invalidar sólo raíces afectadas; comprobar correcciones humanas y que fichas obsoletas no se sirven vigentes. Cambio narrativo aislado: cero nueva ficha/pertenencia por ese cambio.
5. Recuperar una ejecución interrumpida y repetir la misma solicitud: cero doble cobro/escritura. Verificar máxima explícita y revocación de autoridad. Guardar recibo separado de pruebas simuladas, proveedor y aceptación humana.

Pendiente: corpus/human gold del fundador, verificación PG/CI, ejecución real de segunda carga, UI autenticada y aceptación UAT del corte recuperable. No declarar producción integral a partir de este documento.
