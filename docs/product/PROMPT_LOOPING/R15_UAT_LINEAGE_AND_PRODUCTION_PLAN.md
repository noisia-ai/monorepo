# R15 · procedencia de UAT y plan de release a producción

Fecha de corte de Git: 2026-11-09. Esta nota compara referencias de Git y archivos versionados. No registra nombres, corpus, credenciales, identificadores ni resultados de estudios.

## Línea UAT y destino de sus commits

La referencia de UAT examinada es `codex/interest-membership-2026-10-02`, con cabeza `2e9bd62e`. A partir de `origin/develop` en `03be153f`, `git rev-list origin/develop..codex/interest-membership-2026-10-02` encuentra **18 commits exclusivos y cero merges**, no 17. El recuento incluye la cabeza. Se registran todos para que el despliegue pueda sustituirse sin perder el historial.

| Commit UAT | Cambio registrado | Destino en la línea vigente |
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
| `59b7375f` | Registrar aceptación de navegación de intereses | Descartar el recibo de navegación de UAT; el código de navegación vigente se mantiene en producto. |

La similitud de nombres de archivos no basta para migrar una rama antigua. Los commits con cambios de producto tienen sus equivalentes o comportamiento absorbido en la arquitectura actual. Los restantes guardan estado temporal de pruebas o decisiones ya reemplazadas. La rama UAT completa no se fusiona a develop.

## Divergencia entre develop y main

En el mismo corte, `git rev-list --left-right --count origin/main...origin/develop` devuelve **69 commits exclusivos de main y 1,034 exclusivos de develop**. La diferencia neta es 965. Por tanto, la cifra preliminar de 987 commits de develop no coincide con las referencias Git examinadas. El corte debe repetirse al preparar el release, después de congelar SHAs de main y develop. Los 69 commits exclusivos de main requieren inventario y reconciliación antes de un merge de release. Este plan no propone mover develop directamente a main.

## Plan de producción · escrito, no ejecutado

1. Congelar las referencias exactas de main y develop; enumerar commits de ambos lados, incluyendo los 69 exclusivos de main. Asignar a cada cambio destino equivalente en develop, PR de portado con revisión y CI, o descarte documentado. Resolver conflictos de producto antes de formar el candidato.
2. Consultar en modo estrictamente de lectura cada ledger disponible y comparar identificadores y checksums. En el corte R15, el ledger Drizzle de producción contiene 25 entradas, hasta 0024. Develop contiene 56 entradas Drizzle hasta 0055. Las entradas 0025–0055 no aparecen en el ledger productivo. De las 25 entradas existentes, 23 hashes coinciden con develop. Los hashes de 0014 y 0023 coinciden con las variantes de main. En las 47 relaciones públicas de producción, 46 nombres coinciden con tablas declaradas por el SQL canónico; la restante corresponde al registro de migración managed. Este inventario da presencia de objetos y filas del ledger, pero no compara columnas, constraints o índices y no demuestra la aplicación de las 266 migraciones numeradas del conjunto SQL canónico. Para esa lista falta una lectura que exponga su ledger completo o un volcado estructural verificable. Registrar el mecanismo, estado y checksums antes de calcular una lista completa de pendientes.
3. Antes del cambio, solicitar una copia íntegra de la base de producción con cifrado, control de acceso y retención aprobada. Registrar fecha, tamaño y checksums fuera del repositorio. Restaurar en una base temporal aislada, comprobar tablas, extensiones, secuencias, permisos y lecturas de Signal. No ensayar sobre producción.
4. Aplicar la lista exacta de migraciones pendientes en la copia temporal. Verificar el ledger, constraints, índices y consultas críticas. Comparar muestras agregadas y la salud de Signal con el estado anterior. Ejecutar las pruebas de release sobre la copia.
5. Preparar una reversión ensayada. Congelar ingestión y trabajos de escritura durante la ventana; si una migración no es reversible de forma segura, restaurar la copia validada con una estrategia de recuperación aprobada antes de abrir escrituras. Mantener artefactos y registros privados.
6. Proponer una ventana con menor tráfico, duración estimada a partir del ensayo, responsables de aplicación y observación y una hora de decisión para abortar. La aprobación expresa del fundador debe preceder cualquier cambio de producción. Este documento no autoriza ni ejecuta dicho cambio.

### Ledger de producción

**Comprobación parcial en lectura de solo consulta.** El ledger Drizzle reporta 31 entradas ausentes respecto de develop (0025–0055), y dos hashes previos a 0025 que coinciden con main, no develop. El inventario de relaciones no permite inferir el estado DDL completo de las 266 migraciones numeradas del repositorio. Pregunta abierta para el release: ¿qué ledger o introspección estructural de solo lectura debe usarse para comprobarlas? Hasta obtener esa evidencia, no se presenta 31 como total de todas las migraciones pendientes.

## Evidencia del cotejo

La comparación se hizo en Git con las referencias remotas obtenidas para este corte, `git rev-list`, `git cherry`, inspección de los commits exclusivos y lectura de los módulos equivalentes en develop. El ledger productivo se consultó en modo de solo lectura y quedó en custodia privada. Sus filas permiten verificar las dos variantes descritas arriba. El archivo de relaciones sólo enumera nombres, por lo que no prueba equivalencia de DDL. Los blobs de las migraciones `0219_signal_interest_decision_explicit_rejections.sql` y `0220_signal_interest_decision_provider_inventory_reconciliation.sql` son idénticos en ambas referencias: `09720f6a4d989041859eeef96050159f030cf9ec` y `5659ca0b07894b618a1621620c7ec84e3206eb30`, respectivamente.
