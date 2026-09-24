# Preparación persistente de revisión de intereses — LOCAL

24 septiembre 2026, heartbeat 11:23 UTC. Continúa DELIVERY_INTEREST_REVIEW_RECOVERY_LOCAL_2026-09-24.md y Compass. Código local sobre dbfe9f8; sin ejecución SQL, proveedores o entrega UAT.

## Resultado y alcance real

SQL0183 agrega un snapshot privado e inmutable de la preparación: revisión completa, fuente numérica, perfil, definición de intereses, digests y clave de solicitud por actor/workspace. Los adaptadores server-only permiten guardar y recuperar esa preparación con una transacción corta; contexto Brand OS y contexto editorial se comprueban dentro del mismo snapshot transaccional. Una preparación no es un permiso, una ejecución ni una clasificación: siempre devuelve provider_execution_enabled=false.

El manifiesto se valida contra el catálogo vigente, el plan y la evidencia numérica existentes y cada par grupo/interés. Se verifica configuración Sonnet 4.6, prompt/schema, mensajes y contenido de cada lote. Se conservan intereses manuales aunque no guíen BERTopic; un descubrimiento requiere opt-in. Se reutilizan las funciones de evidencia del plan anterior; no se modifican sus bytes ni hashes.

Se rechaza reutilizar una clave con contenido diferente. La repetición exacta recupera el mismo recibo si fuente y catálogo siguen vigentes; si cambiaron, rechaza sin generar otra preparación. La lectura revalida derechos, fuente, catálogo e integridad antes de devolver evidencia. RLS y revocaciones PUBLIC/anon/authenticated mantienen la tabla y funciones privadas; no hay nueva política pública ni SECURITY DEFINER.

La validación de pares usa posiciones directas de veinte elementos por lote, evitando recorrer toda la matriz por cada lote. Se mantiene la matriz completa y los límites técnicos previos; no top-k ni umbral de precisión. Normalización/UTF-16 de definiciones y JSON canónico se contemplan para no confundir Unicode o espacios de JSONB con cambios semánticos. Esto aún requiere contraste real en PostgreSQL.

## Por qué no se amplió aún la admisión pagada

El análisis focal confirmó que añadir interest_review al owner actual no basta: SQL0176/0178/0182, selección del último owner, sucesores y dispatcher están ligados a consolidación. Hacerlo parcialmente podría enviar un plan de intereses al consumidor equivocado. Por eso este corte sólo persiste la preparación; NO cambia constraints, owners, configuración, funciones, requests, costos, permisos ni outbox del sistema pagado existente. No crea otro ledger.

**La admisión pagada y el store PostgreSQL de checkpoints del coordinador dbfe9f8 siguen pendientes.** La preparación es insumo para ese siguiente corte; no sustituye la prueba de recuperación durable ni conecta clasificación con Signal. No hay ruta UI, dispatcher o botón nuevo.

## Validación y límites

- Ocho pruebas del adaptador PASS: preparación y lectura transaccionales, cambios de contexto/editorial, identidad/recibos sustituidos, errores de derechos/catálogo, mutación de opciones mientras espera y recuperación del recibo.
- Seis pruebas estáticas SQL PASS: configuración coincide con el contrato TypeScript, integridad/privacidad/replay previstos y ausencia de mutaciones al pipeline histórico. Son checks de estructura, NO ejecución de funciones/constraints PostgreSQL.
- Suite DB: 615 PASS, 98 omitidos, cero fallos. Ningún omitido equivale a aceptación PG.
- Typecheck y lint raíz: 11/11 tareas PASS; lint conserva 13 warnings anteriores, cero errores. Diff-check limpio.
- Revisión independiente final sin P0/P1/P2 reproducibles; lectura completa del SQL y adaptador, sin afirmar aceptación PostgreSQL. Evidencia en .data/interest-preparation-2026-09-24/ del checkout focal.

No se ejecutó build/QA visual: no hay cambios de interfaz o runtime entregado. No se repitieron imports, embeddings, fit, pruebas pagadas ni gates históricos. Cero gasto y cero permisos renovados.

## Aplicación y aceptación pendientes

SQL0183 es nuevo y LOCAL. No fue agregado al upgrade privado0152–0182 ni instalado en dev-test/UAT. Primero resolver la conexión privada existente; no reintentar28P01 ni cambiar contraseñas desde UI. La causa credencial/encoding sigue sin probarse.

En un futuro ensayo privado sintético, verificar esquema0182 y ausencia0183, guardar sellos de funciones/tablas históricas, abrir transacción con límites, aplicar0183 y probar preparación/lectura/replay/conflicto, fuente/catálogo alterados, revocación, aislamiento workspace, Unicode/límites, rechazo de modificación directa y ACL/RLS. Confirmar cero owners, admissions, calls y outbox nuevos. Terminar con ROLLBACK y comparar sellos. La aceptación en motor real y sus fixtures aún están pendientes; no presentar tests simulados/estáticos como reemplazo.

No hay plan de eliminación de evidencia. Ante fallo posterior a una eventual instalación, retirar el consumidor nuevo (hoy inexistente), conservar snapshots y corregir con migración adelante; no revertir tablas/recibos históricos ni bajar a producción.

Signal desde importación mantiene su gate independiente: recibo privado readonly, sellos reales, upgrade vacío explícito si procede y seis escenarios rollback antes de entregar. Este corte no permite saltarlo.

## Siguiente acción delimitada

Diseñar e implementar LOCAL la admisión pagada de una preparación validada, reutilizando ledger/costos/recibos existentes con propósito e identidad distintos. El owner interest_review debe separarse por workspace/run/review_digest, nunca como sucesor de consolidación pagada. La nueva configuración no debe cambiar signal_topic_editorial_configuration_v1 ni aceptar políticas antiguas por accidente. Todas las lecturas del último owner, sucesores, finalización y dispatch deben respetar propósito; no habilitar envíos ni ruta de consumidor hasta que esa extensión y checkpoints pasen PG sintético. No crear permisos reales ni renovar presupuestos desde un heartbeat.

Después siguen criterio de evidencia para asignaciones, materialización/proyección, ranking/consolidación y segunda carga incremental real. Mantener la utilidad del producto como criterio: no nuevos formularios ni aprobaciones por mención. Queries por ámbito, reportes agente y MCP siguen pendientes.

Studio UAT a42b9b4, Worker original0b68b3e0 y Laika conservan la comprobación anterior; no se consultaron ni modificaron en este corte. Linear requiere reconexión, sin updates inventados. Historia y Compass preservados.
