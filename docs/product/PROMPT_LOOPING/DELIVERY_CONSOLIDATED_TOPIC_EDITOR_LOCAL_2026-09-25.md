# Editor de Topics consolidados — corte local, 25 septiembre 2026

## Resultado

Se añadió una edición de nombre y definición para cada concepto de la propuesta consolidada. La operación toma la revisión validada esperada, copia **todas** las decisiones por grupo y la metadata de prioridad, crea una revisión sucesora completa y prepara su snapshot gratuitamente. Signal conserva la revisión publicada hasta que el usuario selecciona y activa la nueva. Una edición no llama a Claude ni Voyage, no reclasifica menciones y no modifica el censo BERTopic.

Cuando Signal ya usa una consolidación, Topics distingue explícitamente la capa publicada de la lista previa de intereses y resultados parciales. La edición y la selección quedan en la misma sección de Topics, en español e inglés.

## Evidencia y límites

- Corte focal en `codex/noisia-alexa-atomic-census-2026-09-25`, sobre Studio UAT `8f8bf66` activo.
- Dos pruebas de contrato de edición con DB simulada y 19 pruebas de interfaz pasan. Typecheck 11/11, lint 11/11 y diff-check pasaron al cierre. La compilación de Next llegó a código compilado, pero la recolección de páginas se detuvo porque este checkout no tiene `KINDE_ISSUER_URL`; no es un fallo demostrado del cambio.
- No se ejecutó la nueva escritura contra PostgreSQL real; por tanto este corte sigue **LOCAL**, no UAT ni validación end-to-end. Alexa+ continúa con 2/42 lotes y sin catálogo consolidado final, así que tampoco existe un caso real para pulsar el editor.
- La conexión privada de dev-test está recuperada. Una consulta booleana anterior se interpretó erróneamente como ausencia de 0174/0181. Una lectura posterior explícita en el contenedor confirma `current_database=noisia_dev_test`, usuario `noisia_dev`, **299 tablas públicas**, `signal_topic_consolidation_revisions`, `signal_topic_consolidation_decisions` y `prepare_signal_topic_consolidation_snapshot_v1(uuid,uuid,uuid,text)` presentes. El checkout privado de Signal ya conserva el sello de 299 tablas tras su upgrade; **no repetir ese upgrade**. Ninguna de estas lecturas alteró UAT.
- Se preparó un runner privado específico para probar la edición: exige ese sello, aprobación distinta, base vacía y transporte de proveedores bloqueado; reutiliza el fixture de Brand OS y dos grupos sintéticos existente. Hace una revisión inicial, sirve un concepto, edita el otro, comprueba decisiones/prioridad y activación, y termina con rollback físico más verificación de vaciado. Sus 14 pruebas de guards y typecheck pasan localmente. **Todavía no hay recibo PostgreSQL de este runner.**

## Siguiente acción

Probar la operación de edición con una revisión y grupos sintéticos en PostgreSQL privado bajo rollback, usando el esquema de 299 tablas ya instalado y verificando identidad/sello antes de cualquier escritura. Verificar que el snapshot anterior sigue servido, prioridad/decisiones permanecen y la revisión nueva es activable. Sólo entonces entregar esta ruta focal a UAT. Con permiso de gasto vigente, reanudar la misma revisión de Alexa+ (40 lotes), evaluar Noise/uniones/separaciones y probar edición/selección desde la interfaz con datos reales.
