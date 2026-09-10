# Embeddings de corpus completo — corte focal, 8 septiembre 2026

Estado: **Studio UAT `561ecc3c1c5e03f1a6fbba292c8ca1f38c30e0d6` y Worker UAT `67569e991e2ba027d7fa78581739783686092bf5` comprobados.** Verificación final por UI terminada. No se ha ejecutado el proveedor sobre National.

Commit `67569e991e2ba027d7fa78581739783686092bf5`, 29 archivos propios sobre `bed52d9`. Los tres archivos ajenos de contract-drafts conservan sus hashes y quedaron excluidos. Push sólo a la rama focal UAT; producción intacta.

SQL0133 aplicado transaccionalmente en UAT a las 12:48:21.126 UTC. SHA256 `2a9dd1916bfbbce1f58fadc2bc61d29d8c5354d80dc7108556d16bd5c6e440ab`, tres tablas privadas con RLS. La primera invocación desde `/app` falló al resolver `pg`, antes de ejecutar SQL; se ejecutó desde `/app/apps/studio` y el recibo confirma COMMIT. No se reaplicaron SQL0131/0132. Studio y Worker verificaron el flag de proveedor en false antes del despliegue.

Corrección focal posterior `561ecc3c1c5e03f1a6fbba292c8ca1f38c30e0d6`: la cotización real de National supera el máximo configurado de USD5. El panel muestra la causa junto al costo en ES/EN y diferencia límite propuesto de ejecución aceptada. También deja de afirmar que existe conciliación automática de unknown aún no implementada. Sólo cuatro archivos de Studio; el Worker conserva67569e9 porque Railway omitió el corte sin archivos observados modificados. Sin nueva DDL ni cambios de backend.

## Cambio útil

El panel de preparación existente incorpora cobertura, cotización local y límite explícito de ejecución. El corpus preparado alimenta una ejecución de embeddings completa y recuperable mediante la cola Data OS, sin `study_corpus` de puente y sin truncamiento de población/texto. La caché se limita al workspace y al perfil compatible. Un nuevo import puede reutilizar fragmentos sin convertir menciones parcialmente procesadas en completas.

Respuesta e importe observados sobreviven a fallos locales y a revocación posterior de permisos/derechos. Una respuesta persistida se reanuda sin reenviar; un resultado desconocido retiene reserva y bloquea duplicados. La interfaz recupera la key propia tras recarga y no usa la última ejecución de otro actor como confirmación. El proveedor queda deshabilitado: consultar cobertura/costo no cobra ni crea una ejecución pagada.

## Evidencia

- Root typecheck y lint:11/11. Lint conserva15 warnings,0 errores.
- Query Engine:387/387. Studio inicial:625 PASS/5 SKIP y build PASS; corrección de límite:627 PASS/5 SKIP, root typecheck/lint11/11 y build PASS. Worker:243 PASS/3 SKIP. DB estándar:230 PASS/39 SKIP; los5 tests PG nuevos se ejecutaron aparte con5 PASS/0 SKIP.
- PostgreSQL/BullMQ local real, transporte simulado:50,002 menciones,55,519 fragmentos completos, documento con5,358 fragmentos.50,012 inputs únicos en395 llamadas simuladas;5,507 reusos. Corrida inicial103s; recorrido de integración145s. No es medición de capacidad de2millones ni latencia del proveedor.
- Crash después de recibo durable: nueva intención reanuda el mismo run/cap/cursor sin repetir ese lote. Segundo recorrido100% caché sin proveedor. Replay exacto, cuerpo cambiado409, lookup por actor y bloqueo de unknown comprobados.
- PG contractual: revocación de actor/derechos después del envío conserva costo y no escribe caché/cursor; malformed/unknown/overage retienen evidencia; fallo comprobado antes del envío libera reserva; modelo falso se rechaza; salida inválida con uso conocido se contabiliza; seals SQL de keys/cap y RLS.
- Caché efímera local acotada:234,999bytes/161fragmentos cruzan dos páginas con una lectura del texto; máximo un activo de16MiB por job, sin caché global.
- Navegador local:10 escenarios aprobados. ES escritorio y EN390px observados, sin overflow. Incluye doble clic, recarga, misma key/cuerpo, conteos parciales, no polling terminal tras cambio de idioma, unknown sin reenvío y403 que descarta POST tardío.

Recibos de código/PG/Worker/migración: `.data/workspace-embeddings-2026-09-08/` del worktree focal. Evidencia de navegador local y handoff de Frontend: mismo subdirectorio del repositorio documental. El proveedor simulado sólo produjo datos en PostgreSQL local aislado; sus microUSD no son gasto real.

## Cotización real de National

GET de estado200: actor interno autorizado, proveedor no disponible, ninguna ejecución activa ni histórica. El clic normal en Calcular costo devolvió200 en526ms sobre el run preparado `ea577ad4-06ac-4752-9a6e-49237a122bbd`:6,826menciones,20,821referencias y fragmentos de activos,0en caché,22,632,827bytes de texto en activos pendientes. Cota conservadora8,328,543microUSD = USD8.328543; máximo configurado del servidorUSD5. No son tokens exactos ni gasto realizado. No se modificó el máximo ni se inició una ejecución.

ES/EN de esa cotización observados en UAT. DOM emulado 390px sin overflow; la captura del navegador integrado presenta un problema de escala y no constituye evidencia visual de móvil físico. La evidencia visual local ES/escritorio y EN390px sí fue inspeccionada. Idioma es-MX y viewport normal restaurados.

En el HEAD final 561ecc3 se repitió sólo el clic de cotización afectado por el ajuste: muestra «Límite propuesto: USD 8.328543», causa explícita del máximo disponible USD 5.00 y ejecución deshabilitada. Consola sin errores/warnings; captura final de escritorio inspeccionada. Recibos `uat-final-delivery.json` y `uat-final-es-desktop.png` en el directorio focal de evidencia. Deploy Studio `48059993-f893-4ad8-ae85-5b3a64c8b39d`; Worker `570b2dee-07be-4a3c-8e63-23d61ebae7af`. SHA final de Studio comprobado desde el enlace del deployment; el follow-up del Worker fue SKIPPED por no cambiar archivos observados.

## Límites y siguiente paso

National mantiene16CSV/9,131filas y su preparación real anterior de6,826menciones elegibles. Este corte todavía no prueba embeddings reales, clasificación masiva, BERTopic, interpretación Claude ni Signal nuevos. La respuesta pendiente sobre la zona de exportación SentiOne sigue siendo necesaria antes de reparar fechas o analizar ese corpus; no se repite la pregunta.

NOI-81 registra resolución self-service de respuestas/costos inciertos antes de activar ejecución pagada en producción. NOI-19 conserva acceso integral cliente y NOI-80 retirada física/retención de derivados. NOI-31/78 siguen abiertos por clasificación, descubrimiento e incrementalidad del Compass.

Siguiente trabajo de código: consumir la caché completa en la clasificación y el descubrimiento del workspace, con representaciones de todas las partes de cada mención, intereses/Brand OS como guía y ejecución incremental verificable. Reutilizar los métodos existentes y probar localmente sin proveedores; no convertir el fixture de50k o una muestra en la población del producto. Una futura llamada real requiere caso y tope propios.

Saldo sin cambios: producto USD11.362961; Advisor USD1.343826. Cero llamadas pagadas nuevas.
