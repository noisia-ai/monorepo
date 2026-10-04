# MFP · Recibo del programa · 4 octubre 2026

Corte observado: **15:28 UTC**. Canon: `SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md` **v1.3**, preservado con los accesos antes de delegar. Este recibo actualiza los resultados posteriores a los recibos iniciales de cada WS; no acredita producción ni sustituye la evaluación humana.

## Resultado demostrable

El corpus privado de desarrollo recibió 1,000 filas: 977 únicas, 905 elegibles, 72 excluidas y 23 duplicados; 3,158 fragmentos. Alta/importación se hicieron mediante funciones reales del producto desde el runner; **todavía no por UI autenticada**. Cada raíz elegible tiene estado de ficha Claude y JEV; los resultados crudos y costes están conservados. La segunda carga preparada contiene 200 nuevas, 30 duplicadas y 20 ediciones y aún no se ha importado.

- **WS0:** 110 documentos históricos preservados e inventariados, con copias verificadas; originales intactos. Spec y accesos versionados. No se reactivaron planes ni automatizaciones históricas.
- **WS1:** PostgreSQL lógico `noisia_mfp`, Redis, runner y Studio dedicados en Railway dev-test; conexiones de datos privadas. Mac sólo edición/navegador/comandos ligeros. Studio dev-test responde HTTP200; falta autorizar su callback exacto en Kinde para el recorrido de navegador.
- **WS2:** Claude completó 905 estados: 831 `labeled`, 74 `abstained`, cero errores pendientes; población actual374 relevantes. Alias de competidor afectó58 raíces y dejó847 intactas; restauración posterior63 raíces desde caché, cero proveedor. Etiquetador experimental, no aprobado.
- **WS3:** JEV completó905 estados:898 `labeled`,7 `abstained`, cero errores pendientes;915 llamadas incluyendo recuperación de10 redondeos. Derechos y condiciones técnicas/de datos revisados con fuentes oficiales en `JEV_DUE_DILIGENCE.md`. Acuerdo de relevancia Claude–JEV686/905(75.8%): monitor sin gold, **no precisión ni prueba de superioridad**.
- **WS4:** pendiente gold humano150 raíces (partición fija90 dev/60 test) y aprobación de evaluación; no iniciado ni etiquetador aprobado.
- **WS5:** código integrado, CI y PG compuesto44 comprobaciones con transporte simulado aprobados. Las pruebas acotadas de proveedor no sustituyen la demo de pertenencia sobre conceptos ni el gold.
- **WS6:** discovery real sobre374 relevantes/1,259 fragmentos,11 grupos interpretados; consolidación propone2 Topics,7 Noise y2 insufficient. Proyección real recuperada y snapshot preparado; detalle abajo. Aún falta adoptar y acreditar pertenencias citadas.
- **WS7:** UI y contratos integrados; PG real sobre905 raíces, filtros, derechos y correcciones revertidas aprobado. Falta recorrido autenticado bilingüe y QA del fundador.
- **WS8:** PR25, incremental y bootstrap en revisión. Python remoto12PASS; regresión de la función Worker con páginas129/200+1 y rechazo201 aprobada con stores/bytes simulados. PG remoto completó política ilimitada (admisión/replay/plan/reserva/revocación/renovación); caso finito pendiente tras corregir expectativa del código de rechazo. No segunda carga real ni aceptación E2E.

## Recuperación WS6 integrada

PR24 → `develop` **6daf32e20088e2920cccd6aebace36e6cc1eaaa0**. CI final37212055173 sobre56e99bf completo: tipos, lint, suites, build y gates. Revisión independiente sin P1/P2 pendientes. PG con Worker y artifacts reales pasó dos escenarios en265.724s:905 raíces,374 selladas,531 fuera, corrección humana exterior preservada, cambio de relevancia antes de página y antes del INSERT rechazado, serving obsoleto e inmutabilidad comprobados. Páginas200/200/200/200/105; escrituras3.78–4.30s. Todas las mutaciones de prueba se revirtieron.

SQL0240 aplicada **una sola vez** en MFP a15:20:47.794Z, historial224→225; SHA256 `4b09d48eea1c4ad883f43be7583bb263ae61188e5676ea2933fc5628c5f2630f`. Corrige el escaneo global por fila mediante validación por sentencia, conservando identidad/evidencia por fila y vigencia global. No modificar ni repetir migraciones instaladas.

Ejecución original de proyección `e85a236c-3080-4f12-821e-c1d8263d101e` quedó **READY15:22:50.033Z**,905/905 raíces,3,158 fragmentos,343 asignaciones,118.976s. Reutilizó fit y artifacts; cero proveedor. Snapshot `957fb789-a587-4aa0-a676-47f9bc127f5f` preparado15:23:18.502Z,denominador905,fuente vigente,dos candidatos,activación pendiente. No confundir snapshot preparado, adopción y selección. El checkout WS6 fue archivado conservando Git y sus ramas se retiraron conforme§7.

## Coste y límites

Coste conocido acumulado de proveedores: **USD5.282476684**, incluida interpretación discoveryUSD0.260631 y consolidaciónUSD0.149813, ambas liquidadas. No hay reservas ni resultados inciertos en esas corridas. Uso de algunas solicitudes históricas rechazadas de formato no fue informado por el proveedor y no se inventa como cero. Costes/pruebas detallados permanecen en sus recibos privados; presupuestos orientativos, sin máximo estricto configurado para MFP.

Railway observado15:10 UTC: servicios dedicados MFPUSD0.069597942 (runner0.044080049,Studio0.022465134,Redis0.003052759); PostgreSQL compartidoUSD0.257477397 sin atribución exclusiva. No sumar gasto UAT al programa. Estimaciones se actualizan con nuevos resultados, sin imponer caps históricos.

Datos/pruebas pesadas siguen remotos. SQL0237–0238 **no aplicadas permanentemente** en este corte; sus ensayos usan rollback. Runner general detenido y sin claves de proveedor persistentes; operaciones pagadas usan únicamente la clave necesaria en memoria. Imagen base dev-test4e06712 con fuente verificada posterior para pruebas; pendiente imagen final conjunta, no afirmar despliegue UAT. UAT/producción no modificados.

Pendientes humanos concretos: callback/logout exactos de Studio dev-test en Kinde (confirmación de ampliación de acceso del navegador), gold150 y conceptos de evaluación, QA de UI. No hacen falta nuevas claves ni permiso genérico. La aceptación integral requiere marca nueva por UI, ambas cargas, vigencia selectiva, pertenencias con evidencia y Signal; este corte no demuestra todavía ese recorrido.
