# Recuperación ante terminación confirmada del proveedor

Fecha operativa: 8 septiembre México; registro 9 septiembre UTC. En preparación LOCAL, sin nueva llamada ni modificación UAT al abrir este corte.

## Evidencia nueva

El operador abrió Claude Console. En Logs, la única segunda solicitud Opus5 reciente es `req_011Ces5jp4wBNQoqPyARnkvp`: timestamp DOM `2026-09-09T02:34:48.179Z`, latencia119.472s, `client_error:true`, `code:499`, `detail:Client disconnected`. La fila anterior identifica exactamente el primer request conocido `req_011Ces3Rst99KYyqcZ4NSoud` y sus28718/153tokens. La coincidencia temporal con el fallo local de la reparación a02:34:48.471Z y la secuencia única respaldan la correlación; la consola no muestra el digest de la petición, por lo que no se afirma una unión criptográfica con el request externo.

La segunda solicitud registra29190tokens de entrada y4479de salida, caché lectura/escritura0. No se recuperó cuerpo de respuesta ni se observó una acción para recuperarlo. Sus tokens a la tarifa sellada equivalen aUSD0.257925; esto es medición, no una factura conciliada. CostMTD muestraUSD3.36 frente aUSD3.77 del dashboard y la filaSep9UTC muestra0; ese0 no prueba gratuidad. Se conserva la reservaUSD1.6818 y el confirmado previoUSD0.147415. Evidencia privada: `.data/workspace-engine-2026-09-08/claude-console-499-observation-2026-09-09.json`.

## Cambio acotado

Agregar `terminal_confirmed` a la misma fila del ledger: el proveedor terminó, su cargo continúa reservado hasta conciliación. Conservar request/config/digest, ausencia real de response_*, reserva completa y settlednull. Registrar evidencia externa inmutable con origenConsole, request ID, timestamp, usage observado, verificador administrativo y referencia privada+SHA. No fabricar un recibo de Messages API ni liquidar como si existiera.

Permitir como máximo un sucesor de transporte por solicitud lógica, con su propia reserva, misma petición/configuración/reparación editorial/actor, y lease e inputs vigentes. No segunda reparación editorial ni retry automático tras una nueva incertidumbre. Reanudar la misma ejecución y sus357grupos/15artefactos; no nuevos imports, embeddings o fit.

Frontend reutiliza Reanudar con elegibilidad emitida por el servidor, explica que la reserva anterior sigue en conciliación y que el nuevo intento reserva aparte. No formulario nuevo de revisión ni route pública para inventar evidencia de proveedor. La confirmación externa es una operación administrativa excepcional; transporte recuperable con IDs durables sigue siendo deuda para eliminar esta dependencia operativa.

El permiso de Claude sólo cubre8sept America/Mexico_City. La nueva admisión opcional del Worker `NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL` se configurará enUAT a`2026-09-09T06:00:00.000Z` antes de un próximo envío. Rechaza nuevos envíos al vencer; permite terminar y guardar los ya enviados. No cambia el cuerpo ni los digests. No amplía presupuesto ni fecha.

## Responsabilidades y verificación

Backend: ledger, SQL0142, evidencia administrativa, límite de sucesor, recuperación de ejecución, pruebasPG. Worker: recorrido de la cadena durable, replay y conservación de la reparación lógica. Frontend: elegibilidad/importe/copyESEN y recuperación por el botón existente. Root: evidenciaConsole, admisión por fecha, revisión independiente, recibos/documentación/Linear, SQL y despliegue focal sólo después de pruebas. Tres contract-drafts ajenos siguen fuera.

Provider con fecha:17/17pruebas locales correctas; Worker focal26/26informado. Integración/PG/checks/revisión y UAT todavía pendientes. No se ha enviado otra llamada, confirmado terminal enDB ni liquidado reserva. Los resultados de interpretación/catalogación/clasificación/Signal continúan abiertos.

