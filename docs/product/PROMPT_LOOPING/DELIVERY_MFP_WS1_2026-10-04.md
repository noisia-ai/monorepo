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
arranque se registra aparte, no como tiempo de procesamiento del corpus. Medición
única del replay `up → seed → import → prepare → fake → status`: **3 segundos**
wallclock dentro del runner, sin incluir arranque/build ni SSH.

**Pruebas:** seis pruebas ligeras PASS; typecheck de scripts PASS remoto. CI completo
`0d481d0` verde (typecheck/lint/test/build/Data OS/secrets); siguiente candidato de
recuperación pendiente de CI. Redis real verificó concurrencia sin consumir trabajo
ajeno. Fixture independiente en la misma base verificó import fallido → sucesor desde
Storage → replay, preparación fallida → mismo run, y embeddings con primer lote
asentado/segundo definitivamente no enviado → quote cambiada → mismo run recuperado,
cap/costo conservados y replay sin llamadas. Otro caso real comprobó fallo previo
al snapshot (`input_revision=null`) → `--retry` → sucesor vigente. Corpus principal
intacto. Proveedor simulado.

**Coste:** proveedor real USD0. Ledger de embeddings explícitamente sintético
396 microUSD en corpus principal; nunca se acredita como Voyage. Uso Railway observado
atribuible a runner/Studio/Redis MFP: USD0.001872661806. PG compartido USD0.205485
del período completo no atribuible a MFP. Estimación en reposo ~USD3.11/mes, excluye
PG compartido, egreso y picos; no es factura ni máximo. No se copian secretos ni textos al repo.

**Gold privado:** plantilla generada con 150 raíces, 90 dev/60 test, 15 comparaciones
verificadas leyendo textos, 35 enriquecidas y 100 aleatorias. Tres conceptos propuestos
pendientes del fundador; ninguna etiqueta humana ni gold anotado aún.

**Pendientes:** anotación humana/confirmación de conceptos; Voyage sin cap necesita adaptación nullable focal, no techo
inventado; acciones MFP se provisionarán con WS2. Studio dev-test
`https://mfp-studio-dev-test.up.railway.app` (servicio `f87fe1ae-5f7e-45e0-9a19-7c162b315b1b`) responde; Kinde devuelve
`Invalid callback URL` para retorno MFP. Corrección preparada, pendiente confirmación
del operador en Kinde.
Load2 existe privado (200 nuevas, 30 duplicadas, 20 edits de fixture marcados), aún
sin ejecutar; no acredita aceptación WS8. Ficha/pertenencia/evaluación/UAT pendientes.
