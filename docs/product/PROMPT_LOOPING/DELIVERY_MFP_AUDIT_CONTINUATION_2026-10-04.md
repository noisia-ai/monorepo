# Continuación MFP para auditoría — 4 de octubre de 2026

Este documento registra el corte posterior a `HANDOFF_AUDITOR_MFP_2026-10-04.md`. El contrato sigue siendo el spec v1.3; `AUDIT_MFP_2026-10-04.md` fija prioridades y proceso. El trabajo se desarrolla en ramas separadas y **ningún PR se ha fusionado a `develop`**. Dev-test remoto no equivale a UAT ni a producción.

## Entrega y estado verificable

| Corte | PR y resultado | Límite |
|---|---|---|
| Canon y acceso | [#32](https://github.com/noisia-ai/monorepo/pull/32): auditoría actualizada con gold v1 y conceptos v2 decididos, perfiles `.codex/agents/`, spec v1.3 y acceso. Kinde autentica en dev-test: `/signal` muestra `Cliente lector`; `/studio` rechaza acceso por falta de grant de marca. | No se cambió un rol ni se concedió acceso. |
| Fase A | [#35](https://github.com/noisia-ai/monorepo/pull/35): activación por opt-in de workspace, Signal aditivo, importación global preservada, provisión de ocho acciones y adopción/selección gobernada. Prueba «workspace sin MFP idéntico» y PG opt-in final 3/3 PASS. | Proyección fallida histórica `blocked_by_fixture`: el corpus no tiene esa fila; no se fabricó ni se repitió fit. |
| B5–B7 y UI | [#33](https://github.com/noisia-ai/monorepo/pull/33): páginas en vuelo configurables, error técnico aislado, overrides ligados a definición/raíz y aviso ES/EN. PG compara 905/905 filas legacy sin opt-in y prueba flag OFF/ON con rollback. | PR en borrador, pendiente de auditoría. |
| B8 | [#34](https://github.com/noisia-ai/monorepo/pull/34): receipts crudos en storage privado, recuperación con SHA/tamaño, harness y switch JEV acotado a fixture. 1.457/1.457 objetos verificados antes y después de 0255. | `request`/`inputs` permanecen en PG porque no había copia verificable en storage. PR en borrador. |
| B1–B4 | [#36](https://github.com/noisia-ai/monorepo/pull/36): reconciliación de batches inciertos, split de refusal, afectación CE y vigencia con revisión explícita. PG B4 19 aserciones PASS con rollback y cero proveedor. | PR listo para auditoría; diff propio se apila sobre #35/#33/#34. |
| Fase C | Gold v1 transferido al runner sin regenerar selección; SHA-256 local/remoto idénticos. Conceptos v2 instalados por API en catálogo de desarrollo (13→16, replay sin cambios). Rights-check: dos cargas completadas autorizadas, 150/150 raíces y digests vigentes, cero trabajos activos. | Evaluación A/B de proveedor y propuesta sin aprobar etiquetador **en curso**; actualizar esta fila al cierre. |

Migraciones forward-only aplicadas **una vez** sólo en `noisia_mfp`: 0243/0244 (A), 0250/0251 (B estándar), 0255 (B8) y 0256 (B crítico), historial 229→235. Los recibos de cada PR contienen SHA, despliegue, comandos y censos. PostgreSQL, Redis, Worker y pruebas de integración MFP corrieron remotos; no se repitieron imports, fits o migraciones históricas. El gasto de proveedor de A/B fue USD 0; infraestructura remota incremental no cuantificada. Durante una reparación de CI, un agente ejecutó por error `data-os:local-smoke` en la Mac: el script levantó Docker brevemente y desmontó sus contenedores/red al terminar. Se verificó que no quedó un contenedor nuevo de esa prueba; tres contenedores anteriores de otros trabajos permanecieron intactos. No se repetirá ese comando localmente.

El gold y corpus privados siguen fuera de Git. Archivos transferidos al volumen del runner: `gold-labels-reviewed-v1.csv`, `gold.jsonl` (150; dev 90/test 60), `gold-founder-review-2026-10-04.json`, `concepts-proposed-v2.json` y la selección fija. La identidad del fixture se leyó de `fixture-manifest.json.identity_path`; no se usó la identidad de otro corpus. No se publican textos, respuestas crudas, IDs privados ni credenciales en este recibo.

La transferencia fue byte a byte, sin regenerar la selección. SHA-256 local/remoto: CSV revisado `fe4f1d1fc1c9d9706e674edd1ddd357076420e632ec00fb99fa9049dc7543a67`; gold JSONL `c9ea2ebc9075620db6ec80929595463be329adedba076b843bee6d61d070b5e0`; revisión del fundador `e9992acd26b4b6e73281ab5d9526bb38de9acfc0bfb418d0e89a33737004e5b5`; conceptos v2 `04ea7b12e37c3e61b2c9ce119f0fc37249798a54a614d5062efdff646c686e51`; selección `00030d49092ce3c691f9e3a78fcfb672a17d3b1380367608ef197baa8bb0915b`. El manifiesto de identidad elegido por su ruta declarada dio `6907a6d640944e90e7b2adb14917392ed2efc1987e5beef9be4a45c3c4ba294e`.

Los perfiles de agentes versionados solicitaron `gpt-6.1-sol` para trabajo crítico/estándar, que no estaba disponible en este host. Los recibos consignan la ejecución real: Fase A y B1–B4 `gpt-6-sol` high, B5–B7/UI `gpt-6-sol` medium y B8 `gpt-6-luna` high. La prueba Signal de A falló dos veces y sólo esa tarea se repitió con `gpt-6-astra` medium, según la regla de escalamiento. Fase C corre con `gpt-6-sol` medium. Estos son modelos del agente de implementación; las variantes Sonnet/JEV de etiquetado se documentan separadamente en `EVAL_MFP_2026-10-04.md`.

## Pendientes de aceptación

- Cerrar la evaluación separada Sonnet 5.5/JEV con calidad por dimensión y concepto, intervalos, coste por 1.000 menciones y recomendación al auditor; no aprobar etiquetador por esta ejecución.
- Revisión del auditor antes de fusionar cualquiera de los PR a `develop`.
- UAT parcial sólo tras fusión de A, con opt-in de workspaces de prueba, pruebas y recuperación. El recorrido self-service completo de WS8, QA del fundador y aceptación integral siguen pendientes antes de proponer producción.

Las estimaciones de coste son orientativas; sólo un máximo estricto configurado explícitamente limita gasto. La auditoría posterior y los recibos de fase prevalecen sobre el estado de parada histórico del handoff anterior.