Referencia oficial sobre desfase y reconciliación de consumo: [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).

## Verificación local posterior — 9 septiembre 04:56 UTC

Typecheck y lint de raíz:11/11 tareas correctas, sin errores. DB231PASS/67SKIP; Studio714PASS/6SKIP; Worker337PASS/5SKIP. Provider17/17, Workerfocal26/26 y Studiofocal34/34. PostgreSQL focal de0142 pasó contra fixture local dentro de rollback; no se repiten los gates previos. Revisión independiente de SQL/ledger/Worker/UI y vencimiento sinP0/P1/P2 pendientes; se corrigió la elegibilidad cuando otro lote ya agotó su sucesor y la validación de fechas requeridas enSQL. Build Studio de producción PASS.

El runner privado de evidencia comprueba las dos llamadas: recibo original147415microUSD ySHA/requestID exactos; reparación sin respuesta ni liquidación y reserva1681800. Fija totales y hash de columnas inmutables antes/después. La utilidad SQL0142 verifica el paquete y destino por separado; la aplicación real todavía no ocurre. La variable de vencimiento está STAGED enWorkerUAT, no activa todavía. Los tres archivos ajenos de contract-drafts mantienen susSHA originales y quedan fuera del commit focal.

## UAT verificado y recuperación real — 9sept05:06UTC

Studio yWorker ejecutan99b2b58922783438f7652eeb2a5d6025d8f96155. Studio5f2f5704-9c7b-4ea9-bfe9-55e7ac6c27aa; Workerab573356-78fd-4e00-b520-24b23c7696f6. Fecha de admisión2026-09-09T06:00:00.000Z comprobada enWorker. SQL0142 aplicado04:59:04UTC y verificado04:59:16UTC, ledger64filas idéntico antes/después; no reaplicar.

La confirmación administrativa se guardó05:04:50.957UTC y se verificó mediante lecturaDB y descarga privada05:04:59.962UTC. Mismafila pasó terminal_confirmed; original147415 y reserva1681800microUSD intactos. SHA columnas inmutables49b3d1233b1ef42cf7a6658bceecd1be74b949a1ad816d6299fe9655c27cb2e2 igual antes/después. Evidencia externa391f6ebcd1e88260c1a1c980957149bb10e2551fe36f864ff9056b8792840a30 comprobada enstorage. No cuerpo recuperado ni factura conciliada.

La UI actual mostró Reanudar análisis y el costo de una reserva adicional. Root lo accionó una vez. A05:06:25.739UTC misma ejecución4c55af5c-e17f-430a-b17d-6771e94bd30e, dispatch5 running/exporting, fit guardado357grupos/15artefactos/6826raíces20821fragmentos,0Topics y todavía sin nueva llamada en ese instante. Seguir esta ejecución; no abrir otra. Recibos privados uat-0142-migration-receipt.json, uat-terminal-confirmation-receipt.json y uat-terminal-resume-receipt.json.

## Cierre de esa recuperación y cambio de modelo — 9 septiembre 05:35 UTC

El sucesor terminal respondió y cuatro grupos quedaron interpretados. El siguiente lote y su única reparación devolvieron citas inválidas; dispatch 5 terminó en repair_invalid, con cero Topics. Se conservan los 357 grupos y los artefactos numéricos. Claude confirmado USD 1.042910 más reserva terminal USD 1.6818: exposición USD 2.724710. No hay llamadas en vuelo en ese cierre.

El operador excluyó nuevas llamadas Opus y eligió Sonnet 4.6. Worker UAT tiene interpretación deshabilitada, comprobada en ec6e6773-44c9-4946-8e04-39261b8954ab. Se continúa mediante la entrega focal [Sonnet 4.6](DELIVERY_SONNET_46_2026-09-09.md), todavía local. La instrucción histórica de seguir dispatch 5 ya no aplica. No repetir SQL0142 ni reenviar Opus.
