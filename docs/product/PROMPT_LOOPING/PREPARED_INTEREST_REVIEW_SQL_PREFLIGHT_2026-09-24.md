# Prevalidación PostgreSQL de revisión de intereses — preparada, NO ejecutada

24 septiembre 2026, heartbeat12:23UTC. Continúa Compass, la preparación19a7e26 y sus límites; no sustituye la historia ni representa entrega UAT.

## Resultado concreto

Se preparó un ejecutable privado de ensayo de SQL0183 con el destino, comprobaciones de identidad/esquema, transacción reversible y helpers existentes. Agrega una aprobación específica y un manifiesto que fija los bytes de0183. El sello privado sigue vacío en system_identifier/schema_sha256: no se inventaron valores ni se consultó el servidor.

El runner exige exactamente299 tablas públicas vacías de0182, funciones esperadas, ausencia completa de0183, DNS privado y el servicio/rol/base ya fijados. Excluye variables de conexión alternativas y credenciales de proveedores, bloquea HTTP antes de cargar fixtures, rechaza event triggers habilitados y serializa con el advisory lock compartido. Sólo entonces instalaría0183 dentro de una transacción; nunca COMMIT. El cierre exige ROLLBACK físico, nueva lectura vacía y mismo sello de esquema antes de emitir PASS. Un fallo no se reintenta.

Los ocho casos escritos para el motor real cubren: instalación/trigger; configuración/digests; trim/orden/UTF16; normalización de definiciones; límites y definiciones inválidas; RLS/ACL; actor/fuente ausentes; cero preparaciones, políticas pagadas, ejecuciones, cola o costos. El caso de permisos usa identidades inventadas del fixture existente, con provisioning real y rollback; no carga corpus de marcas reales ni reemplaza funciones SQL.

El recibo declara expresamente acceptance_scope=ddl_contracts_negative_paths_only y full_preparation_acceptance=false. **Estos ocho casos todavía no se ejecutaron en PostgreSQL.** Ni siquiera su futuro PASS acreditará una preparación positiva completa.

## Lo que esta tarea no demuestra

No hay fixture ya listo que conecte contexto semántico publicado y fuente numérica actual para preparar una revisión válida0183. No se falsificó ese estado. Siguen pendientes prepare/load/replay exitosos, modificación de fuente/catálogo sobre una preparación existente, matriz completa contra grupos persistidos, concurrencia y recuperación tras commit.

La admisión pagada y checkpoints PostgreSQL continúan pendientes. Se eligió preparar verificación antes de añadir más DDL transversal a owners/dispatch/configuración. No hubo nueva migración, modificaciones0183, ampliación de permisos viejos ni cambios al ledger. Ningún consumidor o UI promete clasificación final.

## Comprobaciones locales

- Dieciocho pruebas de guards PASS (doce existentes afectados por el guard compartido y seis nuevas). Incluyen rechazo del ejecutable antes de DNS/PG con identidad no sellada; el error no muestra datos sensibles.
- Suite DB621PASS/98omitidos/cero fallos. Los omitidos y el nuevo archivo de assertions sin ejecución no se cuentan como aceptación PostgreSQL.
- Typecheck/lint raíz11/11PASS; trece warnings previos, cero errores. Carga TypeScript del helper sin ejecutar SQL y sintaxis del runner correctas; diffcheck limpio.
- Revisión independiente detectó que la primera versión comprobaba rollback antes de llamar cleanup. Root movió cleanup antes de verificar y cubrió ese orden en la prueba. Revisión final sin P0/P1/P2 reproducibles; SQL y comportamiento remoto siguen pendientes.

Evidencia: .data/interest-preflight-2026-09-24/. Ningún SQL, conexión real, proveedor, grant, import, embedding, fit o gasto nuevo. No se ejecutó UI/build, porque este corte no cambia la interfaz ni runtime desplegado.

## Siguiente trabajo delimitado

Preparar el fixture positivo completo sin ejecutarlo hasta corregirPG. Reutilizar el seed de contexto semántico publicado de signal-workspace-operational-profile.assertions.ts y syntheticClientWorkspaceFixtureV1; luego request/claim del control0175, materializeSignalTopicAtomicCensusV1 y materializeSignalTopicCommunityPlanV1 con datos numéricos sintéticos explícitos, y finalizar lease/control ready mediante mecanismos reales. Crear interés manual y cargar entrada por el lector actual. No afirmar que números sintéticos prueban BERTopic real. workspaceProjectionFixtureBodyV1 no contiene por sí solo el bundle completo del worker de consolidación: no etiquetarlo como aceptación de ese worker.

Con ese fixture añadir casos prepare/load/replay, drift, aislamiento y evidencia a una etapa de aceptación completa independiente. Mantener separado el preflight aquí preparado; no cambiar su scope a completo hasta que exista la composición íntegra. No reabrir los mapas BrandOS→guías y candidatos→clasificación ya cerrados ni crear otro ledger. Si no es posible un corte verificable, conservar pendientes concretos y no debilitar guards para continuar.

## Estado operativo

La conexión dev-test conserva28P01 previo a SQL; causa credencial/encoding no comprobada. Operador ya avisado, sin respuesta nueva: NO reintentar ni modificar contraseña por UI. Se conserva readonly/autodeployOFF y el start command actual; este runner nuevo no se configuró ni desplegó. README contiene su futura invocación y aclara que no debe ejecutarse ahora.

Signal importado a881d21 sigue LOCAL y requiere sus seis escenarios privados, además del recibo readonly/sellos/upgrade vacío explícito si procede. UATa42b9b4, Workeroriginal0b68b3e0 y Laika se conservan sin nuevas consultas; Alexa+43,159/Topic67 es la comprobación previa, no otra lectura de este turno. Linear sigue sin reconexión; no se inventaron updates. Loop continúa con esta continuidad y sin renovación de autoridad de gasto.
