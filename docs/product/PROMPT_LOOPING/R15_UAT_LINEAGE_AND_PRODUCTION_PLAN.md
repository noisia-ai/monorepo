# R15 · procedencia de UAT y plan de release a producción

Fecha de corte de Git: 2026-11-09. Esta nota compara referencias de Git y archivos versionados. No registra nombres, corpus, credenciales, identificadores ni resultados de estudios.

## Línea UAT y destino de sus commits

La cabeza desplegada de UAT examinada es `2e9bd62e`. Desde `origin/develop` en `03be153f`, `git rev-list origin/develop..2e9bd62e` encuentra **17 commits exclusivos y cero merges**. La rama avanzó después a `59b7375f`, con 18 commits exclusivos en total. Su único commit adicional, `59b7375f`, registra aceptación de navegación y no estaba desplegado en UAT. Se conserva como evidencia histórica, fuera del inventario de cambios ejecutados.

| Commit exclusivo de la rama UAT | Cambio registrado | Destino en la línea vigente |
|---|---|---|
| `fad0cd0d` | Cierre de política de un manifiesto de interés V2 | Descartar el apunte como estado histórico de UAT. No cambia la ruta de etiquetado aceptada en R14. |
| `f7394045` | Tratar HTTP 402 y 429 del proveedor como rechazos explícitos | Superado por `5ba91c5f` en develop. La migración 0219 coincide byte a byte entre ambas referencias. El transporte vigente reconoce ambos estados. |
| `3460b5e3` | Reconciliar un Batch ausente antes de reintentar | Superado por `757f9b31` en develop. La migración 0220 coincide byte a byte y el lector de recuperaciones vigente reconoce la reconciliación de inventario. |
| `bd860f0a` | Mostrar lotes preparados y recuperables en la vista de intereses | Superado por el contrato vigente de intereses, que devuelve ambos conteos, y por la ruta de Topics que presenta sus controles. |
| `d6b34812` | Mantener pendiente la publicación de intereses durante una evaluación de calidad | Descartar la retención de evaluación como estado histórico. R14 ya fijó las definiciones de intereses y el umbral editable por estudio. |
| `b9051918` | Preparar un constructor V3 de solicitud de decisión | Superado por `62a9516d` en develop. El constructor y la prueba de identidad forman parte de la rama vigente. |
| `41e00534` | Anotar el límite de tamaño de una prueba V3 | Descartar el recibo de una corrida de UAT. No es configuración de producto. |
| `31247614` | Precisar límites de cohortes diagnósticas | Descartar la nota de evaluación, que describe evidencia y alcance temporales de UAT. |
| `aaeca87d` | Registrar una muestra independiente de desafío | Descartar el apunte histórico. No incorporar resultados ni identificadores del estudio a documentación versionada. |
| `0d71953c` | Delimitar una evaluación de consentimiento para un producto | Descartar la nota específica de evaluación. No cambia el clasificador general de R14. |
| `3e0a3e2f` | Exigir identidad exacta del producto en V3 | Superado por `937630d4` en develop y por la prueba correspondiente. |
| `2445d020` | Sacar diagnósticos costosos del camino de importación | Superado por la página actual de datos, que difiere la preparación de gobernanza mediante `LazyGovernancePreparation`. |
| `9f1897d6` | Registrar latencia de importación en UAT | Descartar la medición histórica; no es un contrato de producto. |
| `ae70a192` | Quitar una segunda representación del resumen de corpus | Superado por la composición actual de importación y preparación del corpus. La página usa los componentes vigentes de importación y estado del corpus. |
| `1c39cc32` | Registrar aceptación y tiempo de carga de importación | Descartar el recibo histórico de UAT. |
| `453c94a8` | Priorizar intereses definidos en Topics | Superado por la lista actual, que coloca temas manuales antes del catálogo anterior y los agrupa cuando corresponde. |
| `2e9bd62e` | Mejorar legibilidad del título de interés | Superado: las dos reglas CSS del cambio están presentes en develop. |
| `59b7375f` | Registrar aceptación de navegación de intereses después del despliegue UAT | No pertenecía a los 17 commits ejecutados en UAT. Conservar el registro como historial de la rama, sin atribuirlo a la versión desplegada. |

La similitud de nombres de archivos no basta para migrar una rama antigua. Los commits con cambios de producto tienen sus equivalentes o comportamiento absorbido en la arquitectura actual. Los restantes guardan estado temporal de pruebas o decisiones ya reemplazadas. La rama UAT completa no se fusiona a develop.

