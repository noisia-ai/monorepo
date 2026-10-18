# PR #57 · revisión 12 · Signal inicial y delta R10

**Resultado real, corte 18-oct 17:17 UTC.** El usuario completó load1 → fichas → descubrimiento → pertenencia → revisión editorial → Signal por UI. Signal muestra tres intereses manuales con 12/6/11 asociaciones tras una corrección justificada. Load2 ya fue importado y sus vectores terminaron; sus 201 fichas pendientes siguen en ejecución. **No se acredita aún R10 completo.** Rige spec v1.3 y auditoría §§16–18, opción B: una QA final. Agente `mfp_estandar`, configurado `gpt-6.1-sol`/`medium`; modelo efectivo no verificable desde la herramienta.

**Producto.** El escritor gratuito de fichas recuperó nueve raws pagados sin repetir las 791 válidas. En esta ronda, un rationale de 33 palabras y otro de 32 invalidaban las tres decisiones de una raíz por el máximo V1 de 30. El Worker reutiliza ahora el normalizador acotado V2 únicamente para ese metadato de presentación, conservando identidad, prompt, spans, veredicto y citas V1. Guarda hashes antes/después. «Recuperar respuestas guardadas · sin costo» reanaliza el raw original y escribe decisiones/procedencia en una transacción por lotes. Verifica autoridad, opt-in, ejecución terminal, contexto, conceptos, etiquetador, fingerprints y SHA/tamaño/custom_id; no posee capacidad de proveedor, reserva o liquidación. El replay no vuelve a escribir; las correcciones humanas prevalecen.

**Pruebas y pin.** [CI521 SUCCESS](https://github.com/noisia-ai/monorepo/actions/runs/39145881438), incluido build Studio, suites, lint/typecheck y smoke; [PG256 SUCCESS](https://github.com/noisia-ai/monorepo/actions/runs/39145881447): 25 PASS, cero skip. La nueva aceptación PG17 ejecuta el SELECT canónico 0268: tres errores → dos positivos y un negativo, vista/calls consistentes, replay sin efecto, rollback, rechazo de drift/override y dinero/fila previa intactos. Pruebas focales de parser, Worker/storage y UI también verdes. Pin pareado dev-test `5cfbd2d4`, Studio/Runner SUCCESS, salud HTTP200, 38 hashes comunes más dos catálogos de idioma en Studio y siete variables verificadas por servicio; una réplica y autodeploy OFF. Traza de bundle sin entrypoint Worker. Respaldo `c0db93c2` conservado, sin rollback; 0268/0269 no se repitieron. Censos de R4/R8 idénticos. Ruta estándar preservada; #57 draft, sin fusionar; UAT/producción y guía del auditor intactos.

**Evidencia UI.** Recuperación101: 901/901 fichas (831 labeled, 70 abstained), 10m58.584s Worker; las 800 previas conservaron su SHA. Descubrimiento: 527 raíces, 23 grupos, 8m27.507s. Pertenencia: 54 raíces × tres conceptos, 18m0.946s; replay UI gratuito reparó las tres decisiones sin calls nuevos ni cambio del run/ledger. Editorial materializada: 23 screenings y un shard global, 6m13.310s. Screening dio 17 Noise/6 insuficientes; revisión global final 16 Noise/7 insuficientes, cero conceptos adoptables y cero errores técnicos. La ausencia de candidatos coincide con respuestas y catálogo; no se inventó una adopción ni se aprobó su calidad semántica. Los 26 tópicos técnicos anteriores no son esos conceptos editoriales.

**Mediciones cliente.** Filtro Reviews: 901→73, actualización observada en 14.061s. Corrección de una recomendación genérica que incumplía la definición de Reserva: 3.668s hasta 11 resultados; Signal reflejó 12→11 sin otra ejecución. Incluyen observación CUA, cumplen <15s/<5s en este caso y no son un SLO general. PG confirmó override activo, fuente human y cero llamadas nuevas.

| Etapa | USD observados/liquidados |
|---|---:|
| Vectores load1 | 0.132160 |
| Fichas anteriores, incluido replay9 gratuito | 2.838194 |
| Recuperación101 | 0.391729 |
| Descubrimiento | 0.809574 |
| Pertenencia, incluido replay3 gratuito | 0.336086 |
| Editorial | 0.304142 |
| Vectores load2 | 0.027357 |
| **Acumulado antes de fichas delta** | **4.839242** |

**Delta y límite de entrega.** Load2 recibió 250 filas: 220 incluidas, 29 duplicadas y una excluida por texto corto; veinte revisiones. El CSV contiene 200 IDs nuevos/30 filas exactas/20 modificadas; una exacta crea una canónica por identidad de fuente, y una nueva queda excluida. Vectores: 1,101 completas, 4,063 asset/chunk reutilizados y 840 nuevos, 227,790 tokens observados. La cota previa de 4,133,529 tokens quedó cubierta por saldo gratuito Voyage leído antes del clic. Fichas: 900 vigentes (881 previas +19 nuevas con entrada idéntica), 201 pendientes (181 nuevas +20 revisadas); Claude USD30.70 leído antes de autorizar una sola vez, quote USD0.823287. Falta terminal del delta, actualización de pertenencia, temas nuevos y Signal final. Presupuestos orientativos; no se compraron créditos. Evidencia/IDs/textos y recuperación exacta sólo en `.data/front5-qa/r10/`.
