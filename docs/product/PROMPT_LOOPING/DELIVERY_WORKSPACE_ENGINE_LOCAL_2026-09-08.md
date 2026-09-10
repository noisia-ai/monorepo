# Motor completo workspace — corte local del8septiembre

Commit focal **5f5ca24**, rama `codex/noisia-topic-cohort-ui-2026-09-06`, worktree `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`. Se conservaron fuera del commit los tres archivos contract-drafts preexistentes. Sin push, SQL remoto ni despliegue de este corte. UAT permanece en ae3e36c/SQL0135, con Voyage real ya terminado según [recibo](DELIVERY_VOYAGE_REAL_CORPUS_2026-09-08.md).

## Qué queda implementado

El Worker existente conecta el corpus completo y sus vectores con BERTopic/UMAP/HDBSCAN, por vías abierta y guiada. Brand OS aporta contexto con cero intereses válidos. No hay muestreo de cómputo ni Topic ficticio. Persistencia privada por partes, modelo completo y checkpoint verificable; recuperación sin repetir el fit, despacho inicial atómico y rescate de leases. La siguiente población puede predecirse con el modelo compatible y se vuelve a descubrir completa; un cambio de runtime omite el modelo binario incompatible y conserva linaje JSON.

Topics tiene una entrada de análisis con estado, recuperación de solicitud e idiomas ES/EN; en este corte es **sólo cómputo**, capClaude0 y proveedor de interpretaciónfalse. No sustituir esos ceros por gasto ficticio. El ledger0138 para la futura interpretación tiene reserva, envío único, recibo, liquidación y un sucesor explícito para un intento que no se envió. El modelo ajustado queda draft, sin aprobación semántica ni selección automática en Signal.

## Pruebas y límites comprobados

- `pnpm typecheck` y `pnpm lint`:11/11. Lint conserva15 advertencias previas,0errores.
- Query engine:423pruebas; DB:231 con56 pruebas de integración omitidas por falta de opt-in; Worker:268 con5 omisiones. Los casos Python opt-in del Worker se ejecutaron aparte: suite focal13/13, sin omisiones.
- Studio: la corrida general dejó658 casos verdes y6 omisiones, pero2 archivos no pudieron importarse sin DATABASE_URL. Se repitieron exclusivamente esos archivos con URL local deliberadamente inalcanzable e inyección de dependencias:17/17. No se modificó autenticación ni se usó DB remota para resolverlo. Prueba focal del servicio de análisis/reintentos:7/7.
- PostgreSQL engine/dinero:7/7,0omisiones. Incluye begin/outbox atómicos, lease, checkpoint, cap entre workspaces, liquidación que supera reserva, bloqueo antes del siguiente envío y sucesor no-send. Outer ROLLBACK y clone local de migración; SQL0137/0138 ensayados íntegramente.
- PG→BullMQ→Node→Python real:3raíces/133fragmentos/6guías/0intereses; caída después del checkpoint y recuperación con un solo subprocess,15artefactos,0nuevos embeddings/Claude. HTTP del bucket privado simulado en memoria. El primer driver usó queue.add; una regresión posterior begin+drain cubrió el despacho faltante. No es una prueba UI→proveedor→Signal.
- Python:7 casos de algoritmo/contrato;8 casos de routing al cambiar runtime/contexto;2 casos nuevos de selección de ejemplos distintos. Fixtures sintéticas241→342fragmentos,3→4clusters; no son dos imports UAT ni evidencia de precisión.
- Imagen Linux final: `sha256:b217bfb5b4e029614813c93f6bbdf49a1c936bd80f0e90bba701ad44187363a0`,325,637,401bytes. Build51.56s con dependencias cacheadas; smoke Node/imports/Python sin red. El manifiesto de modelos incluye ambas vías. Ejemplos de hasta10raíces distintas con afiliación alta/frontera relativa, sin confundir esa afiliación con relevancia calibrada.

Recibos privados en `.data/workspace-engine-2026-09-08` del worktree: `backend-final-receipt.md`, `backend-postgres-final.log`, `worker-postgres-proof.md`, `docker-worker-build-receipt.json`, `docker-node-smoke.json`, `docker-python-contract.json`, `representatives-and-money-review-final.md`, logs de checks y `commit-manifest.json`. El ADR025 documenta la decisión de runtime.

SQL0137 SHA256:481c3f19d21349607c5399032a7e5132bd11d9d64b6a9b9ebc73b844dcbb522e.

SQL0138 SHA256:51d63616a7895b37c8c5a21dc1301856efb99e20ddd14efe925a4d840df7728c.

## Próxima entrega útil y orden

**Una corrida nueva completa desde Topics hasta resultados editables y Signal.** No otro benchmark general ni recuperar Laika/Alexa. Reutilizar los embeddings reales de UAT; no repetirlos. Preservar el Compass y el plan aprobado.

1. Integrar Claude al trabajo durable: presupuesto/configuración versionada sellados al comenzar; checkpoint de fit; interpretación de todos los grupos mediante evidencia acotada y diversa. Actualmente0137 cierra fit ready inmutable y0138 requiere ready para reservar; resolver esa transición de manera explícita antes de activar el productor. No inventar compatibilidad para las fixtures de cap0.
2. Separar intereses de entrada de Topics emergentes de salida dentro del catálogo existente. Hoy crear resultados alteraría plan_digest y los invalidaría. Materialización en lote como drafts editables/no seleccionados, con origen estable y preservación de ediciones humanas. Resolver ámbito mixto sin inferir primary_brand desde un archivo ni obligar un formulario por grupo.
3. Sellar relación cluster→Topic y producir la generación completa0136, con excepciones y correcciones. Las identidades exigidas por0087/0136 y los eventos/policies de aprobación no existen por nombrar un cluster. Mantener visible la diferencia entre pertenencia computacional y semántica verificada.
4. Conectar selección editorial y reader de Signal workspace-native: el projector legacy excluye study_corpus_id NULL. No fabricar un estudio ni tags aprobados. Elegir un contrato explícito de medición para agrupaciones computacionales si se muestran en Signal; no presentarlas como precisión semántica medida.
5. Aceptar desde UI una corrida nueva, interrupción/recuperación sin segundo cargo, edición/selección con efecto comprobable en Signal y otra importación con cambio/novedad. Reutilizar última generación completa mientras avanza la nueva. No reclamar2M por los volúmenes locales probados.

El memo concreto de archivos/contratos siguiente está en `.data/workspace-engine-2026-09-08/frontend-interpretation-contract.md`. El análisis del producto y deuda permanecen abiertos en NOI-31/78 y el plan self-service; este commit no los cierra.
