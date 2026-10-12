# R10 · checkpoint recuperable de §15.1 · PR #57

**Recorrido abierto en fichas; no acredita cierre integral.** Marca creada por UI «Marca QA MFP Oct11 R10», brand `20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f`, workspace `b466a888-c3f6-4b53-babe-e076be9e82d1`; Topics `/studio/brands/20c7d12a-57fd-49d9-a97b-7b19bf5f2d8f/topics`. Alta → Brand OS/KB → tres intereses guardados → load1 → preparación → vectores ejecutados. Load2 permanece sin importar hasta Signal inicial. R4/R8 y gold intactos.

**Build observada:** Studio fijado `44a2e1becebed896d68608678d24ece827b97c63`, deployment `0566a994-0df6-4aa5-b782-1945eedcd50f`; 22 hashes runtime coinciden. Ningún deploy/restart Studio/Runner durante QA-1. Runner conserva `f20209e209e48483ea3dbc9da076e319d1c0c66f`; numeric producer/topic progress/incremental projection true, sin cambiar flags. Autodeploy OFF/una réplica de la fijación previa; debe revalidarse antes del próximo pin autorizado.

| Acción UI única | Resultado / duración observada | Estimado USD | Liquidado USD |
|---|---|---:|---:|
| Crear marca y continuar | Brand OS; <8.058 s | 0 | 0 |
| Importar CSV load1, IAB del orquestador | 1,000 filas; 901 incluidas/17 excluidas/82 duplicadas; 918 únicas | 0 | 0 |
| Preparar texto | 901 preparadas/17 excluidas/4,048 fragmentos; UI <17.967 s; worker 2.371 s | 0 | 0 |
| Crear vectores · estimación USD1.814885 | 901/901; 4,048/4,048; UI terminal <56.552 s | 1.814885 | 0.132160 |
| Completar fichas pendientes, 901 raíces | Run `4573aba2…`; 17m23.532s; 791 válidas (740 labeled/51 abstained), 9 invalid_facets y 101 DNC | 3.195224 | 2.838194 |
| Completar fichas pendientes, recuperación focal 110 | Run `c6a28ab8…`; 83.427 s worker; 39 calls DNC/110 raíces; cero batch IDs/gasto liquidado, 791 válidas conservadas | 0.401614 | 0 |

**Total real USD2.970354**, reserva activa USD0. Reserva temporal inicial USD23.20338 separada del forecast y gasto; ningún máximo estricto configurado. Primera ficha: 1,705,452 input/200,769 output tokens. Modelo proveedor registrado en payload: Sonnet5.5/adaptive/low/max_tokens16000. IDs/recibos y manifest focal privados; hash selector110 `f1a620b64d1850677afee5b250f7191700962c5558c1dbf2023aba07b842266b`. Los nueve raw SHA verificados fallan únicamente `asunto.value >12 palabras`; el HTTP histórico DNC no se preservó, causa desconocida. Preflight offline de 31/39 requests pasa unicidad, forma y volumen; no acredita aceptación HTTP. No tercer intento.

**Correcciones locales:** asunto opcional largo abstiene con traza durable, sin truncar texto ni alterar entidades/raw; validador estricto sigue rechazando los demás errores. Parser no integra el digest de identidad: prompt/schema/params intactos y respuestas válidas idénticas, por lo que no invalida las 791. Create rechazada persiste allowlist clase/código/status/submission, sin cuerpo/secretos y sin cambiar fences DNC/unknown. Terminal de fichas invalida GET dependientes, conservando intención pagada; E2E de build nueva pendiente. Brand OS MFP conduce a Datos; panel estándar preservado. Corrección humana resuelve targets una vez con lector scoped; prueba PG/UI nueva pendiente.

**Pruebas/evidencia:** CI412 y PG158 del checkpoint anterior `b6b5e7cf` SUCCESS; PG17 16/16. Correcciones nuevas: parser9/9, worker21/21, store1/1, procedencia3/3, UI3/3; typechecks Query/DB/Worker/Studio y ESLint focal verdes. CI del próximo HEAD acredita suites completas. PG UAT17.6 enlazado a staging por comparación booleana UI; dev-test17.11/CI17: no diferencia mayor ni reescritura SQL0263–0266; preimagen exacta necesaria antes de futuro apply UAT. Ningún SQL/UAT cambiado.

**Custodia y límites:** CSV privados en checkout principal `.data/dev-corpus/r10/`, 47 columnas/1,000 y250 filas, hashes load1 `4773f7ff…fb41d86`, load2 `8817c1fa…c213ea`, manifest `86cfde3b…1881c0f`; muestra excluye344 IDs/1,230 filas contradictorias, originales intactos. Duraciones UI son límites clic→observación; no inventar latencias de intereses sin muestreo. B1/pipeline completo y B2 corrección<5s/filtros<15s pendientes del gate QA-1 y validación nueva. Agente estándar GPT-6.1-sol/medium configurado por perfil, sin telemetría independiente; orquestador UI según configuración solicitada, no verificada independientemente.
