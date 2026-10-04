# Accesos y credenciales compartidas del programa MFP

Preparado el 4 de octubre de 2026 a petición del fundador para que el nuevo orquestador y sus auxiliares reutilicen accesos existentes. Complementa el spec v1.3 y sus reglas vigentes de presupuesto orientativo, verificación JEV y entregas progresivas en UAT.

## Archivo privado compartido

`/Users/brandhon_o/.config/noisia/mfp/credentials.env`

Directorio con permisos `0700`, archivo `0600`, fuera del repositorio y de los worktrees. Formato dotenv con valores entre comillas dobles. Leer mediante dotenv, nunca mediante `cat`, logs, prompts ni comandos que impriman el entorno. No hacer `source`: los valores están serializados para dotenv, no para expansión de shell.

Variables disponibles:

- Claude: `ANTHROPIC_API_KEY`.
- Voyage: `VOYAGE_API_KEY`.
- JEV: `TYPESAFE_API_KEY`, guardada desde la clave que el fundador indicó reutilizar.
- Supabase: URL, anon key, service role y nombres de buckets.
- Kinde: client ID, client secret e issuer.
- Resend: API key y remitente.
- SentiOne: API key, base URL y proyecto predeterminado.

No copiar todas las credenciales a cada proceso: cargar las necesarias para el servicio o proveedor correspondiente. No pasar claves de servicio al navegador ni a variables NEXT_PUBLIC.

## Comprobación inicial (antes de WS1)

- Claude: `GET https://api.anthropic.com/v1/models` respondió HTTP 200 con JSON.
- JEV: `GET https://api.typesafe.ai/v1/models` respondió HTTP 200 con JSON.
- Voyage y demás servicios: credenciales presentes; no se ejecutaron inferencias ni se certificó su estado de facturación/permisos.
- No se enviaron menciones a proveedores ni se iniciaron ejecuciones de producto. Las comprobaciones de modelos no certifican saldo, todos los modelos ni límites de uso.

Recibo privado sin valores: `/Users/brandhon_o/.config/noisia/mfp/access-check.json`.

### Actualización verificada · 2026-10-04 09:00 UTC

- CLI oficial Railway autenticado tras la concesión expresa del fundador. Se reutiliza la clave SSH registrada; no se extraen cookies ni claves privadas.
- WS1 integrado en `develop` por PR #16 (`7833fed`). Base lógica `noisia_mfp`, Redis `mfp-redis`, runner `mfp-private-runner` y Studio `mfp-studio` separados de UAT. Conexiones de datos privadas y runner próximo a PostgreSQL; replay remoto idempotente de 905 raíces elegibles con embeddings **simulados**. Esto no acredita aceptación semántica.
- Studio MFP responde a salud en `https://mfp-studio-dev-test.up.railway.app`. El fundador registró el callback y logout de este destino en Kinde el 4 de octubre; la comprobación del recorrido autenticado sigue pendiente. No se elude autenticación ni autorización.
- Lectura autenticada de Anthropic confirma `claude-sonnet-5-5`; todavía sin inferencia Claude de MFP en este corte.
- JEV: seis inferencias **sintéticas** HTTP 200 desde el runner confirman `jev-1.13.0`; `jev-latest` devuelve esa versión. Uso total 16.802 tokens de entrada; coste calculado con tarifa oficial USD0,042/MTok: USD0,000705684, sin solicitudes de facturación incierta. La clave y el flag se cargaron sólo en memoria del proceso mediante SSH cifrado, sin habilitación persistente del runner.
- La comprobación de derechos vigente a las 08:59:35Z confirmó la única fuente del corpus MFP activa, con licencia `llm-processing=allowed` y retención indefinida. No se enviaron menciones reales a JEV. Condiciones oficiales y límites de esta evidencia en [JEV_DUE_DILIGENCE.md](JEV_DUE_DILIGENCE.md) y [recibo WS3](DELIVERY_MFP_WS3_2026-10-04.md).

Los servicios MFP siguen la rama `develop`. El recibo inicial indicó autodeploy desactivado, pero la revisión de las12:35UTC encontró ambos servicios activos y lo corrigió; ver actualización al cierre. UAT conserva su configuración y runtime anteriores; una entrega allí requiere el corte coherente y la verificación del spec, no se produce al fusionar un PR MFP.

## Entorno de ejecución separado

Los archivos existentes `apps/studio/.env.local` y `services/workers/.env` contienen una conexión de DB remota y conservan configuración histórica. No copiarlos completos ni enlazarlos a WS1.

El archivo compartido NO incluye `DATABASE_URL`, `REDIS_URL`, selección de modelo, callbacks de login ni flags de ejecución. WS1 debe configurar los servicios del `dev-test` remoto con conexiones exclusivas de MFP y cargar sólo las credenciales necesarias por servicio. PostgreSQL, Redis y Worker corren allí; no se levanta Docker en la Mac. Las conexiones privadas de ese entorno se resuelven desde el runner remoto, no copiando URLs históricas al proceso local. Mantener secretos en variables privadas del servicio y fuera de Git, logs y recibos. El archivo compartido no acredita que la base/cola MFP ya estén provisionadas: WS1 verifica y configura ese destino según §9.1 del spec.

