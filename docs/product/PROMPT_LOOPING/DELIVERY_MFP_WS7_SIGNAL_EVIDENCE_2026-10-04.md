# WS7 — Origen y cobertura de pertenencia en Signal

Corte focal desde `develop` `00b6e3f9`; rama `feat/mfp-ws7-signal-evidence`.

**Fallo observado por Root.** Signal sirvió cuatro pertenencias vigentes de dos
conceptos adoptados como `basis=computed_cluster`. La cobertura mostraba905 raíces,
422 como ruido y370 sin resolver, omitiendo40 spam y69 de relevancia desconocida.
La UI interpretaba esos campos como disposiciones editoriales. Además, la estimación
seguía en448594 microUSD con cero trabajo pendiente; una solicitud real posterior
completó sin llamadas ni gasto. Estos recibos privados son evidencia del fallo,
no de calidad semántica ni de la corrección todavía.

**Cambio.** El catálogo MFP identifica sus términos con `concept_membership`;
discovery no adoptado conserva `computed_cluster`. `membership_population` expone
relevant/unrelated/spam/unknown sobre raíces únicas con los mismos filtros de fecha
y derechos. Esas cuatro categorías particionan el denominador; `without_concept`
es un subconjunto de relevantes respecto de todos los conceptos MFP, incluso los
no seleccionados. `assigned_unique` conserva las raíces visibles seleccionadas;
los conteos por concepto siguen siendo multietiqueta y no se suman. MFP deja de
publicar `unrelated` como Noise editorial. La UI ES/EN presenta estas distinciones,
resultados experimentales y evidencia sin exigir una generación de discovery cuando
el concepto sólo tiene pertenencia. Las rutas legacy conservan sus etiquetas.

La estimación de solicitud y estado comparte con el dispatcher el selector de
pares compatibles pendientes/error o del etiquetador anterior. Reutiliza decisiones
vigentes y humanas, conserva el cerco de transportes inciertos y calcula la salida
sobre pares pendientes, no el producto completo raíces×catálogo. Cero trabajo
produce cero estimación. Preview conserva su muestra evaluada nuevamente, sin
introducir caché. No cambian parser, veredictos, políticas de coste ni proveedor.

**Verificación.** Focal DB5 PASS (mocks de consulta), UI38 PASS (render estático
ES/EN y contratos existentes), sintaxis TypeScript y `git diff --check` sin errores.
Se añade regresión de detalle sin generación. CI remoto pendiente: typecheck,
lint, suites y build. El SQL nuevo requiere comprobación real de Root; los mocks
no prueban PostgreSQL ni rendimiento. El agente no ejecutó PG, proveedores,
mutaciones remotas, DDL ni despliegues. QA autenticado continúa pendiente del callback.

**Comprobación remota propuesta.** Sobre el corpus existente y sin proveedor:
comparar Signal con las cuatro categorías del estado de fichas; verificar bases
mixtas discovery/pertenencia, filtros/derechos y raíces con varios conceptos.
Consultar estimación tras cero pendientes y tras editar sólo una definición;
contrastar trabajo estimado con el selector real y preservar humanos/uncertidumbre.
Root coordina la ejecución y registra sus resultados antes de integrar.
