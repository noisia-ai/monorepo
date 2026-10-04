# WS1 — Harness MFP remoto, corte funcional parcial · 4 octubre 2026

**Ahora:** el harness crea una marca por el mismo servicio que el alta cliente,
importa CSV con procedencia/derechos, prepara raíces y ejecuta embeddings sintéticos
con BullMQ real en Redis privado. No es entrega UAT ni aceptación semántica.

**Código:** `scripts/dev-corpus/README.md` contiene las órdenes. La ruta de alta
mantiene sesión/authZ y delega al servicio extraído; no hay override Kinde. CI ahora
verifica PR hacia develop conservando gates existentes. Gold valida entidades
múltiples, 150 raíces/90dev/60test y ≥15 comparaciones verificadas; no inventa etiquetas.

**Destino remoto comprobado:** Railway dev-test `5bad359d-cfa4-4e8f-aa41-98e6f075375a`,
PG17.11/vector0.8.6 del servicio existente, sistema `7683766906362679330`.
Base y rol propios `noisia_mfp`; runner `a5706eaa-7d67-4d63-8e7e-2b9fc7424508`;
Redis privado `4cef4bb5-cf97-476c-952c-af575b0399bf` con AOF; bucket privado
`mfp-corpus-files`. Runner y PostgreSQL próximos, sin proxy público ni autodeploy.
Volumen runner `/app/.data/dev-corpus` preserva corpus/recibos. Bases y runner
históricos permanecen intactos. Infra inicial/build separado del recorrido.

**Ejecución real y replay (4 octubre):** `up` observó base vacía/0 conexiones ajenas;
`migrate` aplicó 213 archivos numerados hasta SQL0220 una vez a la base nueva y el
replay aplicó 0. `seed` real retornó 201 y luego replay. `import load1`:
1,000 recibidas = 905 incluidas + 72 excluidas + 23 duplicadas; 977 únicas.
`prepare`: 977/977 contabilizadas, 905 elegibles y 3,158 chunks.
`embeddings fake`: 905/905 completas, 3,144 vectores nuevos y 14 cache hits;
replay sin llamadas nuevas. Segunda ejecución de seed/import/preparación conserva
conteos. `status` confirma ambas etapas vigentes. Las ejecuciones exitosas por
etapa tardaron aproximadamente 4s+8s+5s+9s (incluye control SSH); el debugging de
arranque se registra aparte, no como tiempo de procesamiento del corpus.

**Pruebas:** cinco pruebas ligeras sin DB PASS; typecheck de scripts PASS en runner
privado. CI remoto verificó typecheck/lint generales; detectó un test estructural DB
que aún leía la ruta antigua, corregido para leer el servicio extraído. CI completo
 del candidato final sigue pendiente. Transformación TS requirió módulo ESM y
`node --import tsx` (pnpm exec inyecta NODE_PATH, correctamente rechazado por guard).

**Coste:** proveedor real USD0. Ledger de embeddings explícitamente sintético
396 microUSD; nunca se acredita como Voyage. Infra Railway sin conciliación de
factura todavía. No se copian secretos ni textos al repo.

**Pendientes:** gold humano y ≥15 comparaciones confirmadas (hay candidatos reales,
no certificación); Voyage sin cap necesita adaptación nullable focal, no techo
inventado; acciones MFP se provisionarán con WS2. Studio dev-test
`https://mfp-studio-dev-test.up.railway.app` y callbacks/login en verificación por root.
Load2 existe privado (200 nuevas, 30 duplicadas, 20 edits de fixture marcados), aún
sin ejecutar; no acredita aceptación WS8. Ficha/pertenencia/evaluación/UAT pendientes.
