# Preparación recuperable del corpus — recibo UAT

8 septiembre 2026. **Estado: entregado y comprobado en UAT Studio + Worker `bed52d9`.**

## Cambio entregable

Desde Datos recibidos, el operador solicita preparar todo el texto elegible de sus importaciones aceptadas. La UI muestra avance persistente y diferencia texto preparado de análisis. La cola Data OS existente ejecuta el manifiesto fijo, fragmentación íntegra y checkpoints. Importaciones posteriores, correcciones y derechos invalidan la generación; se reutilizan activos de texto compatibles.

No hay límite global de 50 mil menciones, 900 caracteres ni 80 fragmentos. Páginas de hasta 100 raíces/6 MiB de texto pendiente, con un documento mayor íntegro por lote. No es un límite RSS. No se crea un study_corpus ficticio ni se llama a modelos.

## Artefactos y verificación local

Commit focal `bed52d9bdea7d72f986e994bc13d0a8f1ee260a7`. SQL0132, checksum `eb35e91fb46049edc383cf54efc5900a1188d18d6848a8f283d5917b9b06740d`, aplicado sólo en UAT el 8 septiembre a las 11:53:15 UTC; cuatro tablas privadas con RLS. Se transportó SQL revisado, se verificó hash antes de conectar y se aplicó en transacción. Producción intacta.

Root typecheck/lint 11/11; DB 230 PASS/34 SKIP, Worker 230 PASS/3 SKIP, Studio 606 PASS/5 SKIP y build verde. Los saltos de PostgreSQL del comando estándar no son evidencia PG: las pruebas reales se ejecutaron aparte contra PostgreSQL/BullMQ locales.

PG + BullMQ: 50,001 raíces y 50,161 fragmentos completos, interrupción tras checkpoint, reintento, jobs perdidos/retenidos, segunda carga 50,002 con 50,001 reutilizados, cambio concurrente de fuente, actor revocado y frontera temporal. Documentos de 4 MiB y 7.5 MB reconstruidos íntegros. Primera ejecución bulk 21.6 s frente a 163.7 s; actualización de estadísticas de las dos tablas derivadas añadió 186 ms medidos por separado. No promete rendimiento de dos millones ni UAT.

UI real del componente con transporte simulado: diez casos observados por root; respuesta perdida conserva clave, doble clic, progreso, nueva carga, 503, 403 y desmontaje. Revisión independiente final: sin P0/P1/P2 concretos. Tres archivos ajenos contract-drafts preservados y excluidos del commit.

## Aceptación real de National

Studio `5e3db838-2e3a-47d3-882f-5152f6f8319b` y Worker `103b49e4-9319-476a-b097-6ec1529ec85f` activos con el SHA exacto. Health profundo200 y log de Worker confirma Data OS y job completado.

Acción normal de UI **Preparar texto**, POST202 en 611 ms. Run `ea577ad4-06ac-4752-9a6e-49237a122bbd`, revisión1, creado 12:00:01.419448 UTC y completado 12:01:15.530930 UTC (74.11 s). Recarga durante ejecución recuperó avance de200 a3,400 del mismo denominador7,396. No se inició otra solicitud para continuar.

| Resultado | Cantidad |
|---|---:|
| Raíces recorridas | 7,396 / 7,396 |
| Menciones elegibles preparadas | 6,826 |
| Excluidas según datos existentes | 570 |
| Bloqueadas por derechos / texto faltante elegible / inclusión pendiente | 0 / 0 / 0 |
| Fragmentos íntegros registrados | 20,821 |

GET terminal `is_current=true`, `needs_preparation=false`, sin run activo ni error. UI muestra **Texto preparado** y aclara que falta análisis. Los16archivos/9,131filas se conservaron, y ocho competidores sin archivos no bloquearon la preparación. Se preparó todo el texto elegible almacenado, no una muestra. Las570exclusiones no son pérdida de texto; una de esas raíces ya carecía de texto antes del corte.

QA remoto: estados inicial/progreso/completado, recarga durante y después, español e inglés renderizados con los mismos conteos, viewport390 y740 sin overflow (anchos de documento390/740). Captura de escritorio revisada; la captura emulada móvil de CUA tiene escala/densidad inconsistente y no se usa para afirmar fidelidad visual de un dispositivo físico. Preferencia original es-MX y viewport normal restaurados. Consola actual sin errores. La primera recarga tras desplegar volvió al Dashboard por la sesión y se recuperó mediante navegación normal; la recarga posterior durante el trabajo conservó National y su progreso, sin cambiar auth.

## Alcance restante del Compass

Preparar texto no produce embeddings, clasificación semántica, clusters BERTopic, interpretación Claude ni Signal. Esas etapas deben consumir la generación vigente con versiones, permisos, cobertura y costo propios. Siguen pendientes la guía Brand OS/Topics aplicada al cálculo, descubrimiento emergente incremental y Signal multiámbito.

La zona SentiOne sigue pendiente de la pregunta ya presentada. No se infirió respuesta ni se repararon fechas/reimportaron archivos de National. Retención/retirada material de activos compartidos es NOI-80; invalidar uso no borra contenido. No se ejecutó limpieza.

Cero llamadas pagadas. Saldo mínimo producto USD11.362961 y Advisor separado USD1.343826, intactos. Los controles legacy de gobernanza y acceso integral cliente mantienen sus tickets; no se declara producto listo para producción.

## Operación y retirada

Retirar código requiere detener su drainer y conservar registros/resultados; no DROP ni vuelta de datos. Redis transporta, PostgreSQL conserva intención/checkpoint. API valida can_view/can_import_mentions por workspace y Worker vuelve a comprobar autoridad. Este corte no amplía ejecutar modelos ni publicar.

Evidencia privada focal: `.data/workspace-corpus-preparation-2026-09-08/`; [decisiones y ejecución](./CORPUS_PREPARATION_EXECUTION_2026-09-08.md), [ADR020](../../adr/020-workspace-corpus-text-preparation.md). No cargar logs históricos ni secretos.
