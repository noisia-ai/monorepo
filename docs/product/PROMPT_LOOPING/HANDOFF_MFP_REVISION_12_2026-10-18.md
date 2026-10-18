# MFP — entrega para revisión 12 (18 de octubre de 2026)

El contrato sigue siendo el spec v1.3 y la auditoría §§17–18. Este recibo distingue código, pruebas y recorrido real; ninguna medición pendiente se presenta como entregada.

## Estado integrado

- La auditoría §§17–18 quedó versionada en el PR #32 (`e0d88141`), sin datos privados del estudio. CI465 y PostgreSQL200 verdes.
- #58 se fusionó a `develop` (`9b0ec743`) tras CI472/PG207 verdes; #59 se fusionó después (`0fdb75ef`) tras CI480/PG215 verdes. Son experimentos apagados: ningún workspace selecciona H1 por defecto.
- La interrupción entre INSERT de menciones y escritura de procedencia se reprodujo con PostgreSQL real (PG211 rojo esperado). #65 corrigió la recuperación usando el origen durable del lote y se fusionó a `develop` (`8c9a1107`) tras CI484/PG219 verdes. La prueba preserva los duplicados de otros imports y el censo tras rollback.

## R10 (#57, sin fusionar)

El escritor de respuestas almacenadas y la etiqueta de Signal pasaron CI475/PG210; la rama integrada `c1989e79` pasó CI488/PG223. Studio y Runner dev-test se fijaron a ese mismo commit y respondieron salud HTTP 200 con 22 hashes de runtime coincidentes. La migración 0268 se aplicó una vez, comprobando preimagen y postimagen `prosrc` del lector (`687909…`). Se aplicaron las 9 respuestas ya almacenadas: al repetir, la operación fue no-op; 791 fichas previas y ledger quedaron idénticos. Quedan 101 casos de la primera carga y el recorrido UI hasta la segunda carga. No se enviaron llamadas nuevas ni se tocó R4/R8.

## Juez v3 (#66, sin fusionar)

El PR separa identidades `low` y `medium`, formaliza las decisiones confirmadas del fundador en Cobros v5 y conserva la ruta estándar como default. CI486/PG221 verdes sobre el código. Definiciones v5 aún no instaladas y brazos de 1,086 raíces aún no ejecutados; sin revisión ciega ni costo nuevo. La lectura actual del saldo Anthropic sigue pendiente antes de cada brazo.

## Estudio real A (cerveza, Brasil)

La marca y el contexto se crearon por UI en dev-test, con alcance de corpus global y zona UTC. Nueve archivos del corte 1 terminaron con 110,280 filas recibidas; el décimo falló tras 2,000 filas y el undécimo no se envió. El censo privado del fallo identifica 480 raíces sin procedencia (349 incluidas y 131 excluidas). #65 ya está en la build fijada; el reintento desde el archivo almacenado y el censo posterior están en curso. No se han ejecutado vectores, fichas, pertenencia ni consolidación pagadas.

La política vigente de la organización compartida ofrece acciones MFP, pero le faltan las dos acciones clásicas de Brand Context. Habilitar MFP cambiaría la población de descubrimiento y consolidación a fichas, incompatible con este paso. #67 prepara una activación explícita por UI para administradores internos sin cambiar features; #68 prepara topes opcionales para esas acciones sin convertir el presupuesto orientativo en máximo. Ambos siguen draft y exigen CI/PG y revisión antes de activarse. No hay una vía manual legítima que sustituya la preparación semántica.

Los estimadores, la comparación con la taxonomía del estudio, los tiempos y los costos reales esperan el cierre del import y la política. El corpus completo se proyectará sobre aproximadamente 1.04 millones de filas como hipótesis; el subconjunto SentiOne compatible se declarará por separado. Nombres, archivos, textos, identificadores, citas y censos detallados permanecen sólo en `.data/` privada.

## Puertas vigentes

Claude y Voyage no muestran un saldo actual en las sesiones disponibles. Ninguna etapa pagada debe empezar sin leerlo; no se compran créditos. Las 101 respuestas de R10, los brazos v3 y vectores/temas del estudio continúan en espera. Studio y Runner sólo se operan en dev-test; UAT y producción no se han tocado. Presupuestos orientativos: registrar costo observado por etapa cuando haya ejecución.