Tener una clave no sustituye autoridad, configuración del servicio ni derechos sobre los datos. Los presupuestos de las demos son orientativos: el fundador autoriza superarlos para completar el programa, con coste registrado y previsión actualizada; no se pide autorización rutinaria por una desviación. Sólo un máximo estricto configurado explícitamente constituye un tope (§6.5). WS3 verifica JEV con fuentes oficiales y pruebas según §9.3; `JEV_DUE_DILIGENCE.md` registra evidencia, sin firma ni carta obligatorias. Las restricciones reales de tratamiento de datos siguen aplicando. UAT admite cortes parciales coherentes según §6.9; producción conserva su aceptación integral.

Las sesiones de GitHub/Railway/navegador y los permisos de herramientas pertenecen al host y al chat; no son credenciales que deban extraerse de almacenes o copiarse indiscriminadamente a dotenv. El nuevo chat debe usar las sesiones existentes cuando estén disponibles y comprobar el permiso necesario para una operación concreta. No afirmar acceso de escritura por haber validado sólo lectura.

## Instrucción para el nuevo orquestador

Lee este documento junto al spec. Ya hay credenciales compartidas, incluidas Claude, Voyage y JEV. No vuelvas a pedirlas sin comprobar primero su disponibilidad y el error real de la operación necesaria. Enlaza su carga selectiva al harness remoto de WS1, usando exclusivamente su destino dev-test verificado, sin heredar la base/cola de los .env históricos. No publiques claves, no leas secretos históricos y no actives el loop anterior. Si una credencial falla, registra sólo servicio y código saneado; continúa el trabajo independiente.

## Verificación operativa del programa — 4 de octubre de 2026

El CLI oficial de Railway y SSH ya tienen acceso autorizado por el fundador. Proyecto `noisia-signal-v02-uat`, entorno `dev-test`; los identificadores exactos y controles de destino están versionados en `scripts/dev-corpus/target.json`. No repetir recuperación de conexión ni reconstrucción histórica del esquema.

MFP usa la base/rol exclusivos `noisia_mfp`, Redis privado y `mfp-private-runner` en la misma región remota. El runner mantiene el corpus en `/app/.data/dev-corpus`; Studio de desarrollo está en `https://mfp-studio-dev-test.up.railway.app`. Autodeploy desactivado. Estos recursos no son UAT ni producción. Las claves de proveedores se cargan selectivamente en memoria para cada ejecución autorizada; no están instaladas de forma permanente en el runner. La configuración privada de conexiones permanece fuera de Git.

El bucket privado `mfp-corpus-files` pasó la comprobación de disponibilidad requerida por el runtime. Usar los nombres de entorno `SUPABASE_STORAGE_BUCKET_IMPORTS` y `SUPABASE_STORAGE_BUCKET_CORPUS_FILES` que consume el código; no inventar una variable genérica de bucket.

- Claude: `claude-sonnet-5-5` comprobado en la cuenta; una prueba sintética real de Message Batches completó transporte, salida estructurada y parser. La prueba del corpus tiene su recibo en `DELIVERY_MFP_WS2_2026-10-04.md`.
- Voyage: `voyage-4-large`,1024 dimensiones, transporte real confirmado sobre905 raíces.32 respuestas HTTP200,809,294 tokens y USD0.097130 registrados; replay con clave retirada y proveedor deshabilitado no hizo nuevas llamadas. La ejecución requiere explícitamente `NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED=true`; su omisión produjo un intento definitivamente no enviado, recuperado sin duplicación.
- JEV: `jev-1.13.0` completó905 raíces reales y recuperó10 errores técnicos:915 llamadas, USD0.154879,898labeled/7abstained/0error; replay sin llamadas nuevas. Condiciones técnicas y tratamiento de datos en `JEV_DUE_DILIGENCE.md`; no acredita precisión semántica humana.
- Kinde: sesión administrativa existente comprobada. El fundador registró el callback y logout exactos de Studio dev-test. La navegación a `/studio` redirige al formulario de Kinde sin el antiguo error de callback; aún falta completar el login y verificar la llegada autenticada a Studio. No usar bypass de autorización.

Los resultados de proveedor prueban las capacidades indicadas, no el saldo futuro ni calidad semántica. Los recibos de corpus y gold permanecen privados bajo `.data/dev-corpus/`; no copiar textos a la documentación pública. El workspace con embeddings simulados y el de Voyage real son distintos dentro de la misma base MFP, sin clonar bases.

### Ajuste verificado · 2026-10-04 12:35UTC

La UI Railway confirmó **Auto deploy is disabled** en `mfp-private-runner` y
`mfp-studio` después de desactivarlo y recargar cada página. Antes del ajuste,
el merge de PR19 había desplegado automáticamente develop `ada9d98` en el
runner y cortado una prueba PG; transacción revertida, volumen conservado.
Los despliegues MFP siguientes son explícitos. No cambiar la fuente con
`service source connect` sin verificar después que autodeploy siga desactivado.

Claude completó905 estados (831labeled/74abstained/0error), replay y alias
selectivo A→B→A con recuperación de caché sin llamadas al volver aA. Recibo
actualizado en `DELIVERY_MFP_WS2_2026-10-04.md`. Sigue pendiente la evaluación
humana gold y el recorrido autenticado por Kinde.

Coste de proveedores liquidado conocido del programa hasta este corte:
**USD4.872032684**, incluyendo pruebas fallidas liquidadas, recuperaciones,
alias y probes sintéticos de pertenencia (USD0.091632). Excluye infraestructura
y rechazos de esquema sin uso/coste observado (`settled=null`); no se anotan
como coste cero. Los presupuestos siguen orientativos, sin máximo estricto
configurado en estas ejecuciones.