## Divergencia entre develop y main

En el mismo corte, `git rev-list --left-right --count origin/main...origin/develop` devuelve **69 commits exclusivos de main y 1,034 exclusivos de develop**. La diferencia neta es 965. Por tanto, la cifra preliminar de 987 commits de develop no coincide con las referencias Git examinadas. El corte debe repetirse al preparar el release, después de congelar SHAs de main y develop. Los 69 commits exclusivos de main requieren inventario y reconciliación antes de un merge de release. Este plan no propone mover develop directamente a main.

El 10 de noviembre de 2026 se repitió el conteo entre `main` en `6ff84434` y `develop` en `b9dbd456`. Git devolvió **75 exclusivos de main y 1,085 exclusivos de develop**. El inventario para producción deberá cubrir los 75 de este corte y los que se incorporen hasta la congelación de las ramas.

El 11 de noviembre se repitió la lectura tras integrar el cálculo de candidatos de R15. Entre `main` en `c0ee9326` y `develop` en `004e4331` había 85 commits exclusivos de main y 1,105 exclusivos de develop. Entre las incorporaciones de main figuran cambios del kit de estudios y vídeo, del sitio y de las firmas de correo. Se volverá a calcular la diferencia al fijar el candidato de producción.

## Plan de producción · escrito, no ejecutado

1. Congelar las referencias exactas de main y develop; enumerar commits de ambos lados, incluyendo todos los exclusivos de main del corte congelado. Asignar a cada cambio destino equivalente en develop, PR de portado con revisión y CI, o descarte documentado. Resolver conflictos de producto antes de formar el candidato.
2. Consultar en modo estrictamente de lectura cada ledger disponible y comparar identificadores y checksums. En el corte R15, el ledger Drizzle de producción contiene 25 entradas, hasta 0024. Develop contiene 56 entradas Drizzle hasta 0055. Las entradas 0025–0055 no aparecen en el ledger productivo. De las 25 entradas existentes, 23 hashes coinciden con develop. Los hashes de 0014 y 0023 coinciden con las variantes de main. El catálogo consultado contiene nombres y columnas de 47 relaciones, 199 índices, 93 funciones y 210 constraints. Las consultas de triggers y enums públicos devolvieron cero filas. De las 47 relaciones, 46 tienen una declaración CREATE TABLE correspondiente en el SQL versionado; la restante es el registro de migración managed.

   Se cotejaron los 241 archivos SQL canónicos numerados entre 0025 y 0285 contra el catálogo. En 223 archivos, al menos un objeto estático declarado no aparece en el catálogo actual. Sus versiones son 0034–0113, 0115, 0122–0129, 0131–0157, 0159–0167, 0170–0179, 0181–0182, 0184–0226, 0228, 0231–0233, 0237–0238, 0240–0243, 0250–0252, 0254–0269 y 0271–0285. En 8 archivos, los nombres de objetos estáticos detectados sí existen, lo cual no demuestra que las definiciones vigentes sean iguales. Otros 10 incluyen DDL dinámico o alteraciones que el catálogo no permite verificar por definición o contenido. Ciento treinta y tres archivos incluyen sentencias de modificación de datos, cuyos efectos no son visibles en este inventario estructural. El extractor usa el AST PostgreSQL de pglast v8.3 para ALTER TABLE, ADD COLUMN, ADD CONSTRAINT y columnas citadas. Parseó los 241 archivos sin error. Las regresiones confirmaron que 0025 no fabrica columnas llamadas constraint y que 0031/0032 detectan y encuentran presentes sus columnas citadas. La matriz privada registra el resultado por archivo y hash del SQL. El catálogo de tipos sólo cubre enums públicos; las demás clases de tipo requieren inspección adicional.

   Estas ausencias prueban que los objetos concretos no figuran en el catálogo observado. Por sí solas no prueban que el archivo entero nunca se ejecutó, pues pudieron existir rollbacks, sustituciones o cambios manuales. La diferencia 0025–0055 es directa para el ledger Drizzle. Para las migraciones numeradas 0025–0285, la matriz clasifica presencia/ausencia de objetos, pero no sus efectos DML ni definiciones no incluidas en el catálogo.
3. Antes del cambio, solicitar una copia íntegra de la base de producción con cifrado, control de acceso y retención aprobada. Registrar fecha, tamaño y checksums fuera del repositorio. Restaurar en una base temporal aislada, comprobar tablas, extensiones, secuencias, permisos y lecturas de Signal. No ensayar sobre producción.
4. Aplicar la lista exacta de migraciones pendientes en la copia temporal. Verificar el ledger, constraints, índices y consultas críticas. Comparar muestras agregadas y la salud de Signal con el estado anterior. Ejecutar las pruebas de release sobre la copia.
5. Preparar una reversión ensayada. Congelar ingestión y trabajos de escritura durante la ventana; si una migración no es reversible de forma segura, restaurar la copia validada con una estrategia de recuperación aprobada antes de abrir escrituras. Mantener artefactos y registros privados.
6. Proponer una ventana con menor tráfico, duración estimada a partir del ensayo, responsables de aplicación y observación y una hora de decisión para abortar. La aprobación expresa del fundador debe preceder cualquier cambio de producción. Este documento no autoriza ni ejecuta dicho cambio.

### Ledger de producción

**Comprobación en lectura, con límite estructural.** El ledger Drizzle reporta 31 entradas ausentes respecto de develop (0025–0055), y dos hashes aplicados que coinciden con main, no develop. El cotejo del catálogo encontró objetos declarados ausentes en 223 de los 241 archivos SQL numerados 0025–0285. La matriz privada conserva el cotejo por archivo y las huellas. Los efectos DML, los defaults y tipos de columnas, y las definiciones de funciones siguen requiriendo evidencia específica. Pregunta abierta para el release: ¿qué ledger o introspección read-only permite demostrar el estado de esos efectos? No se presenta 31 como total de todas las migraciones pendientes ni la ausencia de un objeto como prueba aislada de que nunca se ejecutó su archivo.

## Evidencia del cotejo

La comparación se hizo en Git con las referencias remotas obtenidas para este corte, `git rev-list`, `git cherry`, inspección de los commits exclusivos y lectura de los módulos equivalentes en develop. El ledger y el catálogo productivo se consultaron en modo de solo lectura y quedaron en custodia privada. La matriz `production-migration-gap-audit.json` coteja los 241 archivos por versión y SHA-256 contra la instantánea de catálogo. Sus hallazgos miden presencia de objetos, no la historia de ejecución ni efectos DML. Los blobs de las migraciones `0219_signal_interest_decision_explicit_rejections.sql` y `0220_signal_interest_decision_provider_inventory_reconciliation.sql` son idénticos en ambas referencias: `09720f6a4d989041859eeef96050159f030cf9ec` y `5659ca0b07894b618a1621620c7ec84e3206eb30`, respectivamente.

En la integración `13b6330c` se cotejaron también los cinco archivos 0286–0290 con la misma lectura del catálogo de producción. En los cinco falta al menos una firma de objeto. Cuatro contienen cambios de datos y tres contienen DDL dinámico. Al preparar el ensayo habrá que contrastar esos efectos con el respaldo restaurado. El suplemento privado conserva los cinco hashes SQL y las firmas por archivo. Su SHA-256 es `2efc99e862bb0d8069ce6d9a23571155fa8b080cfe7afba7a2df62ed9cf804f1`.

La integración `704da339` añade la migración 0291. La consulta de catálogo en producción encontró las tablas de importaciones y menciones. Las dos funciones que reemplaza 0291, sus siete funciones auxiliares comprobadas y cuatro relaciones de Signal estaban ausentes. El recibo privado vincula esa observación a los bytes de SQL del commit integrado, con SHA-256 `4d41edda4c506453dfaf29cea4a68d6033f2f569ad77501e87ceaea0b410667e`. El ensayo de producción deberá preparar primero esas dependencias y comprobar el cierre transaccional con un archivo de tamaño representativo.

La integración `99f8bcff` añade la migración 0292 para recuperar una consolidación pagada. En la consulta de catálogo del 11 de noviembre a las 03:48 UTC, PostgreSQL confirmó una transacción de sólo lectura. Producción tenía la tabla de costes. Faltaban la función que verifica la decisión de recuperación y las tablas de decisiones, ejecuciones de tópicos y admisiones de procesamiento. El ensayo de un futuro corte deberá incorporar las dependencias históricas antes de comprobar la recuperación sin gasto sobre una copia. El SHA-256 del SQL integrado es `a5ec78835b3a22bc5aca0113965de0d2ea67d34337da722d861390f8aa52167e`.
